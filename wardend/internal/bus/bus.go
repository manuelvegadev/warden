// Package bus decouples producers (instances, tasks, metrics) from the WebSocket hub.
package bus

// Broadcaster delivers a typed message to every client subscribed to an instance.
// instanceID may be empty for global messages.
type Broadcaster interface {
	Broadcast(instanceID, typ string, data any)
}

// Nop discards everything; useful in tests and before the hub is wired.
type Nop struct{}

func (Nop) Broadcast(string, string, any) {}
