package store

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestRollupFoldsOldSamplesIntoMinutes(t *testing.T) {
	ctx := context.Background()
	t0 := time.Unix(1_700_000_040, 0).UTC() // a minute boundary
	f := func(v float64) *float64 { return &v }
	tests := []struct {
		name    string
		samples []MetricRow
		before  time.Time
		want    []MetricRow // what Metrics reads back, oldest first
	}{
		{
			name: "a minute older than the cut becomes one row with its averages and peaks",
			samples: []MetricRow{
				{TS: t0, CPU: 10, MemRSS: 100, DiskUsed: 5, Players: 1, NetRx: 10, NetTx: 20, TPS1: f(20)},
				{TS: t0.Add(30 * time.Second), CPU: 30, MemRSS: 300, DiskUsed: 7, Players: 3, NetRx: 30, NetTx: 40, TPS1: f(18)},
			},
			before: t0.Add(time.Minute),
			want: []MetricRow{{TS: t0, CPU: 20, MemRSS: 200, DiskUsed: 7, Players: 3, NetRx: 20, NetTx: 30, TPS1: f(19),
				CPUMax: f(30), MemRSSMax: ptr[int64](300), TPS1Min: f(18), Samples: 2}},
		},
		{
			name: "samples after the cut stay raw",
			samples: []MetricRow{
				{TS: t0, CPU: 10, MemRSS: 100},
				{TS: t0.Add(time.Minute), CPU: 50, MemRSS: 500},
			},
			before: t0.Add(time.Minute),
			want: []MetricRow{
				{TS: t0, CPU: 10, MemRSS: 100, CPUMax: f(10), MemRSSMax: ptr[int64](100), Samples: 1},
				{TS: t0.Add(time.Minute), CPU: 50, MemRSS: 500, Samples: 1},
			},
		},
		{
			name:    "a cut inside a minute is truncated to its start, so the minute is not split",
			samples: []MetricRow{{TS: t0.Add(10 * time.Second), CPU: 10}, {TS: t0.Add(50 * time.Second), CPU: 30}},
			before:  t0.Add(40 * time.Second),
			want: []MetricRow{
				{TS: t0.Add(10 * time.Second), CPU: 10, Samples: 1},
				{TS: t0.Add(50 * time.Second), CPU: 30, Samples: 1},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := Open(filepath.Join(t.TempDir(), "t.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			for _, m := range tt.samples {
				if err := s.InsertMetric(ctx, "srv", m); err != nil {
					t.Fatal(err)
				}
			}
			if err := s.Rollup(ctx, tt.before); err != nil {
				t.Fatal(err)
			}
			got, err := s.Metrics(ctx, "srv", t0.Add(-time.Hour))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got  %s\nwant %s", describe(got), describe(tt.want))
			}
		})
	}
}

func TestPruneDropsRolledUpMinutesPastRetention(t *testing.T) {
	ctx := context.Background()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	t0 := time.Unix(1_700_000_040, 0).UTC()
	for _, ts := range []time.Time{t0, t0.Add(2 * time.Minute)} {
		if err := s.InsertMetric(ctx, "srv", MetricRow{TS: ts, CPU: 1}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Rollup(ctx, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.Prune(ctx, t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Metrics(ctx, "srv", t0.Add(-time.Hour))
	if len(got) != 1 || !got[0].TS.Equal(t0.Add(2*time.Minute)) {
		t.Errorf("after prune: %s", describe(got))
	}
}

func ptr[T any](v T) *T { return &v }

func describe(rows []MetricRow) string {
	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "{%s cpu=%v mem=%d disk=%d players=%d rx=%d tx=%d",
			r.TS.Format(time.TimeOnly), r.CPU, r.MemRSS, r.DiskUsed, r.Players, r.NetRx, r.NetTx)
		if r.TPS1 != nil {
			fmt.Fprintf(&b, " tps=%v", *r.TPS1)
		}
		if r.CPUMax != nil {
			fmt.Fprintf(&b, " cpuMax=%v", *r.CPUMax)
		}
		if r.MemRSSMax != nil {
			fmt.Fprintf(&b, " memMax=%d", *r.MemRSSMax)
		}
		if r.TPS1Min != nil {
			fmt.Fprintf(&b, " tpsMin=%v", *r.TPS1Min)
		}
		fmt.Fprintf(&b, " n=%d} ", r.Samples)
	}
	return b.String()
}
