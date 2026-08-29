# Seguridad y autenticación panel ↔ daemon

Fecha: 2026-08-28. Complementa ADR-007 y define ADR-008.

## 1. El problema
El panel (Next.js en Docker, dominio `panel.ejemplo.com`) y el daemon (Go, `mcd.ejemplo.com` o `:8080` en el host) viven en **orígenes distintos**. Hay que decidir: quién guarda los usuarios, dónde vive la credencial en el navegador, cómo se autentica el WebSocket y cómo se protege el daemon, que tiene poder total sobre procesos y archivos del host.

## 2. Cómo lo hacen los demás
- **Pterodactyl**: el Panel (PHP) es la autoridad de usuarios. Cada nodo Wings tiene un *token secreto* compartido. Para abrir la consola, el navegador pide al Panel un **JWT firmado con el token del nodo** (HMAC, expira en 10 min, claims `server_uuid`, `user_uuid`, `permissions[]`, `unique_id`) y se conecta directamente al WebSocket de Wings enviándolo en el primer mensaje `{"event":"auth","args":[jwt]}`. Wings solo valida firma y claims; nunca ve contraseñas. Lección de sus CVEs (p.ej. CVE-2026-54593): los JWT deben llevar un claim de **propósito/audiencia** para que un token de descarga no sirva para el WS, y las **permisos deben resolverse en el emisor**, no confiarse ciegamente.
- **Crafty / MCSManager**: monolito, cookie de sesión same-origin. No aplica a nuestro caso de dos orígenes.

Fuentes: [Wings authentication](https://pterodactyl-wings.mintlify.app/security/authentication), [Pterodactyl WebSocket API](https://pteroapi.com/docs/api/websocket), [GHSA-8r6w-3qq5-4p4r](https://github.com/advisories/GHSA-8r6w-3qq5-4p4r).

## 3. Opciones para el navegador

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| **A. Navegador → daemon directo con JWT en `localStorage`** (lo que decía ADR-007) | Login contra el daemon, token en JS, `Authorization: Bearer` | Simple, panel sin estado | OWASP desaconseja `localStorage` (un XSS = robo de token de un daemon con acceso root a tus servers). CORS con credenciales en cada endpoint. |
| **B. Navegador → daemon directo con cookies cross-site** | Cookie `HttpOnly; Secure; SameSite=None` emitida por el daemon | Sin JS tocando tokens | Cookies de terceros bloqueadas/limitadas por Safari, Firefox y Chrome (CHIPS). Frágil. Descartada. |
| **C. Panel como BFF (Backend-for-Frontend)** | El navegador solo habla con el panel (same-origin, cookie de sesión `HttpOnly; SameSite=Strict`). Los *route handlers* de Next.js reenvían al daemon con el token del usuario, guardado **cifrado dentro de la cookie** (stateless) o en sesión servidor. | Patrón recomendado por OWASP/IETF para SPAs; sin CORS para REST; sin tokens en JS; CSRF resuelto por `SameSite=Strict` + comprobación de `Origin`; el daemon puede quedar **no expuesto al navegador** salvo el WS. | Un salto extra por petición (despreciable); el WS necesita un mecanismo aparte. |

Fuentes: [OWASP: token storage](https://safeguard.sh/resources/blog/single-page-application-token-storage-security), [auth-implementation-guide: token storage](https://github.com/heyitskuril/auth-implementation-guide/blob/main/docs/06-token-storage-and-cookies.md), [Cookies vs JWT 2026](https://crosscheck.cloud/blogs/cookies-vs-jwt-authentication-2026/).

## 4. WebSocket
El constructor `WebSocket` del navegador **no permite cabeceras**. Opciones: token en la query (acaba en logs de proxy/servidor: mal), cookie (solo same-origin, y aun así hay que validar `Origin`), o **primer mensaje** (el más seguro; el servidor cierra la conexión si no llega auth en 5 s).

Fuentes: [websocket.org: authentication](https://websocket.org/guides/authentication/), [Ably: WebSocket authentication](https://ably.com/blog/websocket-authentication), [DEV: cookies vs bearer en WS](https://dev.to/nikhilsharma6/the-websocket-auth-problem-cookies-vs-bearer-tokens-4eel).

## 5. Diseño elegido (ADR-008)

```
Navegador ──cookie sesión (HttpOnly, Strict)──► Panel Next.js ──Bearer <user JWT>──► Daemon
Navegador ──WSS + ticket de 1 uso (1er mensaje)─────────────────────────────────────► Daemon /api/v1/ws
```

1. **El daemon sigue siendo la autoridad de usuarios** (SQLite, argon2id). `POST /auth/login` → JWT de usuario (HS256 con secreto aleatorio de 32 bytes generado en el primer arranque, `exp` 12 h, `aud: "api"`, `jti`).
2. **El panel es un BFF sin estado**: el navegador hace login contra `/api/login` del panel; el panel llama al daemon, recibe el JWT y lo guarda **cifrado** (AES-GCM, `iron-session`/`jose`) en la cookie `panel_session` (`HttpOnly; Secure; SameSite=Strict; Path=/`). Cada `/api/*` del panel descifra, reenvía al daemon con `Authorization: Bearer`, y devuelve la respuesta. Nada sensible toca JavaScript del cliente.
3. **WebSocket**: el cliente pide `POST /api/ws-ticket` al panel → el panel pide al daemon `POST /auth/ws-ticket` (con el JWT del usuario) → el daemon devuelve un **ticket opaco aleatorio de un solo uso, 30 s de vida**, ligado al usuario. El navegador abre `wss://mcd…/api/v1/ws` y envía `{"type":"auth","ticket":"…"}` como **primer mensaje**. El daemon valida `Origin` contra `MCD_ALLOWED_ORIGINS`, canjea el ticket (borrado atómico) y cierra si no hay auth en 5 s. Reconexión = nuevo ticket.
4. **Roles**: `admin` (todo) y `operator` (start/stop/comandos/jugadores, sin borrar instancias ni gestionar usuarios). El daemon aplica los permisos; el panel solo oculta botones.
5. **Panel ↔ daemon (servidor a servidor)**: además del JWT del usuario, el panel se identifica con `X-Panel-Key: <secreto compartido>` (`MCD_PANEL_KEY`). Sin esa cabecera, el daemon rechaza `/auth/login` y `/auth/ws-ticket`. Así, aunque el daemon esté en Internet, solo el panel puede iniciar sesiones. Opcional: **mTLS** entre ambos si están en hosts distintos.
6. **Transporte**: TLS obligatorio fuera de `localhost`. Recomendado: daemon en `127.0.0.1:8080` y Traefik de Dokploy (mismo host) o Caddy como reverse proxy con HTTPS; alternativa: `MCD_TLS_CERT/KEY` para TLS nativo. HSTS.
7. **Hardening del daemon**:
   - Rate limit en `/auth/login` (5/min por IP) y bloqueo progresivo por usuario; auditoría de logins y de cada comando enviado (`events`).
   - Rutas de archivo canonicalizadas y confinadas a `servers/<id>/server/`; sin symlinks fuera; límites de tamaño en uploads.
   - Descargas externas: solo HTTPS, hosts permitidos (`fill-data.papermc.io`, `hangarcdn.papermc.io`, `cdn.modrinth.com`, `github.com` para `externalUrl`), verificación de hash, timeouts.
   - Usuario `minecraft` sin shell, `systemd` con `NoNewPrivileges`, `ProtectSystem`, `ReadWritePaths`.
   - Cabeceras: `X-Content-Type-Options`, `Referrer-Policy`, CSP estricta en el panel.
   - Secretos nunca en `instance.json` legible por otros: `rcon.password` se genera por instancia y RCON escucha solo en `127.0.0.1`.
8. **API tokens** (para scripts/CI): `Authorization: Bearer mcd_<random>` creados en Ajustes, con `aud: "api"`, revocables, hash en DB.

## 6. Checklist de implementación
- [ ] daemon: `internal/auth` (argon2id, JWT jose-go o `golang-jwt`, tickets WS en memoria con TTL, `X-Panel-Key`, rate limit)
- [ ] daemon: validación de `Origin` en el upgrade WS; cierre por inactividad de auth
- [ ] panel: `lib/session.ts` con cookie cifrada; route handlers `app/api/[...path]/route.ts` como proxy; `app/api/ws-ticket`
- [ ] panel: CSP, `next.config` headers
- [ ] docs: guía de despliegue con Traefik/Dokploy y variables (`MCD_PANEL_KEY`, `MCD_ALLOWED_ORIGINS`, `PANEL_SESSION_SECRET`, `MCD_URL` interna vs `NEXT_PUBLIC_MCD_WS_URL` pública)
