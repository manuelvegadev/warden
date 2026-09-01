# Security and authentication panel ↔ daemon

Date: 2026-08-28. Complements ADR-007 and defines ADR-008.

## 1. The problem
The panel (Next.js in Docker, domain `panel.example.com`) and the daemon (Go, `wardend.example.com` or `:8080` on the host) live on **different origins**. We must decide: who stores the users, where the credential lives in the browser, how the WebSocket is authenticated, and how the daemon is protected, since it has full power over host processes and files.

## 2. How others do it
- **Pterodactyl**: the Panel (PHP) is the user authority. Each Wings node has a shared *secret token*. To open the console, the browser asks the Panel for a **JWT signed with the node's token** (HMAC, expires in 10 min, claims `server_uuid`, `user_uuid`, `permissions[]`, `unique_id`) and connects directly to the Wings WebSocket, sending it in the first message `{"event":"auth","args":[jwt]}`. Wings only validates the signature and claims; it never sees passwords. Lesson from their CVEs (e.g. CVE-2026-54593): JWTs must carry a **purpose/audience** claim so a download token cannot be used for the WS, and **permissions must be resolved by the issuer**, not trusted blindly.
- **Crafty / MCSManager**: monolith, same-origin session cookie. Does not apply to our two-origin case.

Sources: [Wings authentication](https://pterodactyl-wings.mintlify.app/security/authentication), [Pterodactyl WebSocket API](https://pteroapi.com/docs/api/websocket), [GHSA-8r6w-3qq5-4p4r](https://github.com/advisories/GHSA-8r6w-3qq5-4p4r).

## 3. Options for the browser

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Browser → daemon directly with JWT in `localStorage`** (what ADR-007 said) | Login against the daemon, token in JS, `Authorization: Bearer` | Simple, stateless panel | OWASP discourages `localStorage` (one XSS = stolen token for a daemon with root access to your servers). CORS with credentials on every endpoint. |
| **B. Browser → daemon directly with cross-site cookies** | `HttpOnly; Secure; SameSite=None` cookie issued by the daemon | No JS touching tokens | Third-party cookies blocked/limited by Safari, Firefox and Chrome (CHIPS). Fragile. Rejected. |
| **C. Panel as BFF (Backend-for-Frontend)** | The browser only talks to the panel (same-origin, `HttpOnly; SameSite=Strict` session cookie). Next.js *route handlers* forward to the daemon with the user's token, stored **encrypted inside the cookie** (stateless) or in a server session. | Pattern recommended by OWASP/IETF for SPAs; no CORS for REST; no tokens in JS; CSRF solved by `SameSite=Strict` + `Origin` check; the daemon can remain **not exposed to the browser** except for the WS. | One extra hop per request (negligible); the WS needs a separate mechanism. |

Sources: [OWASP: token storage](https://safeguard.sh/resources/blog/single-page-application-token-storage-security), [auth-implementation-guide: token storage](https://github.com/heyitskuril/auth-implementation-guide/blob/main/docs/06-token-storage-and-cookies.md), [Cookies vs JWT 2026](https://crosscheck.cloud/blogs/cookies-vs-jwt-authentication-2026/).

## 4. WebSocket
The browser's `WebSocket` constructor **does not allow headers**. Options: token in the query string (ends up in proxy/server logs: bad), cookie (same-origin only, and `Origin` must still be validated), or **first message** (the safest; the server closes the connection if no auth arrives within 5 s).

Sources: [websocket.org: authentication](https://websocket.org/guides/authentication/), [Ably: WebSocket authentication](https://ably.com/blog/websocket-authentication), [DEV: cookies vs bearer in WS](https://dev.to/nikhilsharma6/the-websocket-auth-problem-cookies-vs-bearer-tokens-4eel).

## 5. Chosen design (ADR-008)

```
Browser ──session cookie (HttpOnly, Strict)──► Next.js panel ──Bearer <user JWT>──► Daemon
Browser ──WSS + single-use ticket (1st message)─────────────────────────────────► Daemon /api/v1/ws
```

1. **The daemon remains the user authority** (SQLite, argon2id). `POST /auth/login` → user JWT (HS256 with a random 32-byte secret generated on first startup, `exp` 12 h, `aud: "api"`, `jti`).
2. **The panel is a stateless BFF**: the browser logs in against the panel's `/api/login`; the panel calls the daemon, receives the JWT and stores it **encrypted** (AES-GCM, `iron-session`/`jose`) in the `panel_session` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`). Each panel `/api/*` decrypts, forwards to the daemon with `Authorization: Bearer`, and returns the response. Nothing sensitive touches client-side JavaScript.
3. **WebSocket**: the client requests `POST /api/ws-ticket` from the panel → the panel requests `POST /auth/ws-ticket` from the daemon (with the user's JWT) → the daemon returns a **random, opaque, single-use ticket with a 30 s lifetime**, bound to the user. The browser opens `wss://wardend…/api/v1/ws` and sends `{"type":"auth","ticket":"…"}` as the **first message**. The daemon validates `Origin` against `WARDEND_ALLOWED_ORIGINS`, redeems the ticket (atomic deletion) and closes if there is no auth within 5 s. Reconnection = new ticket.
4. **Roles**: `admin` (everything) and `operator` (start/stop/commands/players, no deleting instances or managing users). The daemon enforces permissions; the panel only hides buttons.
5. **Panel ↔ daemon (server to server)**: in addition to the user's JWT, the panel identifies itself with `X-Panel-Key: <shared secret>` (`WARDEND_PANEL_KEY`). Without that header, the daemon rejects `/auth/login` and `/auth/ws-ticket`. This way, even if the daemon is on the Internet, only the panel can start sessions. Optional: **mTLS** between the two if they are on different hosts.
6. **Transport**: TLS mandatory outside `localhost`, terminated by wardend itself (`WARDEND_TLS`: `acme` via Let's Encrypt, `files`, or `self-signed` for LANs; TLS 1.2+) because the browser's WebSocket reaches the daemon directly — ADR-011 and `docs/deploy.md`. `off` only behind a reverse proxy on the same box.
7. **Daemon hardening**:
   - Rate limit on `/auth/login` (5/min per IP) and progressive per-user lockout; audit of logins and of every command sent (`events`).
   - File paths canonicalized and confined to `servers/<id>/server/`; no symlinks outside; size limits on uploads.
   - External downloads: HTTPS only, allowed hosts (`fill-data.papermc.io`, `hangarcdn.papermc.io`, `cdn.modrinth.com`, `github.com` for `externalUrl`), hash verification, timeouts.
   - `warden` user without a shell, `systemd` with `NoNewPrivileges`, `ProtectSystem`, `ReadWritePaths`.
   - Headers: `X-Content-Type-Options`, `Referrer-Policy`, strict CSP on the panel.
   - Secrets never in an `instance.json` readable by others: `rcon.password` is generated per instance and RCON listens only on `127.0.0.1`.
8. **API tokens** (for scripts/CI): `Authorization: Bearer wd_<random>` created in Settings, with `aud: "api"`, revocable, hashed in DB.

## 6. Implementation checklist
- [ ] daemon: `internal/auth` (argon2id, JWT via jose-go or `golang-jwt`, in-memory WS tickets with TTL, `X-Panel-Key`, rate limit)
- [ ] daemon: `Origin` validation on WS upgrade; close on auth inactivity
- [ ] panel: `lib/session.ts` with encrypted cookie; route handlers `app/api/[...path]/route.ts` as proxy; `app/api/ws-ticket`
- [ ] panel: CSP, `next.config` headers
- [x] docs: deployment guide (`docs/deploy.md`): Dokploy for Beacon, systemd + native TLS for wardend, variables on both sides

## 7. Update (ADR-009)
**Better Auth** is adopted in the panel: identity moves to the panel (SQLite/Postgres), the daemon verifies JWTs **offline via JWKS** (`/api/auth/jwks`) with `aud="wardend"`, and the WS uses the short-lived JWT from `/api/auth/token` as the first message instead of the opaque ticket. Everything else in §5 (BFF, `HttpOnly` cookie, `X-Panel-Key`, `Origin`, TLS, hardening) remains in force.

## 8. Update (ADR-017)

Identity gains an **organization** (Better Auth `organization` plugin) and per-instance grants of our
own, because the plugin's access control is per resource type, not per object.

- **Roles split by scope.** The global `admin`/`operator` pair now governs the *host* only (node
  registration, daemon self-update, Java runtimes, accounts). Organization roles (`owner`/`admin`/
  `member`) govern instances, and a `member` reaches only the instances an `instanceAccess` row
  grants them, as `viewer`, `operator` or `manager`.
- **Beacon resolves, wardend enforces.** The grants are signed into the JWT (`caps`, `aclAll`, `acl`,
  `node`) — Pterodactyl's pattern, and the reason §2's lesson holds: permissions are resolved by the
  issuer, never trusted from the client. The daemon keeps no access state.
- **The WebSocket is scoped too.** `subscribe` requires `viewer` on that instance and `command`
  requires `operator`; without this the browser's own token would be a way around the BFF, since the
  socket goes straight to the daemon.
- **Instances are hidden, not forbidden.** No grant → 404, and `GET /instances` returns only what the
  caller may see, so the list of servers on a node does not leak.
- **Registration** stays closed. An account can be created only by the first user, by following a
  pending invitation for that address, or with `BEACON_OPEN_SIGNUP=true`. Invitations are links the
  inviter copies (no mail server); the invitation id is a bearer token and is never logged.
- **Revocation is immediate.** Removing or lowering a grant calls `POST /sessions/revoke` on the
  daemon, which closes that user's live sockets. REST needs nothing extra: the BFF signs a fresh
  token per request. If that call fails, the 15-minute token lifetime bounds the window.
- **`server.properties` is manager-only**, in both directions, because it carries `rcon.password`.

## Plugins (third-party code)

Plugins are arbitrary Java loaded into the server JVM: once loaded they can do anything the `warden`
user can. Current mitigations: catalog downloads are verified against the hash the source publishes;
every jar (downloaded or uploaded) must be a real archive with a plugin descriptor; the daemon never
runs as root. Malware scanning (static heuristics, ClamAV, VirusTotal) is planned as an optional
layer — see the backlog in docs/roadmap.md.
