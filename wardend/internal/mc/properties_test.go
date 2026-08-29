package mc

import (
	"path/filepath"
	"testing"
)

func TestProperties(t *testing.T) {
	p := filepath.Join(t.TempDir(), "server.properties")
	if err := WriteProperties(p, map[string]string{"motd": "hi", "server-port": "25565"}); err != nil {
		t.Fatal(err)
	}
	if err := WriteProperties(p, map[string]string{"motd": "hello", "max-players": "10"}); err != nil {
		t.Fatal(err)
	}
	got, err := ReadProperties(p)
	if err != nil {
		t.Fatal(err)
	}
	if got["motd"] != "hello" || got["server-port"] != "25565" || got["max-players"] != "10" {
		t.Errorf("unexpected %v", got)
	}
}
