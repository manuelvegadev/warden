package world

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/manuelvega/warden/wardend/internal/store"
)

// sink records what the world service hands over to the next service (the voice relay).
type sink struct {
	mu           sync.Mutex
	texts        []string // "type:raw"
	binaries     [][]byte
	kinds        []byte
	connected    int
	disconnected int
}

func (s *sink) OnAgentConnected(string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected++
}

func (s *sink) OnAgentDisconnected(string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.disconnected++
}

func (s *sink) OnAgentText(_ string, typ string, raw []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.texts = append(s.texts, typ+":"+string(raw))
}

func (s *sink) OnAgentBinary(_ string, kind byte, raw []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.kinds = append(s.kinds, kind)
	s.binaries = append(s.binaries, raw)
}

func (s *sink) wait(t *testing.T, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		ok := done()
		s.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestAgentSinkRouting(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "w.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	rec := &recorder{}
	svc := NewService(st, rec, tokens{"secret": "inst"})
	vs := &sink{}
	svc.SetSink(vs)
	mux := http.NewServeMux()
	mux.HandleFunc("/agent/v1", svc.HandleAgent)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	if err := svc.SendToAgent("inst", map[string]any{"type": "voice.listen"}); err == nil {
		t.Fatal("no agent yet: SendToAgent must fail")
	}

	c := dial(t, srv)
	defer c.Close(websocket.StatusNormalClosure, "")
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","token":"secret","agent":"warden-agent/0.2.0","server":"Paper 26.2"}`))
	if _, _, err := c.Read(ctx); err != nil { // hello.ok
		t.Fatal(err)
	}
	vs.wait(t, "the connected hook", func() bool { return vs.connected == 1 })

	// A text message of another type goes to the sink raw, with its type; `players` stays here.
	info := `{"type":"voice.info","available":true,"plugin":"2.6.21"}`
	c.Write(ctx, websocket.MessageText, []byte(info))
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"players","t":1,"players":[]}`))
	vs.wait(t, "voice.info", func() bool { return len(vs.texts) == 1 })
	if vs.texts[0] != "voice.info:"+info {
		t.Fatalf("sink got %q", vs.texts[0])
	}
	rec.wait(t, "inst world.players")
	vs.mu.Lock()
	n := len(vs.texts)
	vs.mu.Unlock()
	if n != 1 {
		t.Fatal("players must not reach the sink")
	}

	// A binary frame of another kind goes to the sink raw; chunk frames do not.
	raw := append([]byte{2, 1}, make([]byte, 30)...)
	c.Write(ctx, websocket.MessageBinary, raw)
	vs.wait(t, "the voice frame", func() bool { return len(vs.binaries) == 1 })
	if vs.kinds[0] != 2 || string(vs.binaries[0]) != string(raw) {
		t.Fatalf("frame kind %d %x, want 2 %x", vs.kinds[0], vs.binaries[0], raw)
	}

	// Control messages reach the agent.
	if err := svc.SendToAgent("inst", map[string]any{"type": "voice.listen", "active": true, "by": "Ana"}); err != nil {
		t.Fatal(err)
	}
	rctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	typ, b, err := c.Read(rctx)
	if err != nil {
		t.Fatal(err)
	}
	var msg map[string]any
	if typ != websocket.MessageText || json.Unmarshal(b, &msg) != nil || msg["type"] != "voice.listen" || msg["by"] != "Ana" {
		t.Fatalf("agent got %s", b)
	}

	// Binary control frames reach the agent as they are.
	if err := svc.SendBinaryToAgent("inst", []byte{3, 1, 'x', 9}); err != nil {
		t.Fatal(err)
	}
	rctx2, cancel2 := context.WithTimeout(ctx, 3*time.Second)
	defer cancel2()
	typ, b, err = c.Read(rctx2)
	if err != nil {
		t.Fatal(err)
	}
	if typ != websocket.MessageBinary || string(b) != string([]byte{3, 1, 'x', 9}) {
		t.Fatalf("agent got %v %x", typ, b)
	}

	// The agent leaving is reported.
	c.Close(websocket.StatusNormalClosure, "bye")
	vs.wait(t, "the disconnect hook", func() bool { return vs.disconnected == 1 })
}
