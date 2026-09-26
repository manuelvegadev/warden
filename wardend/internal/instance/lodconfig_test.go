package instance

import (
	"context"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/manuelvega/warden/wardend/internal/lod"
)

const vssConfigRel = "plugins/VoxyServerSide/vss-server-config.json"

// fakeVSS runs `vsslod set` the way Voxy Server Side does: the key changes in memory and the whole
// in-memory configuration — read at boot — is saved over the file.
type fakeVSS struct {
	mu     sync.Mutex
	path   string
	memory map[string]any
	ran    []string
}

func (f *fakeVSS) Run(_ context.Context, _ string, cmd string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ran = append(f.ran, cmd)
	parts := strings.Fields(cmd)
	if len(parts) == 4 && parts[0] == "vsslod" && parts[1] == "set" {
		var v any
		if json.Unmarshal([]byte(parts[3]), &v) != nil {
			v = parts[3]
		}
		f.memory[parts[2]] = v
		b, _ := json.MarshalIndent(f.memory, "", "  ")
		os.WriteFile(f.path, b, 0o644)
	}
	return []string{"ok"}, nil
}

// vssInstance is an instance with Voxy Server Side installed and its configuration file as the
// plugin wrote it at boot; the fake plugin's memory holds the same values.
func vssInstance(t *testing.T) (*Instance, lod.Installed, *fakeVSS) {
	t.Helper()
	dir := t.TempDir()
	i := newInstance(dir, &Manifest{ID: "t"}, nil)
	sd := i.ServerDir()
	os.MkdirAll(filepath.Join(sd, "plugins", "VoxyServerSide"), 0o755)
	writeTestJar(t, filepath.Join(sd, "plugins", "voxy-server-side-paper.jar"), "name: VoxyServerSide\nversion: 0.14.0\n")
	boot := map[string]any{"enabled": true, "lodStore": "on", "lodDistanceChunks": float64(512), "untouched": "x"}
	path := filepath.Join(sd, filepath.FromSlash(vssConfigRel))
	b, _ := json.Marshal(boot)
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
	installed := i.LODInstalled()
	if len(installed) != 1 || installed[0].Provider.Kind != lod.LSS {
		t.Fatalf("installed %+v", installed)
	}
	return i, installed[0], &fakeVSS{path: path, memory: maps.Clone(boot)}
}

func setRunning(i *Instance) {
	i.mu.Lock()
	i.state, i.startedAt = StateRunning, time.Now().UTC()
	i.mu.Unlock()
}

func setStopped(i *Instance) {
	i.mu.Lock()
	i.state = StateStopped
	i.mu.Unlock()
}

func readVSSConfig(t *testing.T, i *Instance) map[string]any {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(i.ServerDir(), filepath.FromSlash(vssConfigRel)))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// A restart-only value saved while the server runs survives the plugin saving its boot-time
// configuration over the file on a live `set` (in the same save and in a later one): it is kept
// pending, shown as the current value, written into the file just before the next start and then
// forgotten — also across a daemon restart that reloads the manifest.
func TestRestartOnlyValuesSavedWhileRunningAreWrittenBeforeTheNextStart(t *testing.T) {
	i, in, vss := vssInstance(t)
	setRunning(i)

	applied, restart, err := i.SaveLODConfig(t.Context(), in, map[string]any{"lodStore": "off", "lodDistanceChunks": 256}, vss)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(applied, []string{"lodDistanceChunks"}) || !slices.Equal(restart, []string{"lodStore"}) {
		t.Fatalf("applied %v restart %v", applied, restart)
	}
	if got := readVSSConfig(t, i)["lodStore"]; got != "on" {
		t.Fatalf("the fake plugin should have saved its boot value over the file, got %v", got)
	}
	if p := i.LOD().PendingConfig[lod.LSS]; len(p) != 1 || p["lodStore"] != "off" {
		t.Fatalf("pending %v", i.LOD().PendingConfig)
	}
	// A later live save in the same server session keeps it pending.
	if _, _, err := i.SaveLODConfig(t.Context(), in, map[string]any{"lodDistanceChunks": 300}, vss); err != nil {
		t.Fatal(err)
	}
	_, _, values, err := i.LODConfig(in)
	if err != nil {
		t.Fatal(err)
	}
	if values["lodStore"] != "off" || values["lodDistanceChunks"] != 300 {
		t.Fatalf("the form should show what was saved: %v", values)
	}

	// The daemon restarts in between: the pending value comes back from instance.json.
	m, err := readManifest(i.Dir)
	if err != nil {
		t.Fatal(err)
	}
	i.Manifest = m
	vss.Run(t.Context(), "t", "vsslod set lodDistanceChunks 300") // the file holds the boot-time lodStore again
	setStopped(i)

	if msg := i.applyPendingLODConfig(); !strings.Contains(msg, "Voxy Server Side") {
		t.Fatalf("console line %q", msg)
	}
	file := readVSSConfig(t, i)
	if file["lodStore"] != "off" || file["lodDistanceChunks"] != float64(300) || file["untouched"] != "x" {
		t.Fatalf("file before the start %v", file)
	}
	if i.LOD().PendingConfig != nil {
		t.Fatalf("still pending %v", i.LOD().PendingConfig)
	}
	if msg := i.applyPendingLODConfig(); msg != "" {
		t.Fatalf("nothing left to apply, got %q", msg)
	}
}

func TestASaveWhileStoppedWritesTheFileAndLeavesNothingPending(t *testing.T) {
	for _, tc := range []struct {
		name    string
		pending map[string]any
		saved   map[string]any
		want    map[string]any
	}{
		{name: "nothing pending", saved: map[string]any{"lodStore": "off"}, want: map[string]any{"lodStore": "off", "enabled": true}},
		{
			name:    "an earlier pending value goes into the file too",
			pending: map[string]any{"lodStore": "off", "enabled": false},
			saved:   map[string]any{"enabled": true},
			want:    map[string]any{"lodStore": "off", "enabled": true},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			i, in, vss := vssInstance(t)
			if tc.pending != nil {
				i.UpdateLOD(func(s *lod.Settings) { s.PendingConfig = map[lod.Kind]map[string]any{lod.LSS: tc.pending} })
			}
			applied, restart, err := i.SaveLODConfig(t.Context(), in, tc.saved, vss)
			if err != nil {
				t.Fatal(err)
			}
			if len(applied) != 0 || len(restart) != 0 || len(vss.ran) != 0 {
				t.Fatalf("applied %v restart %v ran %v", applied, restart, vss.ran)
			}
			file := readVSSConfig(t, i)
			for k, v := range tc.want {
				if file[k] != v {
					t.Fatalf("%s = %v in %v", k, file[k], file)
				}
			}
			if i.LOD().PendingConfig != nil {
				t.Fatalf("pending %v", i.LOD().PendingConfig)
			}
		})
	}
}

func TestASaveWithoutAConfigFileAsksForAFirstStart(t *testing.T) {
	i, in, vss := vssInstance(t)
	os.Remove(filepath.Join(i.ServerDir(), filepath.FromSlash(vssConfigRel)))
	if _, _, err := i.SaveLODConfig(t.Context(), in, map[string]any{"lodStore": "off"}, vss); err != ErrNoLODConfig {
		t.Fatalf("got %v", err)
	}
}
