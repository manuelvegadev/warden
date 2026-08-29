package instance

import (
	"os"
	"path/filepath"
	"testing"
)

func newFilesInstance(t *testing.T) *Instance {
	t.Helper()
	dir := t.TempDir()
	i := &Instance{Dir: dir, Manifest: &Manifest{ID: "t", MCVersion: "1.21"}}
	if err := os.MkdirAll(filepath.Join(i.ServerDir(), "plugins", "Foo"), 0o750); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(i.ServerDir(), "bukkit.yml"), []byte("a: 1\n"), 0o640)
	os.WriteFile(filepath.Join(i.ServerDir(), "plugins", "Foo", "config.yml"), []byte("x: y\n"), 0o640)
	os.WriteFile(filepath.Join(i.ServerDir(), "server.properties"), []byte("motd=hi\n"), 0o640)
	return i
}

func TestConfigFilesAllowlist(t *testing.T) {
	i := newFilesInstance(t)
	files, err := i.ConfigFiles()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, f := range files {
		got[f.Path] = f.Group
	}
	if got["bukkit.yml"] != "Server" || got["plugins/Foo/config.yml"] != "Plugins" {
		t.Fatalf("unexpected listing %v", got)
	}
	if _, ok := got["server.properties"]; ok {
		t.Fatal("server.properties has its own editor and must not be listed")
	}
	for _, bad := range []string{"server.properties", "../instance.json", "plugins/Foo/../../ops.json", "world/level.dat", "plugins/.hidden/x.yml"} {
		if _, err := i.ReadConfigFile(bad); err == nil {
			t.Fatalf("%s should be rejected", bad)
		}
	}
}

func TestWriteConfigFileValidates(t *testing.T) {
	i := newFilesInstance(t)
	if _, err := i.WriteConfigFile("bukkit.yml", "a: [1, 2\n"); err == nil {
		t.Fatal("broken YAML accepted")
	}
	if restart, err := i.WriteConfigFile("bukkit.yml", "a: 2\n"); err != nil || restart {
		t.Fatalf("err=%v restart=%v", err, restart)
	}
	if s, _ := i.ReadConfigFile("bukkit.yml"); s != "a: 2\n" {
		t.Fatalf("got %q", s)
	}
}
