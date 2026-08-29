# ADR-008: Autenticación — panel como BFF, daemon como autoridad, WS con ticket efímero

Fecha: 2026-08-28 · Estado: aceptada · **Modifica** ADR-007 (el navegador ya no guarda un JWT en `localStorage` ni llama al daemon por REST).

## Decisión
- Usuarios y contraseñas viven en el **daemon** (SQLite, argon2id). Emite JWT HS256 de 12 h.
- El **panel Next.js actúa de BFF**: cookie de sesión same-origin `HttpOnly; Secure; SameSite=Strict` con el JWT del daemon cifrado dentro; sus route handlers reenvían las llamadas REST al daemon. El navegador **no** hace REST cross-origin.
- Para tiempo real, el navegador abre el **WebSocket directamente contra el daemon** y se autentica con un **ticket de un solo uso (30 s)** emitido por el daemon a petición del panel, enviado como **primer mensaje**. El daemon valida `Origin`.
- El panel se identifica ante el daemon con `X-Panel-Key` (secreto compartido), imprescindible para login y tickets.
- TLS obligatorio; daemon en localhost detrás de Traefik (Dokploy) o Caddy, o TLS nativo.
- Roles `admin` / `operator` aplicados en el daemon. API tokens revocables para automatización.

## Razones
Sigue la guía OWASP/IETF para SPAs (nada de tokens en JS), evita cookies cross-site (rotas en navegadores modernos), replica el patrón probado de Pterodactyl para el WS y mantiene el panel sin base de datos (multi-nodo futuro: la cookie guarda un JWT por nodo).

## Consecuencias
- Variables nuevas: daemon `MCD_PANEL_KEY`, `MCD_ALLOWED_ORIGINS`; panel `PANEL_SESSION_SECRET`, `MCD_URL` (interna, servidor a servidor), `NEXT_PUBLIC_MCD_WS_URL` (pública, para el WS).
- `panel/lib/api.ts` pasa a llamar a `/api/*` del propio panel; se elimina el `localStorage`.
- Detalle completo en `docs/security.md`.
