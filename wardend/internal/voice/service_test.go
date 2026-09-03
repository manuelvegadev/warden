package voice

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/mc"
)

// fakeAgent records what the service tells the agent: control messages and speak frames.
type fakeAgent struct {
	mu     sync.Mutex
	msgs   []listenMsg
	sess   []sessionMsg
	frames [][]byte
	down   bool
}

func (a *fakeAgent) SendToAgent(_ string, msg any) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.down {
		return context.DeadlineExceeded
	}
	switch m := msg.(type) {
	case listenMsg:
		a.msgs = append(a.msgs, m)
	case sessionMsg:
		a.sess = append(a.sess, m)
	default:
		panic("unexpected agent message")
	}
	return nil
}

func (a *fakeAgent) SendBinaryToAgent(_ string, raw []byte) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.down {
		return context.DeadlineExceeded
	}
	a.frames = append(a.frames, raw)
	return nil
}

func (a *fakeAgent) last(t *testing.T) listenMsg {
	t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.msgs) == 0 {
		t.Fatal("the agent was never told anything")
	}
	return a.msgs[len(a.msgs)-1]
}

func (a *fakeAgent) lastSession(t *testing.T) sessionMsg {
	t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.sess) == 0 {
		t.Fatal("the agent got no voice.session")
	}
	return a.sess[len(a.sess)-1]
}

// wait polls until cond holds under the lock, or fails after 3 s.
func (a *fakeAgent) wait(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		a.mu.Lock()
		ok := cond()
		a.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

type fakeEvents struct {
	mu  sync.Mutex
	evs []mc.Event
}

func (e *fakeEvents) OnEvent(_ string, ev *mc.Event, _ time.Time) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.evs = append(e.evs, *ev)
}

type recorder struct {
	mu   sync.Mutex
	msgs []string
	data []any
}

func (r *recorder) Broadcast(id, typ string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.msgs = append(r.msgs, id+" "+typ)
	r.data = append(r.data, data)
}

func (r *recorder) lastStatus(t *testing.T) Status {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := len(r.msgs) - 1; i >= 0; i-- {
		if strings.HasSuffix(r.msgs[i], " voice.status") {
			return r.data[i].(Status)
		}
	}
	t.Fatal("no voice.status broadcast")
	return Status{}
}

func TestListenerTransitions(t *testing.T) {
	agent := &fakeAgent{}
	events := &fakeEvents{}
	rec := &recorder{}
	s := NewService(events, rec, agent, nil, nil)

	a := &client{name: "Ana", frames: newQueue(4), ctrl: make(chan []byte, 16)}
	b := &client{name: "Bo", frames: newQueue(4), ctrl: make(chan []byte, 16)}

	s.setListening("srv", a, true)
	if m := agent.last(t); !m.Active || m.By != "Ana" || m.Type != "voice.listen" {
		t.Fatalf("first listener: agent got %+v", m)
	}
	s.setListening("srv", b, true)
	if m := agent.last(t); !m.Active || m.By != "Ana, Bo" {
		t.Fatalf("second listener: agent got %+v", m)
	}
	if st := rec.lastStatus(t); !slices.Equal(st.Listeners, []string{"Ana", "Bo"}) || st.Speaking == nil {
		t.Fatalf("status %+v", st)
	}

	// Frames reach every listener, verbatim; malformed ones and other kinds are dropped.
	frame := append(make([]byte, frameHeader), 0xAA)
	frame[0] = frameKind
	s.OnAgentBinary("srv", frameKind, frame)
	if a.frames.len() != 1 || b.frames.len() != 1 {
		t.Fatal("both listeners must receive the frame")
	}
	s.OnAgentBinary("other", frameKind, frame)
	s.OnAgentBinary("srv", frameKind, frame[:frameHeader]) // no opus payload
	s.OnAgentBinary("srv", 9, frame)                       // not a voice frame
	if a.frames.len() != 1 {
		t.Fatal("frames of another instance or malformed frames must not be relayed")
	}

	s.setListening("srv", a, false)
	if m := agent.last(t); !m.Active || m.By != "Bo" {
		t.Fatalf("one left: agent got %+v", m)
	}
	s.setListening("srv", b, false)
	if m := agent.last(t); m.Active || m.By != "" {
		t.Fatalf("last left: agent got %+v", m)
	}
	s.setListening("srv", b, false) // idempotent
	if st := rec.lastStatus(t); len(st.Listeners) != 0 || st.Listeners == nil {
		t.Fatalf("status after leaving %+v", st)
	}

	events.mu.Lock()
	defer events.mu.Unlock()
	kinds := make([]string, 0, len(events.evs))
	for _, ev := range events.evs {
		kinds = append(kinds, string(ev.Kind)+":"+ev.Player)
	}
	want := []string{"voice.listen.start:Ana", "voice.listen.start:Bo", "voice.listen.stop:Ana", "voice.listen.stop:Bo"}
	if !slices.Equal(kinds, want) {
		t.Fatalf("audit %v, want %v", kinds, want)
	}
	if !strings.Contains(events.evs[0].Text, "started listening from Beacon") {
		t.Fatalf("audit text %q", events.evs[0].Text)
	}
}

func TestAgentReconnectResendsListen(t *testing.T) {
	agent := &fakeAgent{down: true}
	s := NewService(nil, &recorder{}, agent, nil, nil)
	c := &client{name: "Ana", frames: newQueue(4), ctrl: make(chan []byte, 16)}
	s.setListening("srv", c, true) // the agent is away: the send fails quietly
	agent.mu.Lock()
	agent.down = false
	agent.mu.Unlock()
	s.OnAgentConnected("srv")
	if m := agent.last(t); !m.Active || m.By != "Ana" {
		t.Fatalf("after reconnect: agent got %+v", m)
	}
	s.OnAgentConnected("idle") // nobody listening: nothing to say
	if n := len(agent.msgs); n != 1 {
		t.Fatalf("%d messages, want 1", n)
	}
}

func TestStatusShape(t *testing.T) {
	s := NewService(nil, &recorder{}, &fakeAgent{}, nil, nil)
	b, _ := json.Marshal(s.Status("unknown"))
	if string(b) != `{"available":false,"distance":0,"whisper":0,"policy":"","listeners":[],"speaking":[]}` {
		t.Fatalf("empty status: %s", b)
	}
	s.OnAgentText("srv", "voice.info", []byte(`{"type":"voice.info","available":true,"plugin":"2.6.21","distance":48,"whisper":6,"policy":"notify"}`))
	s.OnAgentText("srv", "players", []byte(`{"type":"players"}`)) // not ours
	b, _ = json.Marshal(s.Status("srv"))
	if string(b) != `{"available":true,"plugin":"2.6.21","distance":48,"whisper":6,"policy":"notify","listeners":[],"speaking":[]}` {
		t.Fatalf("status: %s", b)
	}
	s.OnAgentDisconnected("srv")
	if s.Status("srv").Available {
		t.Fatal("available must drop with the agent")
	}
}

// --- the socket ---

// testIssuer serves a JWKS and signs tokens like Beacon's Better Auth jwt plugin (EdDSA).
type testIssuer struct {
	srv  *httptest.Server
	priv jwk.Key
}

func newIssuer(t *testing.T) *testIssuer {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	privKey, _ := jwk.Import(priv)
	pubKey, _ := jwk.Import(pub)
	_ = privKey.Set(jwk.KeyIDKey, "k1")
	_ = pubKey.Set(jwk.KeyIDKey, "k1")
	_ = pubKey.Set(jwk.AlgorithmKey, jwa.EdDSA())
	set := jwk.NewSet()
	_ = set.AddKey(pubKey)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/jwks", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(set)
	})
	return &testIssuer{srv: httptest.NewServer(mux), priv: privKey}
}

func (i *testIssuer) token(t *testing.T, claims map[string]any) string {
	t.Helper()
	b := jwt.NewBuilder().Issuer(i.srv.URL).Audience([]string{auth.Audience}).Subject("u1").
		Expiration(time.Now().Add(time.Minute)).Claim("name", "Ana")
	for k, v := range claims {
		b = b.Claim(k, v)
	}
	tok, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.EdDSA(), i.priv, jws.WithProtectedHeaders(func() jws.Headers {
		h := jws.NewHeaders()
		_ = h.Set(jws.KeyIDKey, "k1")
		return h
	}())))
	if err != nil {
		t.Fatal(err)
	}
	return string(signed)
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func send(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}

type reply struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Status  Status `json:"status"`
}

func recvText(t *testing.T, c *websocket.Conn) reply {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	typ, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("got a %v message, want text", typ)
	}
	var m reply
	_ = json.Unmarshal(b, &m)
	return m
}

func recvBinary(t *testing.T, c *websocket.Conn) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		typ, b, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if typ == websocket.MessageBinary {
			return b
		}
	}
}

func TestSocketGatingAndRelay(t *testing.T) {
	iss := newIssuer(t)
	defer iss.srv.Close()
	verifier, err := auth.NewVerifier(context.Background(), auth.Options{JWKSURL: iss.srv.URL + "/api/auth/jwks", Issuer: iss.srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	agent := &fakeAgent{}
	rec := &recorder{}
	s := NewService(&fakeEvents{}, rec, agent, verifier, nil)
	s.setInfo("srv", Info{Available: true, Plugin: "2.6.21", Distance: 48, Whisper: 6, Policy: "notify"})

	// Mounted like the router does: on a root mux beside the JWT-guarded /api/v1/ subtree, which
	// must not capture it.
	root := http.NewServeMux()
	root.HandleFunc("GET /api/v1/instances/{id}/voice/ws", s.HandleWS)
	root.HandleFunc("/api/v1/", func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "jwt required", 401) })
	srv := httptest.NewServer(root)
	defer srv.Close()
	url := func(id string) string {
		return "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/instances/" + id + "/voice/ws"
	}

	// Bad token → closed.
	bad := dial(t, url("srv"))
	send(t, bad, map[string]any{"type": "auth", "token": "nope"})
	if _, _, err := bad.Read(context.Background()); err == nil {
		t.Fatal("expected close on invalid token")
	}

	// A viewer cannot see... an instance they have no grant on looks absent.
	c := dial(t, url("creative"))
	send(t, c, map[string]any{"type": "auth", "token": iss.token(t, map[string]any{"role": "operator", "acl": map[string]string{"srv": "manager"}})})
	if m := recvText(t, c); m.Type != "auth.ok" {
		t.Fatalf("got %s, want auth.ok", m.Type)
	}
	send(t, c, map[string]any{"type": "voice.hello", "listen": true})
	if m := recvText(t, c); m.Type != "error" || m.Message != "instance not found" {
		t.Fatalf("got %+v, want instance not found", m)
	}

	// An operator on the instance is refused: listening needs manager.
	c = dial(t, url("srv"))
	send(t, c, map[string]any{"type": "auth", "token": iss.token(t, map[string]any{"role": "operator", "acl": map[string]string{"srv": "operator"}})})
	recvText(t, c)
	send(t, c, map[string]any{"type": "voice.hello", "listen": true})
	if m := recvText(t, c); m.Type != "error" || !strings.Contains(m.Message, "role manager is required") {
		t.Fatalf("got %+v, want the role error", m)
	}
	if len(agent.msgs) != 0 {
		t.Fatal("a refused listener must not reach the agent")
	}

	// A manager joins: voice.ok with the status, the agent is switched on, frames flow verbatim.
	c = dial(t, url("srv"))
	defer c.Close(websocket.StatusNormalClosure, "")
	send(t, c, map[string]any{"type": "auth", "token": iss.token(t, map[string]any{"role": "operator", "acl": map[string]string{"srv": "manager"}})})
	recvText(t, c)
	send(t, c, map[string]any{"type": "voice.hello", "listen": true})
	m := recvText(t, c)
	if m.Type != "voice.ok" || !m.Status.Available || m.Status.Plugin != "2.6.21" {
		t.Fatalf("got %+v, want voice.ok with the plugin state", m)
	}
	if st := rec.lastStatus(t); !slices.Equal(st.Listeners, []string{"Ana"}) {
		t.Fatalf("hub status %+v, want Ana listening", st)
	}
	if a := agent.last(t); !a.Active || a.By != "Ana" {
		t.Fatalf("agent got %+v", a)
	}
	frame := append([]byte{2, 1}, make([]byte, 24)...)
	frame = append(frame, 0xAA, 0xBB)
	s.OnAgentBinary("srv", frameKind, frame)
	if got := recvBinary(t, c); string(got) != string(frame) {
		t.Fatalf("relayed %x, want %x", got, frame)
	}
	send(t, c, map[string]any{"type": "ping"})
	if m := recvText(t, c); m.Type != "pong" {
		t.Fatalf("got %s, want pong", m.Type)
	}

	// Leaving switches the agent off.
	c.Close(websocket.StatusNormalClosure, "done")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		agent.mu.Lock()
		n := len(agent.msgs)
		off := n > 0 && !agent.msgs[n-1].Active
		agent.mu.Unlock()
		if off {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the agent was not told to stop after the last listener left")
}

func TestSpeakSessions(t *testing.T) {
	agent := &fakeAgent{}
	events := &fakeEvents{}
	rec := &recorder{}
	s := NewService(events, rec, agent, nil, nil)
	c := &client{name: "Ana", session: "a1b2c3d4", canSpeak: true, frames: newQueue(4), ctrl: make(chan []byte, 16)}
	s.attach("srv", c)

	// Frames before the session is open are dropped.
	body := append([]byte{3, 0, 0}, make([]byte, 12)...) // static, header only
	body = append(body, 0xAA)
	s.relaySpeak("srv", c, body)
	if len(agent.frames) != 0 {
		t.Fatal("a frame outside a session must not reach the agent")
	}

	s.setSpeaking("srv", c, true)
	if m := agent.lastSession(t); m.Type != "voice.session" || m.ID != "a1b2c3d4" || m.By != "Ana" || !m.Open {
		t.Fatalf("open: agent got %+v", m)
	}
	if st := rec.lastStatus(t); !slices.Equal(st.Speaking, []string{"Ana"}) || st.Listeners == nil {
		t.Fatalf("status %+v", st)
	}
	s.setSpeaking("srv", c, true) // idempotent
	if len(agent.sess) != 1 {
		t.Fatalf("%d session messages, want 1", len(agent.sess))
	}

	// A valid body is relayed behind the session id, the kind byte replaced by the prefix.
	s.relaySpeak("srv", c, body)
	want := append([]byte{3, 8}, []byte("a1b2c3d4")...)
	want = append(want, body[1:]...)
	if len(agent.frames) != 1 || string(agent.frames[0]) != string(want) {
		t.Fatalf("relayed %x, want %x", agent.frames, want)
	}
	// Locational: the world name sizes the body; entity: a UUID does.
	loc := append([]byte{3, 1, 1}, make([]byte, 12)...)
	loc = append(loc, 5)
	loc = append(loc, []byte("world")...)
	loc = append(loc, make([]byte, 24)...)
	s.relaySpeak("srv", c, loc) // no opus byte: dropped
	loc = append(loc, 0xBB)
	s.relaySpeak("srv", c, loc)
	ent := append([]byte{3, 2, 0}, make([]byte, 12+16)...)
	s.relaySpeak("srv", c, append(ent, 0xCC))
	s.relaySpeak("srv", c, append([]byte{3, 7, 0}, make([]byte, 20)...)) // bad mode
	s.relaySpeak("srv", c, []byte{3, 0})                                 // short
	if len(agent.frames) != 3 {
		t.Fatalf("%d frames relayed, want 3", len(agent.frames))
	}

	// The agent reconnecting learns the open session again.
	s.OnAgentConnected("srv")
	if len(agent.sess) != 2 || !agent.sess[1].Open || agent.sess[1].ID != "a1b2c3d4" {
		t.Fatalf("reconnect: %+v", agent.sess)
	}

	// Leaving closes the session.
	s.detach("srv", c)
	if m := agent.lastSession(t); m.Open {
		t.Fatalf("close: agent got %+v", m)
	}
	if st := rec.lastStatus(t); len(st.Speaking) != 0 || st.Speaking == nil {
		t.Fatalf("status after leaving %+v", st)
	}
	events.mu.Lock()
	defer events.mu.Unlock()
	kinds := make([]string, 0, len(events.evs))
	for _, ev := range events.evs {
		kinds = append(kinds, string(ev.Kind)+":"+ev.Player)
	}
	if want := []string{"voice.speak.start:Ana", "voice.speak.stop:Ana"}; !slices.Equal(kinds, want) {
		t.Fatalf("audit %v, want %v", kinds, want)
	}
}

func TestSocketSpeakOnly(t *testing.T) {
	iss := newIssuer(t)
	defer iss.srv.Close()
	verifier, err := auth.NewVerifier(context.Background(), auth.Options{JWKSURL: iss.srv.URL + "/api/auth/jwks", Issuer: iss.srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	agent := &fakeAgent{}
	rec := &recorder{}
	s := NewService(&fakeEvents{}, rec, agent, verifier, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/instances/{id}/voice/ws", s.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/instances/srv/voice/ws"
	operator := func() string {
		return iss.token(t, map[string]any{"role": "operator", "acl": map[string]string{"srv": "operator"}})
	}

	// An operator may speak but not listen.
	c := dial(t, url)
	send(t, c, map[string]any{"type": "auth", "token": operator()})
	recvText(t, c)
	send(t, c, map[string]any{"type": "voice.hello", "listen": true, "speak": true})
	if m := recvText(t, c); m.Type != "error" || !strings.Contains(m.Message, "role manager is required") {
		t.Fatalf("got %+v, want the listen role error", m)
	}

	// Neither flag: nothing to do.
	c = dial(t, url)
	send(t, c, map[string]any{"type": "auth", "token": operator()})
	recvText(t, c)
	send(t, c, map[string]any{"type": "voice.hello"})
	if m := recvText(t, c); m.Type != "error" || m.Message != "nothing to do" {
		t.Fatalf("got %+v, want nothing to do", m)
	}

	// Speak only: accepted, no listener registered; push-to-talk opens a session, frames flow.
	c = dial(t, url)
	defer c.Close(websocket.StatusNormalClosure, "")
	send(t, c, map[string]any{"type": "auth", "token": operator()})
	recvText(t, c)
	send(t, c, map[string]any{"type": "voice.hello", "speak": true})
	if m := recvText(t, c); m.Type != "voice.ok" {
		t.Fatalf("got %+v, want voice.ok", m)
	}
	if len(agent.msgs) != 0 {
		t.Fatal("a speak-only socket must not register as a listener")
	}
	// A listen toggle from a socket that did not ask for it is ignored.
	send(t, c, map[string]any{"type": "voice.listen", "active": true})
	send(t, c, map[string]any{"type": "voice.speak", "active": true})
	agent.wait(t, "the session", func() bool { return len(agent.sess) == 1 && agent.sess[0].Open && agent.sess[0].By == "Ana" })
	if len(agent.msgs) != 0 {
		t.Fatal("the listen toggle must be ignored without the listen capability")
	}
	body := append([]byte{3, 0, 0}, make([]byte, 12)...)
	body = append(body, 0xEE)
	if err := c.Write(context.Background(), websocket.MessageBinary, body); err != nil {
		t.Fatal(err)
	}
	agent.wait(t, "the frame", func() bool { return len(agent.frames) == 1 })
	id := agent.sess[0].ID
	want := append([]byte{3, byte(len(id))}, []byte(id)...)
	want = append(want, body[1:]...)
	if string(agent.frames[0]) != string(want) {
		t.Fatalf("relayed %x, want %x", agent.frames[0], want)
	}
	send(t, c, map[string]any{"type": "voice.speak", "active": false})
	agent.wait(t, "the close", func() bool { return len(agent.sess) == 2 && !agent.sess[1].Open })
	if st := rec.lastStatus(t); len(st.Speaking) != 0 {
		t.Fatalf("status %+v", st)
	}
}

func TestSocketListenToggle(t *testing.T) {
	iss := newIssuer(t)
	defer iss.srv.Close()
	verifier, err := auth.NewVerifier(context.Background(), auth.Options{JWKSURL: iss.srv.URL + "/api/auth/jwks", Issuer: iss.srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	agent := &fakeAgent{}
	s := NewService(&fakeEvents{}, &recorder{}, agent, verifier, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/instances/{id}/voice/ws", s.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/v1/instances/srv/voice/ws")
	defer c.Close(websocket.StatusNormalClosure, "")
	send(t, c, map[string]any{"type": "auth", "token": iss.token(t, map[string]any{"role": "operator", "acl": map[string]string{"srv": "manager"}})})
	recvText(t, c)
	send(t, c, map[string]any{"type": "voice.hello", "listen": true, "speak": true})
	recvText(t, c)
	agent.wait(t, "listening on", func() bool { return len(agent.msgs) == 1 && agent.msgs[0].Active })
	send(t, c, map[string]any{"type": "voice.listen", "active": false})
	agent.wait(t, "listening off", func() bool { return len(agent.msgs) == 2 && !agent.msgs[1].Active })
	send(t, c, map[string]any{"type": "voice.listen", "active": true})
	agent.wait(t, "listening on again", func() bool { return len(agent.msgs) == 3 && agent.msgs[2].Active })
}
