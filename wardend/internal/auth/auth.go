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
	"sync"
	"time"

	"github.com/lestrrat-go/httprc/v3"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jws"
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
	issuer    string
	panelKey  string
	cache     *jwk.Cache
	mu        sync.Mutex
	lastFetch time.Time
	lastErr   error
	jwksURL   string
	devMode   bool // no JWKS configured: local development only, rejects everything except /health
}

type Options struct {
	JWKSURL  string // https://beacon.example.com/api/auth/jwks
	Issuer   string // https://beacon.example.com (BETTER_AUTH_URL)
	PanelKey string // shared X-Panel-Key secret; empty = not required (dev only)
}

func NewVerifier(ctx context.Context, o Options) (*Verifier, error) {
	v := &Verifier{issuer: o.Issuer, panelKey: o.PanelKey, jwksURL: o.JWKSURL}
	if o.JWKSURL == "" {
		slog.Warn("auth: WARDEND_PANEL_JWKS_URL is empty; every authenticated request will fail; set WARDEND_PANEL_JWKS_URL and WARDEND_PANEL_ISSUER to Beacon's URL (or use `make run`)")
		v.devMode = true
		return v, nil
	}
	c, err := jwk.NewCache(ctx, httprc.NewClient())
	if err != nil {
		return nil, err
	}
	// Background refresh every hour; unknown kids and cold caches are handled by provideKey.
	// WithWaitReady(false): never block startup on the panel being reachable.
	if err := c.Register(ctx, o.JWKSURL,
		jwk.WithMinInterval(time.Hour),
		jwk.WithWaitReady(false),
		jwk.WithHTTPClient(&http.Client{Timeout: 10 * time.Second}),
	); err != nil {
		return nil, fmt.Errorf("register jwks %s: %w", o.JWKSURL, err)
	}
	v.cache = c
	return v, nil
}

var ErrUnauthorized = errors.New("unauthorized")

// jwksRetry bounds how often the JWKS is re-fetched (panel unreachable, or an unknown key id).
const jwksRetry = 5 * time.Second

// Verify validates the signature (JWKS), iss, aud, exp and returns the Principal.
func (v *Verifier) Verify(ctx context.Context, raw string) (*Principal, error) {
	if v.devMode {
		return nil, fmt.Errorf("%w: wardend has no WARDEND_PANEL_JWKS_URL configured, so it cannot verify Beacon tokens", ErrUnauthorized)
	}
	tok, err := jwt.Parse([]byte(raw),
		jwt.WithKeyProvider(jws.KeyProviderFunc(v.provideKey)),
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

// provideKey hands jws the key named by the token's kid. The cached set is tried first; a miss
// (panel rotated its keys) or an empty cache (panel started after the daemon) triggers one
// throttled refresh before giving up.
func (v *Verifier) provideKey(ctx context.Context, sink jws.KeySink, sig *jws.Signature, _ *jws.Message) error {
	hdr := sig.ProtectedHeaders()
	kid, _ := hdr.KeyID()
	alg, ok := hdr.Algorithm()
	if !ok {
		return errors.New("token has no alg header")
	}
	set, err := v.cache.Lookup(ctx, v.jwksURL)
	if err == nil {
		if key, found := set.LookupKeyID(kid); found {
			sink.Key(alg, key)
			return nil
		}
	}
	set, err = v.refresh(ctx)
	if err != nil {
		return fmt.Errorf("jwks: %w", err)
	}
	key, found := set.LookupKeyID(kid)
	if !found {
		return fmt.Errorf("key %q not in the panel's JWKS", kid)
	}
	sink.Key(alg, key)
	return nil
}

// refresh re-fetches the key set, at most once per jwksRetry; inside the window it returns the
// last outcome (the cached set, or the last fetch error).
func (v *Verifier) refresh(ctx context.Context) (jwk.Set, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if time.Since(v.lastFetch) < jwksRetry {
		if v.lastErr != nil {
			return nil, v.lastErr
		}
		return v.cache.Lookup(ctx, v.jwksURL)
	}
	v.lastFetch = time.Now()
	set, err := v.cache.Refresh(ctx, v.jwksURL)
	v.lastErr = err
	if err != nil {
		slog.Warn("auth: jwks fetch failed; retrying on the next request", "url", v.jwksURL, "err", err)
		return nil, err
	}
	slog.Info("auth: jwks loaded", "url", v.jwksURL)
	return set, nil
}

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
