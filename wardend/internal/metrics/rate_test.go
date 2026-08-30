package metrics

import "testing"

func TestRate(t *testing.T) {
	if got := rate(1000, 3000, 2); got != 1000 {
		t.Fatalf("rate = %d", got)
	}
	if got := rate(3000, 1000, 2); got != 0 {
		t.Fatalf("counter step back: rate = %d", got)
	}
}
