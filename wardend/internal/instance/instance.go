package instance

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/manuelvega/warden/wardend/internal/bus"
	"github.com/manuelvega/warden/wardend/internal/mc"
)

var ErrAlreadyRunning = errors.New("instance already running")
var ErrNotRunning = errors.New("instance not running")
var ErrNotInstalled = errors.New("instance is not installed yet")

// Instance is a server directory on disk plus its running process (if any).
type Instance struct {
	Dir      string // <data>/servers/<id>
	Manifest *Manifest
	Console  *RingBuffer

	bc    bus.Broadcaster
	java  JavaResolver
	sink  EventSink
	agent *agentDeps // live view: agent URL and jar (ADR-018); nil until main wires it

	mu          sync.RWMutex
	pluginMetas map[string]pluginMetaEntry // jar descriptors keyed by path, invalidated by size/mtime
	rootOnce    sync.Once                  // realServerDir cache
	rootReal    string
	rootErr     error
	backupLock  sync.Mutex   // one backup/restore at a time per instance
	lineWaiters []lineWaiter // awaitLine subscribers
	uuidCache   map[string]uuidEntry
	statsCache  map[string]statsEntry // KnownPlayers: parsed play time per stats file, keyed by path
	state       State
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	pid         int
	startedAt   time.Time
	exited      chan struct{} // closed when the current process has exited
	stopping    bool          // true when Stop() initiated the shutdown (no restart)
	crashes     int
	players     map[string]struct{}
	tps         [3]float64
	tpsAt       time.Time
	tpsQuiet    bool // a quiet `tps` is in flight: swallow its reply instead of showing it in the console
	// pendingProperties is a snapshot of server.properties taken after a write made while running.
	// The server rewrites the file from memory on shutdown, so the snapshot is restored on exit.
	pendingProperties []byte
}

// EventSink receives parsed server events (persisted by the store).
type EventSink interface {
	OnEvent(instanceID string, ev *mc.Event, at time.Time)
	OnStopped(instanceID string, at time.Time)
}

func newInstance(dir string, m *Manifest, bc bus.Broadcaster) *Instance {
	return &Instance{Dir: dir, Manifest: m, Console: NewRingBuffer(2000), bc: bc, state: StateStopped, players: map[string]struct{}{}}
}

func (i *Instance) ServerDir() string { return filepath.Join(i.Dir, "server") }

func (i *Instance) State() State {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.state
}

// Status is the runtime snapshot sent over the API and WebSocket.
type Status struct {
	State     State       `json:"state"`
	PID       int         `json:"pid,omitempty"`
	StartedAt *time.Time  `json:"startedAt,omitempty"`
	Players   []string    `json:"players"`
	TPS       *[3]float64 `json:"tps,omitempty"`
}

func (i *Instance) Status() Status {
	i.mu.RLock()
	defer i.mu.RUnlock()
	s := Status{State: i.state, PID: i.pid, Players: make([]string, 0, len(i.players))}
	if !i.startedAt.IsZero() && i.state != StateStopped && i.state != StateCrashed {
		t := i.startedAt
		s.StartedAt = &t
	}
	for p := range i.players {
		s.Players = append(s.Players, p)
	}
	if !i.tpsAt.IsZero() && time.Since(i.tpsAt) < time.Minute {
		tps := i.tps
		s.TPS = &tps
	}
	return s
}

func (i *Instance) setState(s State) {
	i.mu.Lock()
	i.state = s
	if s == StateStopped || s == StateCrashed {
		i.pid = 0
		i.players = map[string]struct{}{}
		i.tpsAt = time.Time{}
	}
	sink := i.sink
	i.mu.Unlock()
	if (s == StateStopped || s == StateCrashed) && sink != nil {
		sink.OnStopped(i.Manifest.ID, time.Now().UTC())
	}
	i.bc.Broadcast(i.Manifest.ID, "state", i.Status())
}

func (i *Instance) pushLine(level, text string) {
	l := Line{TS: time.Now().UTC(), Level: level, Text: text}
	i.Console.Push(l)
	i.bc.Broadcast(i.Manifest.ID, "console", l)
}

func (i *Instance) system(msg string) { i.pushLine("SYSTEM", msg) }

// Start launches `java <flags> -jar <jar> --nogui` in ServerDir and pumps stdout to the console.
func (i *Instance) Start(ctx context.Context) error {
	// The agent jar and its config follow the daemon: refreshed before every start (ADR-018). Done
	// before taking the lock; it touches only plugins/ and a start that is refused below did no harm.
	if s := i.State(); s == StateStopped || s == StateCrashed {
		if msg := i.refreshAgent(); msg != "" {
			i.system(msg)
		}
	}
	i.mu.Lock()
	if i.state == StateRunning || i.state == StateStarting || i.state == StateStopping {
		i.mu.Unlock()
		return ErrAlreadyRunning
	}
	if i.state == StateInstalling {
		i.mu.Unlock()
		return ErrNotInstalled
	}
	m := i.Manifest
	if m.Jar == "" {
		i.mu.Unlock()
		return ErrNotInstalled
	}
	if _, err := os.Stat(filepath.Join(i.ServerDir(), m.Jar)); err != nil {
		i.mu.Unlock()
		return fmt.Errorf("%w: %s missing", ErrNotInstalled, m.Jar)
	}
	if eula, _ := mc.ReadProperties(filepath.Join(i.ServerDir(), "eula.txt")); eula["eula"] != "true" {
		i.mu.Unlock()
		return errors.New("EULA not accepted (POST /instances/{id}/eula)")
	}

	javaBin, err := i.resolveJava()
	if err != nil {
		i.mu.Unlock()
		return err
	}
	cmd := exec.Command(javaBin, m.JavaArgs()...)
	cmd.Dir = i.ServerDir()
	cmd.Env = append(os.Environ(), "TERM=dumb")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group: signals never hit wardend
	stdin, err := cmd.StdinPipe()
	if err != nil {
		i.mu.Unlock()
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		i.mu.Unlock()
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		i.mu.Unlock()
		return fmt.Errorf("start java: %w", err)
	}
	i.cmd, i.stdin, i.pid, i.startedAt = cmd, stdin, cmd.Process.Pid, time.Now().UTC()
	i.exited = make(chan struct{})
	i.stopping = false
	exited := i.exited
	i.mu.Unlock()

	i.setState(StateStarting)
	i.system(fmt.Sprintf("Starting %s %s (pid %d): %s", m.Software, m.MCVersion, cmd.Process.Pid, shellLine(javaBin, m.JavaArgs())))
	slog.Info("instance started", "id", m.ID, "pid", cmd.Process.Pid)

	go i.pump(stdout)
	go i.wait(cmd, exited)
	return nil
}

// pump reads process output line by line, feeds the console and the log parser.
func (i *Instance) pump(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		text := sanitize(sc.Text())
		if text == "" {
			continue
		}
		if i.captureTPS(text) {
			continue
		}
		i.notifyLine(text)
		i.pushLine(levelOf(text), text)
		if ev := mc.Parse(text); ev != nil {
			i.handleEvent(ev)
		}
	}
}

func (i *Instance) handleEvent(ev *mc.Event) {
	switch ev.Kind {
	case mc.EvServerReady:
		i.setState(StateRunning)
	case mc.EvServerStopping:
		if i.State() == StateRunning {
			i.setState(StateStopping)
		}
	case mc.EvPlayerJoin:
		i.mu.Lock()
		i.players[ev.Player] = struct{}{}
		i.mu.Unlock()
		i.bc.Broadcast(i.Manifest.ID, "players", i.Status().Players)
	case mc.EvPlayerLeave:
		i.mu.Lock()
		delete(i.players, ev.Player)
		i.mu.Unlock()
		i.bc.Broadcast(i.Manifest.ID, "players", i.Status().Players)
	}
	now := time.Now().UTC()
	i.bc.Broadcast(i.Manifest.ID, "event", ev.Payload(now))
	i.mu.RLock()
	sink := i.sink
	i.mu.RUnlock()
	if sink != nil {
		sink.OnEvent(i.Manifest.ID, ev, now)
	}
}

var tpsRe = regexp.MustCompile(`TPS from last 1m, 5m, 15m: \*?([\d.]+), \*?([\d.]+), \*?([\d.]+)`)

// captureTPS parses Paper's `tps` reply. Replies to quiet polls are swallowed (not shown in the console).
func (i *Instance) captureTPS(text string) bool {
	m := tpsRe.FindStringSubmatch(text)
	if m == nil {
		return false
	}
	var tps [3]float64
	for k := 0; k < 3; k++ {
		tps[k], _ = strconv.ParseFloat(m[k+1], 64)
	}
	i.mu.Lock()
	i.tps, i.tpsAt = tps, time.Now().UTC()
	quiet := i.tpsQuiet
	i.tpsQuiet = false
	i.mu.Unlock()
	return quiet
}

// PollTPS sends a quiet `tps` (no STDIN echo, reply hidden). Called by the metrics sampler for
// software whose provider answers the command (catalog.Traits.TPSCommand).
func (i *Instance) PollTPS() {
	i.mu.Lock()
	if i.state != StateRunning || i.stdin == nil || i.tpsQuiet {
		i.mu.Unlock()
		return
	}
	i.tpsQuiet = true
	stdin := i.stdin
	i.mu.Unlock()
	if _, err := io.WriteString(stdin, "tps\n"); err != nil {
		i.mu.Lock()
		i.tpsQuiet = false
		i.mu.Unlock()
	}
}

// wait blocks until the process exits, then applies the restart policy.
func (i *Instance) wait(cmd *exec.Cmd, exited chan struct{}) {
	err := cmd.Wait()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	i.mu.Lock()
	wasStopping := i.stopping
	i.cmd, i.stdin = nil, nil
	pending := i.pendingProperties
	i.pendingProperties = nil
	i.mu.Unlock()
	if pending != nil {
		if err := mc.WriteAtomic(i.propertiesPath(), pending); err != nil {
			slog.Warn("restore server.properties", "id", i.Manifest.ID, "err", err)
		} else {
			i.system("Restored server.properties edits saved while the server was running")
		}
	}

	if wasStopping || code == 0 {
		i.system(fmt.Sprintf("Server stopped (exit code %d)", code))
		i.setState(StateStopped)
		i.mu.Lock()
		i.crashes = 0
		i.mu.Unlock()
		close(exited) // after the state change so Stop/Kill callers observe "stopped"
		return
	}
	i.system(fmt.Sprintf("Server crashed (exit code %d)", code))
	slog.Warn("instance crashed", "id", i.Manifest.ID, "code", code)
	i.setState(StateCrashed)
	close(exited)

	policy := i.Manifest.RestartPolicy
	if policy != "on-crash" && policy != "always" {
		return
	}
	i.mu.Lock()
	i.crashes++
	n := i.crashes
	i.mu.Unlock()
	if n > 5 {
		i.system("Too many crashes in a row; not restarting automatically")
		return
	}
	delay := time.Duration(n*n) * 5 * time.Second // 5s, 20s, 45s, 80s, 125s
	i.system(fmt.Sprintf("Restarting in %s (attempt %d/5)", delay, n))
	time.Sleep(delay)
	if i.State() == StateCrashed {
		if err := i.Start(context.Background()); err != nil {
			i.system("Automatic restart failed: " + err.Error())
		}
	}
}

// SendCommand writes one line to the server's stdin.
func (i *Instance) SendCommand(cmd string) error {
	i.mu.RLock()
	stdin, st := i.stdin, i.state
	i.mu.RUnlock()
	if stdin == nil || (st != StateRunning && st != StateStarting && st != StateStopping) {
		return ErrNotRunning
	}
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return nil
	}
	i.pushLine("STDIN", "> "+cmd)
	_, err := io.WriteString(stdin, cmd+"\n")
	return err
}

// Stop performs a staged shutdown: `stop` → wait timeout → SIGTERM → 15 s → SIGKILL.
func (i *Instance) Stop(ctx context.Context) error {
	i.mu.Lock()
	if i.cmd == nil {
		i.mu.Unlock()
		return ErrNotRunning
	}
	i.stopping = true
	exited := i.exited
	timeout := time.Duration(i.Manifest.StopTimeoutS) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	i.mu.Unlock()

	i.setState(StateStopping)
	i.system("Stopping server…")
	if err := i.SendCommand("stop"); err != nil {
		slog.Warn("stop command failed", "id", i.Manifest.ID, "err", err)
	}
	select {
	case <-exited:
		return nil
	case <-time.After(timeout):
	case <-ctx.Done():
	}
	i.system("Server did not stop in time; sending SIGTERM")
	i.signal(syscall.SIGTERM)
	select {
	case <-exited:
		return nil
	case <-time.After(15 * time.Second):
	}
	i.system("Sending SIGKILL")
	i.signal(syscall.SIGKILL)
	<-exited
	return nil
}

// Kill terminates the process immediately (SIGKILL). Data loss is possible.
func (i *Instance) Kill() error {
	i.mu.Lock()
	if i.cmd == nil {
		i.mu.Unlock()
		return ErrNotRunning
	}
	i.stopping = true
	exited := i.exited
	i.mu.Unlock()
	i.system("Killing server (SIGKILL)")
	i.signal(syscall.SIGKILL)
	<-exited
	return nil
}

func (i *Instance) signal(sig syscall.Signal) {
	i.mu.RLock()
	pid := i.pid
	i.mu.RUnlock()
	if pid > 0 {
		_ = syscall.Kill(-pid, sig) // whole process group
	}
}

// Restart stops (if running) and starts again.
func (i *Instance) Restart(ctx context.Context) error {
	if i.State() != StateStopped && i.State() != StateCrashed {
		if err := i.Stop(ctx); err != nil && !errors.Is(err, ErrNotRunning) {
			return err
		}
	}
	return i.Start(ctx)
}

// AcceptEULA writes eula=true (must be an explicit user action; https://aka.ms/MinecraftEULA).
func (i *Instance) AcceptEULA(accept bool) error {
	v := "false"
	if accept {
		v = "true"
	}
	return mc.WriteProperties(filepath.Join(i.ServerDir(), "eula.txt"), map[string]string{"eula": v})
}

func (i *Instance) SaveManifest() error { return i.Manifest.save(i.Dir) }

// JavaResolver maps a manifest to a java binary (implemented by the java runtime manager).
type JavaResolver interface {
	// ResolveJava returns the binary for the manifest's JavaRuntime/JavaPath, or the best installed
	// runtime for the instance's Minecraft version. install=true allows downloading a runtime.
	ResolveJava(ctx context.Context, m *Manifest, install bool, report func(int, string)) (string, error)
}

// LaunchCommand is what Start would execute, resolved from the current manifest: the Java binary
// (or an error message when none can be resolved yet), the arguments and the working directory.
type LaunchCommand struct {
	Java      string   `json:"java"`
	JavaError string   `json:"javaError,omitempty"`
	Args      []string `json:"args"`
	Cwd       string   `json:"cwd"`
	Shell     string   `json:"shell"` // java + args quoted for a POSIX shell
}

func (i *Instance) LaunchCommand() LaunchCommand {
	i.mu.RLock()
	out := LaunchCommand{Args: i.Manifest.JavaArgs(), Cwd: i.ServerDir()}
	i.mu.RUnlock()
	// Resolving Java may scan runtimes on disk: do it outside the instance lock.
	java, err := i.resolveJava()
	if err != nil {
		out.JavaError = err.Error()
		java = "java"
	}
	out.Java = java
	out.Shell = shellLine(java, out.Args)
	return out
}

// RequireStopped is the precondition for operations that replace server files.
func (i *Instance) RequireStopped() error {
	if st := i.State(); st != StateStopped && st != StateCrashed {
		return ErrMustBeStopped
	}
	return nil
}

// shellLine renders argv as a POSIX shell command line, quoting only where needed.
func shellLine(bin string, args []string) string {
	parts := make([]string, 0, len(args)+1)
	for _, a := range append([]string{bin}, args...) {
		parts = append(parts, shellQuote(a))
	}
	return strings.Join(parts, " ")
}

var shellSafe = regexp.MustCompile(`^[A-Za-z0-9_+=:.,/%@-]+$`)

func shellQuote(s string) string {
	if shellSafe.MatchString(s) {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func (i *Instance) resolveJava() (string, error) {
	if i.Manifest.JavaPath != "" {
		return i.Manifest.JavaPath, nil
	}
	if i.java == nil {
		return "java", nil
	}
	return i.java.ResolveJava(context.Background(), i.Manifest, false, nil)
}
