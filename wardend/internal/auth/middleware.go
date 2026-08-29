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

// Middleware exige X-Panel-Key (si está configurada) y un JWT válido; deja el Principal en el contexto.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !v.CheckPanelKey(r) {
			writeErr(w, http.StatusForbidden, "bad_panel_key", "X-Panel-Key inválida")
			return
		}
		raw := BearerToken(r)
		if raw == "" {
			writeErr(w, http.StatusUnauthorized, "unauthenticated", "falta Authorization: Bearer")
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

// RequireAdmin envuelve un handler que solo pueden usar administradores.
func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, ok := FromContext(r.Context())
		if !ok || !p.IsAdmin() {
			writeErr(w, http.StatusForbidden, "forbidden", "requiere rol admin")
			return
		}
		next(w, r)
	}
}
