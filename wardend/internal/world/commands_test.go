package world

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/manuelvega/warden/wardend/internal/store"
)

// fakeAgent connects to a fresh service as the instance "inst", with the given hello features.
func fakeAgent(t *testing.T, features string) (*Service, *recorder, *websocket.Conn) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "w.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	rec := &recorder{}
	svc := NewService(st, rec, tokens{"secret": "inst"})
	mux := http.NewServeMux()
	mux.HandleFunc("/agent/v1", svc.HandleAgent)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c := dial(t, srv)
	t.Cleanup(func() { c.Close(websocket.StatusNormalClosure, "") })
	ctx := context.Background()
	hello := `{"type":"hello","token":"secret","agent":"warden-agent/0.2.0","server":"Paper 26.2","worlds":[],"features":` + features + `}`
	if err := c.Write(ctx, websocket.MessageText, []byte(hello)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.Read(ctx); err != nil { // hello.ok
		t.Fatal(err)
	}
	rec.wait(t, "inst world.agent")
	return svc, rec, c
}

// answerNext reads the next `complete` request and writes back `reply` with the request's id.
func answerNext(t *testing.T, c *websocket.Conn, reply map[string]any) (line string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Error(err)
		return ""
	}
	var req struct{ Type, ID, Line string }
	if json.Unmarshal(b, &req) != nil || req.Type != "complete" || req.ID == "" {
		t.Errorf("request %s", b)
		return ""
	}
	if reply != nil {
		reply["type"] = "complete.result"
		reply["id"] = req.ID
		out, _ := json.Marshal(reply)
		c.Write(ctx, websocket.MessageText, out)
	}
	return req.Line
}

func TestCompleteRelaysTheAgentsAnswer(t *testing.T) {
	svc, _, c := fakeAgent(t, `["complete"]`)
	got := make(chan string, 1)
	go func() {
		got <- answerNext(t, c, map[string]any{
			"suggestions": []map[string]string{{"text": "Steve", "tooltip": "online"}, {"text": "Stella"}},
			"truncated":   true,
		})
	}()
	res, err := svc.Complete(context.Background(), "inst", "/lp user Ste")
	if err != nil {
		t.Fatal(err)
	}
	if line := <-got; line != "lp user Ste" {
		t.Fatalf("the agent got %q; the leading slash should be gone", line)
	}
	if len(res.Suggestions) != 2 || res.Suggestions[0] != (Suggestion{"Steve", "online"}) || !res.Truncated {
		t.Fatalf("result %+v", res)
	}
}

func TestCompleteFailures(t *testing.T) {
	tests := []struct {
		name  string
		reply map[string]any // nil: the agent never answers
		ctx   time.Duration  // the caller gives up after this, 0 for no limit
		want  error
	}{
		{"a newer request replaced it", map[string]any{"error": "superseded"}, 0, ErrSuperseded},
		{"the main thread was busy", map[string]any{"error": "timeout"}, 0, ErrCompleteTimeout},
		{"the agent never answers", nil, 0, ErrCompleteTimeout},
		{"the browser moved on", nil, 50 * time.Millisecond, context.DeadlineExceeded},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, c := fakeAgent(t, `["complete"]`)
			go answerNext(t, c, tt.reply)
			ctx := context.Background()
			if tt.ctx > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.ctx)
				defer cancel()
			}
			if _, err := svc.Complete(ctx, "inst", "lp "); !errors.Is(err, tt.want) {
				t.Fatalf("got %v, want %v", err, tt.want)
			}
		})
	}
}

func TestCompleteNeedsAnAgentThatCanComplete(t *testing.T) {
	svc, _, _ := fakeAgent(t, `[]`) // an agent from before completion
	start := time.Now()
	if _, err := svc.Complete(context.Background(), "inst", "lp "); !errors.Is(err, ErrAgentUnavailable) {
		t.Fatalf("got %v", err)
	}
	if time.Since(start) > 100*time.Millisecond {
		t.Fatal("an agent that cannot complete should not be waited on")
	}
	if _, err := svc.Complete(context.Background(), "other", "lp "); !errors.Is(err, ErrAgentUnavailable) {
		t.Fatalf("no agent at all: got %v", err)
	}
}

func TestCompleteFailsAtOnceWhenTheAgentLeaves(t *testing.T) {
	svc, _, c := fakeAgent(t, `["complete"]`)
	go func() {
		answerNext(t, c, nil)
		c.Close(websocket.StatusNormalClosure, "server stopping")
	}()
	start := time.Now()
	if _, err := svc.Complete(context.Background(), "inst", "lp "); !errors.Is(err, ErrAgentUnavailable) {
		t.Fatalf("got %v", err)
	}
	if time.Since(start) >= CompleteTimeout {
		t.Fatal("waited for the timeout instead of failing on the disconnect")
	}
}

func TestCommandListFollowsTheAgent(t *testing.T) {
	svc, rec, c := fakeAgent(t, `["complete"]`)
	if svc.ConsoleCommands("inst") != nil {
		t.Fatal("no list before the agent sends one")
	}
	msg := `{"type":"commands","commands":[{"name":"lp","aliases":["luckperms"],"plugin":"LuckPerms","usage":"/lp user <player>"}]}`
	c.Write(context.Background(), websocket.MessageText, []byte(msg))
	d := rec.wait(t, "inst console.commands").(map[string]any)
	if cmds := d["commands"].([]Command); len(cmds) != 1 || cmds[0].Plugin != "LuckPerms" || cmds[0].Aliases[0] != "luckperms" {
		t.Fatalf("broadcast %+v", d)
	}
	if cmds := svc.ConsoleCommands("inst").(map[string]any)["commands"].([]Command); len(cmds) != 1 {
		t.Fatalf("for new subscribers %+v", cmds)
	}

	// The agent leaves: the list is withdrawn, and new subscribers get none.
	rec.mu.Lock()
	rec.msgs, rec.data = nil, nil
	rec.mu.Unlock()
	c.Close(websocket.StatusNormalClosure, "server stopping")
	d = rec.wait(t, "inst console.commands").(map[string]any)
	if cmds := d["commands"].([]Command); len(cmds) != 0 {
		t.Fatalf("after the disconnect %+v", d)
	}
	if svc.ConsoleCommands("inst") != nil {
		t.Fatal("list kept after the agent left")
	}
}
