package catalog

import "testing"

func TestCompareMC(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"1.21.10", "1.21.2", 1},
		{"26.1", "1.21.11", 1},
		{"1.21", "1.21.0", 0},
		{"26.3-pre-1", "26.3", -1},
		{"26.3-rc-1", "26.3-pre-3", 1},
		{"26.3", "26.2", 1},
		{"snapshot", "1.8", -1},
	}
	for _, tt := range tests {
		if got := CompareMC(tt.a, tt.b); got != tt.want {
			t.Errorf("CompareMC(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
		if got := CompareMC(tt.b, tt.a); got != -tt.want {
			t.Errorf("CompareMC(%q, %q) = %d, want %d", tt.b, tt.a, got, -tt.want)
		}
	}
}

func TestNewestMCReadsNumbersNotText(t *testing.T) {
	// Hangar lists versions in text order, where 1.21.10 comes before 1.21.2 and 26.2 is last only by luck.
	if got := NewestMC([]string{"1.21", "1.21.10", "1.21.2", "26.1", "26.1.2", "1.8"}); got != "26.1.2" {
		t.Errorf("NewestMC = %s", got)
	}
	if NewestMC(nil) != "" {
		t.Error("an empty list has no newest version")
	}
}
