# wardend — agent guide

- Go 1.25, stdlib only + the dependencies listed in `go.mod` (jwx for JWT/JWKS; upcoming: gopsutil, modernc sqlite, gorilla/websocket).
- Style: https://google.github.io/styleguide/go/ and Effective Go. `gofmt`, `go vet`, table-driven tests.
- HTTP: `http.ServeMux` with `METHOD /path/{param}` patterns; small handlers in `internal/api`; JSON errors `{"error":{"code","message"}}` (see `docs/api.md`).
- Auth: never add routes outside the `internal/auth` middleware except `/api/v1/health` and `/api/v1/ws` (which authenticates via its first message).
- All access to an instance's files goes through helpers that confine the path to `servers/<id>/server/`.
- Child processes: always with `context`, escalating stop `stop` → SIGTERM → SIGKILL.
- Document non-trivial decisions in `docs/adr/`.
