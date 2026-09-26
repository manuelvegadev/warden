package api

import (
	"errors"
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/world"
)

// completeCommand is GET /instances/{id}/console/complete?line=…: the agent's completions for the
// token that ends `line` (ADR-024). The panel asks as the admin types and aborts what a newer
// keystroke replaces; the abort cancels the request context, which ends the wait here.
func (s *server) completeCommand(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	line := r.URL.Query().Get("line")
	if len(line) > world.MaxCompleteLine {
		writeError(w, 400, "line_too_long", "at most 1024 characters")
		return
	}
	res, err := s.World.Complete(r.Context(), inst.Manifest.ID, line)
	switch {
	case err == nil:
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, res)
	case r.Context().Err() != nil:
		// The browser moved on; nobody reads the answer.
	case errors.Is(err, world.ErrAgentUnavailable):
		writeError(w, 409, "agent_unavailable", err.Error())
	case errors.Is(err, world.ErrSuperseded):
		writeError(w, 409, "superseded", err.Error())
	case errors.Is(err, world.ErrCompleteTimeout):
		writeError(w, 504, "timeout", err.Error())
	default:
		writeError(w, 502, "completion_failed", err.Error())
	}
}
