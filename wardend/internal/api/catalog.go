package api

import (
	"net/http"

	"github.com/manuelvega/warden/wardend/internal/catalog"
)

func (s *server) catalogServers(w http.ResponseWriter, _ *http.Request) {
	type p struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		catalog.Traits
	}
	var out []p
	for _, prov := range s.Catalog.Providers() {
		out = append(out, p{prov.ID(), prov.Name(), prov.Traits()})
	}
	writeJSON(w, 200, out)
}

func (s *server) catalogVersions(w http.ResponseWriter, r *http.Request) {
	prov, err := s.Catalog.Provider(r.PathValue("provider"))
	if err != nil {
		writeError(w, 404, "unknown_provider", err.Error())
		return
	}
	v, err := prov.Versions(r.Context(), r.URL.Query().Get("includePre") == "true")
	if err != nil {
		writeError(w, 502, "upstream_error", err.Error())
		return
	}
	writeJSON(w, 200, v)
}

func (s *server) catalogBuilds(w http.ResponseWriter, r *http.Request) {
	prov, err := s.Catalog.Provider(r.PathValue("provider"))
	if err != nil {
		writeError(w, 404, "unknown_provider", err.Error())
		return
	}
	builds, err := prov.Builds(r.Context(), r.PathValue("mc"))
	if err != nil {
		writeError(w, 502, "upstream_error", err.Error())
		return
	}
	if ch := r.URL.Query().Get("channel"); ch != "" {
		filtered := builds[:0:0]
		for _, b := range builds {
			if b.Channel == ch || (ch == "STABLE" && b.Channel == "RECOMMENDED") {
				filtered = append(filtered, b)
			}
		}
		builds = filtered
	}
	if builds == nil {
		builds = []catalog.Build{}
	}
	writeJSON(w, 200, builds)
}
