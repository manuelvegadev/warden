package lod

import (
	"encoding/json"
	"strings"
	"testing"
)

const dhsYAML = `# Distant Horizons Support
config_version: 10
render_distance: 1024 # in chunks
generate_new_chunks: true
builder_type: FullBuilder
scheduler_threads: 4
material_map:
  minecraft:water: water
`

func TestReadConfigFillsDefaultsForMissingKeys(t *testing.T) {
	dhs, _ := ByKind(DHS)
	v, err := dhs.ReadConfig([]byte(dhsYAML))
	if err != nil {
		t.Fatal(err)
	}
	if v["render_distance"] != 1024 || v["generate_new_chunks"] != true || v["builder_type"] != "FullBuilder" {
		t.Fatalf("read %v", v)
	}
	if v["real_time_updates_enabled"] != true { // absent from the file: its default
		t.Fatalf("default %v", v["real_time_updates_enabled"])
	}
}

func TestReadConfigWithoutAFileGivesDefaults(t *testing.T) {
	lss, _ := ByKind(LSS)
	v, err := lss.ReadConfig(nil)
	if err != nil || v["lodDistanceChunks"] != 512 {
		t.Fatalf("got %v %v", v, err)
	}
}

func TestWriteYAMLKeepsTheRestOfTheFile(t *testing.T) {
	dhs, _ := ByKind(DHS)
	out, err := dhs.WriteConfig([]byte(dhsYAML), map[string]any{"render_distance": 512, "real_time_updates_enabled": false})
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	for _, want := range []string{"render_distance: 512", "real_time_updates_enabled: false", "minecraft:water: water", "# Distant Horizons Support", "config_version: 10"} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q in:\n%s", want, s)
		}
	}
}

func TestWriteJSONKeepsOtherKeys(t *testing.T) {
	lss, _ := ByKind(LSS)
	in := []byte(`{"enabled": true, "lodDistanceChunks": 512, "updateEvents": ["a.B"]}`)
	out, err := lss.WriteConfig(in, map[string]any{"lodDistanceChunks": 256})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatal(err)
	}
	if m["lodDistanceChunks"] != float64(256) || m["enabled"] != true || m["updateEvents"] == nil {
		t.Fatalf("wrote %s", out)
	}
}

func TestValidate(t *testing.T) {
	lss, _ := ByKind(LSS)
	tests := []struct {
		in      map[string]any
		wantErr bool
	}{
		{map[string]any{"lodDistanceChunks": float64(256)}, false}, // JSON numbers arrive as float64
		{map[string]any{"lodDistanceChunks": float64(4096)}, true}, // above the maximum
		{map[string]any{"lodDistanceChunks": 1.5}, true},
		{map[string]any{"farPlayers": "sideways"}, true},
		{map[string]any{"enabled": "yes"}, true},
		{map[string]any{"notAKey": 1}, true},
	}
	for _, tt := range tests {
		got, err := lss.Validate(tt.in)
		if (err != nil) != tt.wantErr {
			t.Errorf("%v: err %v", tt.in, err)
		}
		if err == nil && got["lodDistanceChunks"] != 256 {
			t.Errorf("%v: normalised %v", tt.in, got)
		}
	}
}

func TestValidateWithOnlyOneBoundSet(t *testing.T) {
	minOnly := &Provider{Keys: []Key{{Name: "atLeast", Type: "int", Min: ptr(10)}}}
	if _, err := minOnly.Validate(map[string]any{"atLeast": float64(5)}); err == nil || !strings.Contains(err.Error(), "at least 10") {
		t.Fatalf("min-only: %v", err)
	}
	if _, err := minOnly.Validate(map[string]any{"atLeast": float64(20)}); err != nil {
		t.Fatalf("min-only, in range: %v", err)
	}

	maxOnly := &Provider{Keys: []Key{{Name: "atMost", Type: "int", Max: ptr(10)}}}
	if _, err := maxOnly.Validate(map[string]any{"atMost": float64(20)}); err == nil || !strings.Contains(err.Error(), "at most 10") {
		t.Fatalf("max-only: %v", err)
	}
	if _, err := maxOnly.Validate(map[string]any{"atMost": float64(5)}); err != nil {
		t.Fatalf("max-only, in range: %v", err)
	}
}

func TestLiveCommands(t *testing.T) {
	dhs, _ := ByKind(DHS)
	cmds, restart := dhs.Live(dhs.Brands[0], map[string]any{"render_distance": 512, "scheduler_threads": 8})
	if len(cmds) != 1 || cmds[0] != "dhs reload" || len(restart) != 1 || restart[0] != "scheduler_threads" {
		t.Fatalf("dhs %v %v", cmds, restart)
	}
	lss, _ := ByKind(LSS)
	cmds, restart = lss.Live(lss.Brands[0], map[string]any{"lodDistanceChunks": 256, "lodStore": "off"})
	if len(cmds) != 1 || cmds[0] != "vsslod set lodDistanceChunks 256" || len(restart) != 1 {
		t.Fatalf("lss %v %v", cmds, restart)
	}
}
