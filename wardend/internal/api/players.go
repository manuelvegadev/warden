package api

import (
	"net/http"
	"strconv"
	"strings"
)

func (s *server) listPlayers(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	players, err := s.Store.Players(r.Context(), inst.Manifest.ID)
	if err != nil {
		writeError(w, 500, "players_failed", err.Error())
		return
	}
	// The live process is the source of truth for "online".
	online := map[string]bool{}
	for _, p := range inst.Status().Players {
		online[p] = true
	}
	for i := range players {
		players[i].Online = online[players[i].Name]
	}
	writeJSON(w, 200, players)
}

func (s *server) playerSessions(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	sessions, err := s.Store.Sessions(r.Context(), inst.Manifest.ID, r.PathValue("name"), limit)
	if err != nil {
		writeError(w, 500, "sessions_failed", err.Error())
		return
	}
	writeJSON(w, 200, sessions)
}

func (s *server) listEvents(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var kinds []string
	if k := r.URL.Query().Get("kind"); k != "" {
		kinds = strings.Split(k, ",")
	}
	events, err := s.Store.Events(r.Context(), inst.Manifest.ID, kinds, limit)
	if err != nil {
		writeError(w, 500, "events_failed", err.Error())
		return
	}
	writeJSON(w, 200, events)
}
