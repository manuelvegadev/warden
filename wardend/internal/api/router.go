// Package api expone la API REST v1 descrita en docs/api.md.
package api

import (
	"encoding/json"
	"net/http"
	"runtime"

	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/config"
	"github.com/manuelvega/warden/wardend/internal/instance"
)

type server struct {
	cfg     *config.Config
	mgr     *instance.Manager
	version string
}

// NewRouter monta la API. Todo /api/v1 salvo /health exige JWT de Beacon (ADR-009).
func NewRouter(cfg *config.Config, mgr *instance.Manager, verifier *auth.Verifier, version string) http.Handler {
	s := &server{cfg: cfg, mgr: mgr, version: version}
	root := http.NewServeMux()
	root.HandleFunc("GET /api/v1/health", s.health)

	mux := http.NewServeMux()
	root.Handle("/api/v1/", verifier.Middleware(mux))

	// Sistema
	mux.HandleFunc("GET /api/v1/system", s.system)
	mux.HandleFunc("GET /api/v1/auth/me", s.me)

	// Catálogo (TODO: internal/catalog)
	mux.HandleFunc("GET /api/v1/catalog/servers", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions/{mc}/builds", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/plugins/search", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}", notImplemented)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}/versions", notImplemented)

	// Instancias
	mux.HandleFunc("GET /api/v1/instances", s.listInstances)
	mux.HandleFunc("POST /api/v1/instances", auth.RequireAdmin(s.createInstance))
	mux.HandleFunc("GET /api/v1/instances/{id}", s.getInstance)
	mux.HandleFunc("PATCH /api/v1/instances/{id}", notImplemented)
	mux.HandleFunc("DELETE /api/v1/instances/{id}", auth.RequireAdmin(notImplemented))
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

	// WebSocket: autentica con el JWT en el primer mensaje, no por cabecera (TODO: internal/ws)
	root.HandleFunc("GET /api/v1/ws", notImplemented)

	// Página de diagnóstico; la UI real es Beacon (ADR-007)
	root.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<h1>wardend " + version + "</h1><p>API en <code>/api/v1</code>. La UI es Beacon.</p>"))
	})

	return cors(cfg.AllowedOrigins, logging(root))
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	writeJSON(w, 200, p)
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
