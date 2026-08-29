// Package api exposes the REST API v1 described in docs/api.md.
package api

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"

	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/config"
	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/java"
	"github.com/manuelvega/warden/wardend/internal/metrics"
	"github.com/manuelvega/warden/wardend/internal/store"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// Deps are the services the handlers need.
type Deps struct {
	Config   *config.Config
	Manager  *instance.Manager
	Verifier *auth.Verifier
	Catalog  *catalog.Registry
	Tasks    *tasks.Manager
	Java     *java.Manager
	Metrics  *metrics.Sampler
	Store    *store.Store
	WS       http.Handler
	Version  string
}

type server struct{ Deps }

// NewRouter mounts the API. Everything under /api/v1 except /health and /ws requires a Beacon JWT (ADR-009).
func NewRouter(d Deps) http.Handler {
	s := &server{Deps: d}
	root := http.NewServeMux()
	root.HandleFunc("GET /api/v1/health", s.health)
	root.Handle("GET /api/v1/ws", d.WS) // authenticates via first message

	mux := http.NewServeMux()
	root.Handle("/api/v1/", d.Verifier.Middleware(mux))

	// System
	mux.HandleFunc("GET /api/v1/system", s.system)
	mux.HandleFunc("GET /api/v1/auth/me", s.me)
	mux.HandleFunc("GET /api/v1/tasks", s.listTasks)
	mux.HandleFunc("GET /api/v1/tasks/{id}", s.getTask)

	// Java runtimes (ADR-010)
	mux.HandleFunc("GET /api/v1/java", s.listJava)
	mux.HandleFunc("GET /api/v1/java/required", s.javaRequired)
	mux.HandleFunc("POST /api/v1/java", auth.RequireAdmin(s.installJava))
	mux.HandleFunc("DELETE /api/v1/java/{id}", auth.RequireAdmin(s.removeJava))

	// Catalog
	mux.HandleFunc("GET /api/v1/catalog/servers", s.catalogServers)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions", s.catalogVersions)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions/{mc}/builds", s.catalogBuilds)
	mux.HandleFunc("GET /api/v1/catalog/plugins/search", s.searchPlugins)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}", s.getPlugin)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}/versions", s.pluginVersions)

	// Instances
	mux.HandleFunc("GET /api/v1/instances", s.listInstances)
	mux.HandleFunc("POST /api/v1/instances", auth.RequireAdmin(s.createInstance))
	mux.HandleFunc("GET /api/v1/instances/{id}", s.getInstance)
	mux.HandleFunc("PATCH /api/v1/instances/{id}", auth.RequireAdmin(s.patchInstance))
	mux.HandleFunc("DELETE /api/v1/instances/{id}", auth.RequireAdmin(s.deleteInstance))
	mux.HandleFunc("POST /api/v1/instances/{id}/install", auth.RequireAdmin(s.installInstance))
	mux.HandleFunc("POST /api/v1/instances/{id}/start", s.startInstance)
	mux.HandleFunc("POST /api/v1/instances/{id}/stop", s.stopInstance)
	mux.HandleFunc("POST /api/v1/instances/{id}/restart", s.restartInstance)
	mux.HandleFunc("POST /api/v1/instances/{id}/kill", s.killInstance)
	mux.HandleFunc("POST /api/v1/instances/{id}/command", s.sendCommand)
	mux.HandleFunc("GET /api/v1/instances/{id}/console", s.console)
	mux.HandleFunc("GET /api/v1/instances/{id}/logs", s.listLogs)
	mux.HandleFunc("GET /api/v1/instances/{id}/logs/{file}", s.getLog)
	mux.HandleFunc("GET /api/v1/instances/{id}/metrics", s.instanceMetrics)
	mux.HandleFunc("POST /api/v1/instances/{id}/eula", auth.RequireAdmin(s.eula))
	mux.HandleFunc("GET /api/v1/instances/{id}/players", s.listPlayers)
	mux.HandleFunc("GET /api/v1/instances/{id}/players/{name}/sessions", s.playerSessions)
	mux.HandleFunc("GET /api/v1/instances/{id}/events", s.listEvents)

	// Configuration and access lists
	mux.HandleFunc("GET /api/v1/instances/{id}/properties", s.getProperties)
	mux.HandleFunc("PUT /api/v1/instances/{id}/properties", auth.RequireAdmin(s.putProperties))
	mux.HandleFunc("GET /api/v1/instances/{id}/properties/raw", s.getPropertiesRaw)
	mux.HandleFunc("PUT /api/v1/instances/{id}/properties/raw", auth.RequireAdmin(s.putPropertiesRaw))
	mux.HandleFunc("GET /api/v1/instances/{id}/whitelist", s.getWhitelist)
	mux.HandleFunc("POST /api/v1/instances/{id}/whitelist/{name}", s.addWhitelist)
	mux.HandleFunc("DELETE /api/v1/instances/{id}/whitelist/{name}", s.removeWhitelist)
	mux.HandleFunc("GET /api/v1/instances/{id}/ops", s.getOps)
	mux.HandleFunc("POST /api/v1/instances/{id}/ops/{name}", auth.RequireAdmin(s.addOp))
	mux.HandleFunc("DELETE /api/v1/instances/{id}/ops/{name}", auth.RequireAdmin(s.removeOp))
	mux.HandleFunc("GET /api/v1/instances/{id}/bans", s.getBans)
	mux.HandleFunc("POST /api/v1/instances/{id}/bans", s.addBan)
	mux.HandleFunc("DELETE /api/v1/instances/{id}/bans/{target}", s.removeBan)

	// Plugins
	mux.HandleFunc("GET /api/v1/instances/{id}/plugins", s.listInstancePlugins)
	mux.HandleFunc("GET /api/v1/instances/{id}/plugins/{file}/icon", s.pluginIcon)
	mux.HandleFunc("POST /api/v1/instances/{id}/plugins", auth.RequireAdmin(s.installPlugin))

	// Files, backups (see docs/api.md) — later phases
	for _, p := range []string{"files", "backups", "schedule"} {
		mux.HandleFunc("/api/v1/instances/{id}/"+p, notImplemented)
		mux.HandleFunc("/api/v1/instances/{id}/"+p+"/", notImplemented)
	}

	// Diagnostics page; the real UI is Beacon (ADR-007)
	root.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<h1>wardend " + d.Version + "</h1><p>API at <code>/api/v1</code>. The UI is Beacon.</p>"))
	})

	return cors(d.Config.AllowedOrigins, logging(root))
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "version": s.Version})
}

func (s *server) system(w http.ResponseWriter, r *http.Request) {
	host, _ := os.Hostname()
	sys := s.Metrics.System(r.Context())
	if rts, err := s.Java.List(); err == nil {
		sys["java"] = rts
	}
	sys["hostname"] = host
	sys["os"] = runtime.GOOS + "/" + runtime.GOARCH
	sys["cpuCores"] = runtime.NumCPU()
	sys["daemonVersion"] = s.Version
	writeJSON(w, 200, sys)
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	writeJSON(w, 200, p)
}

func (s *server) listTasks(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, s.Tasks.List()) }

func (s *server) getTask(w http.ResponseWriter, r *http.Request) {
	t, ok := s.Tasks.Get(r.PathValue("id"))
	if !ok {
		writeError(w, 404, "task_not_found", "task not found")
		return
	}
	writeJSON(w, 200, t)
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
	writeError(w, http.StatusNotImplemented, "not_implemented", "endpoint pending; see docs/api.md")
}
