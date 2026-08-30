package backup

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeZip(t *testing.T, entries map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	zw.Close()
	p := filepath.Join(t.TempDir(), "s.zip")
	os.WriteFile(p, buf.Bytes(), 0o600)
	return p
}

func TestUnpackZipWrapperAndJunk(t *testing.T) {
	archive := writeZip(t, map[string]string{
		"mc/server.properties": "a=b",
		"mc/world/level.dat":   "x",
		"mc/.DS_Store":         "junk",
		"__MACOSX/mc/._foo":    "junk",
	})
	dest := t.TempDir()
	stats, err := Unpack(context.Background(), archive, FormatZip, dest, UnpackLimits{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Bytes != 4 {
		t.Fatalf("bytes = %d", stats.Bytes)
	}
	if ok, err := FlattenRoot(dest); err != nil || !ok {
		t.Fatalf("flatten: %v %v", ok, err)
	}
	if _, err := os.Stat(filepath.Join(dest, "world", "level.dat")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, ".DS_Store")); err == nil {
		t.Fatal("junk kept")
	}
}

func TestUnpackRejectsTraversalAndLimits(t *testing.T) {
	archive := writeZip(t, map[string]string{"../evil": "x"})
	if _, err := Unpack(context.Background(), archive, FormatZip, t.TempDir(), UnpackLimits{}, nil); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("err = %v", err)
	}
	archive = writeZip(t, map[string]string{"a": "0123456789"})
	if _, err := Unpack(context.Background(), archive, FormatZip, t.TempDir(), UnpackLimits{MaxBytes: 5}, nil); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v", err)
	}
}

func TestUnpackTarGz(t *testing.T) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	tw.WriteHeader(&tar.Header{Name: "paper.jar", Mode: 0o644, Size: 3, Typeflag: tar.TypeReg})
	tw.Write([]byte("jar"))
	tw.WriteHeader(&tar.Header{Name: "link", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"})
	tw.Close()
	gw.Close()
	p := filepath.Join(t.TempDir(), "s.tgz")
	os.WriteFile(p, buf.Bytes(), 0o600)
	dest := t.TempDir()
	if _, err := Unpack(context.Background(), p, FormatTarGz, dest, UnpackLimits{}, nil); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "paper.jar")); string(b) != "jar" {
		t.Fatal("jar missing")
	}
	if _, err := os.Lstat(filepath.Join(dest, "link")); err == nil {
		t.Fatal("symlink materialised")
	}
	if ok, _ := FlattenRoot(dest); ok {
		t.Fatal("flattened a flat archive")
	}
}

func TestDetectFormat(t *testing.T) {
	for name, want := range map[string]Format{"a.zip": FormatZip, "A.TAR.GZ": FormatTarGz, "a.tgz": FormatTarGz, "a.tar.zst": FormatTarZst, "a.tar": FormatTar} {
		if got, err := DetectFormat(name); err != nil || got != want {
			t.Errorf("%s: %v %v", name, got, err)
		}
	}
	if _, err := DetectFormat("a.rar"); !errors.Is(err, ErrUnknownFormat) {
		t.Error("rar accepted")
	}
}
