package lod

import (
	"maps"
	"testing"
)

func TestPendKeepsWhatWaitsAndSettlesTheRest(t *testing.T) {
	for _, tc := range []struct {
		name   string
		before map[Kind]map[string]any
		saved  map[string]any
		pend   []string
		want   map[Kind]map[string]any
	}{
		{
			name:  "restart-only keys of a running save are recorded",
			saved: map[string]any{"lodStore": "off", "lodDistanceChunks": 256},
			pend:  []string{"lodStore"},
			want:  map[Kind]map[string]any{LSS: {"lodStore": "off"}},
		},
		{
			name:   "a key saved again and applied is no longer pending",
			before: map[Kind]map[string]any{LSS: {"lodStore": "off", "enabled": false}},
			saved:  map[string]any{"enabled": true},
			want:   map[Kind]map[string]any{LSS: {"lodStore": "off"}},
		},
		{
			name:   "a newer pending value replaces the older one",
			before: map[Kind]map[string]any{LSS: {"lodStoreMaxMB": 10}},
			saved:  map[string]any{"lodStoreMaxMB": 20},
			pend:   []string{"lodStoreMaxMB"},
			want:   map[Kind]map[string]any{LSS: {"lodStoreMaxMB": 20}},
		},
		{
			name:   "nothing left pending leaves no map behind",
			before: map[Kind]map[string]any{LSS: {"enabled": false}},
			saved:  map[string]any{"enabled": true},
			want:   nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Settings{PendingConfig: tc.before}
			s.Pend(LSS, tc.saved, tc.pend)
			if !maps.EqualFunc(s.PendingConfig, tc.want, func(a, b map[string]any) bool { return maps.Equal(a, b) }) ||
				(tc.want == nil) != (s.PendingConfig == nil) {
				t.Fatalf("pending %v, want %v", s.PendingConfig, tc.want)
			}
		})
	}
}

func TestTakePendingReturnsAndForgetsOneKind(t *testing.T) {
	s := Settings{PendingConfig: map[Kind]map[string]any{LSS: {"lodStore": "off"}, DHS: {"x": 1}}}
	got := s.TakePending(LSS)
	if got["lodStore"] != "off" {
		t.Fatalf("took %v", got)
	}
	if _, ok := s.PendingConfig[LSS]; ok || len(s.PendingConfig) != 1 {
		t.Fatalf("left %v", s.PendingConfig)
	}
	s.TakePending(DHS)
	if s.PendingConfig != nil {
		t.Fatalf("left %v", s.PendingConfig)
	}
}

func TestCloneSharesNothingWithTheManifest(t *testing.T) {
	s := Settings{Pregens: []Pregen{{World: "world"}}, PendingConfig: map[Kind]map[string]any{LSS: {"lodStore": "off"}}}
	c := s.Clone()
	c.Pregens[0].World = "other"
	c.PendingConfig[LSS]["lodStore"] = "on"
	if s.Pregens[0].World != "world" || s.PendingConfig[LSS]["lodStore"] != "off" {
		t.Fatalf("the original changed: %+v", s)
	}
}
