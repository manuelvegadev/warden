package backup

import (
	"archive/tar"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"
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

// A Skip replaced by an Extra is not missing: the sidecar's Excluded stays empty, and anything
// else beside the store (here "other.txt") is archived normally, not swept away with it.
func TestCreateSkipsAreNotReportedAsExcludedWhenReplacedByAnExtra(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "world", "region"), 0o755)
	os.MkdirAll(filepath.Join(root, "world", "vss-lod"), 0o755)
	os.WriteFile(filepath.Join(root, "world", "region", "r.0.0.mca"), []byte("region"), 0o644)
	os.WriteFile(filepath.Join(root, "world", "vss-lod", "store.db"), []byte("live"), 0o644)
	os.WriteFile(filepath.Join(root, "world", "vss-lod", "other.txt"), []byte("kept"), 0o644)
	snap := filepath.Join(t.TempDir(), "snap.db")
	os.WriteFile(snap, []byte("snapshot"), 0o644)

	dest := filepath.Join(t.TempDir(), "b.tar.zst")
	info := Info{Paths: []string{"world"}, Skip: []string{"world/vss-lod/store.db"},
		Extra: []Extra{{Rel: "world/vss-lod/store.db", Path: snap}}}
	out, err := Create(context.Background(), root, dest, info, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := archiveContents(t, dest)
	if got["world/region/r.0.0.mca"] != "region" {
		t.Fatalf("region missing: %v", got)
	}
	if got["world/vss-lod/store.db"] != "snapshot" {
		t.Fatalf("the store should be the snapshot: %v", got)
	}
	if got["world/vss-lod/other.txt"] != "kept" {
		t.Fatalf("a file beside the store should still be archived: %v", got)
	}
	if len(out.Excluded) != 0 {
		t.Fatalf("nothing is missing here, it was replaced: %+v", out)
	}
}

// A plain Excluded path (no Extra to replace it) is genuinely missing, and the sidecar says so.
func TestCreateReportsExcludedPathsInTheSidecar(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "world", "vss-lod"), 0o755)
	os.WriteFile(filepath.Join(root, "world", "vss-lod", "store.db"), []byte("live"), 0o644)

	dest := filepath.Join(t.TempDir(), "b.tar.zst")
	info := Info{Paths: []string{"world"}, Excluded: []string{"world/vss-lod"}}
	out, err := Create(context.Background(), root, dest, info, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := archiveContents(t, dest)
	if _, ok := got["world/vss-lod/store.db"]; ok {
		t.Fatalf("excluded path should not be archived: %v", got)
	}
	if len(out.Excluded) != 1 || out.Excluded[0] != "world/vss-lod" {
		t.Fatalf("the sidecar should say what was left out: %+v", out)
	}
}

// Create must refuse an Extra whose Rel escapes every archived path — the archive layer's own
// guard against restoring an extra somewhere a later Extract would wipe out unrelated data.
func TestCreateRejectsAnExtraOutsideThePaths(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "world"), 0o755)
	snap := filepath.Join(t.TempDir(), "snap.db")
	os.WriteFile(snap, []byte("x"), 0o644)

	dest := filepath.Join(t.TempDir(), "b.tar.zst")
	info := Info{Paths: []string{"world"}, Extra: []Extra{{Rel: "plugins/DHSupport/data.sqlite", Path: snap}}}
	if _, err := Create(context.Background(), root, dest, info, nil); err == nil {
		t.Fatal("expected an error for an Extra outside Paths")
	}
	if _, err := os.Stat(dest); err == nil {
		t.Fatal("no archive should be left behind")
	}
}

// archiveContents reads every regular file of an archive into a map.
func archiveContents(t *testing.T, path string) map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := zstd.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	tr := tar.NewReader(zr)
	out := map[string]string{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return out
		}
		if err != nil {
			t.Fatal(err)
		}
		if hdr.Typeflag == tar.TypeReg {
			b, _ := io.ReadAll(tr)
			out[hdr.Name] = string(b)
		}
	}
}
