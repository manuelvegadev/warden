package instance

import (
	"archive/tar"
	"archive/zip"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/manuelvega/warden/wardend/internal/bus"
	_ "modernc.org/sqlite"
)

func TestBackupsLeaveLODStoresOutUnlessAskedToKeepThem(t *testing.T) {
	dir := t.TempDir()
	i := newInstance(dir, &Manifest{ID: "t"}, nil)
	sd := i.ServerDir()
	os.MkdirAll(filepath.Join(sd, "world", "vss-lod"), 0o755)
	os.WriteFile(filepath.Join(sd, "world", "level.dat"), []byte("x"), 0o644)
	os.MkdirAll(filepath.Join(sd, "plugins"), 0o755)
	// A VSS jar: detection reads the descriptor name from plugin.yml.
	writeTestJar(t, filepath.Join(sd, "plugins", "voxy-server-side-paper.jar"), "name: VoxyServerSide\nversion: 0.14.0\n")

	skip, excluded, extra, cleanup, err := i.lodBackupPlan(t.Context(), i.backupPaths("full"), false)
	defer cleanup()
	if err != nil {
		t.Fatal(err)
	}
	if len(skip) != 0 || len(excluded) != 1 || excluded[0] != "world/vss-lod" || len(extra) != 0 {
		t.Fatalf("skip %v excluded %v extra %v", skip, excluded, extra)
	}
	if err := i.UpdateLOD(func(s *lodSettings) { s.BackupIncludeData = true }); err != nil {
		t.Fatal(err)
	}
	if !i.LOD().BackupIncludeData {
		t.Fatal("setting not kept")
	}
}

func writeTestJar(t *testing.T, path, pluginYML string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	w, _ := zw.Create("plugin.yml")
	w.Write([]byte(pluginYML))
	zw.Close()
	f.Close()
}

// writeSQLiteStore creates a real SQLite database at path (making its directory as needed) with a
// few rows, closed before returning — a backup snapshot must be able to read it back.
func writeSQLiteStore(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE lods(x INTEGER); INSERT INTO lods VALUES (1),(2)`); err != nil {
		t.Fatal(err)
	}
}

// readArchive reads every regular file of a tar.zst archive into a map, keyed by its archive path.
func readArchive(t *testing.T, path string) map[string][]byte {
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
	out := map[string][]byte{}
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
			out[hdr.Name] = b
		}
	}
}

func TestArchiveIncludesLODSnapshotsUnderFullScope(t *testing.T) {
	dir := t.TempDir()
	i := newInstance(dir, &Manifest{ID: "t"}, nil)
	sd := i.ServerDir()
	os.MkdirAll(filepath.Join(sd, "world"), 0o755)
	os.WriteFile(filepath.Join(sd, "world", "level.dat"), []byte("x"), 0o644)
	os.MkdirAll(filepath.Join(sd, "plugins"), 0o755)
	writeTestJar(t, filepath.Join(sd, "plugins", "voxy-server-side-paper.jar"), "name: VoxyServerSide\nversion: 0.14.0\n")
	writeSQLiteStore(t, filepath.Join(sd, "world", "vss-lod", "store.db"))
	// A file besides the store in the same directory must survive an include-mode backup.
	os.WriteFile(filepath.Join(sd, "world", "vss-lod", "notes.txt"), []byte("kept"), 0o644)

	if err := i.UpdateLOD(func(s *lodSettings) { s.BackupIncludeData = true }); err != nil {
		t.Fatal(err)
	}
	info, err := i.archive(t.Context(), "manual", "full", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Excluded) != 0 {
		t.Fatalf("nothing should be reported missing: %+v", info)
	}
	contents := readArchive(t, filepath.Join(i.backupsDir(), info.Name))
	raw, ok := contents["world/vss-lod/store.db"]
	if !ok {
		t.Fatal("store.db missing from the archive")
	}
	if string(contents["world/vss-lod/notes.txt"]) != "kept" {
		t.Fatal("a file beside the store should still be archived")
	}
	snapPath := filepath.Join(t.TempDir(), "snap.db")
	if err := os.WriteFile(snapPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	snap, err := sql.Open("sqlite", snapPath)
	if err != nil {
		t.Fatal(err)
	}
	defer snap.Close()
	var n int
	if err := snap.QueryRow(`SELECT count(*) FROM lods`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("snapshot rows: %d (%v)", n, err)
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "lod-snapshot-") {
			t.Fatalf("temp snapshot dir left behind: %s", e.Name())
		}
	}
}

// A store that is detected (its plugin is installed and in scope) but has not written anything to
// disk yet must not trip up an include-mode backup: nothing to snapshot, nothing to skip, nothing
// reported missing, and the backup still completes.
func TestIncludeModeSkipsStoresNotYetOnDisk(t *testing.T) {
	dir := t.TempDir()
	i := newInstance(dir, &Manifest{ID: "t"}, nil)
	sd := i.ServerDir()
	os.MkdirAll(filepath.Join(sd, "world"), 0o755)
	os.WriteFile(filepath.Join(sd, "world", "level.dat"), []byte("x"), 0o644)
	os.MkdirAll(filepath.Join(sd, "plugins"), 0o755)
	// Installed and in scope, but its store.db does not exist yet (a fresh plugin, or the server
	// has never loaded a world with it).
	writeTestJar(t, filepath.Join(sd, "plugins", "voxy-server-side-paper.jar"), "name: VoxyServerSide\nversion: 0.14.0\n")

	skip, excluded, extra, cleanup, err := i.lodBackupPlan(t.Context(), i.backupPaths("full"), true)
	defer cleanup()
	if err != nil {
		t.Fatal(err)
	}
	if len(skip) != 0 || len(excluded) != 0 || len(extra) != 0 {
		t.Fatalf("a store not yet on disk should plan nothing: skip %v excluded %v extra %v", skip, excluded, extra)
	}

	if err := i.UpdateLOD(func(s *lodSettings) { s.BackupIncludeData = true }); err != nil {
		t.Fatal(err)
	}
	info, err := i.archive(t.Context(), "manual", "full", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Excluded) != 0 || len(info.Extra) != 0 {
		t.Fatalf("nothing to exclude or snapshot: %+v", info)
	}
	if _, err := os.Stat(filepath.Join(i.backupsDir(), info.Name)); err != nil {
		t.Fatalf("the backup should still be written: %v", err)
	}
}

func TestArchiveExcludesLODStoresByDefault(t *testing.T) {
	dir := t.TempDir()
	i := newInstance(dir, &Manifest{ID: "t"}, nil)
	sd := i.ServerDir()
	os.MkdirAll(filepath.Join(sd, "world"), 0o755)
	os.WriteFile(filepath.Join(sd, "world", "level.dat"), []byte("x"), 0o644)
	os.MkdirAll(filepath.Join(sd, "plugins"), 0o755)
	writeTestJar(t, filepath.Join(sd, "plugins", "voxy-server-side-paper.jar"), "name: VoxyServerSide\nversion: 0.14.0\n")
	writeSQLiteStore(t, filepath.Join(sd, "world", "vss-lod", "store.db"))

	info, err := i.archive(t.Context(), "manual", "full", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Excluded) != 1 || info.Excluded[0] != "world/vss-lod" {
		t.Fatalf("excluded: %+v", info)
	}
	contents := readArchive(t, filepath.Join(i.backupsDir(), info.Name))
	if _, ok := contents["world/vss-lod/store.db"]; ok {
		t.Fatal("store.db should not be archived")
	}
}

func TestArchiveNeverIncludesPluginsUnderWorldsScope(t *testing.T) {
	dir := t.TempDir()
	i := newInstance(dir, &Manifest{ID: "t"}, nil)
	sd := i.ServerDir()
	os.MkdirAll(filepath.Join(sd, "world"), 0o755)
	os.WriteFile(filepath.Join(sd, "world", "level.dat"), []byte("x"), 0o644)
	os.MkdirAll(filepath.Join(sd, "plugins", "DHSupport"), 0o755)
	writeTestJar(t, filepath.Join(sd, "plugins", "distant-horizons-support.jar"), "name: DHSupport\nversion: 0.14.0\n")
	writeSQLiteStore(t, filepath.Join(sd, "plugins", "DHSupport", "data.sqlite"))

	if err := i.UpdateLOD(func(s *lodSettings) { s.BackupIncludeData = true }); err != nil {
		t.Fatal(err)
	}
	info, err := i.archive(t.Context(), "manual", "worlds", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range info.Paths {
		if p == "plugins" || strings.HasPrefix(p, "plugins/") {
			t.Fatalf("a worlds-scope backup should not include plugins: %v", info.Paths)
		}
	}
	if len(info.Extra) != 0 {
		t.Fatalf("no DHS extra should be planned outside the backup's own paths: %+v", info.Extra)
	}
	contents := readArchive(t, filepath.Join(i.backupsDir(), info.Name))
	for name := range contents {
		if strings.HasPrefix(name, "plugins/") {
			t.Fatalf("plugins leaked into a worlds backup: %s", name)
		}
	}
}

// A store whose snapshot fails (here: not a SQLite database at all) does not fail the backup: it is
// left out and listed in excluded, the console says so, and the other stores keep their snapshots.
func TestAFailedSnapshotLeavesItsStoreOutWithoutFailingTheBackup(t *testing.T) {
	dir := t.TempDir()
	i := newInstance(dir, &Manifest{ID: "t"}, bus.Nop{})
	sd := i.ServerDir()
	for _, w := range []string{"world", "world_nether"} {
		os.MkdirAll(filepath.Join(sd, w), 0o755)
		os.WriteFile(filepath.Join(sd, w, "level.dat"), []byte("x"), 0o644)
	}
	os.MkdirAll(filepath.Join(sd, "plugins"), 0o755)
	writeTestJar(t, filepath.Join(sd, "plugins", "voxy-server-side-paper.jar"), "name: VoxyServerSide\nversion: 0.14.0\n")
	writeSQLiteStore(t, filepath.Join(sd, "world", "vss-lod", "store.db"))
	os.MkdirAll(filepath.Join(sd, "world_nether", "vss-lod"), 0o755)
	os.WriteFile(filepath.Join(sd, "world_nether", "vss-lod", "store.db"), []byte("not a database, and long enough to be read as one"), 0o644)

	if err := i.UpdateLOD(func(s *lodSettings) { s.BackupIncludeData = true }); err != nil {
		t.Fatal(err)
	}
	info, err := i.archive(t.Context(), "schedule", "full", nil)
	if err != nil {
		t.Fatalf("the backup should not fail: %v", err)
	}
	if len(info.Excluded) != 1 || info.Excluded[0] != "world_nether/vss-lod" {
		t.Fatalf("excluded %v", info.Excluded)
	}
	contents := readArchive(t, filepath.Join(i.backupsDir(), info.Name))
	if _, ok := contents["world/vss-lod/store.db"]; !ok {
		t.Fatal("the store that could be snapshotted should be archived")
	}
	for name := range contents {
		if strings.HasPrefix(name, "world_nether/vss-lod") {
			t.Fatalf("the failed store leaked into the archive: %s", name)
		}
	}
	warned := false
	for _, l := range i.Console.Last(50) {
		if l.Level == "SYSTEM" && strings.Contains(l.Text, "world_nether/vss-lod/store.db") {
			warned = true
		}
	}
	if !warned {
		t.Fatalf("no console line about the failed snapshot: %+v", i.Console.Last(50))
	}
}
