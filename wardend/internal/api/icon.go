package api

import (
	"errors"
	"io"
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/instance"
)

// The server icon is a binary next to server.properties, so it gets its own routes: the config
// file API is text-only by design and must stay that way.

// getServerIcon serves server-icon.png, or 404 when the instance has none.
func (s *server) getServerIcon(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	b, err := inst.ServerIcon()
	if err != nil {
		if errors.Is(err, instance.ErrNoIcon) {
			writeError(w, 404, "no_icon", "instance has no server icon")
			return
		}
		writeError(w, 500, "read_failed", err.Error())
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store") // it changes the moment someone saves a new one
	w.Write(b)
}

// putServerIcon replaces the icon with the request body, which must be a 64x64 PNG.
func (s *server) putServerIcon(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, instance.MaxIconBytes+1))
	if err != nil {
		writeError(w, 413, "too_large", err.Error())
		return
	}
	if err := inst.SetServerIcon(body); err != nil {
		if errors.Is(err, instance.ErrIconInvalid) {
			writeError(w, 400, "invalid_icon", err.Error())
			return
		}
		writeError(w, 500, "write_failed", err.Error())
		return
	}
	// Vanilla reads the icon once, at boot, and caches it in the status response.
	writeJSON(w, 200, map[string]any{"restartRequired": true})
}

// deleteServerIcon removes the icon; the client then draws its own placeholder.
func (s *server) deleteServerIcon(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	if err := inst.RemoveServerIcon(); err != nil {
		writeError(w, 500, "delete_failed", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"restartRequired": true})
}
