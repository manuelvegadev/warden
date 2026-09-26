package metrics

import (
	"testing"
	"time"
)

func TestBucket(t *testing.T) {
	t0 := time.Unix(1_700_000_040, 0).UTC() // a minute boundary
	at := func(s int) time.Time { return t0.Add(time.Duration(s) * time.Second) }
	tps := func(v float64) *[3]float64 { return &[3]float64{v, 0, 0} }
	f := func(v float64) *float64 { return &v }

	type want struct {
		start       int // seconds after t0
		cpu, cpuMax float64
		mem, memMax int64
		tps, tpsMin float64 // 0 = no TPS in the step
		players     int
		disk        int64
	}
	tests := []struct {
		name    string
		samples []Sample
		step    time.Duration
		want    []want
	}{
		{
			name: "a step averages its samples and keeps the peak beside the average",
			samples: []Sample{
				{TS: at(0), CPU: 10, MemRSS: 100, TPS: tps(20), Players: 1, DiskUsed: 5},
				{TS: at(20), CPU: 50, MemRSS: 300, TPS: tps(14), Players: 4, DiskUsed: 9},
				{TS: at(40), CPU: 30, MemRSS: 200, TPS: tps(20), Players: 2, DiskUsed: 7},
			},
			step: time.Minute,
			want: []want{{start: 0, cpu: 30, cpuMax: 50, mem: 200, memMax: 300, tps: 18, tpsMin: 14, players: 4, disk: 9}},
		},
		{
			name:    "steps are aligned to the epoch, not to the first sample",
			samples: []Sample{{TS: at(50), CPU: 10}, {TS: at(70), CPU: 20}},
			step:    time.Minute,
			want:    []want{{start: 0, cpu: 10, cpuMax: 10}, {start: 60, cpu: 20, cpuMax: 20}},
		},
		{
			name:    "a step without samples is left out, so a stopped server stays a gap",
			samples: []Sample{{TS: at(0), CPU: 10}, {TS: at(300), CPU: 20}},
			step:    time.Minute,
			want:    []want{{start: 0, cpu: 10, cpuMax: 10}, {start: 300, cpu: 20, cpuMax: 20}},
		},
		{
			name: "a rolled-up minute weighs as many samples as it stands for, and brings its own peaks",
			samples: []Sample{
				{TS: at(0), CPU: 10, MemRSS: 100, CPUMax: f(90), MemRSSMax: ptr[int64](400), TPS: tps(19), TPSMin: f(5), samples: 30},
				{TS: at(60), CPU: 40, MemRSS: 100, TPS: tps(20)},
			},
			step: 2 * time.Minute, // t0 is on a two-minute boundary too
			want: []want{{start: 0, cpu: (10*30 + 40) / 31.0, cpuMax: 90, mem: 100, memMax: 400, tps: (19*30 + 20) / 31.0, tpsMin: 5}},
		},
		{
			name:    "samples without TPS (Vanilla, Fabric) leave it out of the step",
			samples: []Sample{{TS: at(0), CPU: 10}, {TS: at(10), CPU: 20}},
			step:    time.Minute,
			want:    []want{{start: 0, cpu: 15, cpuMax: 20}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Bucket(tt.samples, tt.step)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d buckets, want %d: %+v", len(got), len(tt.want), got)
			}
			for i, w := range tt.want {
				g := got[i]
				if !g.TS.Equal(at(w.start)) {
					t.Errorf("bucket %d starts at %s, want %s", i, g.TS, at(w.start))
				}
				if !near(g.CPU, w.cpu) || !near(*g.CPUMax, w.cpuMax) {
					t.Errorf("bucket %d cpu = %v (max %v), want %v (max %v)", i, g.CPU, *g.CPUMax, w.cpu, w.cpuMax)
				}
				if g.MemRSS != w.mem || *g.MemRSSMax != w.memMax {
					t.Errorf("bucket %d mem = %d (max %d), want %d (max %d)", i, g.MemRSS, *g.MemRSSMax, w.mem, w.memMax)
				}
				if w.tps == 0 {
					if g.TPS != nil || g.TPSMin != nil {
						t.Errorf("bucket %d has TPS %v, want none", i, g.TPS)
					}
				} else if g.TPS == nil || !near(g.TPS[0], w.tps) || !near(*g.TPSMin, w.tpsMin) {
					t.Errorf("bucket %d tps = %v (min %v), want %v (min %v)", i, g.TPS, g.TPSMin, w.tps, w.tpsMin)
				}
				if g.Players != w.players || g.DiskUsed != w.disk {
					t.Errorf("bucket %d players/disk = %d/%d, want %d/%d", i, g.Players, g.DiskUsed, w.players, w.disk)
				}
			}
		})
	}
}

func near(a, b float64) bool { return a-b < 1e-9 && b-a < 1e-9 }

func ptr[T any](v T) *T { return &v }
