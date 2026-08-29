package instance

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
)

var ErrAlreadyRunning = errors.New("instance already running")
var ErrNotRunning = errors.New("instance not running")

// Instance es una instancia de servidor en disco + su proceso (si corre).
type Instance struct {
	Dir      string // <data>/servers/<id>
	Manifest *Manifest

	mu    sync.RWMutex
	state State
	// TODO: proc *process (os/exec), console *RingBuffer, subscribers, parser de log
}

func (i *Instance) ServerDir() string { return filepath.Join(i.Dir, "server") }

func (i *Instance) State() State {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.state
}

func (i *Instance) setState(s State) {
	i.mu.Lock()
	i.state = s
	i.mu.Unlock()
	// TODO: broadcast por WS {"type":"state"}
}

// Start lanza `java <flags> -jar <jar> --nogui` en ServerDir y arranca el bombeo de stdout.
func (i *Instance) Start(ctx context.Context) error {
	if i.State() == StateRunning || i.State() == StateStarting {
		return ErrAlreadyRunning
	}
	// TODO: os/exec, pipes stdin/stdout, goroutine de lectura → parser → ring buffer + ws
	i.setState(StateStarting)
	return errors.New("not implemented")
}

// Stop escribe "stop" en stdin y espera; escala a SIGTERM y SIGKILL (docs/minecraft-admin.md).
func (i *Instance) Stop(ctx context.Context) error {
	if i.State() != StateRunning && i.State() != StateStarting {
		return ErrNotRunning
	}
	i.setState(StateStopping)
	return errors.New("not implemented")
}

// SendCommand escribe una línea en stdin del proceso.
func (i *Instance) SendCommand(cmd string) error {
	if i.State() != StateRunning {
		return ErrNotRunning
	}
	return errors.New("not implemented")
}
