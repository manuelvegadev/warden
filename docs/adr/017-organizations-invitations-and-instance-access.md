# ADR-017: Organizations, invitations and per-instance access

Date: 2026-08-31 · Status: accepted · **Extends** ADR-009 (Better Auth in Beacon) and ADR-008 §5.4 (roles).
Prepares the multi-node item in roadmap Phase 4.

## Context

Beacon has two global roles, `admin` and `operator` (Better Auth `admin` plugin). An `operator` can open the
console, send commands and start/stop **every** instance; `admin` can do everything. There is no way to say
"this person may manage *survival* and nothing else", and no way to bring a second person in at all:
registration is closed by a hook in `beacon/lib/auth.ts` and there is no user-management UI, no invitations
and no mail server.

Two things need to become possible:

1. Inviting somebody to a **single instance**, with a role weaker than "operator of the whole panel".
2. One Beacon eventually driving **several wardend nodes** (roadmap Phase 4), without redoing access control
   when that lands.

The constraint that shapes the design: the browser opens the WebSocket **directly against the daemon** with a
Better Auth JWT it fetched itself (`beacon/hooks/use-wardend-socket.ts`). Filtering in the BFF is therefore not
sufficient — the daemon must be able to enforce per-instance access on its own, from the token alone.

## How others do it

- **Pterodactyl** — a server has an owner and *subusers*, with ~35 granular permissions
  (`control.console`, `file.read-content`, `backup.restore`, `websocket.connect`…). The **panel resolves the
  permissions and embeds them in a short-lived JWT**; Wings never queries a database. Their CVE history says
  the token must carry a purpose/audience claim and the issuer must resolve permissions rather than trust the
  client. No organizations: the scope is the server.
- **Coolify** — the *Team* is the isolation boundary and owns every resource, servers included, with
  owner/admin/member. The standing complaint is the absence of per-resource granularity.
- **Better Auth `organization` plugin** — provides organizations, members, a complete invitation lifecycle
  (`inviteMember` → `sendInvitationEmail` → `acceptInvitation`, with expiry, cancel, reject and hooks),
  custom roles via `createAccessControl`, optional teams and DB-backed dynamic roles. Its access control is
  per **resource type**, not per object: it can express "role X may `instance:start`", not "may start
  *survival*". Object-level scoping stays ours.

## Decision

### 1. Tenancy: organization plugin + our own instance ACL

- Enable the Better Auth `organization` plugin. An **organization is the tenant**; a default one is created on
  first start and every existing user is migrated into it.
- The organization concept stays **invisible in the UI while only one exists**: the menu entry is
  *Settings → Members*, there is no organization switcher, and `allowUserToCreateOrganization` is `false`.
  The switcher and *Settings → Organization* appear only once a second organization exists.
- Object-level access lives in our own table, because the plugin cannot express it.

### 2. Two role systems, split by what they govern

| System | Values | Governs |
|---|---|---|
| Global (`admin` plugin, unchanged) | `admin`, `operator` | The **host**: registering nodes, daemon self-update, Java runtimes, user accounts |
| Organization (`organization` plugin) | `owner`, `admin`, `member` | **Instances**: creating and deleting them, inviting people, managing members |
| Per-instance ACL (ours) | `viewer`, `operator`, `manager` | What a `member` may do on one specific instance |

`owner` and `admin` of an organization implicitly hold `manager` on every instance of that organization; a
`member` holds only what the ACL grants. The global `admin` role no longer implies instance powers — the ~25
routes currently behind `RequireAdmin` are reclassified in §5.

### 3. Per-instance roles

Three fixed roles. Internally they are an ordered ladder, so the permission checks are comparisons, not sets:

| Role | May |
|---|---|
| `viewer` | read the instance, read the console, metrics, players (sessions, stats, advancements), events, list backups and plugins |
| `operator` | everything above, plus power (start/stop/restart/kill), send console commands, message/kick players, whitelist and bans |
| `manager` | everything above, plus instance settings, `server.properties`, config files, plugins, backups (create/restore/download/delete), version upgrades, EULA, in-game ops |

`server.properties` and the config-file editor are `manager`-only because they expose `rcon.password`.
Creating and deleting instances is **not** a per-instance role: it belongs to the organization (`owner`).

### 4. Beacon resolves, the daemon enforces (claims)

`definePayload` in the `jwt` plugin accepts an async function (verified in `better-auth@1.7.2`), so Beacon
resolves membership and ACL from its database at token-signing time and ships the result in the JWT:

```jsonc
{
  "sub": "…", "email": "…", "name": "…",
  "role": "admin",                              // host-level, kept for back-compat
  "node": "default",                            // which wardend this token is for
  "caps": ["system.update", "java.manage", "instances.create", "instances.delete"],
  "aclAll": "manager",                          // org owner/admin: applies to every instance
  "acl": { "survival": "operator", "creative": "viewer" }
}
```

- `aclAll` avoids enumerating instances for owners and keeps their tokens valid for instances created later.
- `node` is present from day one and checked by the daemon against its own `WARDEND_NODE_ID`, so a token
  minted for one node cannot be replayed against another when multi-node lands.
- A token without `caps`/`acl`/`aclAll` (older Beacon) is interpreted from `role`: `admin` → `aclAll:
  "manager"` and all caps; `operator` → `aclAll: "operator"`. Rolling upgrades keep working.

The daemon gains `Principal.Can(instanceID, action)` and `Principal.HasCap(cap)`; `GET /instances` filters by
the ACL, and an instance the caller cannot see returns **404, not 403**, so the list of instances does not
leak. The WebSocket hub applies the same check on `subscribe`.

Two mechanisms keep this from decaying. Instance routes are mounted only through a local `inst(pattern,
action, handler)` helper in `NewRouter`, so naming the required role is part of registering the route rather
than something a reviewer has to notice. And `instanceOr404` — the shared lookup 16 handlers already go
through — repeats the `CanSee` check, so a route that ever ships without its wrapper still leaks nothing.

REST is always exact: the BFF signs a fresh token per proxied request, so a revoked grant stops working
immediately.

### 5. Route reclassification in wardend

- **Host capability** (`caps`): `POST /system/update`, `POST /java`, `DELETE /java/{id}`, and the future
  `/nodes` endpoints.
- **Organization capability** (`caps`): `POST /instances`, `POST /instances/import`, `DELETE /instances/{id}`.
- **Per-instance `manager`**: `PATCH /instances/{id}`, `/install`, `/eula`, `PUT /properties`,
  `PUT /properties/raw`, `PUT /files/content`, `POST /upgrade`, every `/backups` write, every `/plugins`
  write, `POST|DELETE /ops/{name}`.
- **Per-instance `operator`**: `/start`, `/stop`, `/restart`, `/kill`, `/command`, `/players/{name}/action`,
  `/whitelist/*`, `/bans/*`. (This tightens `whitelist` and `bans`, which are unauthenticated beyond "logged
  in" today.)
- **Per-instance `viewer`**: every remaining `GET` under `/instances/{id}`.
- Unchanged and unscoped: `/health`, `/system`, `/auth/me`, `/tasks`, the whole `/catalog` tree.

### 6. Invitations by link, no mail server

- `sendInvitationEmail` is a no-op; Beacon shows the invitation link for the admin to copy and send
  over Discord or wherever. A mail transport can be added later without changing the flow.
- Only organization `owner`/`admin` may invite, from *Settings → Members*. Invitations expire in 7 days.
- The `invitation` table carries three additional fields (supported in 1.7.2): `nodeId`, `instanceId`,
  `instanceRole`. The `afterAcceptInvitation` hook turns them into an `instanceAccess` row.
- The signup hook in `lib/auth.ts` gains a third exception: account creation is allowed when a **pending,
  unexpired invitation exists for that email**. Without it an invited person cannot create the account the
  invitation is addressed to.
- The `/invite/{id}` page must render for a signed-out visitor, so it reads the invitation's email,
  organization name and target instance **directly from the database**, deliberately bypassing the plugin API
  (which requires a session). It exposes nothing else.

### 7. Immediate revocation

Removing a grant, removing a member or lowering a role makes Beacon call a new server-to-server endpoint
`POST /api/v1/sessions/revoke` on the affected node (`{ userId, instanceId? }`, `X-Panel-Key` required). The
hub closes or unsubscribes that user's live connections. The JWT TTL stays at 15 minutes as the backstop.

### 8. Multi-node: designed now, implemented later

Every access row and every claim is keyed by `(nodeId, instanceId)` from the start, with an implicit node
`default` derived from `WARDEND_URL`. The `node` table (name, base URL, public WS URL, encrypted panel key),
the `/api/wardend/[node]/[...path]` proxy and the node UI land in their own milestone; no schema migration
will be needed then.

## Schema added to Beacon

Generated by the plugin: `organization`, `member`, `invitation`, plus `activeOrganizationId` on `session`.

Ours:

A grant on the reserved instance id `*` covers every instance of the node — that is how a pre-ADR-017
`operator` keeps their reach. It is surfaced to the UI as a distinct `blanket` field rather than as a grant on
an instance called `*`, so Settings → Members can show it, lower it and remove it.

```
instanceAccess(id, organizationId, userId, nodeId, instanceId, role, createdAt, createdBy)
  unique (userId, nodeId, instanceId)
node(id, name, baseUrl, publicWsUrl, panelKey, createdAt)            -- later milestone
invitation += nodeId, instanceId, instanceRole                        -- additionalFields
```

## Migration

The first user keeps `admin` and becomes `owner` of the default organization. Existing `operator` users become
`member` of it and receive an explicit `operator` grant on **every instance that exists at migration time**, so
current behaviour is preserved; instances created afterwards are not granted automatically.

## Milestones

1. **Members** — organization plugin, default organization, migration, `caps` claim, daemon reads `caps`,
   *Settings → Members* with the invite-by-link flow and invitation-gated signup.
2. **Per-instance access** — `instanceAccess`, `acl`/`aclAll` claims, `Can()` in the daemon, route
   reclassification, list filtering and 404s, WS `subscribe` check, role-aware UI.
3. **Revocation** — `POST /sessions/revoke` and its wiring.
4. **Multi-node** — `node` table, per-node proxy and UI, `node` claim enforced.

## Consequences

- Two role systems coexist; the split in §2 must be documented in the UI or it will confuse people.
- `definePayload` runs one extra query per signed token, i.e. per proxied REST request. Local SQLite, so
  negligible; memoize per request if it ever shows up.
- The daemon now carries a copy of the role→action table in Go, which must stay in sync with the TypeScript
  one. Both are small and enumerated in §3, and `access-vectors.json` at the repo root is loaded by both test
  suites; each also asserts that every action it knows about appears there, so an action added on one side
  fails the other side's test.
- A grant revoked while the browser holds a WS token is closed by §7; if that call fails, the window is the
  15-minute token TTL.
- `docs/api.md` and `docs/security.md` need updating for the new claims, the 404 behaviour and the revoke
  endpoint.
