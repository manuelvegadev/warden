package mc

import (
	"os"
	"path/filepath"
	"strings"
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

func TestPropertiesEscaping(t *testing.T) {
	p := filepath.Join(t.TempDir(), "server.properties")
	if err := WriteProperties(p, map[string]string{"level-type": "minecraft:normal", "motd": "a=b #1"}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(p)
	if !strings.Contains(string(raw), `level-type=minecraft\:normal`) {
		t.Errorf("colon not escaped: %s", raw)
	}
	got, _ := ReadProperties(p)
	if got["level-type"] != "minecraft:normal" || got["motd"] != "a=b #1" {
		t.Errorf("round trip failed: %v", got)
	}
}
