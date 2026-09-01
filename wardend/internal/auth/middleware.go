package auth

import (
	"encoding/json"
	"net/http"
)

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

// Middleware requires X-Panel-Key (if configured) and a valid JWT; it stores the Principal in the context.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !v.CheckPanelKey(r) {
			writeErr(w, http.StatusForbidden, "bad_panel_key", "invalid X-Panel-Key")
			return
		}
		raw := BearerToken(r)
		if raw == "" {
			writeErr(w, http.StatusUnauthorized, "unauthenticated", "missing Authorization: Bearer")
			return
		}
		p, err := v.Verify(r.Context(), raw)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "invalid_token", err.Error())
			return
		}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}
