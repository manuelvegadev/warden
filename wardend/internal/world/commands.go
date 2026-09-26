package world

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// Console completion (ADR-024): the agent sends the server's command list whenever it changes, and
// answers `complete` requests for a typed line. The daemon keeps the list while the agent is
// connected, relays it to the panel on the hub, and correlates each request with its answer.

// Command is one command the console can run, as the agent lists it. Plugin is empty for the
// server's own commands.
type Command struct {
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases,omitempty"`
	Plugin      string   `json:"plugin,omitempty"`
	Description string   `json:"description,omitempty"`
	Usage       string   `json:"usage,omitempty"`
}

// Suggestion is one completion of the token under the caret.
type Suggestion struct {
	Text    string `json:"text"`
	Tooltip string `json:"tooltip,omitempty"`
}

// Completion is the agent's answer for one line.
type Completion struct {
	Suggestions []Suggestion `json:"suggestions"`
	// Truncated: the agent capped the list, so it cannot be narrowed locally for a longer token.
	Truncated bool `json:"truncated,omitempty"`
}

// FeatureComplete is what an agent that answers `complete` announces in its hello.
const FeatureComplete = "complete"

// CompleteTimeout bounds the wait for the agent's answer; the agent itself answers `timeout` after
// 500 ms on a busy main thread, so this only trips when the agent is gone or stuck.
const CompleteTimeout = time.Second

// MaxCompleteLine bounds the line sent to the agent (the agent refuses longer ones too).
const MaxCompleteLine = 1024

// FeatureRun is what an agent that runs plugin commands for wardend announces (ADR-025).
const FeatureRun = "run"

// RunTimeout bounds the wait for a command's reply; the agent collects for at most 2 s.
const RunTimeout = 3 * time.Second

var (
	// ErrAgentUnavailable: no agent is connected, or it is too old to complete.
	ErrAgentUnavailable = errors.New("no agent connected that can complete commands")
	// ErrSuperseded: a newer request replaced this one before the server looked at it.
	ErrSuperseded = errors.New("superseded by a newer request")
	// ErrCompleteTimeout: neither the server nor the agent answered in time.
	ErrCompleteTimeout = errors.New("the server did not answer in time")
)

type agentResult struct {
	Type        string       `json:"type"`
	ID          string       `json:"id"`
	Suggestions []Suggestion `json:"suggestions"`
	Truncated   bool         `json:"truncated"`
	Lines       []string     `json:"lines"`
	Error       string       `json:"error"`
}

type commandsMsg struct {
	Type     string    `json:"type"`
	Commands []Command `json:"commands"`
}

// request sends one request to the instance's agent and waits for the answer with its id.
func (s *Service) request(ctx context.Context, id, feature string, msg map[string]string, timeout time.Duration) (agentResult, error) {
	s.mu.Lock()
	st := s.inst[id]
	if st == nil || st.conn == nil || !st.features[feature] {
		s.mu.Unlock()
		return agentResult{}, ErrAgentUnavailable
	}
	s.nextReq++
	reqID := strconv.FormatUint(s.nextReq, 10)
	ch := make(chan agentResult, 1)
	st.waiters[reqID] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(st.waiters, reqID)
		s.mu.Unlock()
	}()

	msg["id"] = reqID
	if err := s.SendToAgent(id, msg); err != nil {
		return agentResult{}, ErrAgentUnavailable
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return agentResult{}, ctx.Err()
	case <-timer.C:
		return agentResult{}, ErrCompleteTimeout
	case r := <-ch:
		switch r.Error {
		case "":
			return r, nil
		case "superseded":
			return r, ErrSuperseded
		case "timeout":
			return r, ErrCompleteTimeout
		case "unavailable":
			return r, ErrAgentUnavailable
		default:
			return r, errors.New("the agent failed: " + r.Error)
		}
	}
}

// Complete asks the instance's agent for the completions of `line` (without its leading slash).
// It returns when the agent answers, `ctx` ends (the browser moved on) or CompleteTimeout passes.
func (s *Service) Complete(ctx context.Context, id, line string) (Completion, error) {
	r, err := s.request(ctx, id, FeatureComplete,
		map[string]string{"type": "complete", "line": strings.TrimPrefix(line, "/")}, CompleteTimeout)
	if err != nil {
		return Completion{}, err
	}
	if r.Suggestions == nil {
		r.Suggestions = []Suggestion{}
	}
	return Completion{Suggestions: r.Suggestions, Truncated: r.Truncated}, nil
}

// Run has the instance's agent run one console command with its reply captured (ADR-025): nothing
// reaches the console or the log. It returns the reply's lines as plain text.
func (s *Service) Run(ctx context.Context, id, command string) ([]string, error) {
	r, err := s.request(ctx, id, FeatureRun,
		map[string]string{"type": "run", "command": strings.TrimPrefix(strings.TrimSpace(command), "/")}, RunTimeout)
	if err != nil {
		return nil, err
	}
	if r.Lines == nil {
		r.Lines = []string{}
	}
	return r.Lines, nil
}

// AgentConnected reports whether the instance's agent is connected.
func (s *Service) AgentConnected(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.inst[id]
	return st != nil && st.conn != nil && st.agent.Connected
}

// AgentRuns reports whether the instance's connected agent runs plugin commands (FeatureRun).
func (s *Service) AgentRuns(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.inst[id]
	return st != nil && st.conn != nil && st.features[FeatureRun]
}

// ConsoleCommands is the hub's `console.commands` payload for a new subscriber, or nil while no
// agent has sent its list.
func (s *Service) ConsoleCommands(id string) any {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.inst[id]
	if st == nil || st.conn == nil || st.commands == nil {
		return nil
	}
	return map[string]any{"commands": st.commands}
}

// onAgentCommandText consumes the agent's console-completion messages and reports whether it did.
func (s *Service) onAgentCommandText(id string, st *instState, typ string, b []byte) bool {
	switch typ {
	case "commands":
		var msg commandsMsg
		if json.Unmarshal(b, &msg) != nil {
			return true
		}
		if msg.Commands == nil {
			msg.Commands = []Command{}
		}
		s.mu.Lock()
		st.commands = msg.Commands
		s.mu.Unlock()
		s.bc.Broadcast(id, "console.commands", map[string]any{"commands": msg.Commands})
		return true
	case "complete.result", "run.result":
		var r agentResult
		if json.Unmarshal(b, &r) != nil {
			return true
		}
		s.mu.Lock()
		ch := st.waiters[r.ID]
		s.mu.Unlock()
		if ch != nil {
			select {
			case ch <- r:
			default: // answered already
			}
		}
		return true
	}
	return false
}

// failWaiters answers every pending request of a connection that went away. Called with s.mu held.
func failWaiters(st *instState) {
	for _, ch := range st.waiters {
		select {
		case ch <- agentResult{Error: "unavailable"}:
		default:
		}
	}
}
