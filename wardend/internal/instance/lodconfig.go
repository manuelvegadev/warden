package instance

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/manuelvega/warden/wardend/internal/lod"
	"github.com/manuelvega/warden/wardend/internal/mc"
)

var (
	// ErrNoLODConfig: the plugin has not written its configuration file yet.
	ErrNoLODConfig = errors.New("the plugin has not written its configuration yet: start the server once")
	// ErrBadLODConfig: the configuration file cannot be read (wrapped with the reason).
	ErrBadLODConfig = errors.New("bad configuration")
)

func (i *Instance) lodConfigPath(in lod.Installed) (rel, abs string) {
	rel = in.Provider.ConfigPath(in.Brand)
	return rel, filepath.Join(i.ServerDir(), filepath.FromSlash(rel))
}

// LODConfig reads a LOD plugin's main keys: the file's values, a value still pending for the next
// start in their place (what the panel saved is what it shows), defaults where the file has none.
func (i *Instance) LODConfig(in lod.Installed) (rel string, exists bool, values map[string]any, err error) {
	rel, path := i.lodConfigPath(in)
	raw, err := os.ReadFile(path)
	exists = err == nil
	values, err = in.Provider.ReadConfig(raw)
	if err != nil {
		return rel, exists, nil, fmt.Errorf("%w: %v", ErrBadLODConfig, err)
	}
	if pending, err := in.Provider.Validate(i.LOD().PendingConfig[in.Provider.Kind]); err == nil {
		maps.Copy(values, pending)
	}
	return rel, exists, values, nil
}

// SaveLODConfig writes validated values into a LOD plugin's configuration file and, while the
// server runs, applies what can apply live through run (the agent). It answers which keys applied
// and which wait for a restart.
//
// VSS/LSS saves its whole in-memory configuration over the file on every live `set`, still holding
// the boot-time value of each restart-only key, so a value that did not apply live while the plugin
// runs is also kept pending in the manifest and written into the file again just before the next
// start (applyPendingLODConfig). DHS re-reads its file on `/dhs reload` and never writes it: nothing
// is pending for it. A save while the server is stopped writes the file directly, earlier pending
// values included, and leaves nothing pending.
func (i *Instance) SaveLODConfig(ctx context.Context, in lod.Installed, values map[string]any, run lod.Runner) (applied, restart []string, err error) {
	i.lodConfigMu.Lock()
	defer i.lodConfigMu.Unlock()
	_, path := i.lodConfigPath(in)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, ErrNoLODConfig
	}
	kind := in.Provider.Kind
	st := i.State()
	alive := st != StateStopped && st != StateCrashed
	write := values
	if !alive {
		// The file is the truth while the server is stopped: what was pending goes in now.
		if pending, err := in.Provider.Validate(i.LOD().PendingConfig[kind]); err == nil && len(pending) > 0 {
			write = maps.Clone(pending)
			maps.Copy(write, values)
		}
	}
	out, err := in.Provider.WriteConfig(raw, write)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", ErrBadLODConfig, err)
	}
	if err := mc.WriteAtomic(path, out); err != nil {
		return nil, nil, err
	}
	// A stopped server reads the file at its next start: nothing to apply, nothing to wait for.
	applied, restart = []string{}, []string{}
	running, _ := i.Running()
	if running && in.Enabled {
		cmds, rest := in.Provider.Live(in.Brand, values)
		failed := false // without the agent nothing applied live: everything waits for the restart
		for _, c := range cmds {
			if _, err := run.Run(ctx, i.Manifest.ID, c); err != nil {
				failed = true
				break
			}
		}
		for k := range values {
			if failed || slices.Contains(rest, k) {
				restart = append(restart, k)
			} else {
				applied = append(applied, k)
			}
		}
		sort.Strings(applied)
		sort.Strings(restart)
	}
	var pend []string
	if alive && in.Enabled && kind == lod.LSS {
		if running {
			pend = restart
		} else {
			pend = slices.Collect(maps.Keys(values)) // starting or stopping: nothing applied live
		}
	}
	err = i.UpdateLOD(func(s *lod.Settings) {
		if !alive {
			s.TakePending(kind)
		}
		s.Pend(kind, values, pend)
	})
	return applied, restart, err
}

// applyPendingLODConfig writes the LOD configuration values saved while the server ran into their
// files, just before a start, and forgets them. Returns a console line to show, or "".
func (i *Instance) applyPendingLODConfig() string {
	i.lodConfigMu.Lock()
	defer i.lodConfigMu.Unlock()
	pending := i.LOD().PendingConfig
	if len(pending) == 0 {
		return ""
	}
	installed := i.LODInstalled()
	var done, failed []string
	for kind, values := range pending {
		idx := slices.IndexFunc(installed, func(in lod.Installed) bool { return in.Provider.Kind == kind })
		if idx >= 0 {
			if err := i.writePendingLODConfig(installed[idx], values); err != nil {
				slog.Warn("apply pending LOD configuration", "instance", i.Manifest.ID, "kind", kind, "err", err)
				failed = append(failed, installed[idx].Brand.Title)
				continue // kept for the next start
			}
			done = append(done, installed[idx].Brand.Title)
		}
		// Applied, or its plugin is gone: either way nothing is pending for it any more.
		if err := i.UpdateLOD(func(s *lod.Settings) { s.TakePending(kind) }); err != nil {
			slog.Warn("forget pending LOD configuration", "instance", i.Manifest.ID, "kind", kind, "err", err)
		}
	}
	sort.Strings(done)
	sort.Strings(failed)
	var msgs []string
	if len(done) > 0 {
		msgs = append(msgs, "Distant view: applied the "+strings.Join(done, ", ")+" settings saved while the server was running.")
	}
	if len(failed) > 0 {
		msgs = append(msgs, "Distant view: could not apply the "+strings.Join(failed, ", ")+" settings saved while the server was running; they are kept for the next start.")
	}
	return strings.Join(msgs, " ")
}

// writePendingLODConfig writes pending values into the plugin's file. A file that is gone is left
// alone: the plugin writes its defaults again, and a partial file would not be its configuration.
func (i *Instance) writePendingLODConfig(in lod.Installed, values map[string]any) error {
	values, err := in.Provider.Validate(values) // the manifest turned whole numbers into float64
	if err != nil {
		return err
	}
	_, path := i.lodConfigPath(in)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	out, err := in.Provider.WriteConfig(raw, values)
	if err != nil {
		return err
	}
	return mc.WriteAtomic(path, out)
}
