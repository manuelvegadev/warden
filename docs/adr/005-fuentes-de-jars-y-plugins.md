# ADR-005: Fuentes para descargar servidores y plugins

Fecha: 2026-08-28 · Estado: aceptada

## Contexto
Queremos crear instancias desde la UI ("como Prism Launcher"): elegir software (Paper primero), versión de Minecraft, build, y luego instalar plugins buscándolos en un catálogo. Todo se verificó con llamadas reales el 2026-08-28 (ver `docs/external-apis.md`).

## Decisión
- **Servidor**: PaperMC **Fill v3** (`https://fill.papermc.io/v3`). Devuelve versiones, builds, canal (`STABLE`/`BETA`/`ALPHA`/`RECOMMENDED`), URL directa y `sha256`. Se verifica el hash tras descargar. Diseño extensible por "proveedor" para añadir luego Purpur, Fabric, Vanilla.
- **Plugins**: dos proveedores detrás de una misma interfaz `PluginSource`:
  1. **Hangar** (`https://hangar.papermc.io/api/v1`) — repositorio oficial de PaperMC. Filtro `platform=PAPER`, `version=<mc>`; cada versión trae `downloads.PAPER.downloadUrl` + `sha256Hash` + `pluginDependencies`.
  2. **Modrinth** (`https://api.modrinth.com/v2`) — más catálogo. `facets=[["project_type:plugin"],["categories:paper"],["versions:<mc>"]]`; versiones con `loaders=["paper"]`, archivos con `url` + `hashes.sha512` + `primary`.
- Los plugins instalados se registran en `instance.json` (`plugins[]` con fuente, id de proyecto, versión, hash) para poder mostrar "actualización disponible".
- SpigotMC no tiene API de descarga oficial (usa Cloudflare); queda fuera. Se permite además **subir un .jar manualmente**.
- Todas las peticiones salientes usan `User-Agent: warden/<ver> (<contacto>)`, obligatorio en Fill y Modrinth. Modrinth limita a 300 req/min por IP.

## Consecuencias
- Hay que cachear listados (p.ej. 10 min) para no golpear las APIs desde la UI.
- Aceptar el EULA de Mojang es una acción explícita del usuario en la UI (escribe `eula=true` en `eula.txt`); no se acepta automáticamente.
