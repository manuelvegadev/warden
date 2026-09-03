// Package voice relays Simple Voice Chat audio between the Warden Agent and the browser (ADR-019).
//
// The agent forwards every Opus frame a player speaks as a kind-2 binary frame on its loopback
// socket; this service fans those frames out, unchanged, to the browsers listening to the instance
// over /api/v1/instances/{id}/voice/ws. It tells the agent when to start and stop forwarding, so a
// server nobody listens to costs nothing, and it writes the start and end of every listening
// session to the instance's event log. No audio is ever stored.
package voice

import (
	"context"
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
	Speaking  []string `json:"speaking"`  // reserved for phase 3; always present, never null
}

// The agent's voice frame: `u8 2 · u8 flags · UUID (16) · u64 seq · opus`. Only validated here;
// the browser receives the bytes as they came.
const (
	frameKind   = 2
	frameHeader = 1 + 1 + 16 + 8
)

var errBadFrame = errors.New("malformed voice frame")

func validFrame(kind byte, b []byte) error {
	if kind != frameKind || len(b) <= frameHeader {
		return errBadFrame
	}
	return nil
}

// AgentLink sends control messages to an instance's agent (the world service).
type AgentLink interface {
	SendToAgent(instanceID string, msg any) error
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

type instState struct {
	info      Info
	listeners map[*client]struct{}
	fanout    []*client // the listeners as a slice, replaced (never mutated) on every change
}

// Service owns the listeners of every instance.
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
		st = &instState{listeners: map[*client]struct{}{}}
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
	for c := range st.listeners {
		out.Listeners = append(out.Listeners, c.name)
	}
	sort.Strings(out.Listeners)
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

// OnAgentConnected re-tells a (re)connected agent whether anyone is listening.
func (s *Service) OnAgentConnected(id string) {
	s.mu.RLock()
	msg, send := listenMessage(s.status(s.inst[id]).Listeners)
	s.mu.RUnlock()
	if send {
		s.tellAgent(id, msg)
	}
}

// listenMessage is the `voice.listen` the agent should hold for these listeners.
func listenMessage(names []string) (listenMsg, bool) {
	if len(names) == 0 {
		return listenMsg{Type: "voice.listen"}, false
	}
	return listenMsg{Type: "voice.listen", Active: true, By: strings.Join(names, ", ")}, true
}

func (s *Service) tellAgent(id string, msg listenMsg) {
	if err := s.agent.SendToAgent(id, msg); err != nil {
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

// audit records a session boundary the way the instance records a parsed server event.
func (s *Service) audit(id string, ev *mc.Event) {
	now := time.Now().UTC()
	if s.events != nil {
		s.events.OnEvent(id, ev, now)
	}
	s.bc.Broadcast(id, "event", ev.Payload(now))
}

// Forget drops a deleted instance and closes its listeners.
func (s *Service) Forget(id string) {
	s.mu.Lock()
	st := s.inst[id]
	delete(s.inst, id)
	s.mu.Unlock()
	if st == nil {
		return
	}
	for c := range st.listeners {
		c.conn.Close(websocket.StatusNormalClosure, "instance deleted")
	}
}

// --- the browser socket ---

type client struct {
	conn   *websocket.Conn
	name   string
	frames *queue
	ctrl   chan []byte
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

// HandleWS is GET /api/v1/instances/{id}/voice/ws. The first message must be
// {"type":"auth","token"} within 5 s, the second {"type":"voice.hello","listen":true}; then the
// socket carries kind-2 frames as binary messages and JSON text for pings and errors. Status
// changes travel on the hub (`voice.status`), which every viewer already holds open.
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
	if !hello.Listen {
		refuse("listen is required")
		return
	}
	if !principal.Can(id, auth.ActionVoiceListen) {
		refuse("role manager is required on this instance")
		return
	}

	c := &client{conn: conn, name: displayName(principal), frames: newQueue(64), ctrl: make(chan []byte, 16)}
	okMsg, _ := json.Marshal(map[string]any{"type": "voice.ok", "status": s.Status(id)})
	c.control(okMsg)
	s.setListening(id, c, true)
	defer func() {
		s.setListening(id, c, false)
		conn.Close(websocket.StatusNormalClosure, "bye")
	}()
	slog.Info("voice: listener joined", "instance", id, "user", c.name)

	go c.writer(ctx)
	c.reader(ctx)
	slog.Info("voice: listener left", "instance", id, "user", c.name)
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

// reader answers pings and ignores everything else until phase 3 adds speaking.
func (c *client) reader(ctx context.Context) {
	for {
		typ, b, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		var msg inbound
		if json.Unmarshal(b, &msg) == nil && msg.Type == "ping" {
			c.control(pong)
		}
	}
}
