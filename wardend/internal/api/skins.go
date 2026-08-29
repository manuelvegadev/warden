package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/manuelvega/warden/wardend/internal/skins"
)

// playerSkin serves a player's skin PNG, or with ?face=<px> the head crop. 404 when Mojang has none.
func (s *server) playerSkin(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	px, _ := strconv.Atoi(r.URL.Query().Get("face"))
	var data []byte
	var err error
	if px > 0 {
		data, err = s.Skins.Face(r.Context(), name, px)
	} else {
		data, err = s.Skins.Skin(r.Context(), name)
	}
	if err != nil {
		if errors.Is(err, skins.ErrNoSkin) {
			w.Header().Set("Cache-Control", "private, max-age=3600")
			writeError(w, 404, "no_skin", err.Error())
			return
		}
		writeError(w, 502, "upstream_error", err.Error())
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(data)
}
