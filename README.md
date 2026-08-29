# Warden

> Nombre elegido en `docs/naming.md`: proyecto **Warden**, daemon **`wardend`**, panel **beacon** (nombre "Beacon" aún en consideración para el panel).

Panel sencillo y útil para crear y administrar **varias instancias** de servidores de Minecraft (Java Edition, empezando por **PaperMC**) en Ubuntu, al estilo de Pterodactyl / Crafty Controller pero mucho más ligero. Incluye instalación de plugins desde Hangar y Modrinth ("como Prism Launcher, pero para servidores").

## Componentes

| | Dir | Tecnología | Corre en |
|---|---|---|---|
| **wardend** (daemon) | [`wardend/`](wardend/) | Go, binario único, `systemd` | El Ubuntu de los servidores |
| **Beacon** (panel) | [`beacon/`](beacon/) | Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + Better Auth (pnpm) | Docker vía Dokploy |

El navegador se conecta al daemon (REST + WebSocket con JWT); el panel solo sirve la UI. Ver [`docs/architecture.md`](docs/architecture.md).

## Funcionalidades objetivo
- Crear instancias: elegir versión y build de Paper (API Fill v3), memoria, flags JVM (Aikar), puerto, EULA.
- Arrancar / detener / reiniciar / autostart / reinicio ante crash.
- Consola en vivo y envío de comandos.
- `server.properties` con esquema, whitelist, ops, bans, editor de archivos de config.
- Plugins: buscar en Hangar y Modrinth, instalar, actualizar, activar/desactivar, subir jar.
- Recursos por instancia: CPU, RAM, disco, red, TPS.
- Jugadores: online, historial, logros, estadísticas, mensajes, kick/ban.
- Backups y tareas programadas.

## Documentación
- [`docs/research.md`](docs/research.md) — investigación de alternativas y lenguajes.
- [`docs/architecture.md`](docs/architecture.md) — arquitectura, layout del monorepo, flujos.
- [`docs/api.md`](docs/api.md) — **especificación de la API REST + WebSocket** del daemon.
- [`docs/external-apis.md`](docs/external-apis.md) — Fill v3 (Paper), Hangar, Modrinth, Mojang (verificadas).
- [`docs/minecraft-admin.md`](docs/minecraft-admin.md) — referencia de administración de servidores Paper (archivos, comandos, flags, logs, seguridad).
- [`docs/adr/`](docs/adr/) — decisiones: [001 Go](docs/adr/001-lenguaje-backend.md) · [002 Web](docs/adr/002-interfaz-web.md) · [003 Monolito](docs/adr/003-arquitectura-monolito.md) · [004 Integración MC](docs/adr/004-integracion-minecraft.md) · [005 Fuentes jars/plugins](docs/adr/005-fuentes-de-jars-y-plugins.md) · [006 Multi-instancia](docs/adr/006-multi-instancia.md) · [007 Panel Next.js separado](docs/adr/007-panel-nextjs-docker-separado.md)
- [`docs/security.md`](docs/security.md) — autenticación y hardening panel ↔ daemon.
- [`docs/naming.md`](docs/naming.md) — monorepo y propuestas de nombre.
- [`docs/tooling.md`](docs/tooling.md) — MCP servers y skills instaladas para desarrollo asistido.
- [`docs/roadmap.md`](docs/roadmap.md)

## Desarrollo
```bash
# wardend (daemon)
cd wardend && make run                      # http://localhost:8080/api/v1/health
# Beacon (panel)
cp beacon/.env.example beacon/.env.local     # rellenar BETTER_AUTH_SECRET y WARDEND_PANEL_KEY
cd beacon && pnpm install && pnpm auth:migrate && pnpm dev   # http://localhost:3000
```
Para que wardend acepte los JWT de Beacon en local: `WARDEND_PANEL_JWKS_URL=http://localhost:3000/api/auth/jwks WARDEND_PANEL_ISSUER=http://localhost:3000 make run`.
