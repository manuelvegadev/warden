package mc

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeZip(t *testing.T, files map[string][]byte) string {
	t.Helper()
	name := filepath.Join(t.TempDir(), "a.jar")
	f, err := os.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	if _, err := zw.Create("assets/"); err != nil { // a directory entry, which listings leave out
		t.Fatal(err)
	}
	for n, b := range files {
		w, err := zw.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		w.Write(b)
	}
	zw.Close()
	f.Close()
	return name
}

// A class file header: magic, minor 0, major.
func class(major byte) []byte { return []byte{0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, major, 1, 2} }

func TestJarInfoReadsThePluginItIs(t *testing.T) {
	jar := writeZip(t, map[string][]byte{
		"plugin.yml":       []byte("name: Old\nversion: 1\n"),
		"paper-plugin.yml": []byte("name: Hello\nversion: 2.0\nmain: dev.hello.Main\ndependencies:\n  server:\n    LuckPerms:\n      load: BEFORE\n      required: false\n"),
		"META-INF/MANIFEST.MF": []byte("Manifest-Version: 1.0\r\nImplementation-Title: Hello Plugin \r\n" +
			"Implementation-Vendor: A very long vendor name that the jar tool wrapped onto a\r\n  second line\r\n\r\nName: other\r\nX: y\r\n"),
		"dev/hello/Main.class":                 class(65),
		"META-INF/versions/25/dev/hello.class": class(69),
	})
	info, err := ReadJarInfo(jar)
	if err != nil {
		t.Fatal(err)
	}
	if info.Kind != "paper-plugin" || info.Descriptor != "paper-plugin.yml" {
		t.Errorf("Paper's descriptor wins over plugin.yml: %s from %s", info.Kind, info.Descriptor)
	}
	meta := info.Meta.(map[string]any)
	if meta["name"] != "Hello" || meta["version"] != "2.0" {
		t.Errorf("meta = %v", meta)
	}
	dep := meta["dependencies"].(map[string]any)["server"].(map[string]any)["LuckPerms"].(map[string]any)
	if dep["required"] != false {
		t.Errorf("nested YAML survives: %v", dep)
	}
	if got := info.Manifest["Implementation-Vendor"]; got != "A very long vendor name that the jar tool wrapped onto a second line" {
		t.Errorf("continued manifest line: %q", got)
	}
	if _, ok := info.Manifest["X"]; ok {
		t.Error("only the main section of the manifest is read")
	}
	if info.JavaMin != 21 {
		t.Errorf("the base classes, not the multi-release ones, give the minimum Java: %d", info.JavaMin)
	}
	if info.Entries != 5 {
		t.Errorf("entries = %d", info.Entries)
	}
}

func TestJarInfoOfModsAndLibraries(t *testing.T) {
	for _, tc := range []struct {
		files map[string][]byte
		kind  string
	}{
		{map[string][]byte{"fabric.mod.json": []byte(`{"id":"lithium","version":"0.15"}`)}, "fabric-mod"},
		{map[string][]byte{"META-INF/neoforge.mods.toml": []byte("[[mods]]\nmodId=\"x\"\n")}, "neoforge-mod"},
		{map[string][]byte{"com/lib/Util.class": class(52)}, "library"},
	} {
		info, err := ReadJarInfo(writeZip(t, tc.files))
		if err != nil || info.Kind != tc.kind {
			t.Errorf("kind = %s (err %v), want %s", info.Kind, err, tc.kind)
		}
		if tc.kind == "neoforge-mod" && info.Raw == "" {
			t.Error("a TOML descriptor is shown as its text")
		}
	}
}

func TestArchiveListsFilesSortedAndReadsOne(t *testing.T) {
	zip := writeZip(t, map[string][]byte{"pack.mcmeta": []byte(`{"pack":{}}`), "data/b.json": nil, "data/a.json": nil})
	l, err := ListArchive(zip, 2)
	if err != nil {
		t.Fatal(err)
	}
	if l.Total != 3 || len(l.Entries) != 2 || l.Entries[0].Name != "data/a.json" {
		t.Errorf("listing = %+v", l)
	}
	data, truncated, err := ReadArchiveEntry(zip, "pack.mcmeta")
	if err != nil || truncated || string(data) != `{"pack":{}}` {
		t.Errorf("entry = %q %v %v", data, truncated, err)
	}
	if _, _, err := ReadArchiveEntry(zip, "nope"); !errors.Is(err, ErrNoSuchEntry) {
		t.Errorf("missing entry: %v", err)
	}
}
