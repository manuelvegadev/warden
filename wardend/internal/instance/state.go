package instance

// State es la máquina de estados de una instancia (docs/api.md).
type State string

const (
	StateStopped    State = "stopped"
	StateStarting   State = "starting"
	StateRunning    State = "running"
	StateStopping   State = "stopping"
	StateCrashed    State = "crashed"
	StateInstalling State = "installing"
)
