package ws

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/instance"
)

// testIssuer serves a JWKS and signs tokens like Beacon's Better Auth jwt plugin (EdDSA).
type testIssuer struct {
	srv  *httptest.Server
	priv jwk.Key
}

func newIssuer(t *testing.T) *testIssuer {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	privKey, _ := jwk.Import(priv)
	pubKey, _ := jwk.Import(pub)
	_ = privKey.Set(jwk.KeyIDKey, "k1")
	_ = pubKey.Set(jwk.KeyIDKey, "k1")
	_ = pubKey.Set(jwk.AlgorithmKey, jwa.EdDSA())
	set := jwk.NewSet()
	_ = set.AddKey(pubKey)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/jwks", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(set)
	})
	return &testIssuer{srv: httptest.NewServer(mux), priv: privKey}
}

func (i *testIssuer) token(t *testing.T, role string) string {
	t.Helper()
	tok, _ := jwt.NewBuilder().Issuer(i.srv.URL).Audience([]string{auth.Audience}).Subject("u1").
		Expiration(time.Now().Add(time.Minute)).Claim("role", role).Build()
	b, err := jwt.Sign(tok, jwt.WithKey(jwa.EdDSA(), i.priv, jws.WithProtectedHeaders(func() jws.Headers {
		h := jws.NewHeaders()
		_ = h.Set(jws.KeyIDKey, "k1")
		return h
	}())))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func send(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}

func recv(t *testing.T, c *websocket.Conn) outbound {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var m outbound
	_ = json.Unmarshal(b, &m)
	return m
}

func TestHubAuthAndBroadcast(t *testing.T) {
	iss := newIssuer(t)
	defer iss.srv.Close()
	verifier, err := auth.NewVerifier(context.Background(), auth.Options{JWKSURL: iss.srv.URL + "/api/auth/jwks", Issuer: iss.srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	mgr := instance.NewManager(t.TempDir(), nil)
	hub := NewHub(verifier, mgr, nil)
	mgr.SetBroadcaster(hub)
	srv := httptest.NewServer(hub)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	// Bad token → closed.
	bad := dial(t, url)
	send(t, bad, Message{Type: "auth", Token: "nope"})
	if _, _, err := bad.Read(context.Background()); err == nil {
		t.Fatal("expected close on invalid token")
	}

	// Good token → auth.ok, subscribe → history + state, broadcast → console.
	inst, err := mgr.Create(&instance.Manifest{ID: "srv", Software: "paper", MCVersion: "1.21.8", Port: 25565})
	if err != nil {
		t.Fatal(err)
	}
	c := dial(t, url)
	defer c.Close(websocket.StatusNormalClosure, "")
	send(t, c, Message{Type: "auth", Token: iss.token(t, "admin")})
	if m := recv(t, c); m.Type != "auth.ok" {
		t.Fatalf("got %s, want auth.ok", m.Type)
	}
	send(t, c, Message{Type: "subscribe", Instance: "srv"})
	if m := recv(t, c); m.Type != "console.history" {
		t.Fatalf("got %s, want console.history", m.Type)
	}
	if m := recv(t, c); m.Type != "state" || m.Instance != "srv" {
		t.Fatalf("got %s/%s, want state/srv", m.Type, m.Instance)
	}
	hub.Broadcast("srv", "console", instance.Line{Text: "hello"})
	if m := recv(t, c); m.Type != "console" {
		t.Fatalf("got %s, want console", m.Type)
	}
	hub.Broadcast("other", "console", instance.Line{Text: "not subscribed"})
	send(t, c, Message{Type: "ping"})
	if m := recv(t, c); m.Type != "pong" {
		t.Fatalf("got %s, want pong (unsubscribed broadcast must not leak)", m.Type)
	}
	_ = inst
}

func TestHubAuthTimeout(t *testing.T) {
	verifier, _ := auth.NewVerifier(context.Background(), auth.Options{})
	hub := NewHub(verifier, instance.NewManager(t.TempDir(), nil), nil)
	srv := httptest.NewServer(hub)
	defer srv.Close()
	c := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http"))
	send(t, c, Message{Type: "subscribe", Instance: "x"}) // not auth
	if _, _, err := c.Read(context.Background()); err == nil {
		t.Fatal("expected close when first message is not auth")
	}
}
