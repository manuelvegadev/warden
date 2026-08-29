# ADR-009: Better Auth en el panel; el daemon verifica JWT vía JWKS

Fecha: 2026-08-28 · Estado: aceptada · **Reemplaza** el punto 1 de ADR-008 (usuarios en el daemon) y los tickets WS opacos.

## Contexto
Better Auth (https://better-auth.com) es un framework de autenticación TypeScript para Next.js con sesiones en cookie `HttpOnly`, hash de contraseñas (scrypt), rate limiting, 2FA/passkeys, OAuth social (Discord, GitHub…), plugin `admin` (roles, ban de usuarios), `organization`, `apiKey`, y plugin **`jwt`** que expone `/api/auth/token` y `/api/auth/jwks` (claves EdDSA/RS256 rotables) para que servicios externos verifiquen tokens sin llamar al panel. Soporta SQLite (`better-sqlite3`), Postgres y MySQL directamente o vía Drizzle/Prisma/Kysely.

Alternativa: escribir a mano en Go usuarios, argon2id, sesiones, rate limit, 2FA… (ADR-008).

## Decisión
- **El panel es la autoridad de identidad** usando Better Auth. Base de datos del panel: **SQLite en un volumen de Dokploy** (`/data/warden.db`) para empezar; migrable a Postgres de Dokploy cambiando el adaptador.
- Login inicial por email+contraseña; **Discord OAuth** como segundo proveedor (natural para comunidades de Minecraft) — opcional, activable por env.
- Plugins: `admin` (roles `admin`/`operator`), `jwt`, `apiKey` (tokens para scripts), `twoFactor` (fase posterior).
- **Daemon (`wardend`)**: no tiene usuarios. Cada petición del panel lleva `Authorization: Bearer <JWT>` emitido por Better Auth; el daemon lo verifica **offline con el JWKS del panel** (`WARDEND_PANEL_JWKS_URL`, cacheado, refresco al ver un `kid` desconocido), exige `iss` = URL del panel, `aud = "wardend"`, `exp ≤ 15 min`, y lee `role` de los claims para autorizar. Además `X-Panel-Key` como segunda capa (secreto compartido) para que solo *ese* panel pueda hablarle.
- **WebSocket**: el navegador pide al panel `GET /api/auth/token` (Better Auth devuelve un JWT corto) y lo envía como **primer mensaje** al WS del daemon. El daemon lo verifica igual que en REST, valida `Origin` y cierra si no hay auth en 5 s. Se conserva la regla "nada de tokens en `localStorage`": el JWT vive en memoria solo el tiempo de conectar.
- El flujo BFF del panel (route handlers que reenvían al daemon) se mantiene: el navegador sigue sin hacer REST cross-origin.

## Razones
- Nos ahorra ~1.500 líneas de Go delicado (auth es donde más se falla) y trae 2FA, OAuth y rate limit gratis.
- El daemon queda **sin estado de usuarios**, como Wings: añadir un segundo host es instalar `wardend` y apuntarlo al JWKS del panel.
- La verificación por JWKS es asimétrica: el daemon nunca posee una clave capaz de emitir tokens.

## Consecuencias
- El panel deja de ser stateless: necesita un volumen (SQLite) o Postgres. En Dokploy es un *mount* de una línea.
- Dependencia de un proyecto joven (Better Auth 1.x): fijar versión y leer changelogs al actualizar.
- Si el panel cae, el daemon sigue corriendo los servers pero nadie puede administrarlo hasta que vuelva (igual que Pterodactyl). Mitigación: CLI local `wardend admin …` con socket Unix para emergencias.
- Variables: panel `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`, `WARDEND_URL`, `WARDEND_PANEL_KEY`, `DISCORD_CLIENT_ID/SECRET`; daemon `WARDEND_PANEL_JWKS_URL`, `WARDEND_PANEL_ISSUER`, `WARDEND_PANEL_KEY`, `WARDEND_ALLOWED_ORIGINS`.
