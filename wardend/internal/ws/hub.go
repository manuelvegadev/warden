// Package ws implements the WebSocket hub (/api/v1/ws): per-instance subscriptions to console/state/events/metrics.
// Auth: the client sends {"type":"auth","token":"<jwt>"} as the first message (docs/security.md).
package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/instance"
)

type Message struct {
	Type     string          `json:"type"`
	Instance string          `json:"instance,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
	Token    string          `json:"token,omitempty"`
	Streams  []string        `json:"streams,omitempty"`
}

type outbound struct {
	Type     string `json:"type"`
	Instance string `json:"instance,omitempty"`
	Data     any    `json:"data,omitempty"`
}

type client struct {
	conn      *websocket.Conn
	principal *auth.Principal
	send      chan outbound
	mu        sync.Mutex
	subs      map[string]bool
}

type Hub struct {
	verifier *auth.Verifier
	mgr      *instance.Manager
	origins  []string
	mu       sync.RWMutex
	clients  map[*client]struct{}
}

func NewHub(verifier *auth.Verifier, mgr *instance.Manager, allowedOrigins []string) *Hub {
	var pats []string
	for _, o := range allowedOrigins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			pats = append(pats, u.Host)
		}
	}
	return &Hub{verifier: verifier, mgr: mgr, origins: pats, clients: map[*client]struct{}{}}
}

// Broadcast implements bus.Broadcaster.
func (h *Hub) Broadcast(instanceID, typ string, data any) {
	msg := outbound{Type: typ, Instance: instanceID, Data: data}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if instanceID != "" {
			c.mu.Lock()
			sub := c.subs[instanceID]
			c.mu.Unlock()
			if !sub {
				continue
			}
		}
		select {
		case c.send <- msg:
		default: // slow client: drop rather than block producers
		}
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.origins})
	if err != nil {
		slog.Debug("ws accept", "err", err)
		return
	}
	ctx := r.Context()

	// First message must be auth within 5 s.
	authCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	var first Message
	err = readJSON(authCtx, conn, &first)
	cancel()
	if err != nil || first.Type != "auth" || first.Token == "" {
		conn.Close(websocket.StatusPolicyViolation, "auth required")
		return
	}
	principal, err := h.verifier.Verify(ctx, first.Token)
	if err != nil {
		conn.Close(websocket.StatusPolicyViolation, "invalid token")
		return
	}

	c := &client{conn: conn, principal: principal, send: make(chan outbound, 256), subs: map[string]bool{}}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
		conn.Close(websocket.StatusNormalClosure, "bye")
	}()

	c.send <- outbound{Type: "auth.ok", Data: principal}
	go c.writer(ctx)
	c.reader(ctx, h)
}

func (c *client) writer(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			b, _ := json.Marshal(msg)
			err := c.conn.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func (c *client) reader(ctx context.Context, h *Hub) {
	for {
		var msg Message
		if err := readJSON(ctx, c.conn, &msg); err != nil {
			return
		}
		switch msg.Type {
		case "ping":
			c.send <- outbound{Type: "pong"}
		case "subscribe":
			inst, err := h.mgr.Get(msg.Instance)
			if err != nil {
				c.send <- outbound{Type: "error", Instance: msg.Instance, Data: "instance not found"}
				continue
			}
			c.mu.Lock()
			c.subs[msg.Instance] = true
			c.mu.Unlock()
			c.send <- outbound{Type: "console.history", Instance: msg.Instance, Data: map[string]any{"lines": inst.History(1000)}}
			c.send <- outbound{Type: "state", Instance: msg.Instance, Data: inst.Status()}
		case "unsubscribe":
			c.mu.Lock()
			delete(c.subs, msg.Instance)
			c.mu.Unlock()
		case "command":
			var d struct {
				Command string `json:"command"`
			}
			_ = json.Unmarshal(msg.Data, &d)
			inst, err := h.mgr.Get(msg.Instance)
			if err != nil {
				c.send <- outbound{Type: "error", Instance: msg.Instance, Data: "instance not found"}
				continue
			}
			if err := inst.SendCommand(d.Command); err != nil {
				c.send <- outbound{Type: "error", Instance: msg.Instance, Data: err.Error()}
			}
		}
	}
}

func readJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	_, b, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
