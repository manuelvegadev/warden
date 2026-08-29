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

type Manager struct {
	mu    sync.RWMutex
	tasks map[string]*Task
	bc    bus.Broadcaster
}

func NewManager(bc bus.Broadcaster) *Manager {
	return &Manager{tasks: map[string]*Task{}, bc: bc}
}

// Run starts fn in a goroutine and returns the task immediately.
func (m *Manager) Run(ctx context.Context, typ, instanceID string, fn func(ctx context.Context, report Reporter) error) *Task {
	t := &Task{ID: uuid.NewString(), Type: typ, InstanceID: instanceID, Status: StatusPending, CreatedAt: time.Now().UTC()}
	m.mu.Lock()
	m.tasks[t.ID] = t
	m.mu.Unlock()

	go func() {
		m.update(t, func() { t.Status = StatusRunning })
		report := func(p int, msg string) {
			m.update(t, func() { t.Progress = p; t.Message = msg })
		}
		err := fn(context.WithoutCancel(ctx), report)
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
