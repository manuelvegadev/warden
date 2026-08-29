package instance

// State is the state machine of an instance (docs/api.md).
type State string

const (
	StateStopped    State = "stopped"
	StateStarting   State = "starting"
	StateRunning    State = "running"
	StateStopping   State = "stopping"
	StateCrashed    State = "crashed"
	StateInstalling State = "installing"
)
