package instance

import (
	"archive/zip"
	"bytes"
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

func TestLiveViewInstallsAgentOnCreatedAndLoadedInstances(t *testing.T) {
	root := t.TempDir()
	m := NewManager(root, nil)
	jar := agentJar(t, "0.1.0")
	m.SetAgent("ws://127.0.0.1:1/agent/v1", func() ([]byte, string, error) { return jar, "0.1.0", nil }, pluginsOnPaper)

	// Created at runtime (the API path): must know the agent, not only instances present at LoadAll.
	inst, err := m.Create(&Manifest{ID: "alpha", Name: "A", Software: "paper", MCVersion: "26.2", Port: 25565, RconPort: 25575, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if err := inst.SetLiveView(true); err != nil {
		t.Fatalf("enable on a created instance: %v", err)
	}
	if _, err := os.Stat(filepath.Join(inst.ServerDir(), "plugins", agent.FileName)); err != nil {
		t.Fatalf("jar not installed: %v", err)
	}
	cfg, err := os.ReadFile(filepath.Join(inst.ServerDir(), "plugins", "WardenAgent", "config.yml"))
	if err != nil {
		t.Fatal(err)
	}
	lv := inst.LiveView()
	if !lv.Enabled || lv.AgentToken == "" || !strings.Contains(string(cfg), lv.AgentToken) || !strings.Contains(string(cfg), "ws://127.0.0.1:1/agent/v1") {
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

	// A daemon restart: the instance is loaded from disk and the token still resolves.
	m2 := NewManager(root, nil)
	jar2 := agentJar(t, "0.2.0")
	m2.SetAgent("ws://127.0.0.1:2/agent/v1", func() ([]byte, string, error) { return jar2, "0.2.0", nil }, pluginsOnPaper)
	if err := m2.LoadAll(); err != nil {
		t.Fatal(err)
	}
	if id, ok := m2.InstanceByAgentToken(lv.AgentToken); !ok || id != "alpha" {
		t.Fatalf("token lookup after reload: %q %v", id, ok)
	}
	loaded, _ := m2.Get("alpha")
	// refreshAgent (what Start does) upgrades the jar to the embedded version and rewrites the url.
	if msg := loaded.refreshAgent(); msg != "" {
		t.Fatalf("refresh: %s", msg)
	}
	if rec, _ := loaded.InstalledPlugin(agent.FileName); rec.Version != "0.2.0" {
		t.Fatalf("jar not upgraded: %+v", rec)
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
	cfg, _ = os.ReadFile(filepath.Join(loaded.ServerDir(), "plugins", "WardenAgent", "config.yml"))
	if !strings.Contains(string(cfg), "ws://127.0.0.1:2/agent/v1") {
		t.Fatalf("url not refreshed:\n%s", cfg)
	}

	// Disabling removes the jar; the token stays so a re-enable keeps working config for the plugin.
	if err := loaded.SetLiveView(false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(loaded.ServerDir(), "plugins", agent.FileName)); !os.IsNotExist(err) {
		t.Fatalf("jar still there: %v", err)
	}
	if _, ok := m2.InstanceByAgentToken(lv.AgentToken); ok {
		t.Fatal("a disabled live view must not accept its token")
	}

	// Software without plugins is refused.
	van, err := m2.Create(&Manifest{ID: "van-one", Name: "V", Software: "vanilla", MCVersion: "26.2", Port: 25566, RconPort: 25576, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if err := van.SetLiveView(true); err != ErrLiveViewUnsupported {
		t.Fatalf("vanilla: %v", err)
	}
}
