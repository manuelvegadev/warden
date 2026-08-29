package store

import (
	"context"
	"time"

	"github.com/manuelvega/warden/wardend/internal/mc"
)

const playersSchema = `
CREATE TABLE IF NOT EXISTS players (
  instance_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  play_time_s INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (instance_id, name)
);
CREATE TABLE IF NOT EXISTS player_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  joined_at   INTEGER NOT NULL,
  left_at     INTEGER
);
CREATE INDEX IF NOT EXISTS player_sessions_open ON player_sessions(instance_id, name, left_at);
`

type Player struct {
	Name      string    `json:"name"`
	FirstSeen time.Time `json:"firstSeen"`
	LastSeen  time.Time `json:"lastSeen"`
	PlayTimeS int64     `json:"playTimeSeconds"`
	Online    bool      `json:"online"`
}

type Session struct {
	Name     string     `json:"name"`
	JoinedAt time.Time  `json:"joinedAt"`
	LeftAt   *time.Time `json:"leftAt,omitempty"`
}

type Event struct {
	TS     time.Time `json:"ts"`
	Kind   string    `json:"kind"`
	Player string    `json:"player,omitempty"`
	Text   string    `json:"text"`
}

// OnEvent implements instance.EventSink.
func (s *Store) OnEvent(instanceID string, ev *mc.Event, at time.Time) {
	ctx := context.Background()
	_, _ = s.db.ExecContext(ctx, `INSERT INTO events(instance_id, ts, kind, player, text) VALUES (?,?,?,?,?)`,
		instanceID, at.Unix(), string(ev.Kind), ev.Player, ev.Text)
	switch ev.Kind {
	case mc.EvPlayerJoin:
		_, _ = s.db.ExecContext(ctx, `INSERT INTO players(instance_id, name, first_seen, last_seen) VALUES (?,?,?,?)
			ON CONFLICT(instance_id, name) DO UPDATE SET last_seen=excluded.last_seen`, instanceID, ev.Player, at.Unix(), at.Unix())
		_, _ = s.db.ExecContext(ctx, `INSERT INTO player_sessions(instance_id, name, joined_at) VALUES (?,?,?)`, instanceID, ev.Player, at.Unix())
	case mc.EvPlayerLeave:
		s.closeSessions(ctx, instanceID, ev.Player, at)
	}
}

// OnStopped closes every open session of the instance (server stopped or crashed).
func (s *Store) OnStopped(instanceID string, at time.Time) {
	s.closeSessions(context.Background(), instanceID, "", at)
}

func (s *Store) closeSessions(ctx context.Context, instanceID, name string, at time.Time) {
	q := `SELECT id, name, joined_at FROM player_sessions WHERE instance_id=? AND left_at IS NULL`
	args := []any{instanceID}
	if name != "" {
		q += ` AND name=?`
		args = append(args, name)
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return
	}
	type open struct {
		id     int64
		name   string
		joined int64
	}
	var opens []open
	for rows.Next() {
		var o open
		if rows.Scan(&o.id, &o.name, &o.joined) == nil {
			opens = append(opens, o)
		}
	}
	rows.Close()
	for _, o := range opens {
		dur := at.Unix() - o.joined
		if dur < 0 {
			dur = 0
		}
		_, _ = s.db.ExecContext(ctx, `UPDATE player_sessions SET left_at=? WHERE id=?`, at.Unix(), o.id)
		_, _ = s.db.ExecContext(ctx, `UPDATE players SET last_seen=?, play_time_s=play_time_s+? WHERE instance_id=? AND name=?`, at.Unix(), dur, instanceID, o.name)
	}
}

func (s *Store) Players(ctx context.Context, instanceID string) ([]Player, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT p.name, p.first_seen, p.last_seen, p.play_time_s,
		EXISTS(SELECT 1 FROM player_sessions ps WHERE ps.instance_id=p.instance_id AND ps.name=p.name AND ps.left_at IS NULL)
		FROM players p WHERE p.instance_id=? ORDER BY p.last_seen DESC`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Player{}
	for rows.Next() {
		var p Player
		var first, last int64
		var online int
		if err := rows.Scan(&p.Name, &first, &last, &p.PlayTimeS, &online); err != nil {
			return nil, err
		}
		p.FirstSeen, p.LastSeen, p.Online = time.Unix(first, 0).UTC(), time.Unix(last, 0).UTC(), online == 1
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) Sessions(ctx context.Context, instanceID, name string, limit int) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name, joined_at, left_at FROM player_sessions WHERE instance_id=? AND name=? ORDER BY joined_at DESC LIMIT ?`, instanceID, name, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var se Session
		var joined int64
		var left *int64
		if err := rows.Scan(&se.Name, &joined, &left); err != nil {
			return nil, err
		}
		se.JoinedAt = time.Unix(joined, 0).UTC()
		if left != nil {
			t := time.Unix(*left, 0).UTC()
			se.LeftAt = &t
		}
		out = append(out, se)
	}
	return out, rows.Err()
}

func (s *Store) Events(ctx context.Context, instanceID string, kinds []string, limit int) ([]Event, error) {
	q := `SELECT ts, kind, player, text FROM events WHERE instance_id=?`
	args := []any{instanceID}
	if len(kinds) > 0 {
		q += ` AND kind IN (`
		for i, k := range kinds {
			if i > 0 {
				q += `,`
			}
			q += `?`
			args = append(args, k)
		}
		q += `)`
	}
	q += ` ORDER BY ts DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		var ts int64
		var player *string
		if err := rows.Scan(&ts, &e.Kind, &player, &e.Text); err != nil {
			return nil, err
		}
		e.TS = time.Unix(ts, 0).UTC()
		if player != nil {
			e.Player = *player
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
