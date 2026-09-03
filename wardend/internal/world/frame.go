// Package world receives the Warden Agent's stream (player positions and simplified chunks, ADR-018),
// caches the chunks in the store and republishes both to Beacon over the bus and the REST API.
package world

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// Frame is one binary message from the agent: a chunk of a world.
type Frame struct {
	World string
	CX    int32
	CZ    int32
	Hash  uint64
	Blob  []byte // gzip payload, stored as-is
}

// frameChunk is the kind byte of a chunk frame (ADR-018). Other kinds belong to other services
// (voice frames, ADR-019) and are handed to the AgentSink unparsed.
const frameChunk = 1

// kind is the first byte of a binary message, 0 for an empty one.
func kind(b []byte) byte {
	if len(b) == 0 {
		return 0
	}
	return b[0]
}

// MaxFrame bounds an agent message; a mountain chunk is tens of KB, so this is generous.
const MaxFrame = 4 << 20

var errBadFrame = errors.New("malformed agent frame")

// ParseFrame decodes `u8 kind · u8 nameLen · name · i32 cx · i32 cz · u64 hash · blob` (little-endian).
func ParseFrame(b []byte) (Frame, error) {
	if len(b) < 2 || b[0] != frameChunk {
		return Frame{}, errBadFrame
	}
	n := int(b[1])
	if n == 0 || len(b) < 2+n+16 {
		return Frame{}, errBadFrame
	}
	f := Frame{World: string(b[2 : 2+n])}
	p := 2 + n
	f.CX = int32(binary.LittleEndian.Uint32(b[p:]))
	f.CZ = int32(binary.LittleEndian.Uint32(b[p+4:]))
	f.Hash = binary.LittleEndian.Uint64(b[p+8:])
	f.Blob = b[p+16:]
	if len(f.Blob) < 18 || f.Blob[0] != 0x1f || f.Blob[1] != 0x8b { // gzip magic
		return Frame{}, fmt.Errorf("%w: payload is not gzip", errBadFrame)
	}
	return f, nil
}

// HashHex is the 16-digit form shared with the agent and the viewer.
func HashHex(h uint64) string { return fmt.Sprintf("%016x", h) }
