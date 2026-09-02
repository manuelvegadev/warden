package api

import (
	"encoding/binary"
	"encoding/json"
	"net/http"
	"strconv"
)

// maxChunkRequest bounds one batch: a 32-chunk radius is 4225 chunks, more than any viewer asks at once.
const maxChunkRequest = 1024

// getMap is GET /instances/{id}/map: whether the software can run the agent, the agent state, worlds and positions.
func (s *server) getMap(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	snap := s.World.Snapshot(r.Context(), inst.Manifest.ID)
	writeJSON(w, 200, map[string]any{
		"supported": inst.LiveViewSupported(),
		"agent":     snap.Agent,
		"worlds":    snap.Worlds,
		"players":   snap.Players,
		"t":         snap.At,
	})
}

// postMapChunks is POST /instances/{id}/map/{world}/chunks {"chunks":[[cx,cz],…]}: the stored chunks
// among the requested ones, as `i32 cx · i32 cz · u64 hash · u32 len · gzip blob` records (little-endian).
func (s *server) postMapChunks(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var body struct {
		Chunks [][2]int `json:"chunks"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, 400, "bad_request", "chunks is required")
		return
	}
	if len(body.Chunks) > maxChunkRequest {
		writeError(w, 400, "too_many_chunks", "at most 1024 chunks per request")
		return
	}
	worldName := r.PathValue("world")
	if worldName == "" || len(worldName) > 255 {
		writeError(w, 400, "bad_request", "world is required")
		return
	}
	blobs, err := s.World.Chunks(r.Context(), inst.Manifest.ID, worldName, body.Chunks)
	if err != nil {
		writeError(w, 500, "store_error", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	hdr := make([]byte, 20)
	for _, c := range blobs {
		hash, _ := strconv.ParseUint(c.Hash, 16, 64)
		binary.LittleEndian.PutUint32(hdr[0:], uint32(int32(c.CX)))
		binary.LittleEndian.PutUint32(hdr[4:], uint32(int32(c.CZ)))
		binary.LittleEndian.PutUint64(hdr[8:], hash)
		binary.LittleEndian.PutUint32(hdr[16:], uint32(len(c.Blob)))
		if _, err := w.Write(hdr); err != nil {
			return
		}
		if _, err := w.Write(c.Blob); err != nil {
			return
		}
	}
}
