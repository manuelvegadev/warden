package instance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/mc"
	"github.com/manuelvega/warden/wardend/internal/mojang"
)

var nameRe = regexp.MustCompile(`^[A-Za-z0-9_]{1,16}$`)

var ErrBadName = errors.New("invalid player name")
var ErrBadIP = errors.New("invalid ip address")

// Outbound Mojang lookups go through one shared client, set by main.
var mojangClient = mojang.New("warden")

func SetMojang(c *mojang.Client) { mojangClient = c }

const uuidCacheTTL = time.Hour

func (i *Instance) propertiesPath() string { return filepath.Join(i.ServerDir(), "server.properties") }

func (i *Instance) onlineMode() bool {
	p, _ := mc.ReadProperties(i.propertiesPath())
	return p["online-mode"] != "false"
}

// running reports whether the server process accepts commands right now.
func (i *Instance) running() bool { return i.State() == StateRunning }

// ResolveUUID finds a player's UUID: offline UUID when online-mode=false, else usercache.json,
// else Mojang (cached for an hour so a player card does not hit Mojang twice).
func (i *Instance) ResolveUUID(ctx context.Context, name string) (string, error) {
	if !nameRe.MatchString(name) {
		return "", ErrBadName
	}
	if !i.onlineMode() {
		return mc.OfflineUUID(name), nil
	}
	if cache, err := mc.ReadList[mc.UserCacheEntry](i.ServerDir(), mc.UserCacheFile); err == nil {
		for _, e := range cache {
			if strings.EqualFold(e.Name, name) {
				return e.UUID, nil
			}
		}
	}
	key := strings.ToLower(name)
	i.mu.RLock()
	c, ok := i.uuidCache[key]
	i.mu.RUnlock()
	if ok && time.Since(c.at) < uuidCacheTTL {
		return c.uuid, nil
	}
	id, err := mojangClient.ProfileID(ctx, name)
	if errors.Is(err, mojang.ErrNotFound) {
		return "", fmt.Errorf("player %q not found on Mojang", name)
	}
	if err != nil {
		return "", err
	}
	uuid := mc.DashUUID(id)
	i.mu.Lock()
	if i.uuidCache == nil {
		i.uuidCache = map[string]uuidEntry{}
	}
	i.uuidCache[key] = uuidEntry{uuid: uuid, at: time.Now()}
	i.mu.Unlock()
	return uuid, nil
}

type uuidEntry struct {
	uuid string
	at   time.Time
}

// ---- server.properties

func (i *Instance) Properties() ([]mc.Property, error) { return mc.ListProperties(i.propertiesPath()) }

func (i *Instance) PropertiesRaw() (string, error) {
	b, err := os.ReadFile(i.propertiesPath())
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	return string(b), nil
}

// UpdateProperties validates and writes the given keys. Keys with a live command are applied to a
// running server immediately; the rest report restart=true while the server runs.
func (i *Instance) UpdateProperties(updates map[string]string) (restart bool, err error) {
	for k, v := range updates {
		if err := mc.ValidateProperty(k, v); err != nil {
			return false, err
		}
	}
	if err := mc.WriteProperties(i.propertiesPath(), updates); err != nil {
		return false, err
	}
	if !i.running() {
		return false, nil
	}
	i.snapshotProperties()
	for k, v := range updates {
		if spec := mc.SpecFor(k); spec != nil && spec.LiveCommand != nil {
			_ = i.SendCommand(spec.LiveCommand(v))
			continue
		}
		if mc.RequiresRestart(k) {
			restart = true
		}
	}
	return restart, nil
}

// UpdatePropertiesRaw replaces the whole file after validating it against the schema.
func (i *Instance) UpdatePropertiesRaw(text string) (restart bool, err error) {
	if err := mc.ValidateRaw(text); err != nil {
		return false, err
	}
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	if err := mc.WriteAtomic(i.propertiesPath(), []byte(text)); err != nil {
		return false, err
	}
	if !i.running() {
		return false, nil
	}
	i.snapshotProperties()
	return true, nil
}

// snapshotProperties records the on-disk file so wait() can restore it after the server rewrites
// server.properties from memory on shutdown. Called after every write made while running.
func (i *Instance) snapshotProperties() {
	b, err := os.ReadFile(i.propertiesPath())
	if err != nil {
		return
	}
	i.mu.Lock()
	i.pendingProperties = b
	i.mu.Unlock()
}

// ---- access lists: live command when running, JSON edit when stopped

// mutate runs liveCmd on a running server, otherwise applies fileOp to the JSON lists.
func (i *Instance) mutate(liveCmd string, fileOp func() error) error {
	if i.running() {
		return i.SendCommand(liveCmd)
	}
	return fileOp()
}

func byName[T any](name string, nameOf func(T) string) func(T) bool {
	return func(e T) bool { return strings.EqualFold(nameOf(e), name) }
}

// addEntry appends make() to the list unless match already finds an entry.
func addEntry[T any](dir, file string, match func(T) bool, make func() (T, error)) error {
	list, err := mc.ReadList[T](dir, file)
	if err != nil {
		return err
	}
	if slices.ContainsFunc(list, match) {
		return nil
	}
	e, err := make()
	if err != nil {
		return err
	}
	return mc.WriteList(dir, file, append(list, e))
}

func removeEntry[T any](dir, file string, match func(T) bool) error {
	list, err := mc.ReadList[T](dir, file)
	if err != nil {
		return err
	}
	return mc.WriteList(dir, file, slices.DeleteFunc(list, match))
}

func checkName(name string) error {
	if !nameRe.MatchString(name) {
		return ErrBadName
	}
	return nil
}

func (i *Instance) Whitelist() ([]mc.WhitelistEntry, error) {
	return mc.ReadList[mc.WhitelistEntry](i.ServerDir(), mc.WhitelistFile)
}

func (i *Instance) WhitelistAdd(ctx context.Context, name string) error {
	if err := checkName(name); err != nil {
		return err
	}
	return i.mutate("whitelist add "+name, func() error {
		return addEntry(i.ServerDir(), mc.WhitelistFile, byName(name, func(e mc.WhitelistEntry) string { return e.Name }), func() (mc.WhitelistEntry, error) {
			uuid, err := i.ResolveUUID(ctx, name)
			return mc.WhitelistEntry{UUID: uuid, Name: name}, err
		})
	})
}

func (i *Instance) WhitelistRemove(name string) error {
	if err := checkName(name); err != nil {
		return err
	}
	return i.mutate("whitelist remove "+name, func() error {
		return removeEntry(i.ServerDir(), mc.WhitelistFile, byName(name, func(e mc.WhitelistEntry) string { return e.Name }))
	})
}

func (i *Instance) Ops() ([]mc.OpEntry, error) {
	return mc.ReadList[mc.OpEntry](i.ServerDir(), mc.OpsFile)
}

// OpAdd grants op. Per-player levels are only honoured while stopped: `/op` always uses op-permission-level.
func (i *Instance) OpAdd(ctx context.Context, name string, level int) error {
	if err := checkName(name); err != nil {
		return err
	}
	if level < 1 || level > 4 {
		level = 4
	}
	return i.mutate("op "+name, func() error {
		list, err := mc.ReadList[mc.OpEntry](i.ServerDir(), mc.OpsFile)
		if err != nil {
			return err
		}
		if k := slices.IndexFunc(list, byName(name, func(e mc.OpEntry) string { return e.Name })); k >= 0 {
			list[k].Level = level
			return mc.WriteList(i.ServerDir(), mc.OpsFile, list)
		}
		uuid, err := i.ResolveUUID(ctx, name)
		if err != nil {
			return err
		}
		return mc.WriteList(i.ServerDir(), mc.OpsFile, append(list, mc.OpEntry{UUID: uuid, Name: name, Level: level}))
	})
}

func (i *Instance) OpRemove(name string) error {
	if err := checkName(name); err != nil {
		return err
	}
	return i.mutate("deop "+name, func() error {
		return removeEntry(i.ServerDir(), mc.OpsFile, byName(name, func(e mc.OpEntry) string { return e.Name }))
	})
}

type Bans struct {
	Players []mc.BanEntry `json:"players"`
	IPs     []mc.BanEntry `json:"ips"`
}

func (i *Instance) Bans() (Bans, error) {
	p, err := mc.ReadList[mc.BanEntry](i.ServerDir(), mc.BannedPlayersFile)
	if err != nil {
		return Bans{}, err
	}
	ips, err := mc.ReadList[mc.BanEntry](i.ServerDir(), mc.BannedIPsFile)
	if err != nil {
		return Bans{}, err
	}
	return Bans{Players: p, IPs: ips}, nil
}

// Ban bans a player name or an IP address (detected with mc.IsIP).
func (i *Instance) Ban(ctx context.Context, target, reason, source string) error {
	if mc.IsIP(target) {
		return i.mutate(strings.TrimSpace("ban-ip "+target+" "+reason), func() error {
			return addEntry(i.ServerDir(), mc.BannedIPsFile, func(e mc.BanEntry) bool { return e.IP == target }, func() (mc.BanEntry, error) {
				b := mc.NewBan(reason, source)
				b.IP = target
				return b, nil
			})
		})
	}
	if err := checkName(target); err != nil {
		return err
	}
	return i.mutate(strings.TrimSpace("ban "+target+" "+reason), func() error {
		return addEntry(i.ServerDir(), mc.BannedPlayersFile, byName(target, func(e mc.BanEntry) string { return e.Name }), func() (mc.BanEntry, error) {
			uuid, err := i.ResolveUUID(ctx, target)
			b := mc.NewBan(reason, source)
			b.UUID, b.Name = uuid, target
			return b, err
		})
	})
}

// Pardon lifts a player or IP ban.
func (i *Instance) Pardon(target string) error {
	if mc.IsIP(target) {
		return i.mutate("pardon-ip "+target, func() error {
			return removeEntry(i.ServerDir(), mc.BannedIPsFile, func(e mc.BanEntry) bool { return e.IP == target })
		})
	}
	if err := checkName(target); err != nil {
		return err
	}
	return i.mutate("pardon "+target, func() error {
		return removeEntry(i.ServerDir(), mc.BannedPlayersFile, byName(target, func(e mc.BanEntry) string { return e.Name }))
	})
}
