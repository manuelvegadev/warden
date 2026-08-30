// Package config loads the daemon configuration from environment variables (and a YAML file in the future).
package config

import (
	"errors"

	"github.com/manuelvega/warden/wardend/internal/tlsconf"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Listen         string   // WARDEND_LISTEN, e.g. ":8080"
	DataDir        string   // WARDEND_DATA_DIR, e.g. /var/lib/warden
	AllowedOrigins []string // WARDEND_ALLOWED_ORIGINS, comma-separated (Next.js panel origin)
	Contact        string   // WARDEND_CONTACT, email/URL for the Fill/Hangar/Modrinth User-Agent
	Level          string   // WARDEND_LOG_LEVEL: debug|info|warn|error
	PanelJWKSURL   string   // WARDEND_PANEL_JWKS_URL, e.g. https://beacon.example.com/api/auth/jwks
	PanelIssuer    string   // WARDEND_PANEL_ISSUER, = the panel's BETTER_AUTH_URL
	PanelKey       string   // WARDEND_PANEL_KEY, shared secret (X-Panel-Key)
	// WARDEND_TLS (off|files|acme|self-signed), WARDEND_TLS_CERT/KEY, WARDEND_TLS_HOSTS (comma-separated),
	// WARDEND_TLS_EMAIL, WARDEND_TLS_HTTP_ADDR (ACME challenge/redirect listener, default ":80"; set empty to disable).
	TLS tlsconf.Options
}

func Load() (*Config, error) {
	c := &Config{
		Listen:       env("WARDEND_LISTEN", ":8080"),
		DataDir:      env("WARDEND_DATA_DIR", "./data"),
		Contact:      env("WARDEND_CONTACT", "unknown"),
		Level:        env("WARDEND_LOG_LEVEL", "info"),
		PanelJWKSURL: os.Getenv("WARDEND_PANEL_JWKS_URL"),
		PanelIssuer:  os.Getenv("WARDEND_PANEL_ISSUER"),
		PanelKey:     os.Getenv("WARDEND_PANEL_KEY"),
		TLS: tlsconf.Options{
			Mode:     env("WARDEND_TLS", tlsconf.ModeOff),
			CertFile: os.Getenv("WARDEND_TLS_CERT"),
			KeyFile:  os.Getenv("WARDEND_TLS_KEY"),
			Hosts:    SplitList(os.Getenv("WARDEND_TLS_HOSTS")),
			Email:    os.Getenv("WARDEND_TLS_EMAIL"),
			HTTPAddr: ":80",
		},
	}
	if v, set := os.LookupEnv("WARDEND_TLS_HTTP_ADDR"); set {
		c.TLS.HTTPAddr = v // explicitly empty disables the listener
	}
	// The JWKS lives at a fixed path under the issuer; the URL is only an override.
	if c.PanelJWKSURL == "" && c.PanelIssuer != "" {
		c.PanelJWKSURL = strings.TrimRight(c.PanelIssuer, "/") + "/api/auth/jwks"
	}
	if c.PanelJWKSURL != "" && c.PanelIssuer == "" {
		return nil, errors.New("WARDEND_PANEL_ISSUER is required when WARDEND_PANEL_JWKS_URL is set")
	}
	if err := c.TLS.Validate(); err != nil {
		return nil, err
	}
	c.AllowedOrigins = SplitList(os.Getenv("WARDEND_ALLOWED_ORIGINS"))
	abs, err := filepath.Abs(c.DataDir)
	if err != nil {
		return nil, err
	}
	c.DataDir = abs
	c.TLS.DataDir = abs
	return c, nil
}

func (c *Config) ServersDir() string { return filepath.Join(c.DataDir, "servers") }

// ImportsDir holds uploaded server archives while an import task runs.
func (c *Config) ImportsDir() string { return filepath.Join(c.DataDir, "imports") }
func (c *Config) DBPath() string     { return filepath.Join(c.DataDir, "wardend.db") }
func (c *Config) UserAgent(version string) string {
	return "warden/" + version + " (" + c.Contact + ")"
}

func (c *Config) LogLevel() slog.Level {
	switch strings.ToLower(c.Level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	}
	return slog.LevelInfo
}

// SplitList parses a comma-separated variable, trimming blanks.
func SplitList(v string) []string {
	var out []string
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
