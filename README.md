# mc-server-gui

Panel sencillo y útil para administrar un servidor de Minecraft (Java Edition) en Ubuntu,
al estilo de Pterodactyl / Crafty Controller pero con mucho menos peso y complejidad.

## Objetivos

- **Daemon** que arranca/detiene/supervisa el proceso del servidor y lo reinicia si se cae.
- **Consola en vivo** (stdout/stderr) y envío de comandos por stdin.
- **Configuración**: editar `server.properties`, `whitelist.json`, `ops.json`, `banned-*.json`.
- **Recursos por instancia**: CPU, RAM, disco, red.
- **Jugadores**: conectados, logros (advancements), estadísticas, enviar mensajes.
- Interfaz **web** accesible desde cualquier dispositivo de la red.

## Estado

Fase de investigación y diseño. Ver [`docs/`](docs/):

- [`docs/research.md`](docs/research.md) — investigación de alternativas existentes y APIs de Minecraft.
- [`docs/adr/`](docs/adr/) — registro de decisiones de arquitectura (ADRs).
- [`docs/roadmap.md`](docs/roadmap.md) — plan de fases.

## Decisiones tomadas (resumen)

| Tema | Decisión | ADR |
|---|---|---|
| Lenguaje del daemon/backend | **Go** | [ADR-001](docs/adr/001-lenguaje-backend.md) |
| Interfaz | **Web** (React + TypeScript, embebida en el binario) | [ADR-002](docs/adr/002-interfaz-web.md) |
| Arquitectura | Monolito: un binario = daemon + API + UI, sin Docker obligatorio | [ADR-003](docs/adr/003-arquitectura-monolito.md) |
| Cómo hablar con el servidor MC | stdin/stdout del proceso + RCON opcional + lectura de archivos del mundo | [ADR-004](docs/adr/004-integracion-minecraft.md) |
