// Package tasks runs long operations (downloads, backups, upgrades) with progress reported over the bus.
package tasks

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/manuelvega/warden/wardend/internal/bus"
)

type Status string

const (
	StatusPending Status = "pending"
	StatusRunning Status = "running"
	StatusDone    Status = "done"
	StatusFailed  Status = "failed"
)

type Task struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	InstanceID string     `json:"instanceId,omitempty"`
	Status     Status     `json:"status"`
	Progress   int        `json:"progress"`
	Message    string     `json:"message"`
	Error      string     `json:"error,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
}

// Reporter lets a task publish progress (0-100) and a human-readable message.
type Reporter func(progress int, message string)

type running struct {
	cancel context.CancelFunc
	done   chan struct{}
}

type Manager struct {
	mu      sync.RWMutex
	tasks   map[string]*Task
	running map[string]running // by task id, while the goroutine is alive
	bc      bus.Broadcaster
}

func NewManager(bc bus.Broadcaster) *Manager {
	return &Manager{tasks: map[string]*Task{}, running: map[string]running{}, bc: bc}
}

// Run starts fn in a goroutine and returns the task immediately. The task outlives the HTTP
// request that started it; CancelInstance is the only way to stop it early.
func (m *Manager) Run(ctx context.Context, typ, instanceID string, fn func(ctx context.Context, report Reporter) error) *Task {
	t := &Task{ID: uuid.NewString(), Type: typ, InstanceID: instanceID, Status: StatusPending, CreatedAt: time.Now().UTC()}
	tctx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	done := make(chan struct{})
	m.mu.Lock()
	m.tasks[t.ID] = t
	m.running[t.ID] = running{cancel: cancel, done: done}
	m.mu.Unlock()

	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.running, t.ID)
			m.mu.Unlock()
			cancel()
			close(done)
		}()
		m.update(t, func() { t.Status = StatusRunning })
		report := func(p int, msg string) {
			m.update(t, func() { t.Progress = p; t.Message = msg })
		}
		err := fn(tctx, report)
		now := time.Now().UTC()
		m.update(t, func() {
			t.FinishedAt = &now
			if err != nil {
				t.Status = StatusFailed
				t.Error = err.Error()
				slog.Warn("task failed", "id", t.ID, "type", typ, "instance", instanceID, "err", err)
			} else {
				t.Status = StatusDone
				t.Progress = 100
			}
		})
	}()
	return t
}

// CancelInstance stops every running task of an instance and waits for them to return, so the
// caller can remove the instance's files without a task recreating them.
func (m *Manager) CancelInstance(instanceID string) {
	m.mu.RLock()
	var waits []chan struct{}
	for id, r := range m.running {
		if m.tasks[id].InstanceID == instanceID {
			r.cancel()
			waits = append(waits, r.done)
		}
	}
	m.mu.RUnlock()
	for _, w := range waits {
		<-w
	}
}

// Active reports whether a task of the instance is still running.
func (m *Manager) Active(instanceID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for id := range m.running {
		if m.tasks[id].InstanceID == instanceID {
			return true
		}
	}
	return false
}

// ListInstance returns the instance's tasks, newest first.
func (m *Manager) ListInstance(instanceID string) []Task {
	all := m.List()
	out := make([]Task, 0, len(all))
	for _, t := range all {
		if t.InstanceID == instanceID {
			out = append(out, t)
		}
	}
	return out
}

func (m *Manager) update(t *Task, mutate func()) {
	m.mu.Lock()
	mutate()
	snapshot := *t
	m.mu.Unlock()
	m.bc.Broadcast(t.InstanceID, "task.progress", snapshot)
}

func (m *Manager) Get(id string) (*Task, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.tasks[id]
	if !ok {
		return nil, false
	}
	cp := *t
	return &cp, true
}

func (m *Manager) List() []Task {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Task, 0, len(m.tasks))
	for _, t := range m.tasks {
		out = append(out, *t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}
