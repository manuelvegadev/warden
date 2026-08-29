// Package api expone la API REST v1 descrita en docs/api.md.
package api

import (
	"encoding/json"
	"net/http"
	"runtime"

	"github.com/manuelvega/mc-server-gui/daemon/internal/config"
	"github.com/manuelvega/mc-server-gui/daemon/internal/instance"
)

type server struct {
	cfg     *config.Config
	mgr     *instance.Manager
	version string
}

func NewRouter(cfg *config.Config, mgr *instance.Manager, version string) http.Handler {
	s := &server{cfg: cfg, mgr: mgr, version: version}
	mux := http.NewServeMux()

	// Sistema
	mux.HandleFunc("GET /api/v1/health", s.health)
	mux.HandleFunc("GET /api/v1/system", s.system)

	// Auth (TODO: internal/auth)
	mux.HandleFunc("POST /api/v1/auth/login", notImplemented)
	mux.HandleFunc("POST /api/v1/auth/logout", notImplemented)
	mux.HandleFunc("GET /api/v1/auth/me", notImplemented)

	// Catálogo (TODO: internal/catalog)
	mux.HandleFunc("GET /api/v1/catalog/servers", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions/{mc}/builds", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/plugins/search", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}/versions", notImplemented)

	// Instancias
	mux.HandleFunc("GET /api/v1/instances", s.listInstances)
	mux.HandleFunc("POST /api/v1/instances", s.createInstance)
	mux.HandleFunc("GET /api/v1/instances/{id}", s.getInstance)
	mux.HandleFunc("PATCH /api/v1/instances/{id}", notImplemented)
	mux.HandleFunc("DELETE /api/v1/instances/{id}", notImplemented)
	mux.HandleFunc("POST /api/v1/instances/{id}/start", s.startInstance)
	mux.HandleFunc("POST /api/v1/instances/{id}/stop", s.stopInstance)
	mux.HandleFunc("POST /api/v1/instances/{id}/restart", notImplemented)
	mux.HandleFunc("POST /api/v1/instances/{id}/kill", notImplemented)
	mux.HandleFunc("POST /api/v1/instances/{id}/command", s.sendCommand)
	mux.HandleFunc("GET /api/v1/instances/{id}/console", notImplemented)
	mux.HandleFunc("GET /api/v1/instances/{id}/metrics", notImplemented)
	mux.HandleFunc("POST /api/v1/instances/{id}/eula", notImplemented)

	// Config, plugins, jugadores, backups (ver docs/api.md)
	for _, p := range []string{"properties", "whitelist", "ops", "bans", "files", "plugins", "players", "backups", "schedule"} {
		mux.HandleFunc("/api/v1/instances/{id}/"+p, notImplemented)
		mux.HandleFunc("/api/v1/instances/{id}/"+p+"/", notImplemented)
	}

	// WebSocket (TODO: internal/ws)
	mux.HandleFunc("GET /api/v1/ws", notImplemented)

	// Página de diagnóstico; la UI real es panel/ (ADR-007)
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<h1>mcd " + version + "</h1><p>API en <code>/api/v1</code>. La UI es el panel Next.js.</p>"))
	})

	return cors(cfg.AllowedOrigins, logging(mux))
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "version": s.version})
}

func (s *server) system(w http.ResponseWriter, _ *http.Request) {
	host, _ := hostname()
	writeJSON(w, 200, map[string]any{
		"hostname":      host,
		"os":            runtime.GOOS + "/" + runtime.GOARCH,
		"cpuCores":      runtime.NumCPU(),
		"daemonVersion": s.version,
		// TODO: memTotal/memUsed/disk/java (internal/metrics)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

func notImplemented(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "endpoint pendiente; ver docs/api.md")
}
