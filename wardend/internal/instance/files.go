package instance

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/mc"
	"gopkg.in/yaml.v3"
)

// Editable configuration files. The panel never gets a general file browser: only paths that
// match this allowlist, always relative to the server directory, never following symlinks out.

// ConfigFile describes one editable file.
type ConfigFile struct {
	Path       string    `json:"path"` // slash-separated, relative to the server directory
	Group      string    `json:"group"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

var (
	ErrFileNotAllowed = errors.New("file is not editable through the panel")
	ErrFileTooLarge   = errors.New("file too large to edit")
	ErrInvalidSyntax  = errors.New("invalid syntax")
)

// MaxConfigBytes caps the size of a file the panel may edit.
const MaxConfigBytes = 2 << 20

// Files known at fixed paths, in display order.
var fixedConfigFiles = []struct{ path, group string }{
	{"bukkit.yml", "Server"},
	{"spigot.yml", "Server"},
	{"commands.yml", "Server"},
	{"help.yml", "Server"},
	{"permissions.yml", "Server"},
	{"config/paper-global.yml", "Paper"},
	{"config/paper-world-defaults.yml", "Paper"},
}

var editableExt = map[string]bool{".yml": true, ".yaml": true, ".json": true, ".properties": true, ".txt": true, ".toml": true, ".conf": true}

// Plugin data folders can be huge (map tiles, per-player files); the listing stays bounded.
const (
	pluginWalkDepth = 3
	maxPluginFiles  = 500
)

// configFileGroup is the allowlist: it maps a clean, slash-separated path relative to the server
// directory to its display group, or ok=false when the panel must not touch it. Both the listing
// and the read/write path go through here, so the policy cannot diverge.
func configFileGroup(rel string) (group string, ok bool) {
	if !editableExt[strings.ToLower(path.Ext(rel))] {
		return "", false
	}
	for _, f := range fixedConfigFiles {
		if f.path == rel {
			return f.group, true
		}
	}
	parts := strings.Split(rel, "/")
	for _, p := range parts {
		if p == "" || strings.HasPrefix(p, ".") {
			return "", false
		}
	}
	switch {
	case len(parts) == 2 && parts[1] == "paper-world.yml":
		return "Worlds", true
	case len(parts) >= 3 && len(parts) <= 1+pluginWalkDepth && parts[0] == "plugins":
		return "Plugins", true
	}
	return "", false
}

// ConfigFiles lists the editable files that exist: fixed server/Paper configs, per-world
// paper-world.yml files, and text files inside each plugin's data folder.
func (i *Instance) ConfigFiles() ([]ConfigFile, error) {
	var out []ConfigFile
	add := func(rel string) {
		group, ok := configFileGroup(rel)
		if !ok {
			return
		}
		info, err := os.Stat(filepath.Join(i.ServerDir(), filepath.FromSlash(rel)))
		if err != nil || info.IsDir() {
			return
		}
		out = append(out, ConfigFile{Path: rel, Group: group, Size: info.Size(), ModifiedAt: info.ModTime().UTC()})
	}
	for _, f := range fixedConfigFiles {
		add(f.path)
	}
	entries, err := os.ReadDir(i.ServerDir())
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() {
			add(e.Name() + "/paper-world.yml")
		}
	}
	pluginFiles := 0
	_ = filepath.WalkDir(i.pluginsDir(), func(p string, de os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(i.ServerDir(), p)
		rel = filepath.ToSlash(rel)
		if de.IsDir() {
			if strings.Count(rel, "/") >= pluginWalkDepth || strings.HasPrefix(de.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if pluginFiles >= maxPluginFiles {
			return filepath.SkipAll
		}
		if _, ok := configFileGroup(rel); ok {
			add(rel)
			pluginFiles++
		}
		return nil
	})
	sort.SliceStable(out, func(a, b int) bool { return out[a].Group == out[b].Group && out[a].Path < out[b].Path })
	if out == nil {
		out = []ConfigFile{}
	}
	return out, nil
}

// resolveConfigFile confines rel to the allowlist and returns its absolute path.
func (i *Instance) resolveConfigFile(rel string) (string, error) {
	rel = path.Clean("/" + strings.ReplaceAll(rel, "\\", "/"))[1:] // no "..", no absolute paths
	if _, ok := configFileGroup(rel); !ok {
		return "", ErrFileNotAllowed
	}
	// Follow symlinks and make sure the target is still inside the server directory.
	real, err := filepath.EvalSymlinks(filepath.Join(i.ServerDir(), filepath.FromSlash(rel)))
	if err != nil {
		if os.IsNotExist(err) {
			return "", os.ErrNotExist
		}
		return "", err
	}
	root, err := i.realServerDir()
	if err != nil {
		return "", err
	}
	if real != root && !strings.HasPrefix(real, root+string(filepath.Separator)) {
		return "", ErrFileNotAllowed
	}
	return real, nil
}

// realServerDir is ServerDir with symlinks resolved; fixed for the instance's lifetime.
func (i *Instance) realServerDir() (string, error) {
	i.rootOnce.Do(func() { i.rootReal, i.rootErr = filepath.EvalSymlinks(i.ServerDir()) })
	return i.rootReal, i.rootErr
}

// ReadConfigFile returns the file's text.
func (i *Instance) ReadConfigFile(rel string) (string, error) {
	abs, err := i.resolveConfigFile(rel)
	if err != nil {
		return "", err
	}
	f, err := os.Open(abs)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if info, err := f.Stat(); err != nil {
		return "", err
	} else if info.Size() > MaxConfigBytes {
		return "", ErrFileTooLarge
	}
	b, err := io.ReadAll(f)
	return string(b), err
}

// WriteConfigFile validates the syntax for the file type and writes it atomically. restart is
// true when the server is running: Paper reads these files at startup only.
func (i *Instance) WriteConfigFile(rel, content string) (restart bool, err error) {
	abs, err := i.resolveConfigFile(rel)
	if err != nil {
		return false, err
	}
	if int64(len(content)) > MaxConfigBytes {
		return false, ErrFileTooLarge
	}
	if err := validateSyntax(rel, content); err != nil {
		return false, fmt.Errorf("%w: %v", ErrInvalidSyntax, err)
	}
	if err := mc.WriteAtomic(abs, []byte(content)); err != nil {
		return false, err
	}
	return i.running(), nil
}

func validateSyntax(rel, content string) error {
	var v any
	switch strings.ToLower(path.Ext(rel)) {
	case ".yml", ".yaml":
		return yaml.Unmarshal([]byte(content), &v)
	case ".json":
		if strings.TrimSpace(content) == "" {
			return nil
		}
		return json.Unmarshal([]byte(content), &v)
	}
	return nil
}
