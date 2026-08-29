package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func nowUTC() time.Time { return time.Now().UTC() }

func TestCreateListExtract(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "world", "region"), 0o750)
	os.WriteFile(filepath.Join(root, "world", "level.dat"), []byte("lvl"), 0o640)
	os.WriteFile(filepath.Join(root, "world", "region", "r.0.0.mca"), make([]byte, 5000), 0o640)
	os.WriteFile(filepath.Join(root, "server.properties"), []byte("a=b\n"), 0o640)
	os.WriteFile(filepath.Join(root, "logs.txt"), []byte("not included"), 0o640)

	dir := filepath.Join(t.TempDir(), "backups")
	info, err := Create(context.Background(), root, filepath.Join(dir, Name("manual", nowUTC())), Info{Trigger: "manual", Scope: "full", Paths: append([]string{"server.properties"}, WorldDirs(root)...)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size == 0 || info.SHA256 == "" || len(info.Paths) != 2 {
		t.Fatalf("bad info %+v", info)
	}
	list, err := List(dir)
	if err != nil || len(list) != 1 || list[0].Trigger != "manual" || list[0].Name != info.Name {
		t.Fatalf("list: %+v %v", list, err)
	}

	// Mutate, then restore: the stale file must be gone, contents back.
	os.WriteFile(filepath.Join(root, "world", "stale.dat"), []byte("x"), 0o640)
	os.WriteFile(filepath.Join(root, "server.properties"), []byte("changed"), 0o640)
	if err := Extract(context.Background(), filepath.Join(dir, info.Name), root, nil); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(root, "server.properties")); string(b) != "a=b\n" {
		t.Fatalf("properties not restored: %q", b)
	}
	if _, err := os.Stat(filepath.Join(root, "world", "stale.dat")); err == nil {
		t.Fatal("stale file survived restore")
	}
	if b, _ := os.ReadFile(filepath.Join(root, "logs.txt")); string(b) != "not included" {
		t.Fatal("untouched file changed")
	}
	if err := Remove(dir, info.Name); err != nil {
		t.Fatal(err)
	}
	if l, _ := List(dir); len(l) != 0 {
		t.Fatal("remove left entries")
	}
}
