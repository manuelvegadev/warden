package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/instance"
)

func (s *server) playerStats(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.PlayerStats(r.Context(), r.PathValue("name")) })
}

func (s *server) playerAdvancements(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) {
		return i.PlayerAdvancements(r.Context(), r.PathValue("name"))
	})
}

// playerAction runs a moderation command: {"action":"message|kick|op|deop","text":"…"}.
func (s *server) playerAction(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var body struct {
		Action string `json:"action"`
		Text   string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "bad_request", err.Error())
		return
	}
	err := inst.PlayerAction(r.PathValue("name"), body.Action, body.Text)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, instance.ErrNotRunning):
		writeError(w, 409, "invalid_state", err.Error())
	case errors.Is(err, instance.ErrUnknownPlayerAction), errors.Is(err, instance.ErrBadName):
		writeError(w, 400, "bad_request", err.Error())
	default:
		writeError(w, 400, "action_failed", err.Error())
	}
}
