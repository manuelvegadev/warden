package instance

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/manuelvega/warden/wardend/internal/bus"
)

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,31}$`)

var ErrNotFound = errors.New("instance not found")
var ErrInvalidID = errors.New("invalid instance id")
var ErrExists = errors.New("instance id already exists")
var ErrPortInUse = errors.New("port already used by another instance")

// Manager knows every instance under serversDir.
type Manager struct {
	root  string
	bc    bus.Broadcaster
	java  JavaResolver
	sink  EventSink
	agent *agentDeps
	mu    sync.RWMutex
	byID  map[string]*Instance
}

func NewManager(serversDir string, bc bus.Broadcaster) *Manager {
	if bc == nil {
		bc = bus.Nop{}
	}
	return &Manager{root: serversDir, bc: bc, byID: map[string]*Instance{}}
}

// SetEventSink wires event persistence (store).
func (m *Manager) SetEventSink(s EventSink) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sink = s
	for _, i := range m.byID {
		i.sink = s
	}
}

// SetJavaResolver wires the Java runtime manager.
func (m *Manager) SetJavaResolver(r JavaResolver) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.java = r
	for _, i := range m.byID {
		i.java = r
	}
}

// SetBroadcaster wires the WebSocket hub after construction (hub needs the manager too).
func (m *Manager) SetBroadcaster(bc bus.Broadcaster) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bc = bc
	for _, i := range m.byID {
		i.bc = bc
	}
}

// newInstance builds an instance wired to every dependency the manager holds. The Set* methods
// re-wire instances that already exist; new ones must come through here.
func (m *Manager) newInstance(dir string, man *Manifest) *Instance {
	inst := newInstance(dir, man, m.bc)
	inst.java, inst.sink, inst.agent = m.java, m.sink, m.agent
	return inst
}

// LoadAll reads each <root>/<id>/instance.json.
func (m *Manager) LoadAll() error {
	entries, err := os.ReadDir(m.root)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(m.root, e.Name())
		man, err := readManifest(dir)
		if err != nil {
			slog.Warn("skipping instance dir", "dir", dir, "err", err)
			continue
		}
		inst := m.newInstance(dir, man)
		inst.java, inst.sink = m.java, m.sink
		if man.Jar == "" {
			inst.state = StateInstalling // install never finished; UI can retry
		}
		m.byID[man.ID] = inst
		slog.Info("loaded instance", "id", man.ID, "mc", man.MCVersion)
	}
	return nil
}

func (m *Manager) Get(id string) (*Instance, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	inst, ok := m.byID[id]
	if !ok {
		return nil, ErrNotFound
	}
	return inst, nil
}

func (m *Manager) List() []*Instance {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Instance, 0, len(m.byID))
	for _, i := range m.byID {
		out = append(out, i)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Manifest.ID < out[b].Manifest.ID })
	return out
}

// Create validates the manifest and writes the directory tree. Downloading the jar is a task (Install).
func (m *Manager) Create(man *Manifest) (*Instance, error) {
	if !idRe.MatchString(man.ID) {
		return nil, ErrInvalidID
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.byID[man.ID]; exists {
		return nil, ErrExists
	}
	man.Backups.Normalize()
	for _, other := range m.byID {
		if other.Manifest.Port == man.Port || other.Manifest.RconPort == man.Port {
			return nil, ErrPortInUse
		}
	}
	dir := filepath.Join(m.root, man.ID)
	for _, sub := range []string{"server", "server/plugins", "backups"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o750); err != nil {
			return nil, err
		}
	}
	if man.CreatedAt.IsZero() {
		man.CreatedAt = time.Now().UTC()
	}
	if err := man.save(dir); err != nil {
		return nil, err
	}
	inst := m.newInstance(dir, man)
	inst.state = StateInstalling
	m.byID[man.ID] = inst
	return inst, nil
}

// Delete stops the instance and moves its directory to <data>/trash/<id>-<ts> (or removes it when purge).
func (m *Manager) Delete(ctx context.Context, id string, purge bool) error {
	inst, err := m.Get(id)
	if err != nil {
		return err
	}
	if inst.State() != StateStopped && inst.State() != StateCrashed && inst.State() != StateInstalling {
		if err := inst.Stop(ctx); err != nil && !errors.Is(err, ErrNotRunning) {
			return err
		}
	}
	m.mu.Lock()
	delete(m.byID, id)
	m.mu.Unlock()
	if purge {
		return os.RemoveAll(inst.Dir)
	}
	trash := filepath.Join(filepath.Dir(m.root), "trash")
	if err := os.MkdirAll(trash, 0o750); err != nil {
		return err
	}
	return os.Rename(inst.Dir, filepath.Join(trash, id+"-"+time.Now().UTC().Format("20060102-150405")))
}

func (m *Manager) AutostartAll(ctx context.Context) {
	for _, i := range m.List() {
		if i.Manifest.Autostart && i.State() == StateStopped {
			if err := i.Start(ctx); err != nil {
				slog.Warn("autostart failed", "id", i.Manifest.ID, "err", err)
			}
		}
	}
}

func (m *Manager) StopAll(ctx context.Context) {
	var wg sync.WaitGroup
	for _, i := range m.List() {
		switch i.State() {
		case StateRunning, StateStarting:
		default:
			continue
		}
		wg.Add(1)
		go func(i *Instance) {
			defer wg.Done()
			if err := i.Stop(ctx); err != nil {
				slog.Warn("stop failed", "id", i.Manifest.ID, "err", err)
			}
		}(i)
	}
	wg.Wait()
}

// RunningIDs lists the instances that are up or starting.
func (m *Manager) RunningIDs() []string {
	var ids []string
	for _, i := range m.List() {
		if st := i.State(); st == StateRunning || st == StateStarting {
			ids = append(ids, i.Manifest.ID)
		}
	}
	return ids
}

// resumeFile remembers, across a daemon restart, which instances were running when it stopped.
func resumeFile(root string) string { return filepath.Join(filepath.Dir(root), "resume.json") }

// SaveResume records ids for ResumeAll; an empty list removes the marker.
func (m *Manager) SaveResume(ids []string) error {
	path := resumeFile(m.root)
	if len(ids) == 0 {
		err := os.Remove(path)
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	b, _ := json.Marshal(ids)
	return os.WriteFile(path, b, 0o640)
}

// ResumeAll starts the instances the previous daemon stopped on its way out (in addition to the
// autostart ones) and forgets the marker, so a crash loop cannot restart servers forever.
func (m *Manager) ResumeAll(ctx context.Context) {
	path := resumeFile(m.root)
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	os.Remove(path)
	var ids []string
	if json.Unmarshal(b, &ids) != nil {
		return
	}
	for _, id := range ids {
		inst, err := m.Get(id)
		if err != nil || inst.State() != StateStopped {
			continue
		}
		slog.Info("resuming instance after daemon restart", "id", id)
		if err := inst.Start(ctx); err != nil {
			slog.Warn("resume failed", "id", id, "err", err)
		}
	}
}
