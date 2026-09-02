package world

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/manuelvega/warden/wardend/internal/bus"
	"github.com/manuelvega/warden/wardend/internal/store"
)

// Tokens resolves an agent token to the instance it belongs to.
type Tokens interface {
	InstanceByAgentToken(token string) (id string, ok bool)
}

// WorldInfo is what the agent reports about a world, plus how many chunks the store holds for it.
type WorldInfo struct {
	Name         string `json:"name"`
	Dimension    string `json:"dimension"`
	ViewDistance int    `json:"viewDistance"`
	MinY         int    `json:"minY"`
	MaxY         int    `json:"maxY"`
	Chunks       int    `json:"chunks"`
}

// PlayerPos is one player's last reported position.
type PlayerPos struct {
	UUID      string  `json:"uuid"`
	Name      string  `json:"name"`
	World     string  `json:"world"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	Yaw       float64 `json:"yaw"`
	Pitch     float64 `json:"pitch"`
	Sneaking  bool    `json:"sneaking"`
	Sprinting bool    `json:"sprinting"`
	Pose      string  `json:"pose"`
	OnGround  bool    `json:"onGround"`
	Flying    bool    `json:"flying"`
	InWater   bool    `json:"inWater"`
	Gamemode  string  `json:"gamemode"`
	Vanished  bool    `json:"vanished"`
}

// WorldClock is a world's day count, time of day (ticks, 0 = 06:00) and weather, sent with every
// positions message.
type WorldClock struct {
	Day      int64 `json:"day"`
	Time     int64 `json:"time"`
	GameTime int64 `json:"gameTime"` // total ticks, what the clouds scroll by
	Rain     bool  `json:"rain"`
	Thunder  bool  `json:"thunder"`
}

// AgentInfo is the connection state shown in the panel.
type AgentInfo struct {
	Connected bool   `json:"connected"`
	Version   string `json:"version,omitempty"`
	Server    string `json:"server,omitempty"`
}

// Snapshot is GET /instances/{id}/map minus the manifest bits the API layer adds.
type Snapshot struct {
	Agent   AgentInfo             `json:"agent"`
	Worlds  []WorldInfo           `json:"worlds"`
	Players []PlayerPos           `json:"players"`
	Clocks  map[string]WorldClock `json:"clocks,omitempty"`
	At      int64                 `json:"t,omitempty"` // millis of the last positions message
}

type chunkRef [3]any // [cx, cz, hash] as sent to the browser

type instState struct {
	conn      *websocket.Conn
	agent     AgentInfo
	worlds    []WorldInfo
	players   []PlayerPos
	clocks    map[string]WorldClock
	playersAt int64
	hashes    map[string]map[[2]int32]string // world → chunk → stored hash; frames that match are dropped
	pending   map[string][]chunkRef          // world → changed chunks not yet announced
	flush     *time.Timer
}

// Service owns one agent connection per instance.
type Service struct {
	store  *store.Store
	bc     bus.Broadcaster
	tokens Tokens
	mu     sync.Mutex
	inst   map[string]*instState
}

func NewService(st *store.Store, bc bus.Broadcaster, tokens Tokens) *Service {
	return &Service{store: st, bc: bc, tokens: tokens, inst: map[string]*instState{}}
}

type helloMsg struct {
	Type   string      `json:"type"`
	Token  string      `json:"token"`
	Agent  string      `json:"agent"`
	Server string      `json:"server"`
	Worlds []WorldInfo `json:"worlds"`
}

type playersMsg struct {
	Type    string                `json:"type"`
	T       int64                 `json:"t"`
	Players []PlayerPos           `json:"players"`
	Worlds  map[string]WorldClock `json:"worlds,omitempty"`
}

// HandleAgent is the WebSocket endpoint on the agent listener. The first message must be `hello`
// with a valid token; then text frames carry positions and binary frames carry chunks.
func (s *Service) HandleAgent(w http.ResponseWriter, r *http.Request) {
	// Not a browser endpoint: no Origin to check, and it only listens on loopback.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		slog.Debug("agent accept", "err", err)
		return
	}
	conn.SetReadLimit(MaxFrame)
	ctx := r.Context()

	hctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	typ, b, err := conn.Read(hctx)
	cancel()
	var hello helloMsg
	if err != nil || typ != websocket.MessageText || json.Unmarshal(b, &hello) != nil || hello.Type != "hello" || hello.Token == "" {
		conn.Close(websocket.StatusPolicyViolation, "hello required")
		return
	}
	id, ok := s.tokens.InstanceByAgentToken(hello.Token)
	if !ok {
		slog.Warn("agent rejected: unknown token", "remote", r.RemoteAddr)
		conn.Close(websocket.StatusPolicyViolation, "invalid token")
		return
	}

	stored, err := s.store.ChunkHashes(ctx, id)
	if err != nil {
		slog.Warn("chunk hashes", "instance", id, "err", err)
		stored = map[string][]store.ChunkRef{}
	}
	known := map[string][]chunkRef{}
	hashes := map[string]map[[2]int32]string{}
	for w, refs := range stored {
		list := make([]chunkRef, 0, len(refs))
		byKey := make(map[[2]int32]string, len(refs))
		for _, c := range refs {
			list = append(list, chunkRef{c.CX, c.CZ, c.Hash})
			byKey[[2]int32{int32(c.CX), int32(c.CZ)}] = c.Hash
		}
		known[w] = list
		hashes[w] = byKey
	}
	ack, _ := json.Marshal(map[string]any{"type": "hello.ok", "known": known})
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	err = conn.Write(wctx, websocket.MessageText, ack)
	cancel()
	if err != nil {
		return
	}

	st := s.attach(id, conn, hello, hashes)
	slog.Info("agent connected", "instance", id, "agent", hello.Agent, "server", hello.Server)
	defer s.detach(id, st)

	for {
		typ, b, err := conn.Read(ctx)
		if err != nil {
			return
		}
		switch typ {
		case websocket.MessageText:
			var msg playersMsg
			if json.Unmarshal(b, &msg) != nil || msg.Type != "players" {
				continue
			}
			if msg.Players == nil {
				msg.Players = []PlayerPos{}
			}
			s.mu.Lock()
			st.players, st.playersAt = msg.Players, msg.T
			if msg.Worlds != nil {
				st.clocks = msg.Worlds
			}
			s.mu.Unlock()
			s.bc.Broadcast(id, "world.players", map[string]any{"t": msg.T, "players": msg.Players, "worlds": msg.Worlds})
		case websocket.MessageBinary:
			f, err := ParseFrame(b)
			if err != nil {
				slog.Debug("agent frame", "instance", id, "err", err)
				continue
			}
			hash := HashHex(f.Hash)
			if !s.remember(st, f.World, [2]int32{f.CX, f.CZ}, hash) {
				continue // a resend of what the store already holds
			}
			if err := s.store.UpsertChunk(ctx, id, f.World, int(f.CX), int(f.CZ), hash, f.Blob); err != nil {
				slog.Warn("store chunk", "instance", id, "err", err)
				continue
			}
			s.announce(id, st, f.World, chunkRef{int(f.CX), int(f.CZ), hash})
		}
	}
}

// remember records the hash of a frame and reports whether it differs from what was held.
func (s *Service) remember(st *instState, world string, key [2]int32, hash string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	byKey := st.hashes[world]
	if byKey == nil {
		byKey = map[[2]int32]string{}
		st.hashes[world] = byKey
	}
	if byKey[key] == hash {
		return false
	}
	byKey[key] = hash
	return true
}

// attach registers the live connection; a second agent for the same instance replaces the first.
func (s *Service) attach(id string, conn *websocket.Conn, hello helloMsg, hashes map[string]map[[2]int32]string) *instState {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old := s.inst[id]; old != nil && old.conn != nil && old.conn != conn {
		old.conn.Close(websocket.StatusPolicyViolation, "replaced by a newer agent")
	}
	st := &instState{conn: conn, agent: AgentInfo{Connected: true, Version: hello.Agent, Server: hello.Server},
		worlds: hello.Worlds, players: []PlayerPos{}, hashes: hashes, pending: map[string][]chunkRef{}}
	if st.worlds == nil {
		st.worlds = []WorldInfo{}
	}
	s.inst[id] = st
	go s.bc.Broadcast(id, "world.agent", st.agent)
	return st
}

func (s *Service) detach(id string, st *instState) {
	s.mu.Lock()
	cur := s.inst[id]
	if cur != st {
		s.mu.Unlock()
		return
	}
	st.conn = nil
	st.agent.Connected = false
	st.players = []PlayerPos{}
	s.mu.Unlock()
	slog.Info("agent disconnected", "instance", id)
	s.bc.Broadcast(id, "world.agent", st.agent)
	s.bc.Broadcast(id, "world.players", map[string]any{"t": time.Now().UnixMilli(), "players": []PlayerPos{}})
}

// announce coalesces chunk changes into one `world.chunks` message per world per second.
func (s *Service) announce(id string, st *instState, world string, ref chunkRef) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st.pending[world] = append(st.pending[world], ref)
	if st.flush == nil {
		st.flush = time.AfterFunc(time.Second, func() {
			s.mu.Lock()
			batches := st.pending
			st.pending = map[string][]chunkRef{}
			st.flush = nil
			s.mu.Unlock()
			for w, refs := range batches {
				s.bc.Broadcast(id, "world.chunks", map[string]any{"world": w, "chunks": refs})
			}
		})
	}
}

// Forget drops the in-memory state of a deleted instance and closes its agent.
func (s *Service) Forget(id string) {
	s.mu.Lock()
	st := s.inst[id]
	delete(s.inst, id)
	s.mu.Unlock()
	if st != nil && st.conn != nil {
		st.conn.Close(websocket.StatusNormalClosure, "instance deleted")
	}
}

// Snapshot is the current state for the panel: agent, worlds (with chunk counts) and last positions.
func (s *Service) Snapshot(ctx context.Context, id string) Snapshot {
	s.mu.Lock()
	st := s.inst[id]
	out := Snapshot{Worlds: []WorldInfo{}, Players: []PlayerPos{}}
	if st != nil {
		out.Agent = st.agent
		out.Worlds = append(out.Worlds, st.worlds...)
		out.Players = append(out.Players, st.players...)
		out.Clocks = st.clocks
		out.At = st.playersAt
	}
	s.mu.Unlock()
	counts, err := s.store.ChunkCounts(ctx, id)
	if err != nil {
		return out
	}
	seen := map[string]bool{}
	for i := range out.Worlds {
		out.Worlds[i].Chunks = counts[out.Worlds[i].Name]
		seen[out.Worlds[i].Name] = true
	}
	// Worlds only the cache knows (the agent is offline, or the world was unloaded) still have a map.
	for w, n := range counts {
		if !seen[w] {
			out.Worlds = append(out.Worlds, WorldInfo{Name: w, Chunks: n})
		}
	}
	return out
}

// Chunks fetches stored chunks for the viewer.
func (s *Service) Chunks(ctx context.Context, id, world string, keys [][2]int) ([]store.ChunkBlob, error) {
	return s.store.Chunks(ctx, id, world, keys)
}
