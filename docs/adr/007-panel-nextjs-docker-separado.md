# ADR-007: Panel web separado (Next.js en Docker vía Dokploy) + daemon Go

Fecha: 2026-08-28 · Estado: aceptada, **modificada por ADR-008** (auth vía BFF, sin JWT en el navegador) · **Reemplaza** la parte "UI embebida en el binario" de ADR-002 y ADR-003.

## Contexto
El autor quiere desplegar el panel web con **Dokploy** (Docker) y que este se conecte al daemon Go que corre en el host de Minecraft. Esto separa la UI del daemon, como Pterodactyl (Panel ↔ Wings), y abre la puerta a administrar varios hosts desde un solo panel.

## Decisión
Dos componentes, dos directorios en el monorepo:

| Componente | Dir | Tecnología | Dónde corre |
|---|---|---|---|
| **`wardend`** (daemon) | `wardend/` | Go, binario único, `systemd` | En el Ubuntu donde corren los servidores de Minecraft (acceso directo a procesos, disco, `/proc`). |
| **`panel`** | `beacon/` | **Next.js 16 (App Router) + React + TypeScript + Tailwind + shadcn/ui** | Contenedor Docker desplegado por Dokploy (mismo host u otro). |

### Por qué Next.js y no Astro
- El panel es una app interactiva de tiempo real (WebSocket, consola xterm, gráficas): territorio de React puro. Astro brilla en sitios de contenido; sus "islas" añadirían fricción sin beneficio aquí.
- Next.js tiene `output: "standalone"` → imagen Docker pequeña (~150 MB) y Dokploy lo detecta sin config extra (Nixpacks/Dockerfile).
- shadcn/ui está pensado para Next.js.

### Comunicación panel ↔ daemon
- El **daemon es la autoridad de auth**: usuarios en su SQLite, emite JWT (`POST /auth/login`). El panel no tiene base de datos propia en v1.
- El **navegador habla directamente con el daemon** (REST + WebSocket) usando el JWT en `Authorization: Bearer`. Razones: el WebSocket de consola/métricas no se proxya bien a través de Next.js, y evita duplicar la API.
- El panel (Next server) solo necesita `NEXT_PUBLIC_WARDEND_URL` (p.ej. `https://wardend.midominio.com`). Más adelante: lista de daemons ("nodos") gestionada en el panel.
- El daemon sirve **CORS** restringido a `WARDEND_ALLOWED_ORIGINS` (origen del panel) y debe exponerse por **HTTPS** (TLS integrado con certificado propio, o detrás de Caddy/Traefik — Dokploy ya trae Traefik y puede enrutar hacia el daemon si están en el mismo host).
- El daemon mantiene además un **modo dev**: sirve un `index.html` mínimo de diagnóstico en `/`, pero la UI real es el panel.

### Despliegue con Dokploy
- `beacon/Dockerfile` multi-stage (`node:22-alpine`, `output: standalone`).
- Dokploy: aplicación tipo *Dockerfile* apuntando a `beacon/` del repo, dominio con TLS automático, variable `NEXT_PUBLIC_WARDEND_URL`.
- El daemon **no** va en Docker por defecto (necesita `/proc`, Java, cgroups y acceso al disco de los mundos); se instala con `systemd`. Se documenta igualmente una imagen opcional con `pid: host` y volúmenes para quien quiera todo en contenedores.

## Consecuencias
- Dos despliegues en vez de uno (compensado por Dokploy).
- Hay que cuidar CORS, HTTPS y expiración de JWT en el daemon.
- Multi-host queda al alcance: el panel puede apuntar a N daemons.
