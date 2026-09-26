package metrics

import (
	"testing"
	"time"
)

func TestParseRange(t *testing.T) {
	tests := []struct {
		in   string
		want time.Duration
	}{
		{"", time.Hour},
		{"15m", 15 * time.Minute},
		{"6h", 6 * time.Hour},
		{"1d", 24 * time.Hour},
		{"7d", 7 * 24 * time.Hour},
		{"30d", Retention}, // longer than the week kept: clamped
		{"200h", Retention},
		{"0", time.Hour},
		{"-5m", time.Hour},
		{"xd", time.Hour},
		{"week", time.Hour},
	}
	for _, tt := range tests {
		if got := ParseRange(tt.in); got != tt.want {
			t.Errorf("ParseRange(%q) = %s, want %s", tt.in, got, tt.want)
		}
	}
}

func TestStepFor(t *testing.T) {
	tests := []struct {
		name   string
		rng    time.Duration
		points int
		want   time.Duration
	}{
		{"no points, no bucketing", time.Hour, 0, 0},
		{"an hour in 360 points is ten seconds", time.Hour, 360, 10 * time.Second},
		{"a week in 360 points is 28 minutes", 7 * 24 * time.Hour, 360, 28 * time.Minute},
		{"a range that does not divide evenly rounds up, so it fits in the points", time.Hour, 7, 515 * time.Second},
		{"never finer than the sampling interval", 15 * time.Minute, 2000, MinStep},
	}
	for _, tt := range tests {
		if got := StepFor(tt.rng, tt.points); got != tt.want {
			t.Errorf("%s: StepFor(%s, %d) = %s, want %s", tt.name, tt.rng, tt.points, got, tt.want)
		}
	}
}
