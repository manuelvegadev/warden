package instance

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/manuelvega/warden/wardend/internal/catalog"
)

// pluginJar is a zip with a plugin.yml, which is all the descriptor reader looks at.
func pluginJar(t *testing.T, name string) []byte {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	f, err := zw.Create("plugin.yml")
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte("name: " + name + "\nversion: 1.0\nmain: x.Y\napi-version: '26.1'\n"))
	zw.Close()
	return b.Bytes()
}

// voiceInstance is a Paper instance with the agent wired and a catalog, so the only thing left to
// decide is whether Simple Voice Chat should be installed.
func voiceInstance(t *testing.T) *Instance {
	t.Helper()
	m := NewManager(t.TempDir(), nil)
	jar := pluginJar(t, "WardenAgent")
	m.SetAgent("ws://127.0.0.1:1/agent/v1", func() ([]byte, string, error) { return jar, "0.1.0", nil }, pluginsOnPaper)
	m.SetCatalog(catalog.NewRegistry("warden-test"))
	inst, err := m.Create(&Manifest{ID: "voice", Name: "V", Software: "paper", MCVersion: "26.2", Port: 25565,
		RconPort: 25575, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	return inst
}

func TestVoicePluginIsWantedOnceAndNotAgain(t *testing.T) {
	inst := voiceInstance(t)
	if !inst.wantsVoicePlugin() {
		t.Fatal("a Paper server without the plugin should want it")
	}

	// A jar somebody else installed counts: the descriptor names the plugin.
	jar := filepath.Join(inst.ServerDir(), "plugins", "voicechat-bukkit-2.6.21.jar")
	if err := os.WriteFile(jar, pluginJar(t, "voicechat"), 0o640); err != nil {
		t.Fatal(err)
	}
	if inst.wantsVoicePlugin() {
		t.Error("a server that already has the plugin should not want another copy")
	}

	// Removing it is remembered, so the next start leaves plugins/ alone.
	if err := inst.RemovePlugin("voicechat-bukkit-2.6.21.jar"); err != nil {
		t.Fatal(err)
	}
	if inst.wantsVoicePlugin() {
		t.Error("the plugin was removed on purpose; wardend should not put it back")
	}
	if got := inst.Manifest.Voice; got == nil || !got.NoAutoInstall {
		t.Errorf("the removal should be recorded in the manifest, got %+v", got)
	}
	// It survives a reload: the mark is in instance.json, not in memory.
	man, err := readManifest(inst.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if man.Voice == nil || !man.Voice.NoAutoInstall {
		t.Error("the removal should be saved to the manifest")
	}
}

func TestVoicePluginIsSkippedWhereItCannotRun(t *testing.T) {
	m := NewManager(t.TempDir(), nil)
	jar := pluginJar(t, "WardenAgent")
	m.SetAgent("ws://127.0.0.1:1/agent/v1", func() ([]byte, string, error) { return jar, "0.1.0", nil }, pluginsOnPaper)
	m.SetCatalog(catalog.NewRegistry("warden-test"))
	inst, err := m.Create(&Manifest{ID: "fabric", Name: "F", Software: "fabric", MCVersion: "26.2", Port: 25566,
		RconPort: 25576, CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if inst.wantsVoicePlugin() {
		t.Error("software that does not load Bukkit plugins should not get the plugin")
	}

	// No catalog wired (a daemon built without one, or before main wires it): nothing to fetch from.
	paper := voiceInstance(t)
	paper.reg = nil
	if paper.wantsVoicePlugin() {
		t.Error("without a catalog there is nowhere to fetch the plugin from")
	}
}
