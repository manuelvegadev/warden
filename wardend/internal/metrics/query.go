package metrics

import (
	"strconv"
	"strings"
	"time"
)

// MinStep is the sampling interval: no bucket is finer than the samples it averages.
const MinStep = 2 * time.Second

// ParseRange reads a history range: a Go duration ("90m", "6h") or a whole number of days ("7d").
// Anything unreadable, zero or negative is the default hour; anything longer is clamped to the
// week the daemon keeps.
func ParseRange(v string) time.Duration {
	var d time.Duration
	if days, ok := strings.CutSuffix(v, "d"); ok {
		if n, err := strconv.Atoi(days); err == nil {
			d = time.Duration(n) * 24 * time.Hour
		}
	} else {
		d, _ = time.ParseDuration(v)
	}
	if d <= 0 {
		return time.Hour
	}
	return min(d, Retention)
}

// StepFor is the bucket width that fits a range into at most `points` buckets: whole seconds,
// never finer than the sampling interval. Zero points means no bucketing.
func StepFor(rng time.Duration, points int) time.Duration {
	if points <= 0 {
		return 0
	}
	step := (rng + time.Duration(points) - 1) / time.Duration(points)
	step = (step + time.Second - 1).Truncate(time.Second)
	return max(step, MinStep)
}
