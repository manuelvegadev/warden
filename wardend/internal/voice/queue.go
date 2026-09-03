package voice

import "sync"

// queue is a bounded FIFO of frames that drops the oldest when full: a slow browser must hear
// what is being said now, not what was said while it stalled.
type queue struct {
	mu    sync.Mutex
	buf   [][]byte
	head  int
	n     int
	ready chan struct{} // signalled (without blocking) whenever a frame is pushed
}

func newQueue(capacity int) *queue {
	return &queue{buf: make([][]byte, capacity), ready: make(chan struct{}, 1)}
}

func (q *queue) push(b []byte) {
	q.mu.Lock()
	if q.n == len(q.buf) {
		q.head = (q.head + 1) % len(q.buf) // drop the oldest
		q.n--
	}
	q.buf[(q.head+q.n)%len(q.buf)] = b
	q.n++
	q.mu.Unlock()
	select {
	case q.ready <- struct{}{}:
	default:
	}
}

// pop returns the oldest frame, or nil when empty. When frames remain it re-arms ready so the
// consumer keeps draining without waiting for the next push.
func (q *queue) pop() []byte {
	q.mu.Lock()
	if q.n == 0 {
		q.mu.Unlock()
		return nil
	}
	b := q.buf[q.head]
	q.buf[q.head] = nil
	q.head = (q.head + 1) % len(q.buf)
	q.n--
	more := q.n > 0
	q.mu.Unlock()
	if more {
		select {
		case q.ready <- struct{}{}:
		default:
		}
	}
	return b
}

func (q *queue) len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.n
}
