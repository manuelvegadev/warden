package instance

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

// fakeJava mimics a Paper server: prints startup lines, echoes commands, exits on "stop".
const fakeJava = `#!/bin/sh
echo "[12:00:00 INFO]: Starting minecraft server version 1.21.8"
echo "[12:00:01 INFO]: Done (1.000s)! For help, type \"help\""
while IFS= read -r line; do
  case "$line" in
    stop) echo "[12:00:05 INFO]: Stopping the server"; exit 0 ;;
    crash) exit 3 ;;
    join) echo "[12:00:02 INFO]: Steve joined the game" ;;
    leave) echo "[12:00:04 INFO]: Steve left the game" ;;
    tps) echo "[12:00:03 INFO]: TPS from last 1m, 5m, 15m: *20.0, 19.9, 18.5" ;;
    *) echo "[12:00:03 INFO]: echo $line" ;;
  esac
done
`

type recorder struct {
	mu   sync.Mutex
	msgs []string
}

func (r *recorder) Broadcast(_ string, typ string, _ any) {
	r.mu.Lock()
	r.msgs = append(r.msgs, typ)
	r.mu.Unlock()
}

func newTestInstance(t *testing.T, policy string) (*Instance, *recorder) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake java")
	}
	dir := t.TempDir()
	server := filepath.Join(dir, "server")
	if err := os.MkdirAll(server, 0o755); err != nil {
		t.Fatal(err)
	}
	java := filepath.Join(dir, "java")
	if err := os.WriteFile(java, []byte(fakeJava), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(server, "eula.txt"), []byte("eula=true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(server, "paper.jar"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := &recorder{}
	m := &Manifest{ID: "t", Software: "paper", MCVersion: "1.21.8", Jar: "paper.jar", JavaPath: java,
		MemoryMB: 256, JVMPreset: "basic", RestartPolicy: policy, StopTimeoutS: 2}
	return newInstance(dir, m, rec), rec
}

func waitState(t *testing.T, i *Instance, want State, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if i.State() == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("state %s, want %s", i.State(), want)
}

func TestStartCommandStop(t *testing.T) {
	inst, _ := newTestInstance(t, "never")
	if err := inst.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, inst, StateRunning, 3*time.Second)
	if err := inst.Start(context.Background()); err != ErrAlreadyRunning {
		t.Errorf("second start: %v", err)
	}
	if err := inst.SendCommand("join"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && len(inst.Status().Players) == 0 {
		time.Sleep(20 * time.Millisecond)
	}
	if p := inst.Status().Players; len(p) != 1 || p[0] != "Steve" {
		t.Errorf("players = %v", p)
	}
	if err := inst.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, inst, StateStopped, 3*time.Second)
	lines := inst.Console.Last(100)
	var sawStdin, sawStopped bool
	for _, l := range lines {
		if l.Level == "STDIN" && l.Text == "> join" {
			sawStdin = true
		}
		if l.Level == "SYSTEM" && l.Text == "Server stopped (exit code 0)" {
			sawStopped = true
		}
	}
	if !sawStdin || !sawStopped {
		t.Errorf("console missing stdin echo (%v) or stop line (%v): %+v", sawStdin, sawStopped, lines)
	}
	if err := inst.SendCommand("list"); err != ErrNotRunning {
		t.Errorf("command after stop: %v", err)
	}
}

func TestCrashWithoutRestart(t *testing.T) {
	inst, _ := newTestInstance(t, "never")
	if err := inst.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, inst, StateRunning, 3*time.Second)
	_ = inst.SendCommand("crash")
	waitState(t, inst, StateCrashed, 3*time.Second)
}

func TestKill(t *testing.T) {
	inst, _ := newTestInstance(t, "never")
	if err := inst.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, inst, StateRunning, 3*time.Second)
	if err := inst.Kill(); err != nil {
		t.Fatal(err)
	}
	if s := inst.State(); s != StateStopped {
		t.Errorf("state after kill = %s", s)
	}
}

func TestStartRequiresEULA(t *testing.T) {
	inst, _ := newTestInstance(t, "never")
	_ = os.Remove(filepath.Join(inst.ServerDir(), "eula.txt"))
	if err := inst.Start(context.Background()); err == nil {
		t.Fatal("expected EULA error")
	}
}

func TestQuietTPSPoll(t *testing.T) {
	inst, _ := newTestInstance(t, "never")
	if err := inst.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, inst, StateRunning, 3*time.Second)
	before := len(inst.Console.Last(100))
	inst.PollTPS()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && inst.Status().TPS == nil {
		time.Sleep(20 * time.Millisecond)
	}
	tps := inst.Status().TPS
	if tps == nil || tps[0] != 20 || tps[1] != 19.9 || tps[2] != 18.5 {
		t.Fatalf("tps = %v", tps)
	}
	if after := len(inst.Console.Last(100)); after != before {
		t.Errorf("quiet tps poll leaked %d console lines", after-before)
	}
	// A user-typed `tps` must still show its reply.
	_ = inst.SendCommand("tps")
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && len(inst.Console.Last(100)) < before+2 {
		time.Sleep(20 * time.Millisecond)
	}
	if got := len(inst.Console.Last(100)); got != before+2 {
		t.Errorf("visible tps: %d lines, want %d", got, before+2)
	}
	_ = inst.Stop(context.Background())
}
