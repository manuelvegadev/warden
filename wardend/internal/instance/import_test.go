package instance

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func fakeJar(t *testing.T, path, versionJSON string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	if versionJSON != "" {
		w, _ := zw.Create("version.json")
		w.Write([]byte(versionJSON))
	}
	zw.Close()
	f.Close()
}

func TestDetectServer(t *testing.T) {
	dir := t.TempDir()
	fakeJar(t, filepath.Join(dir, "paper-26.2-112.jar"), "")
	fakeJar(t, filepath.Join(dir, "helper-lib.jar"), "")
	d := DetectServer(dir)
	if d.Jar != "paper-26.2-112.jar" || d.Software != "paper" || d.MCVersion != "26.2" || d.Build != 112 {
		t.Fatalf("%+v", d)
	}

	dir = t.TempDir()
	fakeJar(t, filepath.Join(dir, "server.jar"), `{"id":"1.21.8"}`)
	os.MkdirAll(filepath.Join(dir, ".paper"), 0o750)
	os.WriteFile(filepath.Join(dir, ".paper", "version_history.json"), []byte(`{"currentVersion":"1.21.8-60-abc123 (MC: 1.21.8)"}`), 0o600)
	d = DetectServer(dir)
	if d.Jar != "server.jar" || d.Software != "paper" || d.MCVersion != "1.21.8" || d.Build != 60 {
		t.Fatalf("%+v", d)
	}

	dir = t.TempDir()
	fakeJar(t, filepath.Join(dir, "fabric-server-mc.1.21.8-loader.0.16.14-launcher.1.0.3.jar"), "")
	d = DetectServer(dir)
	if d.Software != "fabric" || d.MCVersion != "1.21.8" || d.Build != 16014 {
		t.Fatalf("%+v", d)
	}

	dir = t.TempDir()
	fakeJar(t, filepath.Join(dir, "minecraft_server.1.20.1.jar"), "")
	d = DetectServer(dir)
	if d.Software != "vanilla" || d.MCVersion != "1.20.1" {
		t.Fatalf("%+v", d)
	}

	if d := DetectServer(t.TempDir()); d.Jar != "" {
		t.Fatalf("%+v", d)
	}
}
