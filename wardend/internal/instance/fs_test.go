package instance

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/manuelvega/warden/wardend/internal/agent"
)

// newFSInstance is a server directory with a jar, a plugin folder, a hidden file and a link that
// points outside the server directory.
func newFSInstance(t *testing.T) (*Instance, string) {
	t.Helper()
	dir := t.TempDir()
	i := &Instance{Dir: dir, Manifest: &Manifest{ID: "t", MCVersion: "1.21", Jar: "paper.jar"}}
	server := i.ServerDir()
	for _, d := range []string{"plugins/Foo", "world/region", "logs"} {
		if err := os.MkdirAll(filepath.Join(server, d), 0o750); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		"paper.jar":                 "jar",
		"server.properties":         "motd=hi\n",
		"bukkit.yml":                "a: 1\n",
		".console_history":          "list\n",
		"plugins/Foo/config.yml":    "x: y\n",
		"plugins/" + agent.FileName: "agent",
		"logs/latest.log":           "[INFO] Done\n",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(server, filepath.FromSlash(name)), []byte(body), 0o640); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(dir, "outside")
	if err := os.MkdirAll(outside, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("s"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(server, "escape")); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	return i, outside
}

func TestListDirShowsEverythingInsideAndKeepsDirectoriesFirst(t *testing.T) {
	i, _ := newFSInstance(t)
	l, err := i.ListDir("/")
	if err != nil {
		t.Fatal(err)
	}
	if l.Path != "" {
		t.Fatalf("root path should be empty, got %q", l.Path)
	}
	var names []string
	for _, e := range l.Entries {
		names = append(names, e.Name)
	}
	// Directories (the escaping link resolves to one) sorted by name, then files, hidden included.
	want := "escape logs plugins world .console_history bukkit.yml paper.jar server.properties"
	if got := strings.Join(names, " "); got != want {
		t.Fatalf("listing order:\n got %s\nwant %s", got, want)
	}
	for _, e := range l.Entries {
		if e.Name == "escape" && (!e.Symlink || !e.Dir) {
			t.Fatalf("the link should be marked and described as a directory: %+v", e)
		}
		if e.Name == "bukkit.yml" && e.Size != 5 {
			t.Fatalf("size of bukkit.yml: %+v", e)
		}
		if e.Protected != (e.Name == "paper.jar") {
			t.Fatalf("only the jar is protected here: %+v", e)
		}
	}
	if _, err := i.ListDir("bukkit.yml"); !errors.Is(err, ErrNotDir) {
		t.Fatalf("listing a file: %v", err)
	}
}

func TestPathsAreConfinedToTheServerDirectory(t *testing.T) {
	i, outside := newFSInstance(t)
	// Through the link the target exists but is refused: nothing outside is listed, read or written.
	for _, rel := range []string{"escape", "escape/secret.txt"} {
		if _, err := i.ListDir(rel); !errors.Is(err, ErrFileNotAllowed) {
			t.Fatalf("%s: listing: %v", rel, err)
		}
		if _, _, err := i.OpenFile(rel); !errors.Is(err, ErrFileNotAllowed) {
			t.Fatalf("%s: opening: %v", rel, err)
		}
		if _, err := i.WriteFile(rel, []byte("x")); err == nil {
			t.Fatalf("%s: writing should be refused", rel)
		}
	}
	if _, err := i.WriteFile("escape/secret.txt", []byte("x")); !errors.Is(err, ErrFileNotAllowed) {
		t.Fatalf("writing through the link: %v", err)
	}
	// A climb is cleaned away before it is looked at: it names a path inside the server directory
	// (which may or may not exist), never the file it was aiming for.
	for _, rel := range []string{"../instance.json", "/../outside/secret.txt", "plugins/../../outside/secret.txt"} {
		if _, _, err := i.OpenFile(rel); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("%s: opening: %v", rel, err)
		}
	}
	if _, err := i.WriteFile("/../outside/secret.txt", []byte("x")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a climb writes inside or not at all: %v", err)
	}
	if _, err := i.WriteFile("../instance.json", []byte("{}")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(i.Dir, "instance.json")); !os.IsNotExist(err) {
		t.Fatal("the climb reached the instance directory")
	}
	if _, err := os.Stat(filepath.Join(i.ServerDir(), "instance.json")); err != nil {
		t.Fatal("the cleaned path should land in the server directory:", err)
	}
	if b, _ := os.ReadFile(filepath.Join(outside, "secret.txt")); string(b) != "s" {
		t.Fatal("the file outside changed")
	}
	if l, err := i.ListDir("../.."); err != nil || l.Path != "" {
		t.Fatalf("a path above the root is the root: %v %+v", err, l)
	}
	if _, _, err := i.OpenFile("missing.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing file: %v", err)
	}
}

func TestWriteFileValidatesAndRoutesServerProperties(t *testing.T) {
	i, _ := newFSInstance(t)
	if _, err := i.WriteFile("bukkit.yml", []byte("a: [1\n")); !errors.Is(err, ErrInvalidSyntax) {
		t.Fatalf("broken YAML: %v", err)
	}
	if _, err := i.WriteFile("plugins/Foo/new.json", []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := i.WriteFile("server.properties", []byte("this is not a property\n")); err == nil {
		t.Fatal("server.properties must go through the schema validation")
	}
	if _, err := i.WriteFile("server.properties", []byte("motd=bye")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(i.ServerDir(), "server.properties")); string(b) != "motd=bye\n" {
		t.Fatalf("server.properties: %q", b)
	}
	if _, err := i.WriteFile("nowhere/x.txt", []byte("x")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a file in a missing directory: %v", err)
	}
	if _, err := i.WriteFile("world", []byte("x")); !errors.Is(err, ErrIsDir) {
		t.Fatalf("writing over a directory: %v", err)
	}
	if _, err := i.WriteFile("big.txt", make([]byte, MaxEditBytes+1)); !errors.Is(err, ErrFileTooLarge) {
		t.Fatalf("too large: %v", err)
	}
}

func TestTheServerJarAndTheAgentAreReadOnly(t *testing.T) {
	i, _ := newFSInstance(t)
	for _, rel := range []string{"paper.jar", "plugins/" + agent.FileName} {
		if _, _, err := i.OpenFile(rel); err != nil {
			t.Fatalf("%s should still be readable: %v", rel, err)
		}
		if _, err := i.WriteFile(rel, []byte("x")); !errors.Is(err, ErrProtected) {
			t.Fatalf("%s write: %v", rel, err)
		}
		if err := i.Remove(rel); !errors.Is(err, ErrProtected) {
			t.Fatalf("%s remove: %v", rel, err)
		}
		if err := i.Rename(rel, "other.jar"); !errors.Is(err, ErrProtected) {
			t.Fatalf("%s rename: %v", rel, err)
		}
		if err := i.Rename("bukkit.yml", rel); !errors.Is(err, ErrProtected) {
			t.Fatalf("renaming onto %s: %v", rel, err)
		}
		if _, err := i.SaveUpload(filepath.Dir(rel), filepath.Base(rel), strings.NewReader("x"), true); !errors.Is(err, ErrProtected) {
			t.Fatalf("uploading over %s: %v", rel, err)
		}
	}
}

func TestMkdirRenameAndRemove(t *testing.T) {
	i, _ := newFSInstance(t)
	e, err := i.Mkdir("plugins/Bar")
	if err != nil || !e.Dir || e.Name != "Bar" {
		t.Fatalf("mkdir: %v %+v", err, e)
	}
	if _, err := i.Mkdir("plugins/Bar"); !errors.Is(err, ErrFileExists) {
		t.Fatalf("mkdir twice: %v", err)
	}
	if _, err := i.Mkdir("nowhere/Baz"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("mkdir under a missing parent: %v", err)
	}
	if _, err := i.Mkdir(""); !errors.Is(err, ErrRootPath) {
		t.Fatalf("mkdir root: %v", err)
	}
	// Rename in place, move across directories, refuse collisions and moving a folder into itself.
	if err := i.Rename("plugins/Foo/config.yml", "plugins/Foo/settings.yml"); err != nil {
		t.Fatal(err)
	}
	if err := i.Rename("plugins/Foo/settings.yml", "plugins/Bar/settings.yml"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(i.ServerDir(), "plugins", "Bar", "settings.yml")); err != nil {
		t.Fatal("moved file missing:", err)
	}
	if err := i.Rename("bukkit.yml", "server.properties"); !errors.Is(err, ErrFileExists) {
		t.Fatalf("rename onto an existing file: %v", err)
	}
	if err := i.Rename("plugins", "plugins/Bar/plugins"); !errors.Is(err, ErrBadFileName) {
		t.Fatalf("moving a directory into itself: %v", err)
	}
	if err := i.Rename("missing.yml", "x.yml"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("renaming a missing file: %v", err)
	}
	if err := i.Rename("", "x"); !errors.Is(err, ErrRootPath) {
		t.Fatalf("renaming the root: %v", err)
	}
	// Remove takes files and whole directories; the root stays.
	if err := i.Remove("plugins/Bar"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(i.ServerDir(), "plugins", "Bar")); !os.IsNotExist(err) {
		t.Fatal("directory should be gone")
	}
	if err := i.Remove("plugins/Bar"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("removing twice: %v", err)
	}
	if err := i.Remove("/"); !errors.Is(err, ErrRootPath) {
		t.Fatalf("removing the root: %v", err)
	}
}

func TestRemovingALinkLeavesItsTargetAlone(t *testing.T) {
	i, outside := newFSInstance(t)
	if err := i.Remove("escape"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(i.ServerDir(), "escape")); !os.IsNotExist(err) {
		t.Fatal("the link should be gone")
	}
	if _, err := os.Stat(filepath.Join(outside, "secret.txt")); err != nil {
		t.Fatal("the target must survive:", err)
	}
}

func TestSaveUploadRefusesToOverwriteUnlessAsked(t *testing.T) {
	i, _ := newFSInstance(t)
	e, err := i.SaveUpload("plugins/Foo", "data.bin", strings.NewReader("12345"), false)
	if err != nil || e.Size != 5 || e.Dir {
		t.Fatalf("upload: %v %+v", err, e)
	}
	if _, err := i.SaveUpload("plugins/Foo", "data.bin", strings.NewReader("x"), false); !errors.Is(err, ErrFileExists) {
		t.Fatalf("second upload: %v", err)
	}
	if _, err := i.SaveUpload("plugins/Foo", "data.bin", strings.NewReader("xy"), true); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(i.ServerDir(), "plugins", "Foo", "data.bin")); string(b) != "xy" {
		t.Fatalf("overwritten content: %q", b)
	}
	if _, err := i.SaveUpload("plugins", "Foo", strings.NewReader("x"), true); !errors.Is(err, ErrIsDir) {
		t.Fatalf("uploading over a directory: %v", err)
	}
	for _, bad := range []string{"", ".", "..", "a/b", "a\\b"} {
		if _, err := i.SaveUpload("", bad, strings.NewReader("x"), false); !errors.Is(err, ErrBadFileName) {
			t.Fatalf("%q: %v", bad, err)
		}
	}
	if _, err := i.SaveUpload("escape", "x.txt", strings.NewReader("x"), false); !errors.Is(err, ErrFileNotAllowed) {
		t.Fatalf("uploading through the link: %v", err)
	}
	entries, _ := os.ReadDir(filepath.Join(i.ServerDir(), "plugins", "Foo"))
	for _, e := range entries {
		if strings.Contains(e.Name(), ".upload-") {
			t.Fatalf("temporary file left behind: %s", e.Name())
		}
	}
}

func TestContentTypeTellsTextImagesSoundsAndTheRestApart(t *testing.T) {
	cases := []struct {
		name string
		head string
		want string
	}{
		{"paper-global.yml", "", "text/plain; charset=utf-8"},
		{"level.dat", "\x1f\x8b\x08\x00", "application/octet-stream"},
		{"server-icon.png", "\x89PNG\r\n\x1a\n", "image/png"},
		{"notes", "plain words\n", "text/plain; charset=utf-8"},
		{"paper.jar", "PK\x03\x04", "application/octet-stream"},
		{"level.dat", "x", "application/octet-stream"},
		{"tiny.mca", "", "application/octet-stream"},
		{"click.ogg", "", "audio/ogg"},
		{"theme.MP3", "", "audio/mpeg"},
		{"no-extension", "OggS\x00\x02", "audio/ogg"},
		{"sample", "RIFF\x24\x00\x00\x00WAVEfmt ", "audio/wave"},
	}
	for _, c := range cases {
		if got := ContentType(c.name, func() []byte { return []byte(c.head) }); got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}
