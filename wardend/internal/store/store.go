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
-- Samples older than a day, folded into one row per instance and minute (Rollup).
CREATE TABLE IF NOT EXISTS metrics_1m (
  instance_id TEXT NOT NULL,
  ts          INTEGER NOT NULL,   -- unix seconds, the start of the minute
  cpu         REAL NOT NULL,      -- averages
  mem_rss     INTEGER NOT NULL,
  net_rx      INTEGER NOT NULL,
  net_tx      INTEGER NOT NULL,
  tps1        REAL,
  cpu_max     REAL NOT NULL,      -- the extremes the averages hide
  mem_rss_max INTEGER NOT NULL,
  tps1_min    REAL,
  disk_used   INTEGER NOT NULL,   -- highest in the minute
  players     INTEGER NOT NULL,
  samples     INTEGER NOT NULL    -- how many samples the row stands for
);
CREATE INDEX IF NOT EXISTS metrics_1m_instance_ts ON metrics_1m(instance_id, ts);
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
	if _, err := db.Exec(schema + playersSchema + mapChunksSchema); err != nil {
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
	// Set on the rows of a minute that has been rolled up: the peaks behind the averages above,
	// and how many samples the row stands for (1 for a raw sample).
	CPUMax    *float64 `json:"cpuMax,omitempty"`
	MemRSSMax *int64   `json:"memRssMax,omitempty"`
	TPS1Min   *float64 `json:"tps1Min,omitempty"`
	Samples   int      `json:"-"`
}

func (s *Store) InsertMetric(ctx context.Context, instanceID string, m MetricRow) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO metrics(instance_id, ts, cpu, mem_rss, disk_used, players, net_rx, net_tx, tps1) VALUES (?,?,?,?,?,?,?,?,?)`,
		instanceID, m.TS.Unix(), m.CPU, m.MemRSS, m.DiskUsed, m.Players, m.NetRx, m.NetTx, m.TPS1)
	return err
}

// Metrics reads an instance's samples since a time, oldest first: the minutes rolled up past a
// day, then the raw samples of the last one.
func (s *Store) Metrics(ctx context.Context, instanceID string, since time.Time) ([]MetricRow, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT ts, cpu, mem_rss, disk_used, players, net_rx, net_tx, tps1, NULL, NULL, NULL, 1
  FROM metrics WHERE instance_id=? AND ts>=?
UNION ALL
SELECT ts, cpu, mem_rss, disk_used, players, net_rx, net_tx, tps1, cpu_max, mem_rss_max, tps1_min, samples
  FROM metrics_1m WHERE instance_id=? AND ts>=?
ORDER BY 1`, instanceID, since.Unix(), instanceID, since.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MetricRow{}
	for rows.Next() {
		var r MetricRow
		var ts int64
		if err := rows.Scan(&ts, &r.CPU, &r.MemRSS, &r.DiskUsed, &r.Players, &r.NetRx, &r.NetTx, &r.TPS1,
			&r.CPUMax, &r.MemRSSMax, &r.TPS1Min, &r.Samples); err != nil {
			return nil, err
		}
		r.TS = time.Unix(ts, 0).UTC()
		out = append(out, r)
	}
	return out, rows.Err()
}

// Rollup folds the raw samples older than `before` into one row per instance and minute, then
// deletes them: a day at full resolution, then minutes, for the week the daemon keeps. `before`
// is truncated to the minute, so a minute is never split between two rollups.
func (s *Store) Rollup(ctx context.Context, before time.Time) error {
	cut := before.Unix() / 60 * 60
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
INSERT INTO metrics_1m(instance_id, ts, cpu, mem_rss, net_rx, net_tx, tps1, cpu_max, mem_rss_max, tps1_min, disk_used, players, samples)
SELECT instance_id, ts/60*60, avg(cpu), CAST(avg(mem_rss) AS INTEGER), CAST(avg(net_rx) AS INTEGER), CAST(avg(net_tx) AS INTEGER),
       avg(tps1), max(cpu), max(mem_rss), min(tps1), max(disk_used), max(players), count(*)
  FROM metrics WHERE ts < ? GROUP BY instance_id, ts/60`, cut); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM metrics WHERE ts < ?`, cut); err != nil {
		return err
	}
	return tx.Commit()
}

// Prune deletes metrics older than the retention window, rolled up or not.
func (s *Store) Prune(ctx context.Context, olderThan time.Time) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM metrics WHERE ts < ?`, olderThan.Unix()); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM metrics_1m WHERE ts < ?`, olderThan.Unix())
	return err
}
