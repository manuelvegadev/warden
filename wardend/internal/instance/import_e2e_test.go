package instance

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/manuelvega/warden/wardend/internal/backup"
)

// TestImportArchive imports a real server archive: WARDEN_IMPORT_ARCHIVE=/path/to/server.zip go test -run TestImportArchive ./internal/instance
func TestImportArchive(t *testing.T) {
	src := os.Getenv("WARDEN_IMPORT_ARCHIVE")
	if src == "" {
		t.Skip("WARDEN_IMPORT_ARCHIVE not set")
	}
	format, err := backup.DetectFormat(src)
	if err != nil {
		t.Fatal(err)
	}
	// Import removes the archive when done; work on a copy.
	b, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), filepath.Base(src))
	os.WriteFile(archive, b, 0o600)

	m := NewManager(t.TempDir(), nil)
	inst, err := m.Create(&Manifest{ID: "imported", Name: "Imported", Port: 25599, RconPort: 25609, MemoryMB: 1024, JVMPreset: "aikar"})
	if err != nil {
		t.Fatal(err)
	}
	var last string
	err = inst.Import(context.Background(), nil, ImportOptions{Archive: archive, Format: format, AcceptEULA: true}, func(p int, msg string) {
		last = msg
		t.Logf("%3d%% %s", p, msg)
	})
	if err != nil {
		t.Fatalf("%v (last: %s)", err, last)
	}
	man := inst.Manifest
	t.Logf("manifest: software=%s mc=%s build=%d jar=%s", man.Software, man.MCVersion, man.Build, man.Jar)
	if man.Jar == "" || man.MCVersion == "" {
		t.Fatal("jar or version not detected")
	}
	if _, err := os.Stat(filepath.Join(inst.ServerDir(), man.Jar)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(inst.ServerDir(), "server.properties")); err != nil {
		t.Fatal(err)
	}
	if inst.State() != StateStopped {
		t.Fatalf("state %v", inst.State())
	}
}
