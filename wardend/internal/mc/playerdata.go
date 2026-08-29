package mc

import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"time"
)

// Player statistics and advancements as written by the server under <world>/stats and
// <world>/advancements (see docs/minecraft-admin.md). Both are keyed by player UUID.

// Stats is the parsed <world>/stats/<uuid>.json: category → key → count.
type Stats struct {
	DataVersion int                         `json:"dataVersion"`
	Categories  map[string]map[string]int64 `json:"categories"`
}

// ReadStats parses a stats file. A missing file yields empty stats, not an error.
func ReadStats(path string) (Stats, error) {
	out := Stats{Categories: map[string]map[string]int64{}}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return out, err
	}
	var raw struct {
		Stats       map[string]map[string]int64 `json:"stats"`
		DataVersion int                         `json:"DataVersion"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return out, err
	}
	out.DataVersion = raw.DataVersion
	if raw.Stats != nil {
		out.Categories = raw.Stats
	}
	return out, nil
}

// Custom returns a value from the minecraft:custom category (play time, deaths, …).
func (s Stats) Custom(key string) int64 { return s.Categories["minecraft:custom"]["minecraft:"+key] }

// Total sums every entry of a category (e.g. blocks mined across all block types).
func (s Stats) Total(category string) int64 {
	var n int64
	for _, v := range s.Categories["minecraft:"+category] {
		n += v
	}
	return n
}

// Counter is one entry of a category, sorted by count.
type Counter struct {
	ID    string `json:"id"`
	Count int64  `json:"count"`
}

// Top returns the n largest entries of a category.
func (s Stats) Top(category string, n int) []Counter {
	items := make([]Counter, 0, len(s.Categories["minecraft:"+category]))
	for k, v := range s.Categories["minecraft:"+category] {
		items = append(items, Counter{ID: k, Count: v})
	}
	sort.Slice(items, func(a, b int) bool {
		if items[a].Count != items[b].Count {
			return items[a].Count > items[b].Count
		}
		return items[a].ID < items[b].ID
	})
	if len(items) > n {
		items = items[:n]
	}
	return items
}

// Advancement is one entry of <world>/advancements/<uuid>.json.
type Advancement struct {
	ID       string    `json:"id"` // e.g. minecraft:story/mine_stone
	Done     bool      `json:"done"`
	Criteria int       `json:"criteria"`    // criteria completed so far
	At       time.Time `json:"at,omitzero"` // completion of the latest criterion
}

const advancementTime = "2006-01-02 15:04:05 -0700"

// ReadAdvancements parses an advancements file, newest completion first. Recipe unlocks
// (minecraft:recipes/…) are omitted: they are bookkeeping, not achievements.
func ReadAdvancements(path string) ([]Advancement, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []Advancement{}, nil
		}
		return nil, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	out := []Advancement{}
	for id, msg := range raw {
		if !strings.Contains(id, ":") || strings.HasPrefix(id, "minecraft:recipes/") {
			continue // DataVersion and recipe unlocks
		}
		var entry struct {
			Criteria map[string]string `json:"criteria"`
			Done     bool              `json:"done"`
		}
		if err := json.Unmarshal(msg, &entry); err != nil {
			continue
		}
		a := Advancement{ID: id, Done: entry.Done}
		for _, ts := range entry.Criteria {
			if t, err := time.Parse(advancementTime, ts); err == nil && t.After(a.At) {
				a.At = t
			}
		}
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Done != out[j].Done {
			return out[i].Done
		}
		if !out[i].At.Equal(out[j].At) {
			return out[i].At.After(out[j].At)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}
