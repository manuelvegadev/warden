package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// Create writes a .tar.gz at dest containing the given paths (relative to root, files or
// directories). Progress is a 0-100 percentage of bytes written, reported at most every 500 ms.
// The archive is removed again if the context is cancelled or an error occurs.
//
// Compression is BestSpeed on purpose: world region files are already zlib-compressed, so a
// higher level costs CPU for no size gain.
func Create(ctx context.Context, root, dest string, paths []string, progress func(pct int)) (err error) {
	if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
		return err
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			os.Remove(dest)
		}
	}()
	gz, err := gzip.NewWriterLevel(f, gzip.BestSpeed)
	if err != nil {
		f.Close()
		return err
	}
	tw := tar.NewWriter(gz)

	total := totalSize(root, paths)
	cw := &countingWriter{w: tw, total: total, progress: progress, last: time.Now()}
	for _, rel := range paths {
		if err = addPath(ctx, tw, cw, root, rel); err != nil {
			break
		}
	}
	for _, c := range []io.Closer{tw, gz, f} {
		if cerr := c.Close(); err == nil {
			err = cerr
		}
	}
	if err == nil {
		err = ctx.Err()
	}
	if err == nil && progress != nil {
		progress(100)
	}
	return err
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

// countingWriter forwards to the tar writer and turns bytes written into throttled progress.
type countingWriter struct {
	w        io.Writer
	done     int64
	total    int64
	progress func(int)
	last     time.Time
	lastPct  int
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.done += int64(n)
	if c.progress != nil && c.total > 0 && time.Since(c.last) >= 500*time.Millisecond {
		if pct := int(c.done * 100 / c.total); pct != c.lastPct {
			c.lastPct = pct
			c.progress(pct)
		}
		c.last = time.Now()
	}
	return n, err
}
