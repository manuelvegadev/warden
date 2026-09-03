package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/coder/websocket"
	"github.com/manuelvega/warden/wardend/internal/auth"
)

// OriginPatterns turns the panel origins from the configuration into the host patterns
// websocket.Accept checks the Origin header against.
func OriginPatterns(allowedOrigins []string) []string {
	var pats []string
	for _, o := range allowedOrigins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			pats = append(pats, u.Host)
		}
	}
	return pats
}

// AcceptAuthenticated upgrades the request and runs the browser socket's first-message protocol
// (docs/security.md §4): within 5 s the client must send {"type":"auth","token":<Beacon JWT>}.
// On failure the socket is closed with the reason and false is returned; the caller sends its own
// `auth.ok`.
func AcceptAuthenticated(w http.ResponseWriter, r *http.Request, verifier *auth.Verifier, originPatterns []string) (*websocket.Conn, *auth.Principal, bool) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: originPatterns})
	if err != nil {
		slog.Debug("ws accept", "path", r.URL.Path, "err", err)
		return nil, nil, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var first struct {
		Type  string `json:"type"`
		Token string `json:"token"`
	}
	if err := ReadJSON(ctx, conn, &first); err != nil || first.Type != "auth" || first.Token == "" {
		conn.Close(websocket.StatusPolicyViolation, "auth required")
		return nil, nil, false
	}
	principal, err := verifier.Verify(r.Context(), first.Token)
	if err != nil {
		conn.Close(websocket.StatusPolicyViolation, "invalid token")
		return nil, nil, false
	}
	return conn, principal, true
}

// ReadJSON reads one text message into v.
func ReadJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	_, b, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// WriteJSON writes v as one text message, giving up after 10 s.
func WriteJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, b)
}
