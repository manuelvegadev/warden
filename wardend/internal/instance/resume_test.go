package instance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestResumeMarker(t *testing.T) {
	root := filepath.Join(t.TempDir(), "servers")
	os.MkdirAll(root, 0o750)
	m := NewManager(root, nil)
	if err := m.SaveResume([]string{"a", "b"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(resumeFile(root)); err != nil {
		t.Fatal("marker not written")
	}
	// Unknown ids are skipped; the marker is consumed either way.
	m.ResumeAll(context.Background())
	if _, err := os.Stat(resumeFile(root)); !os.IsNotExist(err) {
		t.Fatal("marker should be removed after resume")
	}
	if err := m.SaveResume(nil); err != nil {
		t.Fatal(err)
	}
}
