package instance

import (
	"context"
	"strings"
	"time"
)

type lineWaiter struct {
	needle string
	ch     chan struct{}
}

// awaitLine blocks until the console prints a line containing needle, the context ends or the
// timeout elapses. The waiter is always removed on exit.
func (i *Instance) awaitLine(ctx context.Context, needle string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	w := lineWaiter{needle: needle, ch: make(chan struct{}, 1)}
	i.mu.Lock()
	i.lineWaiters = append(i.lineWaiters, w)
	i.mu.Unlock()
	defer func() {
		i.mu.Lock()
		for k, x := range i.lineWaiters {
			if x.ch == w.ch {
				i.lineWaiters = append(i.lineWaiters[:k], i.lineWaiters[k+1:]...)
				break
			}
		}
		i.mu.Unlock()
	}()
	select {
	case <-w.ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// notifyLine wakes waiters whose needle appears in text; called from the console pump for every
// line, so the no-waiter case only takes a read lock.
func (i *Instance) notifyLine(text string) {
	i.mu.RLock()
	n := len(i.lineWaiters)
	i.mu.RUnlock()
	if n == 0 {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	for _, w := range i.lineWaiters {
		if strings.Contains(text, w.needle) {
			select {
			case w.ch <- struct{}{}:
			default:
			}
		}
	}
}
