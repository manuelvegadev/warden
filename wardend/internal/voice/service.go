// Package voice relays Simple Voice Chat audio between the Warden Agent and the browser (ADR-019).
//
// The agent forwards every Opus frame a player speaks as a kind-2 binary frame on its loopback
// socket; this service fans those frames out, unchanged, to the browsers listening to the instance
// over /api/v1/instances/{id}/voice/ws, and carries the browsers' own voice back to the agent as
// kind-3 frames. It tells the agent when to start and stop forwarding and when a speak session
// opens and closes, so a server nobody listens to costs nothing, and it writes the start and end of
// every listening and speaking session to the instance's event log. No audio is ever stored.
package voice

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/bus"
	"github.com/manuelvega/warden/wardend/internal/mc"
	"github.com/manuelvega/warden/wardend/internal/ws"
)

// Panel-side audit events; stored and streamed like the parsed server events.
const (
	EvListenStart mc.EventKind = "voice.listen.start"
	EvListenStop  mc.EventKind = "voice.listen.stop"
	EvSpeakStart  mc.EventKind = "voice.speak.start"
	EvSpeakStop   mc.EventKind = "voice.speak.stop"
)

// Info is what the agent reports about Simple Voice Chat on the server (`voice.info`): whether the
// plugin is loaded and, if so, its version, the voice and whisper distances and the consent policy.
type Info struct {
	Available bool    `json:"available"`
	Plugin    string  `json:"plugin,omitempty"`
	Distance  float64 `json:"distance"`
	Whisper   float64 `json:"whisper"`
	Policy    string  `json:"policy"`
}

// Status is GET /instances/{id}/voice and the payload of the hub's `voice.status` message.
type Status struct {
	Info
	Listeners []string `json:"listeners"` // display names of the people listening right now
	Speaking  []string `json:"speaking"`  // display names of the people with push-to-talk pressed
}

// The agent's voice frame: `u8 2 · u8 flags · UUID (16) · u64 seq · opus`. Only validated here;
// the browser receives the bytes as they came.
const (
	frameKind   = 2
	frameHeader = 1 + 1 + 16 + 8
)

// The browser's speak body: `u8 3 · u8 mode · u8 flags · u64 seq · f32 distance · mode-specific ·
// opus`, relayed to the agent behind the session id (ADR-019 §2).
const (
	speakKind   = 3
	speakHeader = 1 + 1 + 1 + 8 + 4
)

var errBadFrame = errors.New("malformed voice frame")

func validFrame(kind byte, b []byte) error {
	if kind != frameKind || len(b) <= frameHeader {
		return errBadFrame
	}
	return nil
}

// validSpeakBody checks the layout of a browser speak frame without decoding it: the mode-specific
// part is sized from the mode, and at least one Opus byte must follow.
func validSpeakBody(b []byte) error {
	if len(b) < speakHeader+1 || b[0] != speakKind {
		return errBadFrame
	}
	n := speakHeader
	switch b[1] {
	case 0:
	case 1:
		if len(b) < n+1 {
			return errBadFrame
		}
		n += 1 + int(b[n]) + 3*8
	case 2:
		n += 16
	default:
		return errBadFrame
	}
	if len(b) <= n {
		return errBadFrame
	}
	return nil
}

// AgentLink sends control messages and speak frames to an instance's agent (the world service).
type AgentLink interface {
	SendToAgent(instanceID string, msg any) error
	SendBinaryToAgent(instanceID string, raw []byte) error
}

// Events persists audit events (the store).
type Events interface {
	OnEvent(instanceID string, ev *mc.Event, at time.Time)
}

// listenMsg is what the agent receives whenever the set of listeners changes.
type listenMsg struct {
	Type   string `json:"type"`
	Active bool   `json:"active"`
	By     string `json:"by"`
}

// sessionMsg is what the agent receives when a speak session opens or closes.
type sessionMsg struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	By   string `json:"by"`
	Open bool   `json:"open"`
}

type instState struct {
	info      Info
	clients   map[*client]struct{} // every socket on the instance
	listeners map[*client]struct{}
	speakers  map[*client]struct{} // open speak sessions
	fanout    []*client            // the listeners as a slice, replaced (never mutated) on every change
}

// Service owns the sockets of every instance.
type Service struct {
	events   Events
	bc       bus.Broadcaster
	agent    AgentLink
	verifier *auth.Verifier
	origins  []string
	mu       sync.RWMutex
	inst     map[string]*instState
}

// NewService wires the relay. allowedOrigins are the panel origins, as for the hub.
func NewService(events Events, bc bus.Broadcaster, agent AgentLink, verifier *auth.Verifier, allowedOrigins []string) *Service {
	return &Service{events: events, bc: bc, agent: agent, verifier: verifier, origins: ws.OriginPatterns(allowedOrigins), inst: map[string]*instState{}}
}

// state returns the instance's record, creating it. Callers hold s.mu for writing.
func (s *Service) state(id string) *instState {
	st := s.inst[id]
	if st == nil {
		st = &instState{clients: map[*client]struct{}{}, listeners: map[*client]struct{}{}, speakers: map[*client]struct{}{}}
		s.inst[id] = st
	}
	return st
}

// Status is the current state of one instance.
func (s *Service) Status(id string) Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status(s.inst[id])
}

func (s *Service) status(st *instState) Status {
	out := Status{Listeners: []string{}, Speaking: []string{}}
	if st == nil {
		return out
	}
	out.Info = st.info
	out.Listeners = names(st.listeners)
	out.Speaking = names(st.speakers)
	return out
}

func names(set map[*client]struct{}) []string {
	out := make([]string, 0, len(set))
	for c := range set {
		out = append(out, c.name)
	}
	sort.Strings(out)
	return out
}

// --- world.AgentSink ---

// OnAgentText handles `voice.info`; other types are not ours.
func (s *Service) OnAgentText(id, typ string, raw []byte) {
	if typ != "voice.info" {
		return
	}
	var info Info
	if json.Unmarshal(raw, &info) != nil {
		return
	}
	s.setInfo(id, info)
}

// OnAgentDisconnected forgets the plugin state: whatever the agent reports next is the truth.
func (s *Service) OnAgentDisconnected(id string) { s.setInfo(id, Info{}) }

func (s *Service) setInfo(id string, info Info) {
	s.mu.Lock()
	st := s.state(id)
	st.info = info
	status := s.status(st)
	s.mu.Unlock()
	s.bc.Broadcast(id, "voice.status", status)
}

// OnAgentBinary relays a voice frame verbatim to every listener of the instance.
func (s *Service) OnAgentBinary(id string, kind byte, raw []byte) {
	if err := validFrame(kind, raw); err != nil {
		slog.Debug("agent voice frame", "instance", id, "err", err)
		return
	}
	s.mu.RLock()
	var clients []*client
	if st := s.inst[id]; st != nil {
		clients = st.fanout
	}
	s.mu.RUnlock()
	for _, c := range clients {
		c.frames.push(raw)
	}
}

// OnAgentConnected re-tells a (re)connected agent who is listening and which speak sessions are open.
func (s *Service) OnAgentConnected(id string) {
	s.mu.RLock()
	st := s.inst[id]
	msg, send := listenMessage(s.status(st).Listeners)
	var sessions []sessionMsg
	if st != nil {
		for c := range st.speakers {
			sessions = append(sessions, c.sessionMsg(true))
		}
	}
	s.mu.RUnlock()
	if send {
		s.tellAgent(id, msg)
	}
	for _, m := range sessions {
		s.tellAgent(id, m)
	}
}

// listenMessage is the `voice.listen` the agent should hold for these listeners.
func listenMessage(names []string) (listenMsg, bool) {
	if len(names) == 0 {
		return listenMsg{Type: "voice.listen"}, false
	}
	return listenMsg{Type: "voice.listen", Active: true, By: strings.Join(names, ", ")}, true
}

// tellAgent sends a control message; an agent that is away is not an error, it will be told again
// when it connects.
func (s *Service) tellAgent(id string, msg any) {
	s.toAgent(id, s.agent.SendToAgent(id, msg))
}

func (s *Service) toAgent(id string, err error) {
	if err != nil {
		slog.Debug("voice: agent unreachable", "instance", id, "err", err)
	}
}

// setListening adds or removes a browser. The agent is told on every change so the in-game notice
// lists everybody, and told to stop when the last one leaves; each change is an audit event.
func (s *Service) setListening(id string, c *client, on bool) {
	s.mu.Lock()
	st := s.state(id)
	if _, has := st.listeners[c]; has == on {
		s.mu.Unlock()
		return
	}
	if on {
		st.listeners[c] = struct{}{}
	} else {
		delete(st.listeners, c)
	}
	st.fanout = make([]*client, 0, len(st.listeners))
	for l := range st.listeners {
		st.fanout = append(st.fanout, l)
	}
	status := s.status(st)
	s.mu.Unlock()

	msg, _ := listenMessage(status.Listeners)
	s.tellAgent(id, msg)
	kind, verb := EvListenStop, "stopped"
	if on {
		kind, verb = EvListenStart, "started"
	}
	s.audit(id, &mc.Event{Kind: kind, Player: c.name, Text: c.name + " " + verb + " listening from Beacon"})
	s.bc.Broadcast(id, "voice.status", status)
}

// setSpeaking opens or closes the browser's speak session: the agent opens or flushes the channel
// the frames feed, the change is an audit event, and the name shows in the status.
func (s *Service) setSpeaking(id string, c *client, on bool) {
	s.mu.Lock()
	st := s.state(id)
	if _, has := st.speakers[c]; has == on {
		s.mu.Unlock()
		return
	}
	if on {
		st.speakers[c] = struct{}{}
	} else {
		delete(st.speakers, c)
	}
	status := s.status(st)
	s.mu.Unlock()

	s.tellAgent(id, c.sessionMsg(on))
	kind, verb := EvSpeakStop, "stopped"
	if on {
		kind, verb = EvSpeakStart, "started"
	}
	s.audit(id, &mc.Event{Kind: kind, Player: c.name, Text: c.name + " " + verb + " speaking from Beacon"})
	s.bc.Broadcast(id, "voice.status", status)
}

// relaySpeak forwards one browser speak body to the agent behind the client's session id.
func (s *Service) relaySpeak(id string, c *client, body []byte) {
	if err := validSpeakBody(body); err != nil {
		slog.Debug("browser speak frame", "instance", id, "user", c.name, "err", err)
		return
	}
	s.mu.RLock()
	st := s.inst[id]
	open := false
	if st != nil {
		_, open = st.speakers[c]
	}
	s.mu.RUnlock()
	if !open {
		return
	}
	raw := make([]byte, 0, 2+len(c.session)+len(body)-1)
	raw = append(raw, speakKind, byte(len(c.session)))
	raw = append(raw, c.session...)
	raw = append(raw, body[1:]...)
	s.toAgent(id, s.agent.SendBinaryToAgent(id, raw))
}

// audit records a session boundary the way the instance records a parsed server event.
func (s *Service) audit(id string, ev *mc.Event) {
	now := time.Now().UTC()
	if s.events != nil {
		s.events.OnEvent(id, ev, now)
	}
	s.bc.Broadcast(id, "event", ev.Payload(now))
}

// Forget drops a deleted instance and closes its sockets.
func (s *Service) Forget(id string) {
	s.mu.Lock()
	st := s.inst[id]
	delete(s.inst, id)
	s.mu.Unlock()
	if st == nil {
		return
	}
	for c := range st.clients {
		c.conn.Close(websocket.StatusNormalClosure, "instance deleted")
	}
}

func (s *Service) attach(id string, c *client) {
	s.mu.Lock()
	s.state(id).clients[c] = struct{}{}
	s.mu.Unlock()
}

func (s *Service) detach(id string, c *client) {
	s.setListening(id, c, false)
	s.setSpeaking(id, c, false)
	s.mu.Lock()
	if st := s.inst[id]; st != nil {
		delete(st.clients, c)
	}
	s.mu.Unlock()
}

// --- the browser socket ---

type client struct {
	conn      *websocket.Conn
	name      string
	session   string // the speak session id the agent knows this socket by
	canListen bool
	canSpeak  bool
	frames    *queue
	ctrl      chan []byte
}

func (c *client) sessionMsg(open bool) sessionMsg {
	return sessionMsg{Type: "voice.session", ID: c.session, By: c.name, Open: open}
}

// control queues a text message. The channel is deep enough for a burst of pongs; a client that
// cannot drain sixteen of them is gone, and a goroutine parked on its channel would outlive it, so
// the message is dropped instead.
func (c *client) control(b []byte) {
	select {
	case c.ctrl <- b:
	default:
		slog.Debug("voice: control message dropped", "user", c.name)
	}
}

type inbound struct {
	Type   string `json:"type"`
	Listen bool   `json:"listen,omitempty"`
	Speak  bool   `json:"speak,omitempty"`
	Active bool   `json:"active,omitempty"`
}

var pong = []byte(`{"type":"pong"}`)

func displayName(p *auth.Principal) string {
	switch {
	case p.Name != "":
		return p.Name
	case p.Email != "":
		return p.Email
	default:
		return p.UserID
	}
}

func newSessionID() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(err) // the OS entropy source is gone; nothing sensible to do
	}
	return hex.EncodeToString(b)
}

// HandleWS is GET /api/v1/instances/{id}/voice/ws. The first message must be
// {"type":"auth","token"} within 5 s, the second {"type":"voice.hello","listen":bool,"speak":bool}
// with at least one true; each capability is checked against its role. Then the socket carries
// kind-2 frames down as binary messages, kind-3 speak bodies up, and JSON text for the listen and
// speak toggles, pings and errors. Status changes travel on the hub (`voice.status`), which every
// viewer already holds open.
func (s *Service) HandleWS(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	conn, principal, ok := ws.AcceptAuthenticated(w, r, s.verifier, s.origins)
	if !ok {
		return
	}
	ctx := r.Context()
	if err := ws.WriteJSON(ctx, conn, map[string]any{"type": "auth.ok"}); err != nil {
		return
	}

	helloCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	var hello inbound
	err := ws.ReadJSON(helloCtx, conn, &hello)
	cancel()
	if err != nil || hello.Type != "voice.hello" {
		conn.Close(websocket.StatusPolicyViolation, "voice.hello required")
		return
	}
	refuse := func(msg string) {
		_ = ws.WriteJSON(ctx, conn, map[string]any{"type": "error", "message": msg})
		conn.Close(websocket.StatusPolicyViolation, msg)
	}
	// An instance the caller has no grant on must look absent, as over REST.
	if !principal.CanSee(id) {
		refuse("instance not found")
		return
	}
	if !hello.Listen && !hello.Speak {
		refuse("nothing to do")
		return
	}
	if hello.Listen && !principal.Can(id, auth.ActionVoiceListen) {
		refuse("role manager is required on this instance")
		return
	}
	if hello.Speak && !principal.Can(id, auth.ActionVoiceSpeak) {
		refuse("role operator is required on this instance")
		return
	}

	c := &client{
		conn: conn, name: displayName(principal), session: newSessionID(),
		canListen: hello.Listen, canSpeak: hello.Speak,
		frames: newQueue(64), ctrl: make(chan []byte, 16),
	}
	okMsg, _ := json.Marshal(map[string]any{"type": "voice.ok", "status": s.Status(id)})
	c.control(okMsg)
	s.attach(id, c)
	if hello.Listen {
		s.setListening(id, c, true)
	}
	defer func() {
		s.detach(id, c)
		conn.Close(websocket.StatusNormalClosure, "bye")
	}()
	slog.Info("voice: joined", "instance", id, "user", c.name, "listen", hello.Listen, "speak", hello.Speak)

	go c.writer(ctx)
	s.reader(ctx, id, c)
	slog.Info("voice: left", "instance", id, "user", c.name)
}

func (c *client) writer(ctx context.Context) {
	for {
		var (
			typ websocket.MessageType
			b   []byte
		)
		select {
		case <-ctx.Done():
			return
		case b = <-c.ctrl:
			typ = websocket.MessageText
		case <-c.frames.ready:
			b = c.frames.pop()
			if b == nil {
				continue
			}
			typ = websocket.MessageBinary
		}
		wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := c.conn.Write(wctx, typ, b)
		cancel()
		if err != nil {
			return
		}
	}
}

// reader takes the browser's messages: speak bodies, the listen and speak toggles, pings.
func (s *Service) reader(ctx context.Context, id string, c *client) {
	for {
		typ, b, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
			if c.canSpeak {
				s.relaySpeak(id, c, b)
			}
			continue
		}
		var msg inbound
		if json.Unmarshal(b, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "ping":
			c.control(pong)
		case "voice.listen":
			if c.canListen {
				s.setListening(id, c, msg.Active)
			}
		case "voice.speak":
			if c.canSpeak {
				s.setSpeaking(id, c, msg.Active)
			}
		}
	}
}
