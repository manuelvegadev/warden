package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

func (s *server) searchPlugins(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	limit, _ := strconv.Atoi(qs.Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	offset, _ := strconv.Atoi(qs.Get("offset"))
	res, err := s.Catalog.SearchPlugins(r.Context(), qs.Get("source"), qs.Get("q"), qs.Get("mc"), limit, offset)
	if err != nil {
		writeError(w, 502, "upstream_error", err.Error())
		return
	}
	writeJSON(w, 200, res)
}

func (s *server) getPlugin(w http.ResponseWriter, r *http.Request) {
	src, err := s.Catalog.PluginSource(r.PathValue("source"))
	if err != nil {
		writeError(w, 404, "unknown_source", err.Error())
		return
	}
	hit, err := src.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, 502, "upstream_error", err.Error())
		return
	}
	writeJSON(w, 200, hit)
}

func (s *server) pluginVersions(w http.ResponseWriter, r *http.Request) {
	src, err := s.Catalog.PluginSource(r.PathValue("source"))
	if err != nil {
		writeError(w, 404, "unknown_source", err.Error())
		return
	}
	versions, err := src.Versions(r.Context(), r.PathValue("id"), r.URL.Query().Get("mc"))
	if err != nil {
		writeError(w, 502, "upstream_error", err.Error())
		return
	}
	writeJSON(w, 200, versions)
}

// pluginIcon serves the icon fetched at install time; 404 when the plugin has none.
func (s *server) pluginIcon(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	path := inst.PluginIconPath(r.PathValue("file"))
	if path == "" {
		writeError(w, 404, "no_icon", "plugin has no icon")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, path)
}

func (s *server) listInstancePlugins(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.Plugins() })
}

// installPlugin starts an install task: {"source":"hangar","projectId":"ViaVersion","versionId":"latest"}.
func (s *server) installPlugin(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	var body struct {
		Source    string `json:"source"`
		ProjectID string `json:"projectId"`
		VersionID string `json:"versionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Source == "" || body.ProjectID == "" {
		writeError(w, 400, "bad_request", "source and projectId are required")
		return
	}
	if _, err := s.Catalog.PluginSource(body.Source); err != nil {
		writeError(w, 400, "unknown_source", err.Error())
		return
	}
	t := s.Tasks.Run(r.Context(), "plugin.install", inst.Manifest.ID, func(ctx context.Context, report tasks.Reporter) error {
		return inst.InstallPlugin(ctx, s.Catalog, body.Source, body.ProjectID, body.VersionID, report)
	})
	writeJSON(w, 202, map[string]any{"task": t})
}
