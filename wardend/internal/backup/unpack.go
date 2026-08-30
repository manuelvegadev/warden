package backup

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/zstd"
)

// Format is an archive container a user may upload.
type Format string

const (
	FormatZip    Format = "zip"
	FormatTar    Format = "tar"
	FormatTarGz  Format = "tar.gz"
	FormatTarZst Format = "tar.zst"
)

// ErrUnknownFormat is returned for file names without a supported archive extension.
var ErrUnknownFormat = errors.New("unsupported archive format (use .zip, .tar, .tar.gz, .tgz or .tar.zst)")

// ErrTooLarge is returned when an archive would expand past the configured limits.
var ErrTooLarge = errors.New("archive exceeds the size limit")

// DetectFormat picks the container from a file name.
func DetectFormat(name string) (Format, error) {
	n := strings.ToLower(name)
	switch {
	case strings.HasSuffix(n, ".zip"):
		return FormatZip, nil
	case strings.HasSuffix(n, ".tar.gz"), strings.HasSuffix(n, ".tgz"):
		return FormatTarGz, nil
	case strings.HasSuffix(n, ".tar.zst"), strings.HasSuffix(n, ".tzst"):
		return FormatTarZst, nil
	case strings.HasSuffix(n, ".tar"):
		return FormatTar, nil
	}
	return "", ErrUnknownFormat
}

// UnpackLimits bound what an untrusted archive may expand to.
type UnpackLimits struct {
	MaxBytes   int64 // total uncompressed bytes (0 = unlimited)
	MaxEntries int   // number of entries (0 = unlimited)
}

// UnpackStats describes what Unpack wrote.
type UnpackStats struct {
	Files int
	Bytes int64
}

// junk is what desktop archivers add and a server never needs.
func junk(rel string) bool {
	base := path.Base(rel)
	return rel == "__MACOSX" || strings.HasPrefix(rel, "__MACOSX/") || base == ".DS_Store" || base == "Thumbs.db" || base == "desktop.ini"
}

// Unpack extracts an uploaded archive into dest, which must exist. Entries are confined to dest
// (no `..`, no absolute paths), symlinks and special files are skipped, desktop junk is dropped
// and limits stop decompression bombs. Progress follows the compressed bytes read.
func Unpack(ctx context.Context, archive string, format Format, dest string, limits UnpackLimits, progress func(pct int)) (UnpackStats, error) {
	var stats UnpackStats
	if format == FormatZip {
		return unpackZip(ctx, archive, dest, limits, progress)
	}
	f, err := os.Open(archive)
	if err != nil {
		return stats, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return stats, err
	}
	var r io.Reader = &countingReader{r: f, progress: newProgress(st.Size(), progress)}
	switch format {
	case FormatTarGz:
		gr, err := gzip.NewReader(r)
		if err != nil {
			return stats, err
		}
		defer gr.Close()
		r = gr
	case FormatTarZst:
		zr, err := zstd.NewReader(r)
		if err != nil {
			return stats, err
		}
		defer zr.Close()
		r = zr
	}
	tr := tar.NewReader(r)
	for {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return stats, err
		}
		if hdr.Typeflag != tar.TypeDir && hdr.Typeflag != tar.TypeReg {
			continue
		}
		if err := writeEntry(dest, hdr.Name, hdr.Typeflag == tar.TypeDir, fs.FileMode(hdr.Mode), tr, limits, &stats); err != nil {
			return stats, err
		}
	}
	if progress != nil {
		progress(100)
	}
	return stats, nil
}

func unpackZip(ctx context.Context, archive, dest string, limits UnpackLimits, progress func(pct int)) (UnpackStats, error) {
	var stats UnpackStats
	zr, err := zip.OpenReader(archive)
	if err != nil {
		return stats, err
	}
	defer zr.Close()
	// Progress by uncompressed bytes as they are written, so a single huge region file still moves it.
	var total int64
	for _, f := range zr.File {
		total += int64(f.UncompressedSize64)
	}
	p := newProgress(total, progress)
	for _, f := range zr.File {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		mode := f.Mode()
		if !mode.IsDir() && !mode.IsRegular() {
			continue
		}
		var rc io.ReadCloser
		var body io.Reader
		if !mode.IsDir() {
			if rc, err = f.Open(); err != nil {
				return stats, err
			}
			body = &countingReader{r: rc, progress: p}
		}
		err := writeEntry(dest, f.Name, mode.IsDir(), mode, body, limits, &stats)
		if rc != nil {
			rc.Close()
		}
		if err != nil {
			return stats, err
		}
	}
	if progress != nil {
		progress(100)
	}
	return stats, nil
}

// writeEntry materialises one archive member under dest after the safety checks.
func writeEntry(dest, name string, isDir bool, mode fs.FileMode, r io.Reader, limits UnpackLimits, stats *UnpackStats) error {
	rel, err := safeRel(name)
	if err != nil {
		return err
	}
	if junk(rel) {
		return nil
	}
	if limits.MaxEntries > 0 {
		if stats.Files++; stats.Files > limits.MaxEntries {
			return fmt.Errorf("%w: more than %d entries", ErrTooLarge, limits.MaxEntries)
		}
	}
	target := filepath.Join(dest, filepath.FromSlash(rel))
	if isDir {
		return os.MkdirAll(target, 0o750)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return err
	}
	w, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode.Perm()|0o600)
	if err != nil {
		return err
	}
	defer w.Close()
	src := r
	if limits.MaxBytes > 0 {
		remaining := limits.MaxBytes - stats.Bytes
		if remaining <= 0 {
			return ErrTooLarge
		}
		src = io.LimitReader(r, remaining+1)
	}
	n, err := io.Copy(w, src)
	stats.Bytes += n
	if err != nil {
		return err
	}
	if limits.MaxBytes > 0 && stats.Bytes > limits.MaxBytes {
		return fmt.Errorf("%w: more than %d MB uncompressed", ErrTooLarge, limits.MaxBytes>>20)
	}
	return nil
}

// FlattenRoot handles archives made of a single top-level directory (`myserver/…`): its
// contents move up into dir and the empty wrapper is removed. Returns whether it did anything.
func FlattenRoot(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false, err
	}
	if len(entries) != 1 || !entries[0].IsDir() {
		return false, nil
	}
	// Move the wrapper aside first so a child with the wrapper's own name cannot collide with it.
	wrapper := filepath.Join(dir, ".unwrap-"+entries[0].Name())
	if err := os.Rename(filepath.Join(dir, entries[0].Name()), wrapper); err != nil {
		return false, err
	}
	inner, err := os.ReadDir(wrapper)
	if err != nil {
		return false, err
	}
	for _, e := range inner {
		if err := os.Rename(filepath.Join(wrapper, e.Name()), filepath.Join(dir, e.Name())); err != nil {
			return false, err
		}
	}
	return true, os.Remove(wrapper)
}

// safeRel normalises an archive member name and rejects anything that would leave the destination.
func safeRel(name string) (string, error) {
	rel := path.Clean(strings.TrimPrefix(strings.ReplaceAll(name, "\\", "/"), "/"))
	if rel == "." || rel == ".." || strings.HasPrefix(rel, "../") {
		return "", fmt.Errorf("%w: %s", ErrUnsafePath, name)
	}
	return rel, nil
}
