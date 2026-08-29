package instance

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/manuelvega/warden/wardend/internal/backup"
)

const scheduleRetry = 10 * time.Minute

// BackupScheduler runs scheduled backups. It remembers per instance when the last scheduled
// archive was made (seeded once from disk) and when it last tried, so a failing instance is
// retried every scheduleRetry instead of every tick.
type BackupScheduler struct {
	mgr   *Manager
	start func(inst *Instance)
	mu    sync.Mutex
	last  map[string]time.Time // last successful scheduled backup
	tried map[string]time.Time // last attempt (success or failure)
}

func NewBackupScheduler(mgr *Manager, start func(inst *Instance)) *BackupScheduler {
	return &BackupScheduler{mgr: mgr, start: start, last: map[string]time.Time{}, tried: map[string]time.Time{}}
}

// Run ticks every minute until ctx ends.
func (s *BackupScheduler) Run(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.tick()
		}
	}
}

func (s *BackupScheduler) tick() {
	for _, inst := range s.mgr.List() {
		cfg := inst.backupSettings()
		if !cfg.Enabled || inst.State() == StateInstalling {
			continue
		}
		id := inst.Manifest.ID
		s.mu.Lock()
		last, seeded := s.last[id]
		tried := s.tried[id]
		s.mu.Unlock()
		if !seeded {
			last = s.seed(inst)
		}
		if time.Since(last) < time.Duration(cfg.EveryHours)*time.Hour || time.Since(tried) < scheduleRetry {
			continue
		}
		s.mu.Lock()
		s.tried[id] = time.Now()
		s.mu.Unlock()
		s.start(inst)
	}
}

// seed reads the newest scheduled archive from disk once per instance.
func (s *BackupScheduler) seed(inst *Instance) time.Time {
	var last time.Time
	list, err := backup.List(inst.backupsDir())
	if err != nil {
		slog.Warn("backup scheduler: list", "instance", inst.Manifest.ID, "err", err)
	}
	for _, b := range list { // newest first
		if b.Trigger == "schedule" {
			last = b.CreatedAt
			break
		}
	}
	s.mu.Lock()
	s.last[inst.Manifest.ID] = last
	s.mu.Unlock()
	return last
}

// Done records a successful scheduled backup so the next one is measured from now.
func (s *BackupScheduler) Done(id string) {
	s.mu.Lock()
	s.last[id] = time.Now()
	s.mu.Unlock()
}
