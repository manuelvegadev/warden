package instance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/mc"
)

// worldDir is the main world folder from server.properties (level-name, default "world").
func (i *Instance) worldDir() string {
	name := "world"
	if p, err := mc.ReadProperties(i.propertiesPath()); err == nil && p["level-name"] != "" {
		name = p["level-name"]
	}
	return filepath.Join(i.ServerDir(), filepath.Base(name))
}

// KnownPlayer is a player the world has data for (a stats file), even if this daemon never saw
// them join — e.g. servers migrated into wardend.
type KnownPlayer struct {
	Name            string
	PlayTimeSeconds int64
	LastSeen        time.Time // stats file mtime: the server rewrites it on save
}

type statsEntry struct {
	size     int64
	mtime    time.Time
	playTime int64
}

// KnownPlayers lists players from <world>/stats, named through usercache.json. Stats files are
// only re-parsed when their size or mtime changed.
func (i *Instance) KnownPlayers() []KnownPlayer {
	statsDir := filepath.Join(i.worldDir(), "stats")
	entries, err := os.ReadDir(statsDir)
	if err != nil {
		return nil
	}
	names := map[string]string{}
	if cache, err := mc.ReadList[mc.UserCacheEntry](i.ServerDir(), mc.UserCacheFile); err == nil {
		for _, e := range cache {
			names[strings.ToLower(e.UUID)] = e.Name
		}
	}
	var out []KnownPlayer
	for _, e := range entries {
		uuid := strings.TrimSuffix(e.Name(), ".json")
		name, ok := names[strings.ToLower(uuid)]
		if e.IsDir() || uuid == e.Name() || !ok {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(statsDir, e.Name())
		i.mu.RLock()
		c, hit := i.statsCache[path]
		i.mu.RUnlock()
		if !hit || c.size != info.Size() || !c.mtime.Equal(info.ModTime()) {
			st, err := mc.ReadStats(path)
			if err != nil {
				continue
			}
			c = statsEntry{size: info.Size(), mtime: info.ModTime(), playTime: st.Custom("play_time") / 20}
			i.mu.Lock()
			if i.statsCache == nil {
				i.statsCache = map[string]statsEntry{}
			}
			i.statsCache[path] = c
			i.mu.Unlock()
		}
		out = append(out, KnownPlayer{Name: name, PlayTimeSeconds: c.playTime, LastSeen: info.ModTime().UTC()})
	}
	return out
}

// PlayerStats is the panel's view of a player's statistics file.
type PlayerStats struct {
	DataVersion     int                     `json:"dataVersion"`
	PlayTimeSeconds int64                   `json:"playTimeSeconds"`
	Deaths          int64                   `json:"deaths"`
	PlayerKills     int64                   `json:"playerKills"`
	MobKills        int64                   `json:"mobKills"`
	DamageDealt     float64                 `json:"damageDealt"` // hearts (stat is in tenths)
	DamageTaken     float64                 `json:"damageTaken"`
	Jumps           int64                   `json:"jumps"`
	DistanceMeters  float64                 `json:"distanceMeters"` // all *_one_cm movement stats
	BlocksMined     int64                   `json:"blocksMined"`
	ItemsCrafted    int64                   `json:"itemsCrafted"`
	Top             map[string][]mc.Counter `json:"top"` // mined, killed, crafted, used, broken, picked_up
}

// PlayerStats reads <world>/stats/<uuid>.json for a player name.
func (i *Instance) PlayerStats(ctx context.Context, name string) (PlayerStats, error) {
	uuid, err := i.ResolveUUID(ctx, name)
	if err != nil {
		return PlayerStats{}, err
	}
	s, err := mc.ReadStats(filepath.Join(i.worldDir(), "stats", uuid+".json"))
	if err != nil {
		return PlayerStats{}, err
	}
	var distanceCm int64
	for k, v := range s.Categories["minecraft:custom"] {
		if strings.HasSuffix(k, "_one_cm") {
			distanceCm += v
		}
	}
	out := PlayerStats{
		DataVersion:     s.DataVersion,
		PlayTimeSeconds: s.Custom("play_time") / 20,
		Deaths:          s.Custom("deaths"),
		PlayerKills:     s.Custom("player_kills"),
		MobKills:        s.Custom("mob_kills"),
		DamageDealt:     float64(s.Custom("damage_dealt")) / 20, // tenths of a heart → hearts
		DamageTaken:     float64(s.Custom("damage_taken")) / 20,
		Jumps:           s.Custom("jump"),
		DistanceMeters:  float64(distanceCm) / 100,
		BlocksMined:     s.Total("mined"),
		ItemsCrafted:    s.Total("crafted"),
		Top:             map[string][]mc.Counter{},
	}
	for _, cat := range []string{"mined", "killed", "crafted", "used", "broken", "picked_up", "killed_by"} {
		out.Top[cat] = s.Top(cat, 10)
	}
	return out, nil
}

// PlayerAdvancements reads <world>/advancements/<uuid>.json for a player name.
func (i *Instance) PlayerAdvancements(ctx context.Context, name string) ([]mc.Advancement, error) {
	uuid, err := i.ResolveUUID(ctx, name)
	if err != nil {
		return nil, err
	}
	return mc.ReadAdvancements(filepath.Join(i.worldDir(), "advancements", uuid+".json"))
}

// ErrUnknownPlayerAction is returned for actions the panel does not expose.
var ErrUnknownPlayerAction = errors.New("unknown player action")

// PlayerAction runs a transient moderation command through the console: message (tell) or
// kick. Op/ban go through the list endpoints, which also work while the server is stopped.
func (i *Instance) PlayerAction(name, action, text string) error {
	if !nameRe.MatchString(name) {
		return ErrBadName
	}
	text = strings.TrimSpace(strings.ReplaceAll(text, "\n", " "))
	var cmd string
	switch action {
	case "message":
		if text == "" {
			return fmt.Errorf("message text is required")
		}
		cmd = "tell " + name + " " + text
	case "kick":
		cmd = "kick " + name
		if text != "" {
			cmd += " " + text
		}
	default:
		return ErrUnknownPlayerAction
	}
	return i.SendCommand(cmd)
}
