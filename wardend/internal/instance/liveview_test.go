package instance

import (
	"archive/zip"
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/manuelvega/warden/wardend/internal/agent"
	"github.com/manuelvega/warden/wardend/internal/catalog"
)

// pluginsOnPaper stands in for the catalog: only Paper loads Bukkit plugins.
func pluginsOnPaper(software string) catalog.Traits {
	return catalog.Traits{Plugins: software == "paper"}
}

// agentJar is a zip with a plugin.yml, which is all placePlugin and agent.Jar's reader look at.
func agentJar(t *testing.T, version string) []byte {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	f, err := zw.Create("plugin.yml")
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte("name: WardenAgent\nversion: " + version + "\nmain: x.Y\napi-version: '26.1'\n"))
	zw.Close()
	return b.Bytes()
}

func TestAgentIsInstalledWhereverItCanRun(t *testing.T) {
	root := t.TempDir()
	m := NewManager(root, nil)
	jar := agentJar(t, "0.1.0")
	m.SetAgent("ws://127.0.0.1:1/agent/v1", func() ([]byte, string, error) { return jar, "0.1.0", nil }, pluginsOnPaper)

	// Created at runtime (the API path): the agent goes in at once, with a token and its config.
	inst, err := m.Create(&Manifest{ID: "alpha", Name: "A", Software: "paper", MCVersion: "26.2", Port: 25565, RconPort: 25575, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(inst.ServerDir(), "plugins", agent.FileName)); err != nil {
		t.Fatalf("jar not installed on create: %v", err)
	}
	cfg, err := os.ReadFile(filepath.Join(inst.ServerDir(), "plugins", "WardenAgent", "config.yml"))
	if err != nil {
		t.Fatal(err)
	}
	lv := inst.LiveView()
	if lv.AgentToken == "" || !strings.Contains(string(cfg), lv.AgentToken) || !strings.Contains(string(cfg), "ws://127.0.0.1:1/agent/v1") {
		t.Fatalf("config.yml does not carry the token and url:\n%s", cfg)
	}
	if id, ok := m.InstanceByAgentToken(lv.AgentToken); !ok || id != "alpha" {
		t.Fatalf("token lookup: %q %v", id, ok)
	}
	if _, ok := m.InstanceByAgentToken("nope"); ok {
		t.Fatal("unknown token accepted")
	}
	if rec, ok := inst.InstalledPlugin(agent.FileName); !ok || rec.Source != agentSource || rec.Version != "0.1.0" {
		t.Fatalf("manifest record: %+v %v", rec, ok)
	}

	// The agent is wardend's: the panel cannot switch it off or throw it away.
	if _, err := inst.TogglePlugin(agent.FileName); !errors.Is(err, ErrPluginManaged) {
		t.Fatalf("toggle: %v", err)
	}
	if err := inst.RemovePlugin(agent.FileName); !errors.Is(err, ErrPluginManaged) {
		t.Fatalf("remove: %v", err)
	}
	files, err := inst.Plugins()
	if err != nil || len(files) != 1 || !files[0].Managed {
		t.Fatalf("plugin list: %+v %v", files, err)
	}

	// A daemon restart: existing instances are loaded from disk and SetAgent brings them up to
	// date, so a server made before the agent existed gets it too, and a newer jar replaces the old.
	m2 := NewManager(root, nil)
	if err := m2.LoadAll(); err != nil {
		t.Fatal(err)
	}
	jar2 := agentJar(t, "0.2.0")
	m2.SetAgent("ws://127.0.0.1:2/agent/v1", func() ([]byte, string, error) { return jar2, "0.2.0", nil }, pluginsOnPaper)
	if id, ok := m2.InstanceByAgentToken(lv.AgentToken); !ok || id != "alpha" {
		t.Fatalf("token lookup after reload: %q %v", id, ok)
	}
	loaded, _ := m2.Get("alpha")
	if rec, _ := loaded.InstalledPlugin(agent.FileName); rec.Version != "0.2.0" {
		t.Fatalf("jar not upgraded: %+v", rec)
	}
	cfg, _ = os.ReadFile(filepath.Join(loaded.ServerDir(), "plugins", "WardenAgent", "config.yml"))
	if !strings.Contains(string(cfg), "ws://127.0.0.1:2/agent/v1") {
		t.Fatalf("url not refreshed:\n%s", cfg)
	}
	// A rebuilt jar with the same version number is still new: content decides, not the version.
	rebuilt := append(agentJar(t, "0.2.0"), 0) // same version, different bytes
	m2.SetAgent("ws://127.0.0.1:2/agent/v1", func() ([]byte, string, error) { return rebuilt, "0.2.0", nil }, pluginsOnPaper)
	if msg := loaded.refreshAgent(); msg != "" {
		t.Fatalf("refresh: %s", msg)
	}
	if got, _ := os.ReadFile(filepath.Join(loaded.ServerDir(), "plugins", agent.FileName)); len(got) != len(rebuilt) {
		t.Fatalf("rebuilt jar not installed: %d bytes, want %d", len(got), len(rebuilt))
	}

	// Software without plugins gets nothing: no jar, no token.
	van, err := m2.Create(&Manifest{ID: "van-one", Name: "V", Software: "vanilla", MCVersion: "26.2", Port: 25566, RconPort: 25576, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(van.ServerDir(), "plugins", agent.FileName)); !os.IsNotExist(err) {
		t.Fatalf("vanilla got the agent: %v", err)
	}
	if van.LiveView().AgentToken != "" {
		t.Fatal("vanilla got a token")
	}
}
