// Package auth verifies the JWTs issued by Beacon (Better Auth, jwt plugin) using its JWKS,
// and checks the shared panel key. wardend has no users of its own (ADR-009).
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

// Principal is the authenticated identity carried in the request context.
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
	devMode  bool // no JWKS configured: local development only, rejects everything except /health
}

type Options struct {
	JWKSURL  string // https://beacon.example.com/api/auth/jwks
	Issuer   string // https://beacon.example.com (BETTER_AUTH_URL)
	PanelKey string // shared X-Panel-Key secret; empty = not required (dev only)
}

func NewVerifier(ctx context.Context, o Options) (*Verifier, error) {
	v := &Verifier{issuer: o.Issuer, panelKey: o.PanelKey, jwksURL: o.JWKSURL}
	if o.JWKSURL == "" {
		slog.Warn("auth: WARDEND_PANEL_JWKS_URL is empty; the whole API stays protected with no access (dev mode)")
		v.devMode = true
		return v, nil
	}
	c, err := jwk.NewCache(ctx, httprc.NewClient())
	if err != nil {
		return nil, err
	}
	// Refresh every hour; on an unknown `kid` jwx refreshes on demand in Lookup.
	if err := c.Register(ctx, o.JWKSURL, jwk.WithMinInterval(time.Hour)); err != nil {
		return nil, fmt.Errorf("register jwks %s: %w", o.JWKSURL, err)
	}
	v.cache = c
	return v, nil
}

var ErrUnauthorized = errors.New("unauthorized")

// Verify validates the signature (JWKS), iss, aud, exp and returns the Principal.
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

// CheckPanelKey compares X-Panel-Key in constant time. If no key is configured, it is not required.
func (v *Verifier) CheckPanelKey(r *http.Request) bool {
	if v.panelKey == "" {
		return true
	}
	got := r.Header.Get("X-Panel-Key")
	return subtle.ConstantTimeCompare([]byte(got), []byte(v.panelKey)) == 1
}

// BearerToken extracts the token from Authorization: Bearer <jwt>.
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
