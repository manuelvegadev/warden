package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMapChunks(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "w.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	if err := s.UpsertChunk(ctx, "a", "world", 1, -2, "aaaa", []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertChunk(ctx, "a", "world", 1, -2, "bbbb", []byte{9}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertChunk(ctx, "a", "world", 5, 5, "cccc", []byte{5}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertChunk(ctx, "a", "world_nether", 0, 0, "dddd", []byte{7}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertChunk(ctx, "b", "world", 1, -2, "eeee", []byte{8}); err != nil {
		t.Fatal(err)
	}

	hashes, err := s.ChunkHashes(ctx, "a")
	if err != nil || len(hashes["world"]) != 2 || len(hashes["world_nether"]) != 1 || hashes["world"][0].Hash == "aaaa" {
		t.Fatalf("hashes: %v %v", hashes, err)
	}
	counts, err := s.ChunkCounts(ctx, "a")
	if err != nil || counts["world"] != 2 || counts["world_nether"] != 1 {
		t.Fatalf("counts: %v %v", counts, err)
	}

	// The bounding box of the request covers (5,5) too, but it was not asked for.
	got, err := s.Chunks(ctx, "a", "world", [][2]int{{1, -2}, {7, 7}, {3, 3}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].CX != 1 || got[0].CZ != -2 || got[0].Hash != "bbbb" || len(got[0].Blob) != 1 {
		t.Fatalf("chunks: %+v", got)
	}
	if got, _ := s.Chunks(ctx, "a", "world", nil); len(got) != 0 {
		t.Fatalf("empty request must return nothing, got %v", got)
	}

	if err := s.DeleteChunks(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if counts, _ := s.ChunkCounts(ctx, "a"); len(counts) != 0 {
		t.Fatalf("delete left %v", counts)
	}
	if hashes, _ := s.ChunkHashes(ctx, "b"); len(hashes["world"]) != 1 {
		t.Fatalf("other instance must be untouched: %v", hashes)
	}
}
