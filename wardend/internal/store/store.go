// Package store opens SQLite (modernc.org/sqlite, no cgo) and applies migrations. Schema in docs/api.md.
package store

import (
	"context"
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS metrics (
  instance_id TEXT NOT NULL,
  ts          INTEGER NOT NULL,   -- unix seconds
  cpu         REAL NOT NULL,
  mem_rss     INTEGER NOT NULL,
  disk_used   INTEGER NOT NULL,
  players     INTEGER NOT NULL,
  net_rx      INTEGER NOT NULL DEFAULT 0,
  net_tx      INTEGER NOT NULL DEFAULT 0,
  tps1        REAL
);
CREATE INDEX IF NOT EXISTS metrics_instance_ts ON metrics(instance_id, ts);
CREATE TABLE IF NOT EXISTS events (
  instance_id TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  player      TEXT,
  text        TEXT
);
CREATE INDEX IF NOT EXISTS events_instance_ts ON events(instance_id, ts);
`

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema + playersSchema); err != nil {
		db.Close()
		return nil, err
	}
	// Additive migrations for databases created before these columns existed (errors = already there).
	for _, stmt := range []string{
		`ALTER TABLE metrics ADD COLUMN net_rx INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE metrics ADD COLUMN net_tx INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE metrics ADD COLUMN tps1 REAL`,
	} {
		_, _ = db.Exec(stmt)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

type MetricRow struct {
	TS       time.Time `json:"ts"`
	CPU      float64   `json:"cpu"`
	MemRSS   int64     `json:"memRss"`
	DiskUsed int64     `json:"diskUsed"`
	Players  int       `json:"players"`
	NetRx    int64     `json:"netRx"` // bytes/s (host interfaces)
	NetTx    int64     `json:"netTx"`
	TPS1     *float64  `json:"tps1,omitempty"`
}

func (s *Store) InsertMetric(ctx context.Context, instanceID string, m MetricRow) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO metrics(instance_id, ts, cpu, mem_rss, disk_used, players, net_rx, net_tx, tps1) VALUES (?,?,?,?,?,?,?,?,?)`,
		instanceID, m.TS.Unix(), m.CPU, m.MemRSS, m.DiskUsed, m.Players, m.NetRx, m.NetTx, m.TPS1)
	return err
}

func (s *Store) Metrics(ctx context.Context, instanceID string, since time.Time) ([]MetricRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT ts, cpu, mem_rss, disk_used, players, net_rx, net_tx, tps1 FROM metrics WHERE instance_id=? AND ts>=? ORDER BY ts`, instanceID, since.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MetricRow{}
	for rows.Next() {
		var r MetricRow
		var ts int64
		if err := rows.Scan(&ts, &r.CPU, &r.MemRSS, &r.DiskUsed, &r.Players, &r.NetRx, &r.NetTx, &r.TPS1); err != nil {
			return nil, err
		}
		r.TS = time.Unix(ts, 0).UTC()
		out = append(out, r)
	}
	return out, rows.Err()
}

// Prune deletes metrics older than the retention window.
func (s *Store) Prune(ctx context.Context, olderThan time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM metrics WHERE ts < ?`, olderThan.Unix())
	return err
}
