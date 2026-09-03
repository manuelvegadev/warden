package voice

import (
	"bytes"
	"slices"
	"testing"
)

func TestQueueDropsTheOldest(t *testing.T) {
	q := newQueue(3)
	for _, s := range []string{"a", "b", "c", "d", "e"} {
		q.push([]byte(s))
	}
	if q.len() != 3 {
		t.Fatalf("len %d, want 3", q.len())
	}
	var got []string
	for b := q.pop(); b != nil; b = q.pop() {
		got = append(got, string(b))
	}
	if want := []string{"c", "d", "e"}; !slices.Equal(got, want) {
		t.Fatalf("drained %v, want %v", got, want)
	}
	if q.pop() != nil {
		t.Fatal("an empty queue must pop nil")
	}
}

func TestQueueReadyKeepsDraining(t *testing.T) {
	q := newQueue(4)
	q.push([]byte("1"))
	q.push([]byte("2"))
	<-q.ready // one signal covers both pushes
	if b := q.pop(); !bytes.Equal(b, []byte("1")) {
		t.Fatalf("got %q", b)
	}
	select {
	case <-q.ready: // pop re-armed it because a frame remained
	default:
		t.Fatal("ready must be re-armed while frames remain")
	}
	if b := q.pop(); !bytes.Equal(b, []byte("2")) {
		t.Fatalf("got %q", b)
	}
	select {
	case <-q.ready:
		t.Fatal("ready must not be armed on an empty queue")
	default:
	}
}
