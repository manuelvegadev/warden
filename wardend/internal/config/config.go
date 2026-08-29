// Package config carga la configuración del daemon desde variables de entorno (y en el futuro un YAML).
package config

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Listen         string   // WARDEND_LISTEN, p.ej. ":8080"
	DataDir        string   // WARDEND_DATA_DIR, p.ej. /var/lib/warden
	AllowedOrigins []string // WARDEND_ALLOWED_ORIGINS, coma-separado (origen del panel Next.js)
	Contact        string   // WARDEND_CONTACT, email/URL para el User-Agent de Fill/Hangar/Modrinth
	Level          string   // WARDEND_LOG_LEVEL: debug|info|warn|error
	PanelJWKSURL   string   // WARDEND_PANEL_JWKS_URL, p.ej. https://beacon.example.com/api/auth/jwks
	PanelIssuer    string   // WARDEND_PANEL_ISSUER, = BETTER_AUTH_URL del panel
	PanelKey       string   // WARDEND_PANEL_KEY, secreto compartido (X-Panel-Key)
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
	}
	if c.PanelJWKSURL != "" && c.PanelIssuer == "" {
		return nil, errors.New("WARDEND_PANEL_ISSUER es obligatorio cuando se define WARDEND_PANEL_JWKS_URL")
	}
	if o := os.Getenv("WARDEND_ALLOWED_ORIGINS"); o != "" {
		for _, s := range strings.Split(o, ",") {
			if s = strings.TrimSpace(s); s != "" {
				c.AllowedOrigins = append(c.AllowedOrigins, s)
			}
		}
	}
	abs, err := filepath.Abs(c.DataDir)
	if err != nil {
		return nil, err
	}
	c.DataDir = abs
	return c, nil
}

func (c *Config) ServersDir() string { return filepath.Join(c.DataDir, "servers") }
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

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
