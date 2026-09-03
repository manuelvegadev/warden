package api

import "net/http"

// getVoice is GET /instances/{id}/voice: whether Simple Voice Chat is loaded, its distances and
// consent policy, and who is listening from the panel right now (ADR-019).
func (s *server) getVoice(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	writeJSON(w, 200, s.Voice.Status(inst.Manifest.ID))
}
