package lod

import (
	"maps"
	"slices"
	"time"
)

// Settings is the instance's LOD state, kept in instance.json (`lod`).
type Settings struct {
	BackupIncludeData bool     `json:"backupIncludeData,omitempty"`
	Pregens           []Pregen `json:"pregens,omitempty"`
	// PendingConfig are configuration values saved while the server ran that the plugin would
	// overwrite before its next start, by kind: VSS/LSS saves its whole in-memory configuration over
	// the file on every live `set`, still holding the boot-time value of a restart-only key. They are
	// written into the file again just before the next start, and then forgotten.
	PendingConfig map[Kind]map[string]any `json:"pendingConfig,omitempty"`
}

// Pregen is one DHS pre-generation the daemon keeps going: what was asked, when, and the server
// session (its start time) it was last launched in, which tells a restart from a manual stop.
type Pregen struct {
	World     string     `json:"world"`
	X         *int       `json:"x,omitempty"`
	Z         *int       `json:"z,omitempty"`
	Radius    *int       `json:"radius,omitempty"` // chunks
	StartedAt time.Time  `json:"startedAt"`
	Session   time.Time  `json:"session"`
	ResumedAt *time.Time `json:"resumedAt,omitempty"`
}

// Clone is a deep copy: the manifest's slices and maps are never shared with a caller.
func (s Settings) Clone() Settings {
	s.Pregens = slices.Clone(s.Pregens)
	if s.PendingConfig != nil {
		pending := make(map[Kind]map[string]any, len(s.PendingConfig))
		for k, v := range s.PendingConfig {
			pending[k] = maps.Clone(v)
		}
		s.PendingConfig = pending
	}
	return s
}

// Pend records what a save left pending for a kind: the saved keys in pend keep their new value
// until the next start; every other saved key is settled (the file and the plugin agree on it).
func (s *Settings) Pend(kind Kind, saved map[string]any, pend []string) {
	pending := maps.Clone(s.PendingConfig[kind])
	if pending == nil {
		pending = map[string]any{}
	}
	for k, v := range saved {
		if slices.Contains(pend, k) {
			pending[k] = v
		} else {
			delete(pending, k)
		}
	}
	s.setPending(kind, pending)
}

// TakePending returns the kind's pending values and forgets them.
func (s *Settings) TakePending(kind Kind) map[string]any {
	out := s.PendingConfig[kind]
	s.setPending(kind, nil)
	return out
}

func (s *Settings) setPending(kind Kind, values map[string]any) {
	if len(values) == 0 {
		delete(s.PendingConfig, kind)
		if len(s.PendingConfig) == 0 {
			s.PendingConfig = nil
		}
		return
	}
	if s.PendingConfig == nil {
		s.PendingConfig = map[Kind]map[string]any{}
	}
	s.PendingConfig[kind] = values
}
