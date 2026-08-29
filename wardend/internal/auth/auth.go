// Package auth verifica los JWT emitidos por Beacon (Better Auth, plugin jwt) usando su JWKS,
// y comprueba la clave compartida del panel. wardend no tiene usuarios propios (ADR-009).
package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/lestrrat-go/httprc/v3"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

const Audience = "wardend"

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
)

// Principal es la identidad autenticada que viaja en el contexto de la petición.
type Principal struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	Role   Role   `json:"role"`
}

func (p Principal) IsAdmin() bool { return p.Role == RoleAdmin }

type Verifier struct {
	issuer   string
	panelKey string
	cache    *jwk.Cache
	jwksURL  string
	devMode  bool // sin JWKS configurado: solo para desarrollo local, rechaza todo salvo /health
}

type Options struct {
	JWKSURL  string // https://beacon.example.com/api/auth/jwks
	Issuer   string // https://beacon.example.com (BETTER_AUTH_URL)
	PanelKey string // secreto compartido X-Panel-Key; vacío = no exigir (solo dev)
}

func NewVerifier(ctx context.Context, o Options) (*Verifier, error) {
	v := &Verifier{issuer: o.Issuer, panelKey: o.PanelKey, jwksURL: o.JWKSURL}
	if o.JWKSURL == "" {
		slog.Warn("auth: WARDEND_PANEL_JWKS_URL vacío; toda la API queda protegida y sin acceso (modo dev)")
		v.devMode = true
		return v, nil
	}
	c, err := jwk.NewCache(ctx, httprc.NewClient())
	if err != nil {
		return nil, err
	}
	// Refresco cada hora; ante un `kid` desconocido jwx refresca bajo demanda en Lookup.
	if err := c.Register(ctx, o.JWKSURL, jwk.WithMinInterval(time.Hour)); err != nil {
		return nil, fmt.Errorf("register jwks %s: %w", o.JWKSURL, err)
	}
	v.cache = c
	return v, nil
}

var ErrUnauthorized = errors.New("unauthorized")

// Verify valida firma (JWKS), iss, aud, exp y devuelve el Principal.
func (v *Verifier) Verify(ctx context.Context, raw string) (*Principal, error) {
	if v.devMode {
		return nil, ErrUnauthorized
	}
	set, err := v.cache.Lookup(ctx, v.jwksURL)
	if err != nil {
		return nil, fmt.Errorf("jwks lookup: %w", err)
	}
	tok, err := jwt.Parse([]byte(raw),
		jwt.WithKeySet(set),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(Audience),
		jwt.WithAcceptableSkew(30*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnauthorized, err)
	}
	p := &Principal{Role: RoleOperator}
	p.UserID, _ = tok.Subject()
	var s string
	if err := tok.Get("email", &s); err == nil {
		p.Email = s
	}
	if err := tok.Get("name", &s); err == nil {
		p.Name = s
	}
	if err := tok.Get("role", &s); err == nil && s == string(RoleAdmin) {
		p.Role = RoleAdmin
	}
	if p.UserID == "" {
		return nil, fmt.Errorf("%w: missing sub", ErrUnauthorized)
	}
	return p, nil
}

// CheckPanelKey compara X-Panel-Key en tiempo constante. Si no hay clave configurada, no se exige.
func (v *Verifier) CheckPanelKey(r *http.Request) bool {
	if v.panelKey == "" {
		return true
	}
	got := r.Header.Get("X-Panel-Key")
	return subtle.ConstantTimeCompare([]byte(got), []byte(v.panelKey)) == 1
}

// BearerToken extrae el token de Authorization: Bearer <jwt>.
func BearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

type ctxKey struct{}

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

func FromContext(ctx context.Context) (*Principal, bool) {
	p, ok := ctx.Value(ctxKey{}).(*Principal)
	return p, ok
}
