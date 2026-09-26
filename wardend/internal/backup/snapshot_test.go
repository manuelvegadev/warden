package backup

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSnapshotCopiesAWALDatabaseWhileItIsOpen(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "store.db")
	db, err := sql.Open("sqlite", src+"?_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE lods(x INTEGER); INSERT INTO lods VALUES (1),(2),(3)`); err != nil {
		t.Fatal(err)
	}
	// The writer keeps the database open, as the server does.
	dst := filepath.Join(dir, "snap.db")
	if err := SnapshotSQLite(context.Background(), src, dst); err != nil {
		t.Fatal(err)
	}
	snap, _ := sql.Open("sqlite", dst)
	defer snap.Close()
	var n int
	if err := snap.QueryRow(`SELECT count(*) FROM lods`).Scan(&n); err != nil || n != 3 {
		t.Fatalf("snapshot has %d rows (%v)", n, err)
	}
}
