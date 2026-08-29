// Package config carga la configuración del daemon desde variables de entorno (y en el futuro un YAML).
package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Listen         string   // MCD_LISTEN, p.ej. ":8080"
	DataDir        string   // MCD_DATA_DIR, p.ej. /var/lib/mc-server-gui
	AllowedOrigins []string // MCD_ALLOWED_ORIGINS, coma-separado (origen del panel Next.js)
	Contact        string   // MCD_CONTACT, email/URL para el User-Agent de Fill/Hangar/Modrinth
	Level          string   // MCD_LOG_LEVEL: debug|info|warn|error
}

func Load() (*Config, error) {
	c := &Config{
		Listen:  env("MCD_LISTEN", ":8080"),
		DataDir: env("MCD_DATA_DIR", "./data"),
		Contact: env("MCD_CONTACT", "unknown"),
		Level:   env("MCD_LOG_LEVEL", "info"),
	}
	if o := os.Getenv("MCD_ALLOWED_ORIGINS"); o != "" {
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
func (c *Config) DBPath() string     { return filepath.Join(c.DataDir, "mcd.db") }
func (c *Config) UserAgent(version string) string {
	return "mc-server-gui/" + version + " (" + c.Contact + ")"
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
