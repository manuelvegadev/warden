package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/lod"
	"github.com/manuelvega/warden/wardend/internal/world"
)

type lodInstalled struct {
	Brand    lod.Brand `json:"brand"`
	FileName string    `json:"fileName"`
	Version  string    `json:"version"`
	Enabled  bool      `json:"enabled"`
}

type lodProvider struct {
	*lod.Provider
	Installed   *lodInstalled `json:"installed,omitempty"`
	Compat      lod.Compat    `json:"compat"`
	Disk        []lod.Usage   `json:"disk"`
	StoreStatus string        `json:"storeStatus,omitempty"`
}

// newestKnown is the version the compatibility of a plugin that is not installed is shown for.
var newestKnown = map[lod.Kind]string{lod.DHS: "0.14.0", lod.LSS: "0.14.0"}

// getLOD is GET /instances/{id}/lod: the Distant view section's state (ADR-025).
func (s *server) getLOD(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	id := inst.Manifest.ID
	running, _ := inst.Running()
	settings := inst.LOD()
	worlds := inst.Worlds()
	if worlds == nil {
		worlds = []string{}
	}
	pregens := s.LOD.States(id)
	if pregens == nil {
		pregens = []lod.PregenState{}
	}
	out := map[string]any{
		"supported":         inst.LiveViewSupported(),
		"agent":             s.World.AgentConnected(id),
		"agentRuns":         s.World.AgentRuns(id),
		"worlds":            worlds,
		"backupIncludeData": settings.BackupIncludeData,
		"pregens":           pregens,
	}
	installed := inst.LODInstalled()
	var providers []lodProvider
	for _, p := range lod.Providers() {
		lp := lodProvider{Provider: p, Compat: p.Compat(newestKnown[p.Kind]), Disk: []lod.Usage{}}
		for _, in := range installed {
			if in.Provider != p {
				continue
			}
			lp.Installed = &lodInstalled{Brand: in.Brand, FileName: in.FileName, Version: in.Version, Enabled: in.Enabled}
			lp.Compat = p.Compat(in.Version)
			if use := lod.DiskUse(inst.ServerDir(), p.Stores(in.Brand, inst.Worlds())); use != nil {
				lp.Disk = use
			}
			if p.Kind == lod.LSS && in.Enabled && running {
				ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
				if lines, err := s.World.Run(ctx, id, in.Brand.Command+" store status"); err == nil {
					lp.StoreStatus = lod.StoreStatus(lines)
				}
				cancel()
			}
		}
		providers = append(providers, lp)
	}
	out["providers"] = providers
	writeJSON(w, 200, out)
}

// lodPlugin resolves {kind} to an installed plugin of the instance.
func (s *server) lodPlugin(w http.ResponseWriter, r *http.Request) (*instance.Instance, lod.Installed, bool) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return nil, lod.Installed{}, false
	}
	kind := lod.Kind(r.PathValue("kind"))
	for _, in := range inst.LODInstalled() {
		if in.Provider.Kind == kind {
			return inst, in, true
		}
	}
	writeError(w, 404, "not_installed", "that LOD plugin is not installed")
	return nil, lod.Installed{}, false
}

func (s *server) getLODConfig(w http.ResponseWriter, r *http.Request) {
	inst, in, ok := s.lodPlugin(w, r)
	if !ok {
		return
	}
	rel, exists, values, err := inst.LODConfig(in)
	if err != nil {
		writeError(w, 422, "bad_config", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"path": rel, "exists": exists, "keys": in.Provider.Keys, "values": values})
}

func (s *server) putLODConfig(w http.ResponseWriter, r *http.Request) {
	inst, in, ok := s.lodPlugin(w, r)
	if !ok {
		return
	}
	var body struct {
		Values map[string]any `json:"values"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil || len(body.Values) == 0 {
		writeError(w, 400, "bad_request", "values is required")
		return
	}
	values, err := in.Provider.Validate(body.Values)
	if err != nil {
		writeError(w, 400, "invalid", err.Error())
		return
	}
	applied, restart, err := inst.SaveLODConfig(r.Context(), in, values, s.World)
	switch {
	case errors.Is(err, instance.ErrNoLODConfig):
		writeError(w, 409, "no_config", err.Error())
		return
	case errors.Is(err, instance.ErrBadLODConfig):
		writeError(w, 422, "bad_config", err.Error())
		return
	case err != nil:
		writeError(w, 500, "write_failed", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"applied": applied, "restart": restart})
}

func (s *server) deleteLODData(w http.ResponseWriter, r *http.Request) {
	inst, in, ok := s.lodPlugin(w, r)
	if !ok {
		return
	}
	if st := inst.State(); st != instance.StateStopped && st != instance.StateCrashed {
		writeError(w, 409, "running", "stop the server first: its LOD database is open")
		return
	}
	if err := lod.DeleteData(inst.ServerDir(), in.Provider.Stores(in.Brand, inst.Worlds())); err != nil {
		writeError(w, 500, "delete_failed", err.Error())
		return
	}
	w.WriteHeader(204)
}

func (s *server) putLODSettings(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var body struct {
		BackupIncludeData *bool `json:"backupIncludeData"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.BackupIncludeData == nil {
		writeError(w, 400, "bad_request", "backupIncludeData is required")
		return
	}
	if err := inst.UpdateLOD(func(st *lod.Settings) { st.BackupIncludeData = *body.BackupIncludeData }); err != nil {
		writeError(w, 500, "save_failed", err.Error())
		return
	}
	w.WriteHeader(204)
}

func (s *server) startPregen(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var p lod.Pregen
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil || p.World == "" {
		writeError(w, 400, "bad_request", "world is required")
		return
	}
	// DHS reads pregen start's arguments positionally ([world] [x z] [radius]): a radius sent
	// without a centre would be read as x, and one of x/z without the other is meaningless.
	if (p.X == nil) != (p.Z == nil) {
		writeError(w, 400, "bad_request", "x and z go together")
		return
	}
	if p.Radius != nil && p.X == nil {
		writeError(w, 400, "bad_request", "a radius needs a centre")
		return
	}
	if p.Radius != nil && (*p.Radius < 1 || *p.Radius > 4096) {
		writeError(w, 400, "bad_request", "radius must be between 1 and 4096 chunks")
		return
	}
	s.pregenResult(w, s.LOD.Start(r.Context(), inst.Manifest.ID, p))
}

func (s *server) stopPregen(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	s.pregenResult(w, s.LOD.Stop(r.Context(), inst.Manifest.ID, r.PathValue("world")))
}

func (s *server) pregenResult(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		w.WriteHeader(204)
	case errors.Is(err, lod.ErrNotRunning):
		writeError(w, 409, "not_running", err.Error())
	case errors.Is(err, world.ErrAgentUnavailable):
		writeError(w, 409, "agent_unavailable", "the Warden Agent is not connected")
	case errors.Is(err, world.ErrCompleteTimeout), errors.Is(err, context.DeadlineExceeded):
		writeError(w, 504, "timeout", "the server did not answer in time: the command may still have run; check again in a moment")
	default:
		writeError(w, 400, "refused", err.Error())
	}
}
