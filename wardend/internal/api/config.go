package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/instance"
)

// instanceJSON looks up the instance and writes fn's result as JSON.
// instanceOr404 resolves {id}; on failure it has already written the 404.
func (s *server) instanceOr404(w http.ResponseWriter, r *http.Request) (*instance.Instance, bool) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return nil, false
	}
	return inst, true
}

func (s *server) instanceJSON(w http.ResponseWriter, r *http.Request, fn func(*instance.Instance) (any, error)) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	v, err := fn(inst)
	if err != nil {
		writeError(w, 500, "read_failed", err.Error())
		return
	}
	writeJSON(w, 200, v)
}

// ---- server.properties

func (s *server) getProperties(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.Properties() })
}

func (s *server) putProperties(w http.ResponseWriter, r *http.Request) {
	var updates map[string]string
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil || len(updates) == 0 {
		writeError(w, 400, "bad_json", "expected an object of key/value strings")
		return
	}
	s.propertiesResult(w, r, func(i *instance.Instance) (bool, error) { return i.UpdateProperties(updates) })
}

func (s *server) getPropertiesRaw(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	text, err := inst.PropertiesRaw()
	if err != nil {
		writeError(w, 500, "read_failed", err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(text))
}

func (s *server) putPropertiesRaw(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
	if err != nil {
		writeError(w, 400, "bad_request", err.Error())
		return
	}
	s.propertiesResult(w, r, func(i *instance.Instance) (bool, error) { return i.UpdatePropertiesRaw(string(body)) })
}

// propertiesResult maps a properties write to {restartRequired} or a 400 with the validation message.
func (s *server) propertiesResult(w http.ResponseWriter, r *http.Request, fn func(*instance.Instance) (bool, error)) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	restart, err := fn(inst)
	if err != nil {
		writeError(w, 400, "invalid_property", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"restartRequired": restart})
}

// ---- whitelist / ops / bans

func (s *server) getWhitelist(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.Whitelist() })
}

func (s *server) addWhitelist(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.WhitelistAdd(r.Context(), r.PathValue("name")) })
}

func (s *server) removeWhitelist(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.WhitelistRemove(r.PathValue("name")) })
}

func (s *server) getOps(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.Ops() })
}

func (s *server) addOp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Level int `json:"level"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.OpAdd(r.Context(), r.PathValue("name"), body.Level) })
}

func (s *server) removeOp(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.OpRemove(r.PathValue("name")) })
}

func (s *server) getBans(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.Bans() })
}

// addBan accepts {"target": "<name or ip>", "reason": ""}; the daemon decides which kind of ban it is.
func (s *server) addBan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Target string `json:"target"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Target == "" {
		writeError(w, 400, "bad_request", "target (player name or ip) is required")
		return
	}
	source := "wardend"
	if p, ok := auth.FromContext(r.Context()); ok && p.Name != "" {
		source = p.Name
	}
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.Ban(r.Context(), body.Target, body.Reason, source) })
}

func (s *server) removeBan(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.Pardon(r.PathValue("target")) })
}
