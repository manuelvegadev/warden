package instance

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/agent"
	"github.com/manuelvega/warden/wardend/internal/mc"
)

// The file manager (ADR-020): the whole server directory, browsed and edited by a manager. Every
// path the panel sends is relative to server/, cleaned so it cannot climb out, and resolved through
// symlinks to make sure it still lands inside the directory. The server jar and the Warden Agent
// are wardend's to manage (upgrades, the live view), so the manager may look at them but not touch
// them. instance.json and the backups live one level up, out of reach by construction.

// Entry is one row of a directory listing.
type Entry struct {
	Name       string    `json:"name"`
	Dir        bool      `json:"dir"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modifiedAt"`
	// Symlink marks an entry that is a link; Dir and Size describe its target when it resolves.
	Symlink bool `json:"symlink,omitempty"`
	// Protected marks a file the daemon keeps read-only (the server jar, the Warden Agent).
	Protected bool `json:"protected,omitempty"`
}

// Listing is a directory's contents: directories first, then files, both by name.
type Listing struct {
	// Path is the cleaned, slash-separated directory relative to server/; "" is the root.
	Path    string  `json:"path"`
	Entries []Entry `json:"entries"`
}

var (
	ErrNotDir      = errors.New("not a directory")
	ErrIsDir       = errors.New("is a directory")
	ErrFileExists  = errors.New("already exists")
	ErrBadFileName = errors.New("invalid name")
	ErrProtected   = errors.New("the server jar and the Warden Agent are managed by wardend")
	ErrRootPath    = errors.New("the server directory itself cannot be renamed or removed")
)

// MaxEditBytes caps the size of a file the panel may write; bigger ones travel as uploads.
const MaxEditBytes = MaxConfigBytes

// MaxUploadBytes caps a single upload request (a world archive is a plausible upload).
const MaxUploadBytes = 4 << 30

// cleanRel normalises a panel path: slashes only, no "..", no leading slash; "" is the root.
func cleanRel(rel string) string {
	rel = path.Clean("/" + strings.ReplaceAll(rel, "\\", "/"))
	return strings.TrimPrefix(rel, "/")
}

// validName is a single path component the panel may create.
func validName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\\x00")
}

// inside reports whether abs (symlinks already resolved) is the server directory or below it.
func (i *Instance) inside(abs string) (bool, error) {
	root, err := i.realServerDir()
	if err != nil {
		return false, err
	}
	return abs == root || strings.HasPrefix(abs, root+string(filepath.Separator)), nil
}

// resolveExisting confines rel to the server directory, following symlinks, and returns its real
// absolute path. A missing target is os.ErrNotExist; one that escapes is ErrFileNotAllowed.
func (i *Instance) resolveExisting(rel string) (string, error) {
	real, err := filepath.EvalSymlinks(filepath.Join(i.ServerDir(), filepath.FromSlash(rel)))
	if err != nil {
		if os.IsNotExist(err) {
			return "", os.ErrNotExist
		}
		return "", err
	}
	ok, err := i.inside(real)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrFileNotAllowed
	}
	return real, nil
}

// resolveEntry confines rel without following the last component: the parent is resolved through
// symlinks and checked, the entry itself is only joined. This is the path to rename or remove, so
// a link inside the server directory is renamed or removed as a link, never through to its target.
func (i *Instance) resolveEntry(rel string) (abs string, err error) {
	if rel == "" {
		return "", ErrRootPath
	}
	dir, name := path.Split(rel)
	if !validName(name) {
		return "", ErrBadFileName
	}
	parent, err := i.resolveDir(strings.TrimSuffix(dir, "/"))
	if err != nil {
		return "", err
	}
	return filepath.Join(parent, name), nil
}

// resolveDir is resolveExisting for a path that must be a directory.
func (i *Instance) resolveDir(rel string) (string, error) {
	abs, err := i.resolveExisting(rel)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(abs); err != nil {
		return "", err
	} else if !info.IsDir() {
		return "", ErrNotDir
	}
	return abs, nil
}

// lstat reports whether the entry itself (a link included) is there, hiding the on-disk path.
func lstat(abs string) error {
	if _, err := os.Lstat(abs); err != nil {
		if os.IsNotExist(err) {
			return os.ErrNotExist
		}
		return err
	}
	return nil
}

// protected names the files the panel may read but not change.
func (i *Instance) protected(rel string) bool {
	if i.Manifest != nil && i.Manifest.Jar != "" && rel == i.Manifest.Jar {
		return true
	}
	return rel == "plugins/"+agent.FileName
}

// ListDir lists the directory at rel ("" for the server root). Hidden entries are included: a
// manager browsing the server wants to see .paper and .console_history.
func (i *Instance) ListDir(rel string) (*Listing, error) {
	rel = cleanRel(rel)
	abs, err := i.resolveDir(rel)
	if err != nil {
		return nil, err
	}
	dirents, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(dirents))
	for _, de := range dirents {
		e := Entry{Name: de.Name(), Dir: de.IsDir(), Protected: i.protected(path.Join(rel, de.Name()))}
		info, err := de.Info()
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			e.Symlink = true
			// Describe the target when there is one; a dangling link stays a 0-byte file.
			if target, err := os.Stat(filepath.Join(abs, de.Name())); err == nil {
				info = target
				e.Dir = target.IsDir()
			}
		}
		if !e.Dir {
			e.Size = info.Size()
		}
		e.ModifiedAt = info.ModTime().UTC()
		entries = append(entries, e)
	}
	sort.SliceStable(entries, func(a, b int) bool {
		if entries[a].Dir != entries[b].Dir {
			return entries[a].Dir
		}
		return strings.ToLower(entries[a].Name) < strings.ToLower(entries[b].Name)
	})
	return &Listing{Path: rel, Entries: entries}, nil
}

// OpenFile opens a regular file for streaming (downloads, previews). The caller closes it.
func (i *Instance) OpenFile(rel string) (*os.File, os.FileInfo, error) {
	abs, err := i.resolveExisting(cleanRel(rel))
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(abs)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	if info.IsDir() {
		f.Close()
		return nil, nil, ErrIsDir
	}
	return f, info, nil
}

// Extensions the editor opens as text even when the sniffer is unsure (an empty file, say).
var textExt = map[string]bool{
	".bat": true, ".cfg": true, ".conf": true, ".csv": true, ".env": true, ".gradle": true, ".hocon": true,
	".html": true, ".ini": true, ".js": true, ".json": true, ".json5": true, ".kts": true, ".lang": true,
	".log": true, ".md": true, ".mcfunction": true, ".mcmeta": true, ".properties": true, ".sh": true,
	".snbt": true, ".sql": true, ".svg": true, ".toml": true, ".ts": true, ".txt": true, ".xml": true,
	".yaml": true, ".yml": true,
}

// Extensions that are never text, however their first bytes look (an empty or tiny .dat, say).
var binaryExt = map[string]bool{
	".dat": true, ".dat_old": true, ".db": true, ".gz": true, ".jar": true, ".mca": true, ".mcr": true, ".nbt": true,
	".sqlite": true, ".tar": true, ".tgz": true, ".zip": true, ".zst": true,
}

// Sounds the panel plays: named by extension, because the sniffer only knows some of them by
// their first bytes (plugin and resource-pack sounds are mostly Ogg Vorbis).
var audioExt = map[string]string{
	".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav",
	".flac": "audio/flac",
}

// ContentType decides what the panel does with a file: `text/plain` opens the editor, `image/*`
// the picture, `audio/*` a player, anything else is download-only. Known extensions win; `head`
// (the first bytes, read only when asked for) settles the rest.
func ContentType(name string, head func() []byte) string {
	ext := strings.ToLower(path.Ext(name))
	if textExt[ext] {
		return "text/plain; charset=utf-8"
	}
	if t, ok := audioExt[ext]; ok {
		return t
	}
	if binaryExt[ext] {
		return "application/octet-stream"
	}
	sniffed := http.DetectContentType(head())
	switch {
	case strings.HasPrefix(sniffed, "text/"):
		return "text/plain; charset=utf-8"
	case strings.HasPrefix(sniffed, "image/"), strings.HasPrefix(sniffed, "audio/"):
		return sniffed
	case sniffed == "application/ogg":
		return "audio/ogg"
	}
	return "application/octet-stream"
}

// WriteFile replaces (or creates) the file at rel with content, atomically. YAML and JSON are
// checked for syntax like the config editor does, and server.properties goes through the
// properties writer so the schema is validated and a running server's rewrite-on-stop is handled.
// restart is true when the server is running and the file is one it reads at startup.
func (i *Instance) WriteFile(rel string, content []byte) (restart bool, err error) {
	rel = cleanRel(rel)
	if int64(len(content)) > MaxEditBytes {
		return false, ErrFileTooLarge
	}
	if i.protected(rel) {
		return false, ErrProtected
	}
	if rel == "server.properties" {
		return i.UpdatePropertiesRaw(string(content))
	}
	abs, err := i.resolveEntry(rel)
	if err != nil {
		return false, err
	}
	if info, err := os.Stat(abs); err == nil && info.IsDir() {
		return false, ErrIsDir
	}
	if err := validateSyntax(rel, string(content)); err != nil {
		return false, fmt.Errorf("%w: %v", ErrInvalidSyntax, err)
	}
	if err := mc.WriteAtomic(abs, content); err != nil {
		return false, err
	}
	return i.running() && editableExt[strings.ToLower(path.Ext(rel))], nil
}

// Mkdir creates one directory; its parent must exist.
func (i *Instance) Mkdir(rel string) (Entry, error) {
	abs, err := i.resolveEntry(cleanRel(rel))
	if err != nil {
		return Entry{}, err
	}
	if err := os.Mkdir(abs, 0o750); err != nil {
		if errors.Is(err, os.ErrExist) {
			return Entry{}, ErrFileExists
		}
		return Entry{}, err
	}
	return statEntry(abs)
}

// Rename moves from to to (a new name in the same directory, or another directory). The target
// must not exist; a directory cannot be moved into itself.
func (i *Instance) Rename(from, to string) error {
	from, to = cleanRel(from), cleanRel(to)
	if i.protected(from) || i.protected(to) {
		return ErrProtected
	}
	src, err := i.resolveEntry(from)
	if err != nil {
		return err
	}
	if err := lstat(src); err != nil {
		return err
	}
	if to == from || strings.HasPrefix(to, from+"/") {
		return ErrBadFileName
	}
	dst, err := i.resolveEntry(to)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(dst); err == nil {
		return ErrFileExists
	}
	return os.Rename(src, dst)
}

// Remove deletes a file, a link (the link only, never what it points to) or a whole directory.
func (i *Instance) Remove(rel string) error {
	rel = cleanRel(rel)
	if i.protected(rel) {
		return ErrProtected
	}
	abs, err := i.resolveEntry(rel)
	if err != nil {
		return err
	}
	if err := lstat(abs); err != nil {
		return err
	}
	return os.RemoveAll(abs)
}

// SaveUpload streams r into dir/name. An existing file is refused with ErrFileExists unless overwrite
// is set; the bytes land in a temporary sibling first so a failed upload leaves nothing behind.
func (i *Instance) SaveUpload(dir, name string, r io.Reader, overwrite bool) (Entry, error) {
	if !validName(name) {
		return Entry{}, ErrBadFileName
	}
	rel := cleanRel(path.Join(cleanRel(dir), name))
	if i.protected(rel) {
		return Entry{}, ErrProtected
	}
	abs, err := i.resolveEntry(rel)
	if err != nil {
		return Entry{}, err
	}
	if info, err := os.Lstat(abs); err == nil {
		if info.IsDir() {
			return Entry{}, ErrIsDir
		}
		if !overwrite {
			return Entry{}, ErrFileExists
		}
	}
	tmp, err := os.CreateTemp(filepath.Dir(abs), "."+name+".upload-*")
	if err != nil {
		return Entry{}, err
	}
	_, err = io.Copy(tmp, r)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp.Name(), 0o640)
	}
	if err == nil {
		err = os.Rename(tmp.Name(), abs)
	}
	if err != nil {
		os.Remove(tmp.Name())
		return Entry{}, err
	}
	return statEntry(abs)
}

func statEntry(abs string) (Entry, error) {
	info, err := os.Stat(abs)
	if err != nil {
		return Entry{}, err
	}
	e := Entry{Name: info.Name(), Dir: info.IsDir(), ModifiedAt: info.ModTime().UTC()}
	if !e.Dir {
		e.Size = info.Size()
	}
	return e, nil
}
