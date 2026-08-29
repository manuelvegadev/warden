package mc

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParsePluginYAML(t *testing.T) {
	src := `name: ViaVersion
version: "5.11.0"
main: com.viaversion.Main
api-version: '1.13' # legacy
authors: [kennytv, "Gerrygames"]
description: Allow newer clients   # trailing
commands:
  viaversion:
    description: nested
`
	m := parsePluginYAML(strings.NewReader(src))
	if m.Name != "ViaVersion" || m.Version != "5.11.0" || m.APIVersion != "1.13" || m.Description != "Allow newer clients" {
		t.Fatalf("unexpected meta %+v", m)
	}
	if len(m.Authors) != 2 || m.Authors[1] != "Gerrygames" {
		t.Fatalf("authors: %v", m.Authors)
	}
}

func TestReadPluginMeta(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.jar")
	f, _ := os.Create(path)
	zw := zip.NewWriter(f)
	w, _ := zw.Create("paper-plugin.yml")
	w.Write([]byte("name: Foo\nversion: 1.2\n"))
	zw.Close()
	f.Close()
	m, ok, err := ReadPluginMeta(path)
	if err != nil || !ok || m.Name != "Foo" || m.Version != "1.2" {
		t.Fatalf("got %+v ok=%v err=%v", m, ok, err)
	}
}
