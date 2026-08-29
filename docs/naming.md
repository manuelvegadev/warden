# Nombres y estructura del repositorio

## ¿Monorepo?
**Sí.** Un solo repo con `daemon/` y `panel/` (más `docs/`). Razones: la API es un contrato compartido entre ambos (se versionan juntos, un PR cambia los dos lados), un solo lugar para ADRs y CI, y Dokploy puede construir desde un subdirectorio (`panel/`). Tooling: Go módulo independiente en `daemon/`, `npm` en `panel/`; no hace falta Turborepo/Nx mientras solo haya una app Node. Releases: tags `daemon/v0.1.0` y `panel/v0.1.0` separados.

## Propuestas de nombre
Criterio: corto, tecleable como comando (`<daemon>` en systemd, binario), con guiño a Minecraft, y sin colisionar con proyectos conocidos (Wings, Crafty, Pelican, Pufferpanel, Lodestone Console… ⚠️ *Lodestone* ya existe como panel de Minecraft en Rust).

| Proyecto | Daemon (Go) | Panel (Next.js) | Comentario |
|---|---|---|---|
| **Warden** | `wardend` | `warden-panel` / "Warden" | El Warden vigila. El daemon con sufijo `d` al estilo Unix. |
| **Beacon** | `beacond` | `beacon` | El beacon es la "señal" del servidor; panel = beacon, daemon = quien lo alimenta. |
| **Observer** + **Command Block** | `observerd` | `commandblock` | Dos bloques con roles literales: observar/ejecutar. Nombres largos. |
| **Hopper** | `hopperd` | `hopper-ui` | Hopper mueve cosas entre contenedores; simpático pero poco descriptivo. |
| **Craftdeck** | `craftd` | `craftdeck` | Sin referencia a un ítem; "deck" = tablero de mando. Muy tecleable. |
| **Piston** | `pistond` | `piston` | Empuja/arranca cosas. Colisiona con Piston (runtime de código). |

## Recomendación
- Repo/proyecto: **Craftdeck** (`craftdeck`).
- Daemon: **`craftd`** (binario `craftd`, servicio `craftd.service`, variables `CRAFTD_*`).
- Panel: **`craftdeck`** (imagen Docker `craftdeck-panel`).

Alternativa con más personalidad: **Warden** (`wardend`) + panel **Beacon** — daemon que vigila, panel que muestra.

Los nombres actuales del esqueleto (`mcd`, `panel`) son provisionales; renombrar es un `sed` global y se hará en cuanto se elija.
