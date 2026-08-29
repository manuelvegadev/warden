package instance

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
)

var ErrAlreadyRunning = errors.New("instance already running")
var ErrNotRunning = errors.New("instance not running")

// Instance is a server instance on disk + its process (if running).
type Instance struct {
	Dir      string // <data>/servers/<id>
	Manifest *Manifest

	mu    sync.RWMutex
	state State
	// TODO: proc *process (os/exec), console *RingBuffer, subscribers, log parser
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
	// TODO: broadcast over WS {"type":"state"}
}

// Start launches `java <flags> -jar <jar> --nogui` in ServerDir and starts pumping stdout.
func (i *Instance) Start(ctx context.Context) error {
	if i.State() == StateRunning || i.State() == StateStarting {
		return ErrAlreadyRunning
	}
	// TODO: os/exec, stdin/stdout pipes, reader goroutine → parser → ring buffer + ws
	i.setState(StateStarting)
	return errors.New("not implemented")
}

// Stop writes "stop" to stdin and waits; escalates to SIGTERM and SIGKILL (docs/minecraft-admin.md).
func (i *Instance) Stop(ctx context.Context) error {
	if i.State() != StateRunning && i.State() != StateStarting {
		return ErrNotRunning
	}
	i.setState(StateStopping)
	return errors.New("not implemented")
}

// SendCommand writes a line to the process stdin.
func (i *Instance) SendCommand(cmd string) error {
	if i.State() != StateRunning {
		return ErrNotRunning
	}
	return errors.New("not implemented")
}
