package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

func (s *server) listBackups(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.Backups() })
}

// createBackup starts a backup task: {"scope":"full|worlds"} (default: the instance's setting, else full).
func (s *server) createBackup(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var body struct {
		Scope string `json:"scope"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, 202, map[string]any{"task": instance.StartBackup(r.Context(), s.Tasks, inst, "manual", body.Scope)})
}

func (s *server) downloadBackup(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	path, err := inst.BackupPath(r.PathValue("name"))
	if err != nil {
		writeError(w, backupErrStatus(err), "not_found", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/zstd")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+r.PathValue("name")+"\"")
	http.ServeFile(w, r, path)
}

func (s *server) restoreBackup(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	if _, err := inst.BackupPath(name); err != nil {
		writeError(w, backupErrStatus(err), "not_found", err.Error())
		return
	}
	if !s.requireStopped(w, inst) {
		return
	}
	t := s.Tasks.Run(r.Context(), "restore", inst.Manifest.ID, func(ctx context.Context, report tasks.Reporter) error {
		return inst.Restore(ctx, name, report)
	})
	writeJSON(w, 202, map[string]any{"task": t})
}

func (s *server) deleteBackup(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	if err := inst.DeleteBackup(r.PathValue("name")); err != nil {
		writeError(w, backupErrStatus(err), "delete_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func backupErrStatus(err error) int {
	if errors.Is(err, os.ErrNotExist) {
		return 404
	}
	return 400
}
