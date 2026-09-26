package backup

import (
	"context"
	"database/sql"
	"net/url"
	"os"

	_ "modernc.org/sqlite"
)

// SnapshotSQLite writes a consistent copy of a SQLite database to dst with `VACUUM INTO`, while
// other connections (the Minecraft server) keep writing: SQLite reads one snapshot of the database,
// WAL included. The source is opened read-only.
func SnapshotSQLite(ctx context.Context, src, dst string) error {
	os.Remove(dst)
	dsn := (&url.URL{Scheme: "file", Path: src, RawQuery: "mode=ro&_pragma=busy_timeout(5000)"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.ExecContext(ctx, `VACUUM INTO ?`, dst)
	return err
}
