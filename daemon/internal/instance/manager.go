package instance

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
)

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,31}$`)

var ErrNotFound = errors.New("instance not found")
var ErrInvalidID = errors.New("invalid instance id")

// Manager conoce todas las instancias bajo serversDir.
type Manager struct {
	root string
	mu   sync.RWMutex
	byID map[string]*Instance
}

func NewManager(serversDir string) *Manager {
	return &Manager{root: serversDir, byID: map[string]*Instance{}}
}

// LoadAll lee cada <root>/<id>/instance.json.
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
		m.byID[man.ID] = &Instance{Dir: dir, Manifest: man, state: StateStopped}
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

// Create escribe el manifiesto y el árbol de directorios. La descarga del jar es una tarea aparte (tasks).
func (m *Manager) Create(man *Manifest) (*Instance, error) {
	if !idRe.MatchString(man.ID) {
		return nil, ErrInvalidID
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.byID[man.ID]; exists {
		return nil, errors.New("instance id already exists")
	}
	dir := filepath.Join(m.root, man.ID)
	for _, sub := range []string{"server", "server/plugins", "backups"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o750); err != nil {
			return nil, err
		}
	}
	if err := man.save(dir); err != nil {
		return nil, err
	}
	inst := &Instance{Dir: dir, Manifest: man, state: StateInstalling}
	m.byID[man.ID] = inst
	return inst, nil
}

func (m *Manager) AutostartAll(ctx context.Context) {
	for _, i := range m.List() {
		if i.Manifest.Autostart {
			if err := i.Start(ctx); err != nil {
				slog.Warn("autostart failed", "id", i.Manifest.ID, "err", err)
			}
		}
	}
}

func (m *Manager) StopAll(ctx context.Context) {
	var wg sync.WaitGroup
	for _, i := range m.List() {
		if i.State() != StateRunning {
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
