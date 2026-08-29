# ADR-001: Go como lenguaje del daemon y backend

Fecha: 2026-08-28 · Estado: aceptada

## Contexto
Necesitamos un daemon que corra en Ubuntu como servicio, lance y supervise el proceso `java` del servidor, exponga una API HTTP/WebSocket y lea métricas del sistema. Candidatos: Go, Rust, Java, Node.js, Python (ver `docs/research.md` §4).

## Decisión
Usar **Go** (1.25+).

## Razones
- Binario estático único: `scp` al servidor + unidad `systemd`, sin runtime ni dependencias.
- `os/exec` + goroutines encajan perfecto con "un proceso hijo cuyo stdout se reparte a N clientes WebSocket".
- Es el lenguaje de Pterodactyl Wings y PufferPanel: hay código de referencia para casi todo.
- `embed` permite meter la UI web compilada dentro del mismo binario.
- Ecosistema: `gopsutil` (métricas), `gorcon/rcon`, `go-mc` (ping/NBT), `chi`/stdlib para HTTP.

## Alternativas descartadas
- **Rust**: excelente resultado final, pero mayor tiempo de desarrollo; se reconsideraría si el objetivo fuera aprender Rust.
- **Java**: el daemon consumiría tanto como un panel entero; solo tendría sentido si quisiéramos ir como plugin dentro del servidor (Paper), que no es el enfoque.
- **Node/Python**: requieren runtime y más RAM; sin ventaja clara.

## Consecuencias
- Librerías Go para NBT/JSON de Minecraft son menos maduras que en Java; para logros y stats basta con JSON, y NBT (`level.dat`, playerdata) se deja para más adelante.
