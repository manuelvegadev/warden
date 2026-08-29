package installer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnvRoundTripKeepsUnknownKeys(t *testing.T) {
	s := defaults()
	s.Port, s.Contact, s.PanelIssuer, s.TLSMode, s.TLSHosts = 8444, "me@example.com", "http://x:3000", "self-signed", "x,y"
	existing := map[string]string{"WARDEND_PANEL_JWKS_URL": "http://beacon:3000/api/auth/jwks", "WARDEND_LOG_LEVEL": "debug"}
	path := filepath.Join(t.TempDir(), "wardend.env")
	if err := writeEnvFile(path, s.envLines(existing)); err != nil {
		t.Fatal(err)
	}
	got, ok := readEnv(path)
	if !ok || got["WARDEND_LISTEN"] != ":8444" || got["WARDEND_TLS_HOSTS"] != "x,y" || got["WARDEND_TLS_HTTP_ADDR"] != "" {
		t.Fatalf("env: %v", got)
	}
	if got["WARDEND_PANEL_JWKS_URL"] != existing["WARDEND_PANEL_JWKS_URL"] || got["WARDEND_LOG_LEVEL"] != "debug" {
		t.Fatalf("hand-added keys lost: %v", got)
	}
	var back Settings
	back.fromEnv(got)
	if back.Port != 8444 || back.Contact != "me@example.com" || back.TLSMode != "self-signed" {
		t.Fatalf("fromEnv: %+v", back)
	}
	b, _ := os.ReadFile(path)
	if !strings.HasPrefix(string(b), "# Written by") {
		t.Fatal("missing header")
	}
}

func TestPanelPort(t *testing.T) {
	for in, want := range map[string]int{"http://server.local:3000": 3000, "https://beacon.example.com": 443, "http://x": 80, "garbage": 3000} {
		if got := panelPort(in); got != want {
			t.Fatalf("%s: got %d want %d", in, got, want)
		}
	}
}

func TestBeaconEnvIsReused(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "beacon.env")
	if err := writeEnvFile(path, []string{"BEACON_IMAGE=warden-beacon:local", "BETTER_AUTH_SECRET=s3cret", "BETTER_AUTH_URL=http://server.local:3000"}); err != nil {
		t.Fatal(err)
	}
	prev, ok := readEnv(path)
	if !ok || prev["BETTER_AUTH_URL"] != "http://server.local:3000" || prev["BEACON_IMAGE"] != "warden-beacon:local" {
		t.Fatalf("prev = %v", prev)
	}
}
