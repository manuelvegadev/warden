// Package backup creates, lists, restores and rotates instance backups as tar.zst archives with a
// JSON sidecar describing each one. The world/consistency dance (save-off/save-all) is the
// instance's job; this package only knows files.
package backup

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/klauspost/compress/zstd"
)

const Ext = ".tar.zst"

// Info is the sidecar (<name>.json) written next to each archive.
type Info struct {
	Name      string    `json:"name"`    // archive file name
	Trigger   string    `json:"trigger"` // manual | schedule | pre-upgrade | pre-restore
	Scope     string    `json:"scope"`   // full | worlds
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256"`
	Paths     []string  `json:"paths"`
	MCVersion string    `json:"mcVersion,omitempty"`
	Build     int       `json:"build,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Name builds "<trigger>-<UTC time>.tar.zst".
func Name(trigger string, at time.Time) string {
	return trigger + "-" + at.UTC().Format("20060102-150405") + Ext
}

// Create writes the archive at dest with the given paths (relative to root), then the sidecar.
// Progress is a 0-100 percentage of bytes read, reported at most every 500 ms. On error or
// cancellation nothing is left behind.
//
// zstd at its default level: world region files are already zlib-compressed, so a slow level
// would burn CPU for no size gain; zstd still beats gzip several times over on this data.
func Create(ctx context.Context, root, dest string, info Info, progress func(pct int)) (out Info, err error) {
	if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
		return info, err
	}
	f, err := os.Create(dest)
	if err != nil {
		return info, err
	}
	defer func() {
		if err != nil {
			os.Remove(dest)
			os.Remove(sidecar(dest))
		}
	}()
	h := sha256.New()
	zw, err := zstd.NewWriter(io.MultiWriter(f, h), zstd.WithEncoderLevel(zstd.SpeedDefault))
	if err != nil {
		f.Close()
		return info, err
	}
	tw := tar.NewWriter(zw)
	cw := &countingWriter{w: tw, progress: newProgress(totalSize(root, info.Paths), progress)}
	for _, rel := range info.Paths {
		if err = addPath(ctx, tw, cw, root, rel); err != nil {
			break
		}
	}
	for _, c := range []io.Closer{tw, zw, f} {
		if cerr := c.Close(); err == nil {
			err = cerr
		}
	}
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		return info, err
	}
	st, err := os.Stat(dest)
	if err != nil {
		return info, err
	}
	info.Name = filepath.Base(dest)
	info.Size = st.Size()
	info.SHA256 = hex.EncodeToString(h.Sum(nil))
	if info.CreatedAt.IsZero() {
		info.CreatedAt = time.Now().UTC()
	}
	b, _ := json.MarshalIndent(info, "", "  ")
	if err = os.WriteFile(sidecar(dest), b, 0o640); err != nil {
		return info, err
	}
	if progress != nil {
		progress(100)
	}
	return info, nil
}

func sidecar(archive string) string { return strings.TrimSuffix(archive, Ext) + ".json" }

// List reads every archive in dir, newest first. Archives without a sidecar (or with a broken
// one) still appear, described from the file itself.
func List(dir string) ([]Info, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Info{}, nil
		}
		return nil, err
	}
	out := []Info{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), Ext) {
			continue
		}
		st, err := e.Info()
		if err != nil {
			continue
		}
		info := Info{Name: e.Name(), Size: st.Size(), CreatedAt: st.ModTime().UTC(), Trigger: "unknown", Scope: "unknown"}
		if b, err := os.ReadFile(sidecar(filepath.Join(dir, e.Name()))); err == nil {
			var side Info
			if json.Unmarshal(b, &side) == nil {
				side.Name, side.Size = e.Name(), st.Size()
				info = side
			}
		}
		out = append(out, info)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].CreatedAt.After(out[b].CreatedAt) })
	return out, nil
}

// Remove deletes an archive and its sidecar.
func Remove(dir, name string) error {
	if err := os.Remove(filepath.Join(dir, name)); err != nil {
		return err
	}
	os.Remove(sidecar(filepath.Join(dir, name)))
	return nil
}

// ErrUnsafePath is returned for archive entries that would escape root.
var ErrUnsafePath = errors.New("archive entry escapes the target directory")

// Extract restores an archive into root. Every top-level path in the archive replaces what is on
// disk (a directory that exists is removed first, so deleted files do not linger).
func Extract(ctx context.Context, archive, root string, progress func(pct int)) error {
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	st, _ := f.Stat()
	cr := &countingReader{r: f, progress: newProgress(st.Size(), progress)}
	zr, err := zstd.NewReader(cr)
	if err != nil {
		return err
	}
	defer zr.Close()
	tr := tar.NewReader(zr)
	replaced := map[string]bool{}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		rel := path.Clean(strings.TrimPrefix(hdr.Name, "/"))
		if rel == "." || rel == ".." || strings.HasPrefix(rel, "../") {
			return fmt.Errorf("%w: %s", ErrUnsafePath, hdr.Name)
		}
		top := strings.SplitN(rel, "/", 2)[0]
		if !replaced[top] {
			replaced[top] = true
			if err := os.RemoveAll(filepath.Join(root, top)); err != nil {
				return err
			}
		}
		target := filepath.Join(root, filepath.FromSlash(rel))
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o750); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
				return err
			}
			w, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, fs.FileMode(hdr.Mode)&0o777|0o600)
			if err != nil {
				return err
			}
			_, err = io.Copy(w, tr)
			w.Close()
			if err != nil {
				return err
			}
		}
	}
	if progress != nil {
		progress(100)
	}
	return nil
}

// addPath appends one file or directory tree. Symlinks and special files are skipped.
func addPath(ctx context.Context, tw *tar.Writer, cw *countingWriter, root, rel string) error {
	return filepath.WalkDir(filepath.Join(root, rel), func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if !d.Type().IsRegular() && !d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		relPath, _ := filepath.Rel(root, p)
		hdr.Name = filepath.ToSlash(relPath)
		if d.IsDir() {
			hdr.Name += "/"
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		src, err := os.Open(p)
		if err != nil {
			return err
		}
		defer src.Close()
		_, err = io.Copy(cw, src)
		return err
	})
}

// WorldDirs lists the top-level directories under root that hold a Minecraft world (level.dat).
func WorldDirs(root string) []string {
	entries, _ := os.ReadDir(root)
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			if _, err := os.Stat(filepath.Join(root, e.Name(), "level.dat")); err == nil {
				out = append(out, e.Name())
			}
		}
	}
	return out
}

func totalSize(root string, paths []string) int64 {
	var n int64
	for _, rel := range paths {
		_ = filepath.WalkDir(filepath.Join(root, rel), func(p string, d fs.DirEntry, err error) error {
			if err == nil && d.Type().IsRegular() {
				if info, err := d.Info(); err == nil {
					n += info.Size()
				}
			}
			return nil
		})
	}
	return n
}

// progress turns bytes moved into a throttled 0-100 callback.
type progress struct {
	done, total int64
	fn          func(int)
	last        time.Time
	lastPct     int
}

func newProgress(total int64, fn func(int)) *progress {
	return &progress{total: total, fn: fn, last: time.Now()}
}

func (p *progress) add(n int) {
	p.done += int64(n)
	if p.fn == nil || p.total <= 0 || time.Since(p.last) < 500*time.Millisecond {
		return
	}
	if pct := int(p.done * 100 / p.total); pct != p.lastPct {
		p.lastPct = pct
		p.fn(pct)
	}
	p.last = time.Now()
}

type countingWriter struct {
	w io.Writer
	*progress
}

func (c *countingWriter) Write(b []byte) (int, error) {
	n, err := c.w.Write(b)
	c.add(n)
	return n, err
}

type countingReader struct {
	r io.Reader
	*progress
}

func (c *countingReader) Read(b []byte) (int, error) {
	n, err := c.r.Read(b)
	c.add(n)
	return n, err
}
