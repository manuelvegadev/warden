# ADR-002: Interfaz web (React + TypeScript) embebida en el binario

Fecha: 2026-08-28 · Estado: aceptada

## Contexto
El servidor es un Ubuntu headless; se administra desde PC o móvil. Opciones: web, app nativa de escritorio (Tauri/Electron), TUI.

## Decisión
- SPA con **React + TypeScript + Vite**, Tailwind + shadcn/ui para componentes, `xterm.js` para la consola y una librería de gráficas ligera para recursos.
- Se compila a estáticos y se embebe en el binario Go con `embed`; un solo puerto sirve UI + API.
- Comunicación: **REST** (`/api/...`) para acciones y **WebSocket** (`/ws`) para consola, eventos y métricas.
- Manifest PWA para "instalarla" en el móvil.

## Razones
- Todos los paneles de referencia son web; cero instalación en el cliente.
- Un solo binario/puerto simplifica despliegue y auth.

## Alternativas descartadas
- Tauri/Electron: obliga a mantener un cliente extra y de todos modos necesitaría la misma API.
- HTMX/templates Go: viable y más simple, pero la consola en vivo y gráficas en tiempo real son más naturales con una SPA.
