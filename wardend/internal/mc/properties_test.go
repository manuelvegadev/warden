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

// A two-line MOTD with colour codes is the case that used to corrupt the file: a raw newline
// split the entry in two and everything after it kept parsing as if nothing had happened.
func TestPropertiesMotdRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "server.properties")
	motd := "§6§lMaincra §r§7survival\n§aOpen now"
	if err := WriteProperties(p, map[string]string{"motd": motd, "max-players": "5"}); err != nil {
		t.Fatal(err)
	}

	raw, _ := os.ReadFile(p)
	for _, line := range strings.Split(strings.TrimRight(string(raw), "\n"), "\n") {
		if !strings.HasPrefix(line, "#") && !strings.Contains(line, "=") {
			t.Fatalf("a value newline split the file:\n%s", raw)
		}
	}
	// The section sign goes out as \u00A7 so Properties.load decodes it whatever the file charset,
	// and the newline as \n so the entry stays on one line.
	if !strings.Contains(string(raw), `motd=\u00A76\u00A7lMaincra \u00A7r\u00A77survival\n\u00A7aOpen now`) {
		t.Errorf("unexpected encoding: %s", raw)
	}

	got, err := ReadProperties(p)
	if err != nil {
		t.Fatal(err)
	}
	if got["motd"] != motd {
		t.Errorf("motd = %q, want %q", got["motd"], motd)
	}
	if got["max-players"] != "5" {
		t.Errorf("the key after the motd did not survive: %v", got)
	}
}

func TestUnescapeValue(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{`plain`, "plain"},
		{`minecraft\:normal`, "minecraft:normal"},
		{`a\=b \#1 \!x`, "a=b #1 !x"},
		{`line\nbreak`, "line\nbreak"},
		{`tab\there`, "tab\there"},
		{`§6gold`, "§6gold"},
		{`§x§f§f`, "§x§f§f"},
		{`a\\nb`, `a\nb`},   // an escaped backslash, then a literal n
		{`😀`, "\U0001f600"}, // surrogate pair, the way Java writes an emoji
		{`\uZZZZ`, "uZZZZ"}, // not an escape: the backslash goes, the text stays
		{`trailing\`, `trailing\`},
	} {
		if got := UnescapeValue(c.in); got != c.want {
			t.Errorf("UnescapeValue(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestEscapeValueRoundTrip(t *testing.T) {
	for _, v := range []string{
		"plain",
		"a=b #1 !x",
		"two\nlines",
		"minecraft:normal",
		`back\slash`,
		"§6§lcolours",
		"\U0001f600 emoji",
	} {
		if got := UnescapeValue(escapeValue(v)); got != v {
			t.Errorf("round trip of %q gave %q (encoded as %q)", v, got, escapeValue(v))
		}
	}
}
