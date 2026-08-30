// Package metrics samples CPU/RAM/disk per instance from /proc (gopsutil) and persists series to SQLite.
package metrics

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/manuelvega/warden/wardend/internal/bus"
	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/store"
)

// Sample is what the UI receives every tick.
type Sample struct {
	TS       time.Time   `json:"ts"`
	CPU      float64     `json:"cpu"`      // percent of one core
	MemRSS   int64       `json:"memRss"`   // bytes
	MemMax   int64       `json:"memMax"`   // -Xmx in bytes
	DiskUsed int64       `json:"diskUsed"` // bytes used by the instance directory
	Players  int         `json:"players"`
	NetRx    int64       `json:"netRx"` // bytes/s on host interfaces (Linux has no per-process counters without eBPF)
	NetTx    int64       `json:"netTx"`
	TPS      *[3]float64 `json:"tps,omitempty"` // 1m, 5m, 15m from Paper's `tps`
}

type Sampler struct {
	mgr      *instance.Manager
	st       *store.Store
	bc       bus.Broadcaster
	interval time.Duration
	dataDir  string
	traits   func(software string) catalog.Traits

	platformOnce     sync.Once
	platform, kernel string

	mu      sync.RWMutex
	procs   map[string]*process.Process
	latest  map[string]Sample
	disk    map[string]diskCache
	history map[string][]Sample // in-memory ring (last hour) as a fallback when the store is nil

	netAt     time.Time
	netRx     uint64
	netTx     uint64
	netRxRate int64
	netTxRate int64
	tpsTick   int
}

type diskCache struct {
	at   time.Time
	size int64
}

// traits tells the sampler which software answers the `tps` command (catalog.Registry.TraitsOf).
func NewSampler(mgr *instance.Manager, st *store.Store, bc bus.Broadcaster, dataDir string, traits func(string) catalog.Traits) *Sampler {
	return &Sampler{mgr: mgr, st: st, bc: bc, interval: 2 * time.Second, dataDir: dataDir, traits: traits,
		procs: map[string]*process.Process{}, latest: map[string]Sample{}, disk: map[string]diskCache{}, history: map[string][]Sample{}}
}

// Run samples until ctx is cancelled.
func (s *Sampler) Run(ctx context.Context) {
	t := time.NewTicker(s.interval)
	defer t.Stop()
	prune := time.NewTicker(time.Hour)
	defer prune.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.tick(ctx)
		case <-prune.C:
			if s.st != nil {
				_ = s.st.Prune(ctx, time.Now().Add(-7*24*time.Hour))
			}
		}
	}
}

// hostNet updates host-wide network rates (bytes/s) from interface counters.
func (s *Sampler) hostNet(ctx context.Context) {
	cs, err := gnet.IOCountersWithContext(ctx, false)
	if err != nil || len(cs) == 0 {
		return
	}
	now := time.Now()
	if !s.netAt.IsZero() {
		dt := now.Sub(s.netAt).Seconds()
		if dt > 0 {
			s.netRxRate = rate(s.netRx, cs[0].BytesRecv, dt)
			s.netTxRate = rate(s.netTx, cs[0].BytesSent, dt)
		}
	}
	s.netAt, s.netRx, s.netTx = now, cs[0].BytesRecv, cs[0].BytesSent
}

// rate is bytes/s between two counter readings. The "all interfaces" total goes backwards when
// an interface disappears (Docker networks come and go); an unsigned subtraction would then wrap
// and the int64 conversion overflow to MinInt64, so a step back reads as 0 for that interval.
func rate(prev, cur uint64, dt float64) int64 {
	if cur < prev {
		return 0
	}
	return int64(float64(cur-prev) / dt)
}

func (s *Sampler) tick(ctx context.Context) {
	s.hostNet(ctx)
	s.tpsTick++
	pollTPS := s.tpsTick%8 == 0 // every ~16 s
	for _, inst := range s.mgr.List() {
		st := inst.Status()
		id := inst.Manifest.ID
		if st.PID == 0 {
			s.mu.Lock()
			delete(s.procs, id)
			delete(s.latest, id)
			s.mu.Unlock()
			continue
		}
		s.mu.Lock()
		p, ok := s.procs[id]
		if !ok || int(p.Pid) != st.PID {
			np, err := process.NewProcess(int32(st.PID))
			if err != nil {
				s.mu.Unlock()
				continue
			}
			p = np
			s.procs[id] = p
			_, _ = p.Percent(0) // prime the CPU counter
		}
		s.mu.Unlock()

		if pollTPS && s.traits(inst.Manifest.Software).TPSCommand {
			inst.PollTPS()
		}
		sample := Sample{TS: time.Now().UTC(), MemMax: int64(inst.Manifest.MemoryMB) << 20, Players: len(st.Players),
			NetRx: s.netRxRate, NetTx: s.netTxRate, TPS: st.TPS}
		if c, err := p.Percent(0); err == nil {
			sample.CPU = c
		}
		if m, err := p.MemoryInfo(); err == nil {
			sample.MemRSS = int64(m.RSS)
		}
		sample.DiskUsed = s.diskUsage(id, inst.Dir)

		s.mu.Lock()
		s.latest[id] = sample
		h := append(s.history[id], sample)
		if max := int(time.Hour / s.interval); len(h) > max {
			h = h[len(h)-max:]
		}
		s.history[id] = h
		s.mu.Unlock()

		s.bc.Broadcast(id, "metrics", sample)
		if s.st != nil {
			row := store.MetricRow{TS: sample.TS, CPU: sample.CPU, MemRSS: sample.MemRSS, DiskUsed: sample.DiskUsed, Players: sample.Players, NetRx: sample.NetRx, NetTx: sample.NetTx}
			if sample.TPS != nil {
				t := sample.TPS[0]
				row.TPS1 = &t
			}
			if err := s.st.InsertMetric(ctx, id, row); err != nil {
				slog.Debug("insert metric", "err", err)
			}
		}
	}
}

// diskUsage walks the instance directory at most every 30 s.
func (s *Sampler) diskUsage(id, dir string) int64 {
	s.mu.RLock()
	c, ok := s.disk[id]
	s.mu.RUnlock()
	if ok && time.Since(c.at) < 30*time.Second {
		return c.size
	}
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			total += info.Size()
		}
		return nil
	})
	s.mu.Lock()
	s.disk[id] = diskCache{at: time.Now(), size: total}
	s.mu.Unlock()
	return total
}

func (s *Sampler) Latest(id string) *Sample {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if v, ok := s.latest[id]; ok {
		return &v
	}
	return nil
}

func (s *Sampler) History(ctx context.Context, id string, since time.Time) []Sample {
	if s.st != nil {
		if rows, err := s.st.Metrics(ctx, id, since); err == nil {
			out := make([]Sample, 0, len(rows))
			for _, r := range rows {
				sm := Sample{TS: r.TS, CPU: r.CPU, MemRSS: r.MemRSS, DiskUsed: r.DiskUsed, Players: r.Players, NetRx: r.NetRx, NetTx: r.NetTx}
				if r.TPS1 != nil {
					sm.TPS = &[3]float64{*r.TPS1, 0, 0}
				}
				out = append(out, sm)
			}
			return out
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Sample{}
	for _, v := range s.history[id] {
		if !v.TS.Before(since) {
			out = append(out, v)
		}
	}
	return out
}

// DiskUsage is the filesystem holding the data directory.
type DiskUsage struct {
	Path  string `json:"path"`
	Total uint64 `json:"total"`
	Used  uint64 `json:"used"`
}

// HostInfo is the host-level snapshot behind GET /system. Pointer fields are omitted when the
// platform cannot report them.
type HostInfo struct {
	Platform   string      `json:"platform,omitempty"` // "ubuntu 26.04"
	Kernel     string      `json:"kernel,omitempty"`
	HostUptime uint64      `json:"hostUptime,omitempty"` // seconds
	MemTotal   uint64      `json:"memTotal,omitempty"`
	MemUsed    uint64      `json:"memUsed,omitempty"`
	CPUPercent *float64    `json:"cpuPercent,omitempty"`
	Load       *[3]float64 `json:"load,omitempty"` // 1m, 5m, 15m
	Disk       *DiskUsage  `json:"disk,omitempty"`
}

// System returns the host snapshot. Platform and kernel never change for the process, so they are
// resolved once; the rest is one proc/sysctl read each.
func (s *Sampler) System(ctx context.Context) HostInfo {
	s.platformOnce.Do(func() {
		if info, err := host.InfoWithContext(ctx); err == nil {
			s.platform = strings.TrimSpace(info.Platform + " " + info.PlatformVersion)
			s.kernel = info.KernelVersion
		}
	})
	out := HostInfo{Platform: s.platform, Kernel: s.kernel}
	if up, err := host.UptimeWithContext(ctx); err == nil {
		out.HostUptime = up
	}
	if v, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		out.MemTotal, out.MemUsed = v.Total, v.Used
	}
	if l, err := load.AvgWithContext(ctx); err == nil {
		out.Load = &[3]float64{l.Load1, l.Load5, l.Load15}
	}
	if pct, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(pct) > 0 {
		out.CPUPercent = &pct[0]
	}
	if d, err := disk.UsageWithContext(ctx, s.dataDir); err == nil {
		out.Disk = &DiskUsage{Path: s.dataDir, Total: d.Total, Used: d.Used}
	}
	return out
}
