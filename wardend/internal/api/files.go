package api

import (
	"errors"
	"io"
	"net/http"
	"os"

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
		writeError(w, fileErrStatus(err), "read_failed", err.Error())
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
		writeError(w, fileErrStatus(err), "write_failed", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"restartRequired": restart})
}

func fileErrStatus(err error) int {
	switch {
	case errors.Is(err, os.ErrNotExist):
		return 404
	case errors.Is(err, instance.ErrFileNotAllowed):
		return 403
	case errors.Is(err, instance.ErrInvalidSyntax), errors.Is(err, instance.ErrFileTooLarge):
		return 400
	}
	return 500
}
