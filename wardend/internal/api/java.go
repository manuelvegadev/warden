package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/java"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

func (s *server) listJava(w http.ResponseWriter, r *http.Request) {
	installed, err := s.Java.List()
	if err != nil {
		writeError(w, 500, "java_list_failed", err.Error())
		return
	}
	if installed == nil {
		installed = []java.Runtime{}
	}
	out := map[string]any{"installed": installed}
	if avail, err := s.Java.Available(r.Context()); err == nil {
		out["available"] = avail
	} else {
		out["availableError"] = err.Error()
	}
	writeJSON(w, 200, out)
}

func (s *server) installJava(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Major int `json:"major"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Major < 8 {
		writeError(w, 400, "bad_request", "major (>= 8) is required")
		return
	}
	t := s.Tasks.Run(r.Context(), "java.install", "", func(ctx context.Context, report tasks.Reporter) error {
		_, err := s.Java.Install(ctx, body.Major, report)
		return err
	})
	writeJSON(w, 202, map[string]any{"task": t})
}

func (s *server) removeJava(w http.ResponseWriter, r *http.Request) {
	if err := s.Java.Remove(r.PathValue("id")); err != nil {
		if errors.Is(err, java.ErrNotFound) {
			writeError(w, 404, "java_not_found", err.Error())
			return
		}
		writeError(w, 400, "java_remove_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) javaRequired(w http.ResponseWriter, r *http.Request) {
	mc := r.URL.Query().Get("mc")
	need := java.RequiredMajor(mc)
	out := map[string]any{"mcVersion": mc, "requiredMajor": need}
	if best := s.Java.Best(need); best != nil {
		out["runtime"] = best
	}
	writeJSON(w, 200, out)
}
