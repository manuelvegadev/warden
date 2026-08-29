package config

import "testing"

func TestLoadDerivesJWKSAndTLS(t *testing.T) {
	t.Setenv("WARDEND_PANEL_ISSUER", "https://beacon.example.com/")
	t.Setenv("WARDEND_PANEL_JWKS_URL", "")
	t.Setenv("WARDEND_TLS", "")
	t.Setenv("WARDEND_TLS_HTTP_ADDR", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.PanelJWKSURL != "https://beacon.example.com/api/auth/jwks" {
		t.Fatalf("jwks = %q", c.PanelJWKSURL)
	}
	if c.TLS.Mode != "off" || c.TLS.HTTPAddr != "" || c.TLS.DataDir != c.DataDir {
		t.Fatalf("tls = %+v", c.TLS)
	}

	t.Setenv("WARDEND_TLS", "files")
	if _, err := Load(); err == nil {
		t.Fatal("files mode without cert/key must fail at load time")
	}
	t.Setenv("WARDEND_PANEL_ISSUER", "")
	t.Setenv("WARDEND_PANEL_JWKS_URL", "https://x/jwks")
	t.Setenv("WARDEND_TLS", "off")
	if _, err := Load(); err == nil {
		t.Fatal("jwks without issuer must fail")
	}
}
