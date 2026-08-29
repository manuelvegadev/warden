package instance

import (
	"regexp"
	"strings"
	"sync"
	"time"
)

// Line is one console line as shown in the UI.
type Line struct {
	TS    time.Time `json:"ts"`
	Level string    `json:"level"` // INFO|WARN|ERROR|STDIN|SYSTEM
	Text  string    `json:"text"`
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

// sanitize strips ANSI escapes and JLine prompt artifacts ("> ", "\r  \r") that leak into piped stdout.
func sanitize(text string) string {
	text = ansiRe.ReplaceAllString(text, "")
	if i := strings.LastIndex(text, "\r"); i >= 0 {
		text = text[i+1:]
	}
	for strings.HasPrefix(text, "> ") || strings.HasPrefix(text, ">\t") {
		text = strings.TrimLeft(text[1:], " \t")
	}
	return strings.TrimRight(text, " \t")
}

var levelRe = regexp.MustCompile(`^\[\d{2}:\d{2}:\d{2}(?: (INFO|WARN|ERROR|FATAL|DEBUG))?\](?: \[[^\]]+/(INFO|WARN|ERROR|FATAL|DEBUG)\])?: `)

func levelOf(text string) string {
	m := levelRe.FindStringSubmatch(text)
	if m == nil {
		return "INFO"
	}
	if m[1] != "" {
		return m[1]
	}
	if m[2] != "" {
		return m[2]
	}
	return "INFO"
}

// RingBuffer keeps the last N console lines.
type RingBuffer struct {
	mu   sync.RWMutex
	buf  []Line
	next int
	full bool
}

func NewRingBuffer(n int) *RingBuffer { return &RingBuffer{buf: make([]Line, n)} }

func (r *RingBuffer) Push(l Line) {
	r.mu.Lock()
	r.buf[r.next] = l
	r.next = (r.next + 1) % len(r.buf)
	if r.next == 0 {
		r.full = true
	}
	r.mu.Unlock()
}

// Last returns up to n most recent lines, oldest first.
func (r *RingBuffer) Last(n int) []Line {
	r.mu.RLock()
	defer r.mu.RUnlock()
	size := r.next
	if r.full {
		size = len(r.buf)
	}
	if n > size {
		n = size
	}
	out := make([]Line, 0, n)
	start := (r.next - n + len(r.buf)) % len(r.buf)
	for i := 0; i < n; i++ {
		out = append(out, r.buf[(start+i)%len(r.buf)])
	}
	return out
}
