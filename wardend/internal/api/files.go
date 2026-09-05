package api

import (
	"io"
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/instance"
)

func (s *server) listConfigFiles(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.ConfigFiles() })
}

// getConfigFile serves the text of an allowlisted file: GET /instances/{id}/files/content?path=bukkit.yml
func (s *server) getConfigFile(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	text, err := inst.ReadConfigFile(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	io.WriteString(w, text)
}

// putConfigFile replaces the file with the request body (text/plain), after syntax validation.
func (s *server) putConfigFile(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, instance.MaxConfigBytes+1))
	if err != nil {
		writeError(w, 400, "bad_request", err.Error())
		return
	}
	restart, err := inst.WriteConfigFile(r.URL.Query().Get("path"), string(body))
	if err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"restartRequired": restart})
}
