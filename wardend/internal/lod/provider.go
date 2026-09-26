package lod

import (
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Kind names a plugin family.
type Kind string

const (
	DHS Kind = "dhs" // Distant Horizons Support
	LSS Kind = "lss" // Voxy Server Side / LOD Server Support: one plugin under two names
)

// Project is where the panel installs a brand from (the plugins endpoint takes it as it is).
type Project struct {
	Source string `json:"source"`
	ID     string `json:"id"`
}

// Brand is one name a family ships under: the plugin's descriptor name, its command, its folder
// under plugins/ and its configuration file there.
type Brand struct {
	Plugin  string  `json:"plugin"`
	Title   string  `json:"title"`
	Command string  `json:"command"`
	Folder  string  `json:"folder"`
	Config  string  `json:"config"`
	DataDir string  `json:"-"` // the store's directory inside each world (LSS)
	Project Project `json:"project"`
}

// Compat says which client mods can connect to a plugin version.
type Compat struct {
	Clients  string `json:"clients,omitempty"`
	Verified bool   `json:"verified"`
	Warning  string `json:"warning,omitempty"`
	Link     string `json:"link"`
}

// Store is one LOD database: the SQLite file a backup snapshot copies, and the paths a backup
// leaves out for it. Paths are relative to the server directory, slash-separated.
type Store struct {
	DB    string   `json:"db"`
	Paths []string `json:"paths"`
}

// Usage is the size of one store path on disk.
type Usage struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
}

// Provider is one family: what players install, its brands (the first is what the panel installs),
// whether it pre-generates, and the settings the panel edits.
type Provider struct {
	Kind   Kind    `json:"kind"`
	Title  string  `json:"title"`
	Client string  `json:"client"`
	Pregen bool    `json:"pregen"`
	Brands []Brand `json:"brands"`
	Keys   []Key   `json:"-"`
	Format string  `json:"-"` // yaml | json
}

var dhsProvider = &Provider{
	Kind: DHS, Title: "Distant Horizons", Client: "Distant Horizons", Pregen: true, Format: "yaml",
	Brands: []Brand{{
		Plugin: "DHSupport", Title: "Distant Horizons Support", Command: "dhs", Folder: "DHSupport",
		Config: "config.yml", Project: Project{"modrinth", "distant-horizons-support"},
	}},
	Keys: dhsKeys,
}

var lssProvider = &Provider{
	Kind: LSS, Title: "Voxy", Client: "Voxy with the Voxy Server Side (or LOD Server Support) client mod", Format: "json",
	Brands: []Brand{
		{Plugin: "VoxyServerSide", Title: "Voxy Server Side", Command: "vsslod", Folder: "VoxyServerSide",
			Config: "vss-server-config.json", DataDir: "vss-lod", Project: Project{"modrinth", "voxy-server-side"}},
		{Plugin: "LodServerSupport", Title: "LOD Server Support", Command: "lsslod", Folder: "LodServerSupport",
			Config: "lss-server-config.json", DataDir: "lss-lod", Project: Project{"modrinth", "lod-server-support"}},
	},
	Keys: lssKeys,
}

// Providers are the families the panel knows, in the order it shows them.
func Providers() []*Provider { return []*Provider{dhsProvider, lssProvider} }

// ByKind finds a family.
func ByKind(k Kind) (*Provider, bool) {
	for _, p := range Providers() {
		if p.Kind == k {
			return p, true
		}
	}
	return nil, false
}

// Jar is one installed plugin jar, as detection needs it.
type Jar struct {
	FileName string
	Name     string // the descriptor's name
	Version  string
	Enabled  bool
}

// Installed is a LOD plugin found among the jars.
type Installed struct {
	Provider *Provider
	Brand    Brand
	FileName string
	Version  string
	Enabled  bool
}

// Detect finds the LOD plugins among the installed jars, by descriptor name, in provider order.
// The first jar of a family wins; a second brand of the same family is ignored.
func Detect(jars []Jar) []Installed {
	var out []Installed
	for _, p := range Providers() {
	brands:
		for _, b := range p.Brands {
			for _, j := range jars {
				if strings.EqualFold(j.Name, b.Plugin) {
					out = append(out, Installed{Provider: p, Brand: b, FileName: j.FileName, Version: j.Version, Enabled: j.Enabled})
					break brands
				}
			}
		}
	}
	return out
}

// Compat reads our table (ADR-025; update it with Warden releases). A version it does not know is
// "not verified", with the plugin's page to check.
func (p *Provider) Compat(version string) Compat {
	major, minor, ok := majorMinor(version)
	switch p.Kind {
	case DHS:
		c := Compat{Link: "https://modrinth.com/plugin/distant-horizons-support"}
		switch {
		case ok && major == 0 && minor == 14:
			c.Clients, c.Verified = "Distant Horizons 3.1.x – 3.2.0", true
			c.Warning = "Distant Horizons 3.3 clients cannot connect until Distant Horizons Support supports network protocol 16."
		case ok && major == 0 && minor == 13:
			c.Clients, c.Verified = "Distant Horizons 3.0.x", true
		case ok && major == 0 && minor == 12:
			c.Clients, c.Verified = "Distant Horizons 2.4.x", true
		}
		return c
	default:
		c := Compat{Link: "https://modrinth.com/plugin/voxy-server-side"}
		if ok && (major > 0 || minor >= 4) {
			c.Clients, c.Verified = "Voxy with the Voxy Server Side or LOD Server Support client mod, 0.4 or newer", true
		}
		return c
	}
}

func majorMinor(v string) (int, int, bool) {
	parts := strings.SplitN(strings.TrimPrefix(v, "v"), ".", 3)
	if len(parts) < 2 {
		return 0, 0, false
	}
	major, err1 := strconv.Atoi(parts[0])
	minor, err2 := strconv.Atoi(strings.TrimRightFunc(parts[1], func(r rune) bool { return r < '0' || r > '9' }))
	return major, minor, err1 == nil && err2 == nil
}

// ConfigPath is the brand's configuration file, relative to the server directory.
func (p *Provider) ConfigPath(b Brand) string { return "plugins/" + b.Folder + "/" + b.Config }

// Stores are the brand's LOD databases for these worlds. DHS keeps one database for every world
// (at its default `database_path`); VSS/LSS one per world.
func (p *Provider) Stores(b Brand, worlds []string) []Store {
	if p.Kind == DHS {
		db := "plugins/" + b.Folder + "/data.sqlite"
		return []Store{{DB: db, Paths: []string{db, db + "-journal", db + "-wal", db + "-shm"}}}
	}
	out := make([]Store, 0, len(worlds))
	for _, w := range worlds {
		dir := w + "/" + b.DataDir
		out = append(out, Store{DB: dir + "/store.db", Paths: []string{dir}})
	}
	return out
}

// DiskUse sizes each store path that exists (directories in full).
func DiskUse(serverDir string, stores []Store) []Usage {
	var out []Usage
	for _, s := range stores {
		for _, rel := range s.Paths {
			var n int64
			found := false
			_ = filepath.WalkDir(filepath.Join(serverDir, filepath.FromSlash(rel)), func(_ string, d fs.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				found = true
				if info, err := d.Info(); err == nil && d.Type().IsRegular() {
					n += info.Size()
				}
				return nil
			})
			if found {
				out = append(out, Usage{Path: rel, Bytes: n})
			}
		}
	}
	return out
}

// DeleteData removes every store path. The caller makes sure the server is stopped.
func DeleteData(serverDir string, stores []Store) error {
	for _, s := range stores {
		for _, rel := range s.Paths {
			if err := os.RemoveAll(filepath.Join(serverDir, filepath.FromSlash(rel))); err != nil {
				return err
			}
		}
	}
	return nil
}
