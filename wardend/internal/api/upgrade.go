package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// checkUpgrade reports newer builds/versions from the catalog for the instance's software.
func (s *server) checkUpgrade(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.CheckUpgrade(r.Context(), s.Catalog) })
}

// startUpgrade runs the upgrade task: {"mcVersion":"1.21.8","build":0} (both optional).
func (s *server) startUpgrade(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var body struct {
		MCVersion string `json:"mcVersion"`
		Build     int    `json:"build"`
	}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, 400, "bad_request", err.Error())
			return
		}
	}
	if !s.requireStopped(w, inst) {
		return
	}
	t := s.Tasks.Run(r.Context(), "upgrade", inst.Manifest.ID, func(ctx context.Context, report tasks.Reporter) error {
		return inst.Upgrade(ctx, s.Catalog, instance.UpgradeOptions{MCVersion: body.MCVersion, Build: body.Build}, report)
	})
	writeJSON(w, 202, map[string]any{"task": t})
}
