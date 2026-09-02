package world

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/manuelvega/warden/wardend/internal/store"
)

type tokens map[string]string

func (t tokens) InstanceByAgentToken(tok string) (string, bool) {
	id, ok := t[tok]
	return id, ok
}

type recorder struct {
	mu   sync.Mutex
	msgs []string // "instance type"
	data []any
}

func (r *recorder) Broadcast(id, typ string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.msgs = append(r.msgs, id+" "+typ)
	r.data = append(r.data, data)
}

func (r *recorder) wait(t *testing.T, want string) any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		for i, m := range r.msgs {
			if m == want {
				d := r.data[i]
				r.mu.Unlock()
				return d
			}
		}
		r.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no %q broadcast; got %v", want, r.msgs)
	return nil
}

func gz(payload []byte) []byte {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	w.Write(payload)
	w.Close()
	return b.Bytes()
}

func frame(world string, cx, cz int32, hash uint64, blob []byte) []byte {
	b := []byte{frameChunk, byte(len(world))}
	b = append(b, world...)
	b = binary.LittleEndian.AppendUint32(b, uint32(cx))
	b = binary.LittleEndian.AppendUint32(b, uint32(cz))
	b = binary.LittleEndian.AppendUint64(b, hash)
	return append(b, blob...)
}

func TestParseFrame(t *testing.T) {
	blob := gz([]byte("payload"))
	f, err := ParseFrame(frame("world_nether", -3, 7, 0x0123456789abcdef, blob))
	if err != nil {
		t.Fatal(err)
	}
	if f.World != "world_nether" || f.CX != -3 || f.CZ != 7 || HashHex(f.Hash) != "0123456789abcdef" || !bytes.Equal(f.Blob, blob) {
		t.Fatalf("frame %+v", f)
	}
	for _, bad := range [][]byte{nil, {1}, {2, 1, 'w'}, frame("w", 0, 0, 1, []byte("not gzip at all......")), {1, 5, 'a', 'b'}} {
		if _, err := ParseFrame(bad); err == nil {
			t.Fatalf("accepted %v", bad)
		}
	}
}

func dial(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/agent/v1", nil)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestAgentSession(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "w.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	// A chunk from a previous session: the agent must learn about it on connect.
	if err := st.UpsertChunk(ctx, "inst", "world", 4, 4, "00000000000000aa", gz([]byte("old"))); err != nil {
		t.Fatal(err)
	}
	rec := &recorder{}
	svc := NewService(st, rec, tokens{"secret": "inst"})
	mux := http.NewServeMux()
	mux.HandleFunc("/agent/v1", svc.HandleAgent)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Wrong token: refused.
	c := dial(t, srv)
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","token":"nope"}`))
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatal("expected the socket to be closed")
	}

	c = dial(t, srv)
	defer c.Close(websocket.StatusNormalClosure, "")
	hello := `{"type":"hello","token":"secret","agent":"warden-agent/0.1.0","server":"Paper 26.2","worlds":[{"name":"world","dimension":"overworld","viewDistance":10,"minY":-64,"maxY":319}]}`
	if err := c.Write(ctx, websocket.MessageText, []byte(hello)); err != nil {
		t.Fatal(err)
	}
	_, ackBytes, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var ack struct {
		Type  string              `json:"type"`
		Known map[string][][3]any `json:"known"`
	}
	if json.Unmarshal(ackBytes, &ack) != nil || ack.Type != "hello.ok" || len(ack.Known["world"]) != 1 || ack.Known["world"][0][2] != "00000000000000aa" {
		t.Fatalf("hello.ok: %s", ackBytes)
	}
	if d := rec.wait(t, "inst world.agent").(AgentInfo); !d.Connected || d.Version != "warden-agent/0.1.0" {
		t.Fatalf("agent info %+v", d)
	}

	// Positions are republished as-is.
	players := `{"type":"players","t":123,"players":[{"uuid":"u","name":"Steve","world":"world","x":1.5,"y":64,"z":-3,"yaw":90,"pitch":0,"sneaking":false,"sprinting":true,"gamemode":"survival","vanished":false}]}`
	c.Write(ctx, websocket.MessageText, []byte(players))
	d := rec.wait(t, "inst world.players").(map[string]any)
	if got := d["players"].([]PlayerPos); len(got) != 1 || got[0].Name != "Steve" || !got[0].Sprinting {
		t.Fatalf("players %+v", d)
	}
	snap := svc.Snapshot(ctx, "inst")
	if len(snap.Players) != 1 || snap.At != 123 || len(snap.Worlds) != 1 || snap.Worlds[0].Chunks != 1 || !snap.Agent.Connected {
		t.Fatalf("snapshot %+v", snap)
	}

	// A chunk lands in the store and is announced (coalesced) once.
	blob := gz([]byte("new"))
	c.Write(ctx, websocket.MessageBinary, frame("world", 1, 2, 0xbb, blob))
	c.Write(ctx, websocket.MessageBinary, frame("world", 1, 2, 0xbb, blob)) // same hash: not a change
	d = rec.wait(t, "inst world.chunks").(map[string]any)
	refs := d["chunks"].([]chunkRef)
	if d["world"] != "world" || len(refs) != 1 || refs[0][0] != 1 || refs[0][2] != "00000000000000bb" {
		t.Fatalf("chunks %+v", d)
	}
	got, err := svc.Chunks(ctx, "inst", "world", [][2]int{{1, 2}})
	if err != nil || len(got) != 1 || !bytes.Equal(got[0].Blob, blob) {
		t.Fatalf("stored chunk %v %v", got, err)
	}

	// Closing the agent clears the players and flips the agent state.
	c.Close(websocket.StatusNormalClosure, "bye")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && svc.Snapshot(ctx, "inst").Agent.Connected {
		time.Sleep(10 * time.Millisecond)
	}
	if s := svc.Snapshot(ctx, "inst"); s.Agent.Connected || len(s.Players) != 0 {
		t.Fatalf("after close %+v", s)
	}
}
