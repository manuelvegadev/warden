# Names and repository structure

## Monorepo?
**Yes.** A single repo with `wardend/` and `beacon/` (plus `docs/`). Reasons: the API is a contract shared by both (they are versioned together, one PR changes both sides), a single place for ADRs and CI, and Dokploy can build from a subdirectory (`beacon/`). Tooling: independent Go module in `wardend/`, `npm` in `beacon/`; no need for Turborepo/Nx while there is only one Node app. Releases: separate `daemon/v0.1.0` and `panel/v0.1.0` tags.

## Name proposals
Criteria: short, typeable as a command (`<daemon>` in systemd, binary), with a nod to Minecraft, and not colliding with known projects (Wings, Crafty, Pelican, Pufferpanel, Lodestone Console… ⚠️ *Lodestone* already exists as a Minecraft panel in Rust).

| Project | Daemon (Go) | Panel (Next.js) | Comment |
|---|---|---|---|
| **Warden** | `wardend` | `beacon` / "Warden" | The Warden keeps watch. Daemon with a Unix-style `d` suffix. |
| **Beacon** | `beacond` | `beacon` | The beacon is the server's "signal"; panel = beacon, daemon = what powers it. |
| **Observer** + **Command Block** | `observerd` | `commandblock` | Two blocks with literal roles: observe/execute. Long names. |
| **Hopper** | `hopperd` | `hopper-ui` | A hopper moves things between containers; cute but not very descriptive. |
| **Craftdeck** | `craftd` | `craftdeck` | No reference to an item; "deck" = control board. Very typeable. |
| **Piston** | `pistond` | `piston` | Pushes/starts things. Collides with Piston (code runtime). |

## Decision
- Repo/project: **Warden**.
- Daemon: **`wardend`** (binary `wardend`, service `wardend.service`, `WARDEND_*` variables).
- Panel: **Beacon** (`beacon/`).

A daemon that keeps watch, a panel that shows. The earlier recommendation (**Craftdeck** / `craftd`) was discarded in favor of this option, which has more personality.
