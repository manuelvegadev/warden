# wardend — guía para agentes

- Go 1.25, solo stdlib + dependencias listadas en `go.mod` (jwx para JWT/JWKS; próximos: gopsutil, modernc sqlite, gorilla/websocket).
- Estilo: https://google.github.io/styleguide/go/ y Effective Go. `gofmt`, `go vet`, tests de tabla.
- HTTP: `http.ServeMux` con patrones `METHOD /ruta/{param}`; handlers pequeños en `internal/api`; errores JSON `{"error":{"code","message"}}` (ver `docs/api.md`).
- Auth: nunca añadir rutas fuera del middleware de `internal/auth` salvo `/api/v1/health` y `/api/v1/ws` (que autentica por primer mensaje).
- Todo acceso a archivos de una instancia pasa por helpers que confinan la ruta a `servers/<id>/server/`.
- Procesos hijo: siempre con `context`, stop escalonado `stop` → SIGTERM → SIGKILL.
- Documentar decisiones no triviales en `docs/adr/`.
