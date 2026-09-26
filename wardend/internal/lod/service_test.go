package lod

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/manuelvega/warden/wardend/internal/mc"
)

type fakeHost struct {
	mu      sync.Mutex
	running bool
	since   time.Time
	s       Settings
}

func (h *fakeHost) Running() (bool, time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.running, h.since
}
func (h *fakeHost) LOD() Settings { h.mu.Lock(); defer h.mu.Unlock(); return h.s }
func (h *fakeHost) UpdateLOD(fn func(*Settings)) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	fn(&h.s)
	return nil
}

type fakeHosts map[string]*fakeHost

func (f fakeHosts) Host(id string) (Host, bool) { h, ok := f[id]; return h, ok }
func (f fakeHosts) IDs() []string {
	var out []string
	for id := range f {
		out = append(out, id)
	}
	return out
}

// fakeRunner answers commands by prefix and records what it ran. during, when set, runs while a
// command is in flight (before its reply is returned), as another request would.
type fakeRunner struct {
	mu      sync.Mutex
	ran     []string
	replies map[string][]string
	during  func(cmd string)
}

func (r *fakeRunner) Run(_ context.Context, _ string, cmd string) ([]string, error) {
	r.mu.Lock()
	r.ran = append(r.ran, cmd)
	during := r.during
	var reply []string
	for prefix, lines := range r.replies {
		if strings.HasPrefix(cmd, prefix) {
			reply = lines
			break
		}
	}
	r.mu.Unlock()
	if during != nil {
		during(cmd)
	}
	return reply, nil
}

type recorder struct {
	mu     sync.Mutex
	types  []string
	data   []any
	events []string
}

func (r *recorder) Broadcast(_ string, typ string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.types = append(r.types, typ)
	r.data = append(r.data, data)
}
func (r *recorder) OnEvent(_ string, ev *mc.Event, _ time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, string(ev.Kind))
}

func (r *recorder) lastPregen(t *testing.T) map[string]any {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := len(r.types) - 1; i >= 0; i-- {
		if r.types[i] == "lod.pregen" {
			return r.data[i].(map[string]any)
		}
	}
	t.Fatalf("no lod.pregen in %v", r.types)
	return nil
}

var started = []string{"Generating LODs for view distance of 64 chunks in world world starting at center 0 0..."}

func setup(t *testing.T) (*Service, *fakeHost, *fakeRunner, *recorder) {
	h := &fakeHost{running: true, since: time.Unix(1000, 0)}
	run := &fakeRunner{replies: map[string][]string{"dhs pregen start": started}}
	rec := &recorder{}
	return NewService(fakeHosts{"i": h}, run, rec, rec), h, run, rec
}

func TestStartSendsWorldWithUnderscores(t *testing.T) {
	s, h, run, _ := setup(t)
	r := 64
	if err := s.Start(context.Background(), "i", Pregen{World: "My World", Radius: &r}); err != nil {
		t.Fatal(err)
	}
	if run.ran[0] != "dhs pregen start My_World 64" {
		t.Fatalf("ran %v", run.ran)
	}
	if len(h.s.Pregens) != 1 || !h.s.Pregens[0].Session.Equal(h.since) {
		t.Fatalf("recorded %+v", h.s.Pregens)
	}
}

func TestStartPassesCentreAndRadius(t *testing.T) {
	s, _, run, _ := setup(t)
	x, z, r := 100, -50, 32
	s.Start(context.Background(), "i", Pregen{World: "world", X: &x, Z: &z, Radius: &r})
	if run.ran[0] != "dhs pregen start world 100 -50 32" {
		t.Fatalf("ran %v", run.ran)
	}
}

func TestStartReportsWhatDHSRefused(t *testing.T) {
	s, h, run, _ := setup(t)
	run.replies["dhs pregen start"] = []string{"Unknown world."}
	if err := s.Start(context.Background(), "i", Pregen{World: "nope"}); err == nil || err.Error() != "Unknown world." {
		t.Fatalf("got %v", err)
	}
	if len(h.s.Pregens) != 0 {
		t.Fatal("a refused start was recorded")
	}
}

func TestPollBroadcastsProgress(t *testing.T) {
	s, _, run, rec := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	run.replies["dhs pregen status"] = []string{"Generation progress: 50.00%", "Processed LODs: 5 / 10 (2.00 CPS)", "Time elapsed: 3s", "Time remaining: 3s"}
	s.Poll(context.Background())
	d := rec.lastPregen(t)
	if d["world"] != "world" || d["state"] != "running" || d["progress"] != 50.0 {
		t.Fatalf("broadcast %v", d)
	}
	if st := s.States("i"); len(st) != 1 || st[0].Status.Done != 5 {
		t.Fatalf("states %+v", st)
	}
}

func TestAFinishedPregenIsForgottenWithAnEvent(t *testing.T) {
	s, h, run, rec := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	run.replies["dhs pregen status"] = []string{"Generation progress: 100.00%", "Generation is complete."}
	s.Poll(context.Background())
	if rec.lastPregen(t)["state"] != "done" || len(h.s.Pregens) != 0 || len(rec.events) != 1 || rec.events[0] != "lod.pregen.done" {
		t.Fatalf("pregens %v events %v", h.s.Pregens, rec.events)
	}
}

func TestAPregenCutByARestartResumes(t *testing.T) {
	s, h, run, rec := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	h.since = time.Unix(2000, 0) // the server started again
	run.replies["dhs pregen status"] = []string{"No pre-generator running in world world."}
	s.Poll(context.Background())
	if run.ran[len(run.ran)-1] != "dhs pregen start world" {
		t.Fatalf("ran %v", run.ran)
	}
	p := h.s.Pregens[0]
	if p.ResumedAt == nil || !p.Session.Equal(h.since) || rec.lastPregen(t)["state"] != "resumed" {
		t.Fatalf("pregen %+v", p)
	}
}

func TestPregenStoppedFromTheConsoleIsForgotten(t *testing.T) {
	s, h, run, rec := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	run.replies["dhs pregen status"] = []string{"No pre-generator running in world world."}
	s.Poll(context.Background()) // same server session: someone stopped it
	if len(h.s.Pregens) != 0 || rec.lastPregen(t)["state"] != "stopped" {
		t.Fatalf("pregens %+v", h.s.Pregens)
	}
	for _, c := range run.ran[1:] {
		if strings.HasPrefix(c, "dhs pregen start") {
			t.Fatal("relaunched a pre-generation someone stopped")
		}
	}
}

func TestUnrecognisedStatusIsReportedNotActedOn(t *testing.T) {
	s, h, run, rec := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	h.since = time.Unix(2000, 0)
	run.replies["dhs pregen status"] = []string{"Unknown command."}
	s.Poll(context.Background())
	if rec.lastPregen(t)["state"] != "unknown" || len(h.s.Pregens) != 1 || len(run.ran) != 2 {
		t.Fatalf("ran %v pregens %v", run.ran, h.s.Pregens)
	}
}

func TestAStoppedServerIsNotPolled(t *testing.T) {
	s, h, run, _ := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	h.running = false
	s.Poll(context.Background())
	if len(run.ran) != 1 {
		t.Fatalf("ran %v", run.ran)
	}
}

func TestStopForgets(t *testing.T) {
	s, h, run, _ := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "My World"})
	if err := s.Stop(context.Background(), "i", "My World"); err != nil {
		t.Fatal(err)
	}
	if run.ran[1] != "dhs pregen stop My_World" || len(h.s.Pregens) != 0 {
		t.Fatalf("ran %v pregens %v", run.ran, h.s.Pregens)
	}
}

func TestStopOnAStoppedServerDoesNotCallTheRunner(t *testing.T) {
	s, h, run, rec := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	h.running = false
	ran := len(run.ran)
	if err := s.Stop(context.Background(), "i", "world"); err != nil {
		t.Fatal(err)
	}
	if len(run.ran) != ran {
		t.Fatalf("ran %v", run.ran)
	}
	if len(h.s.Pregens) != 0 {
		t.Fatalf("pregens %+v", h.s.Pregens)
	}
	if rec.lastPregen(t)["state"] != "stopped" {
		t.Fatalf("broadcast %v", rec.lastPregen(t))
	}
}

func TestAPollInFlightDoesNotBringBackAPregenStoppedMeanwhile(t *testing.T) {
	s, h, run, rec := setup(t)
	s.Start(context.Background(), "i", Pregen{World: "world"})
	run.replies["dhs pregen status"] = []string{"Generation progress: 50.00%", "Processed LODs: 5 / 10 (2.00 CPS)"}
	var once sync.Once
	run.during = func(cmd string) {
		if strings.HasPrefix(cmd, "dhs pregen status") {
			// The status is being asked when someone presses Stop.
			once.Do(func() {
				if err := s.Stop(context.Background(), "i", "world"); err != nil {
					t.Error(err)
				}
			})
		}
	}
	s.Poll(context.Background())
	if len(h.s.Pregens) != 0 {
		t.Fatalf("pregens %+v", h.s.Pregens)
	}
	if st := s.States("i"); len(st) != 0 {
		t.Fatalf("states %+v", st)
	}
	if st, ok := s.last["i"]["world"]; ok {
		t.Fatalf("a stopped pre-generation's status was remembered: %+v", st)
	}
	if d := rec.lastPregen(t); d["state"] != "stopped" {
		t.Fatalf("the last broadcast should say stopped, got %v", d)
	}
}
