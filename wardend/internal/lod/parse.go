// Package lod manages the server-side plugins that let players see far terrain (ADR-025):
// Distant Horizons Support and Voxy Server Side / LOD Server Support. It knows them only through
// their public surface — the commands they answer (run through the Warden Agent) and their files.
package lod

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// PregenStatus is Distant Horizons Support's answer to `dhs pregen status <world>`.
type PregenStatus struct {
	State     string   `json:"state"`    // running | done | none | unknown
	Progress  float64  `json:"progress"` // percent, 0–100
	Done      int64    `json:"done"`
	Target    int64    `json:"target"`
	CPS       float64  `json:"cps"`
	Elapsed   string   `json:"elapsed,omitempty"`
	Remaining string   `json:"remaining,omitempty"`
	Raw       []string `json:"raw,omitempty"` // the reply, when it was not recognised
}

var (
	colorRe     = regexp.MustCompile(`§.`)
	progressRe  = regexp.MustCompile(`^Generation progress: ([\d.,]+)%$`)
	processedRe = regexp.MustCompile(`^Processed LODs: (\d+) / (\d+) \(([^ ]+) CPS\)$`)
	elapsedRe   = regexp.MustCompile(`^Time elapsed: (.+)$`)
	remainingRe = regexp.MustCompile(`^Time remaining: (.+)$`)
	noneRe      = regexp.MustCompile(`^No pre-generator running in world .+\.$`)
)

// clean drops colour codes and outer spaces, as the agent already does; kept for replies that
// reach the parser another way.
func clean(s string) string { return strings.TrimSpace(colorRe.ReplaceAllString(s, "")) }

// number reads DHS's `%.2f`, which follows the server's locale: "12.34" or "12,34". NaN and the
// infinities (a pre-generation that has barely started) read as 0.
func number(s string) float64 {
	v, err := strconv.ParseFloat(strings.Replace(s, ",", ".", 1), 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// ParsePregenStatus reads the lines of `dhs pregen status` (DHS 0.14.0's DhsCommand#pregenStatus).
// A reply it does not recognise is `unknown` with the raw lines, never an error.
func ParsePregenStatus(lines []string) PregenStatus {
	var s PregenStatus
	recognised := false
	for _, raw := range lines {
		l := clean(raw)
		if noneRe.MatchString(l) {
			return PregenStatus{State: "none"}
		}
		if l == "Generation is complete." {
			s.State, recognised = "done", true
		} else if m := progressRe.FindStringSubmatch(l); m != nil {
			s.Progress, recognised = number(m[1]), true
		} else if m := processedRe.FindStringSubmatch(l); m != nil {
			s.Done, _ = strconv.ParseInt(m[1], 10, 64)
			s.Target, _ = strconv.ParseInt(m[2], 10, 64)
			s.CPS, recognised = number(m[3]), true
		} else if m := elapsedRe.FindStringSubmatch(l); m != nil {
			s.Elapsed, recognised = m[1], true
		} else if m := remainingRe.FindStringSubmatch(l); m != nil {
			s.Remaining, recognised = m[1], true
		}
	}
	if !recognised {
		return PregenStatus{State: "unknown", Raw: lines}
	}
	if s.State == "" {
		s.State = "running"
	}
	return s
}

// PregenStarted reads the reply to `dhs pregen start`: nil when DHS started it, otherwise an error
// carrying what DHS said ("Unknown world.", "No radius specified.", …).
func PregenStarted(lines []string) error {
	var said []string
	for _, raw := range lines {
		l := clean(raw)
		if strings.HasPrefix(l, "Generating LODs for") {
			return nil
		}
		if l != "" {
			said = append(said, l)
		}
	}
	if len(said) == 0 {
		return errors.New("Distant Horizons Support did not answer")
	}
	return errors.New(strings.Join(said, " "))
}

// StoreStatus is the `LOD store: …` line of `vsslod store status` (or lsslod), "" when absent.
func StoreStatus(lines []string) string {
	for _, raw := range lines {
		if l := clean(raw); strings.HasPrefix(l, "LOD store:") {
			return l
		}
	}
	return ""
}

// WorldArg is a world name as DHS's commands take it: spaces become underscores.
func WorldArg(name string) string { return strings.ReplaceAll(name, " ", "_") }
