package store

import (
	"context"
	"time"
)

// The live-view chunk cache (ADR-018): one row per chunk the agent sent, keyed by content hash. The
// blob is the gzip payload exactly as the agent produced it; wardend never decompresses it.
const mapChunksSchema = `
CREATE TABLE IF NOT EXISTS map_chunks (
  instance_id TEXT NOT NULL,
  world       TEXT NOT NULL,
  cx          INTEGER NOT NULL,
  cz          INTEGER NOT NULL,
  hash        TEXT NOT NULL,
  blob        BLOB NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (instance_id, world, cx, cz)
);
`

// ChunkRef identifies a chunk and the version of it the store holds.
type ChunkRef struct {
	CX   int
	CZ   int
	Hash string
}

// ChunkBlob is a stored chunk with its payload.
type ChunkBlob struct {
	ChunkRef
	Blob []byte
}

// UpsertChunk stores or replaces one chunk. Callers skip unchanged hashes themselves (the world
// service keeps them in memory), so this is one statement, not a read followed by a write.
func (s *Store) UpsertChunk(ctx context.Context, instanceID, world string, cx, cz int, hash string, blob []byte) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO map_chunks(instance_id, world, cx, cz, hash, blob, updated_at) VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(instance_id, world, cx, cz) DO UPDATE SET hash=excluded.hash, blob=excluded.blob, updated_at=excluded.updated_at`,
		instanceID, world, cx, cz, hash, blob, time.Now().Unix())
	return err
}

// ChunkHashes lists every chunk of an instance with its hash, by world: what the agent is told on
// connect, and what the world service compares incoming frames against.
func (s *Store) ChunkHashes(ctx context.Context, instanceID string) (map[string][]ChunkRef, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT world, cx, cz, hash FROM map_chunks WHERE instance_id=?`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]ChunkRef{}
	for rows.Next() {
		var w string
		var r ChunkRef
		if err := rows.Scan(&w, &r.CX, &r.CZ, &r.Hash); err != nil {
			return nil, err
		}
		out[w] = append(out[w], r)
	}
	return out, rows.Err()
}

// ChunkCounts returns how many chunks the store holds per world of an instance.
func (s *Store) ChunkCounts(ctx context.Context, instanceID string) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT world, COUNT(*) FROM map_chunks WHERE instance_id=? GROUP BY world`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var w string
		var n int
		if err := rows.Scan(&w, &n); err != nil {
			return nil, err
		}
		out[w] = n
	}
	return out, rows.Err()
}

// Chunks fetches the requested chunks that exist. The query covers the bounding box of the keys
// (what a viewer asks for is a square around a point) and the result is filtered to the exact set.
func (s *Store) Chunks(ctx context.Context, instanceID, world string, keys [][2]int) ([]ChunkBlob, error) {
	if len(keys) == 0 {
		return []ChunkBlob{}, nil
	}
	minX, maxX, minZ, maxZ := keys[0][0], keys[0][0], keys[0][1], keys[0][1]
	want := make(map[[2]int]bool, len(keys))
	for _, k := range keys {
		want[k] = true
		minX, maxX = min(minX, k[0]), max(maxX, k[0])
		minZ, maxZ = min(minZ, k[1]), max(maxZ, k[1])
	}
	rows, err := s.db.QueryContext(ctx, `SELECT cx, cz, hash, blob FROM map_chunks WHERE instance_id=? AND world=? AND cx BETWEEN ? AND ? AND cz BETWEEN ? AND ?`,
		instanceID, world, minX, maxX, minZ, maxZ)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChunkBlob{}
	for rows.Next() {
		var c ChunkBlob
		if err := rows.Scan(&c.CX, &c.CZ, &c.Hash, &c.Blob); err != nil {
			return nil, err
		}
		if want[[2]int{c.CX, c.CZ}] {
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

// DeleteChunks drops the cache of an instance (called when the instance is deleted).
func (s *Store) DeleteChunks(ctx context.Context, instanceID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM map_chunks WHERE instance_id=?`, instanceID)
	return err
}
