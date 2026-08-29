package mc

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// JSON lists the vanilla server keeps next to server.properties.
type WhitelistEntry struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
}

type OpEntry struct {
	UUID                string `json:"uuid"`
	Name                string `json:"name"`
	Level               int    `json:"level"`
	BypassesPlayerLimit bool   `json:"bypassesPlayerLimit"`
}

type BanEntry struct {
	UUID    string `json:"uuid,omitempty"`
	IP      string `json:"ip,omitempty"`
	Name    string `json:"name,omitempty"`
	Created string `json:"created"`
	Source  string `json:"source"`
	Expires string `json:"expires"`
	Reason  string `json:"reason"`
}

type UserCacheEntry struct {
	Name      string `json:"name"`
	UUID      string `json:"uuid"`
	ExpiresOn string `json:"expiresOn"`
}

// File names of the server's JSON lists.
const (
	WhitelistFile     = "whitelist.json"
	OpsFile           = "ops.json"
	BannedPlayersFile = "banned-players.json"
	BannedIPsFile     = "banned-ips.json"
	UserCacheFile     = "usercache.json"
)

const banTimeLayout = "2006-01-02 15:04:05 -0700"

// ReadList loads one of the JSON lists (missing file = empty list).
func ReadList[T any](serverDir, file string) ([]T, error) {
	b, err := os.ReadFile(filepath.Join(serverDir, file))
	if err != nil {
		if os.IsNotExist(err) {
			return []T{}, nil
		}
		return nil, err
	}
	var out []T
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("%s: %w", file, err)
	}
	if out == nil {
		out = []T{}
	}
	return out, nil
}

// WriteList writes one of the JSON lists atomically.
func WriteList[T any](serverDir, file string, list []T) error {
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return WriteAtomic(filepath.Join(serverDir, file), append(b, '\n'))
}

// NewBan builds a ban entry the way the vanilla server writes them.
func NewBan(reason, source string) BanEntry {
	if reason == "" {
		reason = "Banned by an operator."
	}
	if source == "" {
		source = "wardend"
	}
	return BanEntry{Created: time.Now().Format(banTimeLayout), Source: source, Expires: "forever", Reason: reason}
}

// IsIP reports whether s is an IPv4/IPv6 address (bans accept either a player name or an IP).
func IsIP(s string) bool { return net.ParseIP(s) != nil }

// OfflineUUID is the UUID an offline-mode server assigns: UUIDv3 of "OfflinePlayer:<name>".
func OfflineUUID(name string) string {
	h := md5.Sum([]byte("OfflinePlayer:" + name))
	h[6] = (h[6] & 0x0f) | 0x30 // version 3
	h[8] = (h[8] & 0x3f) | 0x80 // IETF variant
	return formatUUID(h[:])
}

func formatUUID(b []byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// DashUUID inserts dashes into a 32-hex UUID (Mojang API format).
func DashUUID(s string) string {
	s = strings.ReplaceAll(s, "-", "")
	if len(s) != 32 {
		return s
	}
	return s[0:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
}
