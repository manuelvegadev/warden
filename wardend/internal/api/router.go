// Package api exposes the REST API v1 described in docs/api.md.
package api

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/config"
	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/java"
	"github.com/manuelvega/warden/wardend/internal/metrics"
	"github.com/manuelvega/warden/wardend/internal/skins"
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
	Skins    *skins.Service
	WS       http.Handler
	// Sessions closes a user's live WebSocket connections when Beacon revokes their access.
	Sessions interface{ RevokeUser(string) int }
	Version  string
	// StartedAt is when the daemon process came up; the panel derives the uptime from it.
	StartedAt time.Time
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

	// Host powers need a capability. Everything under an instance is mounted through `inst`, which
	// makes naming the required role part of registering the route — a new instance route cannot be
	// added without deciding who may call it — and answers 404 rather than 403 when the caller has
	// no grant, so the set of instances on the node does not leak (ADR-017 §5).
	inst := func(pattern string, a auth.Action, h http.HandlerFunc) {
		mux.HandleFunc(pattern, auth.OnInstance(a, h))
	}
	read := func(pattern string, h http.HandlerFunc) { inst(pattern, auth.ActionRead, h) }

	// System
	mux.HandleFunc("GET /api/v1/system", s.system)
	mux.HandleFunc("GET /api/v1/system/update", s.getUpdate)
	mux.HandleFunc("POST /api/v1/system/update", auth.RequireCap(auth.CapSystemUpdate, s.applyUpdate))
	mux.HandleFunc("POST /api/v1/sessions/revoke", s.revokeSessions) // server-to-server, needs members.manage
	mux.HandleFunc("GET /api/v1/auth/me", s.me)
	mux.HandleFunc("GET /api/v1/tasks", s.listTasks)
	mux.HandleFunc("GET /api/v1/tasks/{id}", s.getTask)

	// Java runtimes (ADR-010)
	mux.HandleFunc("GET /api/v1/java", s.listJava)
	mux.HandleFunc("GET /api/v1/java/required", s.javaRequired)
	mux.HandleFunc("POST /api/v1/java", auth.RequireCap(auth.CapJavaManage, s.installJava))
	mux.HandleFunc("DELETE /api/v1/java/{id}", auth.RequireCap(auth.CapJavaManage, s.removeJava))

	// Catalog
	mux.HandleFunc("GET /api/v1/catalog/servers", s.catalogServers)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions", s.catalogVersions)
	mux.HandleFunc("GET /api/v1/catalog/servers/{provider}/versions/{mc}/builds", s.catalogBuilds)
	mux.HandleFunc("GET /api/v1/catalog/plugins/search", s.searchPlugins)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}", s.getPlugin)
	mux.HandleFunc("GET /api/v1/catalog/plugins/{source}/{id}/versions", s.pluginVersions)

	// Instances
	mux.HandleFunc("GET /api/v1/instances", s.listInstances) // filtered by the caller's grants
	mux.HandleFunc("POST /api/v1/instances", auth.RequireCap(auth.CapInstanceCreate, s.createInstance))
	mux.HandleFunc("POST /api/v1/instances/import", auth.RequireCap(auth.CapInstanceCreate, s.importInstance))
	mux.HandleFunc("GET /api/v1/players/{name}/skin", s.playerSkin) // not instance-scoped
	read("GET /api/v1/instances/{id}", s.getInstance)
	inst("PATCH /api/v1/instances/{id}", auth.ActionSettingsWrite, s.patchInstance)
	inst("DELETE /api/v1/instances/{id}", auth.ActionSettingsWrite, auth.RequireCap(auth.CapInstanceDestroy, s.deleteInstance))
	inst("POST /api/v1/instances/{id}/install", auth.ActionSettingsWrite, s.installInstance)
	inst("POST /api/v1/instances/{id}/start", auth.ActionPower, s.startInstance)
	inst("POST /api/v1/instances/{id}/stop", auth.ActionPower, s.stopInstance)
	inst("POST /api/v1/instances/{id}/restart", auth.ActionPower, s.restartInstance)
	inst("POST /api/v1/instances/{id}/kill", auth.ActionPower, s.killInstance)
	inst("POST /api/v1/instances/{id}/command", auth.ActionConsoleSend, s.sendCommand)
	read("GET /api/v1/instances/{id}/console", s.console)
	read("GET /api/v1/instances/{id}/logs", s.listLogs)
	read("GET /api/v1/instances/{id}/logs/{file}", s.getLog)
	read("GET /api/v1/instances/{id}/metrics", s.instanceMetrics)
	inst("POST /api/v1/instances/{id}/eula", auth.ActionSettingsWrite, s.eula)
	read("GET /api/v1/instances/{id}/players", s.listPlayers)
	read("GET /api/v1/instances/{id}/players/{name}/sessions", s.playerSessions)
	read("GET /api/v1/instances/{id}/players/{name}/stats", s.playerStats)
	read("GET /api/v1/instances/{id}/players/{name}/advancements", s.playerAdvancements)
	inst("POST /api/v1/instances/{id}/players/{name}/action", auth.ActionPlayersAction, s.playerAction)
	read("GET /api/v1/instances/{id}/events", s.listEvents)

	// Configuration and access lists. server.properties and the config files are manager-only: they
	// carry rcon.password.
	inst("GET /api/v1/instances/{id}/properties", auth.ActionConfigWrite, s.getProperties)
	inst("PUT /api/v1/instances/{id}/properties", auth.ActionConfigWrite, s.putProperties)
	inst("GET /api/v1/instances/{id}/properties/raw", auth.ActionConfigWrite, s.getPropertiesRaw)
	inst("PUT /api/v1/instances/{id}/properties/raw", auth.ActionConfigWrite, s.putPropertiesRaw)
	inst("GET /api/v1/instances/{id}/files", auth.ActionConfigWrite, s.listConfigFiles)
	inst("GET /api/v1/instances/{id}/files/content", auth.ActionConfigWrite, s.getConfigFile)
	inst("PUT /api/v1/instances/{id}/files/content", auth.ActionConfigWrite, s.putConfigFile)
	read("GET /api/v1/instances/{id}/command", s.launchCommand)
	read("GET /api/v1/instances/{id}/upgrade", s.checkUpgrade)
	inst("POST /api/v1/instances/{id}/upgrade", auth.ActionSettingsWrite, s.startUpgrade)
	read("GET /api/v1/instances/{id}/backups", s.listBackups)
	inst("POST /api/v1/instances/{id}/backups", auth.ActionBackupsWrite, s.createBackup)
	inst("GET /api/v1/instances/{id}/backups/{name}/download", auth.ActionBackupsWrite, s.downloadBackup)
	inst("POST /api/v1/instances/{id}/backups/{name}/restore", auth.ActionBackupsWrite, s.restoreBackup)
	inst("DELETE /api/v1/instances/{id}/backups/{name}", auth.ActionBackupsWrite, s.deleteBackup)
	read("GET /api/v1/instances/{id}/whitelist", s.getWhitelist)
	inst("POST /api/v1/instances/{id}/whitelist/{name}", auth.ActionAccessWrite, s.addWhitelist)
	inst("DELETE /api/v1/instances/{id}/whitelist/{name}", auth.ActionAccessWrite, s.removeWhitelist)
	read("GET /api/v1/instances/{id}/ops", s.getOps)
	inst("POST /api/v1/instances/{id}/ops/{name}", auth.ActionOpsWrite, s.addOp)
	inst("DELETE /api/v1/instances/{id}/ops/{name}", auth.ActionOpsWrite, s.removeOp)
	read("GET /api/v1/instances/{id}/bans", s.getBans)
	inst("POST /api/v1/instances/{id}/bans", auth.ActionAccessWrite, s.addBan)
	inst("DELETE /api/v1/instances/{id}/bans/{target}", auth.ActionAccessWrite, s.removeBan)

	// Plugins
	read("GET /api/v1/instances/{id}/plugins", s.listInstancePlugins)
	read("GET /api/v1/instances/{id}/plugins/updates", s.pluginUpdates)
	read("GET /api/v1/instances/{id}/plugins/{file}/icon", s.pluginIcon)
	inst("POST /api/v1/instances/{id}/plugins", auth.ActionPluginsWrite, s.installPlugin)
	inst("POST /api/v1/instances/{id}/plugins/upload", auth.ActionPluginsWrite, s.uploadPlugin)
	inst("POST /api/v1/instances/{id}/plugins/{file}/toggle", auth.ActionPluginsWrite, s.togglePlugin)
	inst("POST /api/v1/instances/{id}/plugins/{file}/update", auth.ActionPluginsWrite, s.updatePlugin)
	inst("DELETE /api/v1/instances/{id}/plugins/{file}", auth.ActionPluginsWrite, s.removePlugin)

	// Files, backups (see docs/api.md) — later phases
	for _, p := range []string{"schedule"} {
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

// SystemInfo is GET /system: daemon identity plus the host snapshot.
type SystemInfo struct {
	metrics.HostInfo
	Hostname      string    `json:"hostname"`
	OS            string    `json:"os"` // "linux/amd64"
	CPUCores      int       `json:"cpuCores"`
	DaemonVersion string    `json:"daemonVersion"`
	GoVersion     string    `json:"goVersion"`
	StartedAt     time.Time `json:"startedAt"`
}

func (s *server) system(w http.ResponseWriter, r *http.Request) {
	host, _ := os.Hostname()
	writeJSON(w, 200, SystemInfo{HostInfo: s.Metrics.System(r.Context()), Hostname: host, OS: runtime.GOOS + "/" + runtime.GOARCH,
		CPUCores: runtime.NumCPU(), DaemonVersion: s.Version, GoVersion: runtime.Version(), StartedAt: s.StartedAt})
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	writeJSON(w, 200, p)
}

func (s *server) listTasks(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if id := r.URL.Query().Get("instance"); id != "" {
		if p == nil || !p.CanSee(id) {
			writeError(w, 404, "instance_not_found", "instance not found")
			return
		}
		writeJSON(w, 200, s.Tasks.ListInstance(id))
		return
	}
	all := s.Tasks.List()
	out := make([]tasks.Task, 0, len(all))
	for _, t := range all {
		// A task on an instance the caller cannot see would leak that the instance exists.
		if t.InstanceID != "" && (p == nil || !p.CanSee(t.InstanceID)) {
			continue
		}
		out = append(out, t)
	}
	writeJSON(w, 200, out)
}

// revokeSessions drops a user's live connections after Beacon changed their access (ADR-017 §7).
func (s *server) revokeSessions(w http.ResponseWriter, r *http.Request) {
	p, ok := auth.FromContext(r.Context())
	if !ok || !p.HasCap(auth.CapMembersManage) {
		writeError(w, 403, "forbidden", "members.manage is required")
		return
	}
	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" {
		writeError(w, 400, "bad_request", "userId is required")
		return
	}
	closed := 0
	if s.Sessions != nil {
		closed = s.Sessions.RevokeUser(body.UserID)
	}
	writeJSON(w, 200, map[string]any{"closed": closed})
}

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
