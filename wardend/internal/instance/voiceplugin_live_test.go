package instance

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/manuelvega/warden/wardend/internal/catalog"
)

// Live: the whole path a first start takes, against the real catalog — resolve the release for the
// server's Minecraft version, download it and put it in plugins/. Skipped unless WARDEN_LIVE_TESTS=1.
func TestVoicePluginInstallLive(t *testing.T) {
	if os.Getenv("WARDEN_LIVE_TESTS") != "1" {
		t.Skip("set WARDEN_LIVE_TESTS=1 to hit Modrinth")
	}
	inst := voiceInstance(t)
	inst.reg = catalog.NewRegistry("warden-tests/dev")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	msg := inst.ensureVoicePlugin(ctx)
	if !strings.Contains(msg, "installed") {
		t.Fatalf("install: %s", msg)
	}
	files, err := inst.Plugins()
	if err != nil {
		t.Fatal(err)
	}
	var jar string
	for _, f := range files {
		if f.Meta != nil && strings.EqualFold(f.Meta.Name, voicePluginName) {
			jar = f.FileName
		}
	}
	if jar == "" {
		t.Fatalf("no voice plugin in plugins/: %+v", files)
	}
	if _, err := os.Stat(filepath.Join(inst.ServerDir(), "plugins", jar)); err != nil {
		t.Fatal(err)
	}
	// A second start finds it and does nothing.
	if inst.wantsVoicePlugin() {
		t.Error("the plugin is installed; a later start should leave it alone")
	}
	if msg := inst.ensureVoicePlugin(ctx); msg != "" {
		t.Errorf("a later start should say nothing, got %q", msg)
	}
}
