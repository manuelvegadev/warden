# Panel UX plan — chrome, previews, plugins, dashboard

Date: 2026-09-25 · Status: agreed; phases 1–4 done · Tracked in
[`roadmap.md`](roadmap.md), Phase 8. **Resuming? Start at [Next step](#next-step).**

This plan came out of a research pass over six areas: the file manager on phones, file previews,
a UI/UX audit of the instance pages, a customisable home dashboard, console history, and plugins
that the catalogs hide. It records what was found, what was decided, and the order of the work.
The decisions that change how an area works go into ADRs as each phase lands; this document is
the plan, not the specification.

## Findings that shaped the plan

- **No Overview page.** An instance opens on Console (`beacon/lib/instance-routes.ts`). Every
  section except Live view and Files carries the same chrome: a header with name, state badge,
  address and power buttons, four resource tiles, and a 280 px right sidebar (Status, Players
  online, Server). Most of it is duplicated — the state badge, port and RAM each appear two or
  three times — and little of it is relevant outside Console.
- **Power buttons read as the page's own.** On Live view, *Stop* and *Restart* sit right above the
  viewer's toolbar. Neither says "server", and neither asks for confirmation
  (`beacon/components/instance/controls.tsx`), even with players online.
- **The sidebar divider stops halfway.** The shell's outer grid only gets `h-full` for full-page
  sections (`instance-shell.tsx`), so on short pages the grid row, and the sidebar's
  `border-l`, end where the content ends.
- **Metrics keeps seven days but shows one hour.** The daemon stores a sample every 2 s for 7 days;
  the panel asks for `1h`, then keeps the *last* sample of each 20 s bucket, so spikes vanish. The
  four charts are 160 px tall next to the sidebar. `docs/api.md` promises a 1-minute rollup after
  24 h that does not exist. TPS is empty on Vanilla and Fabric (no `tps` command).
- **Phones show one folder level at a time on purpose** (ADR-020, *Phones*): the file manager
  mounts only the last column there (`columns.slice(-1)`), so there is nothing to scroll sideways.
- **The Beacon proxy drops `Range`.** The daemon serves file content with `http.ServeContent`, but
  `beacon/app/api/wardend/[...path]/route.ts` forwards only `Content-Type` upstream and drops
  `Content-Range`/`Accept-Ranges`/`Content-Length` on the way back. Safari's `<audio>`, the tail of
  a large log and region-header reads all need it.
- **The editor wraps every line.** `EditorView.lineWrapping` is hard-wired in `code-editor.tsx`.
- **Console history is weak and ArrowUp is taken.** History is a 50-entry `useState` in
  `console.tsx`, lost on unmount and separate in the pop-out. The suggestion list opens on focus
  and on an empty line matches every command, so it takes the arrow keys
  (`command-input.tsx`).
- **Plugin search hides releases for other Minecraft versions.** Modrinth and Hangar queries are
  filtered by the instance's exact version (`wardend/internal/catalog/modrinth.go`, `hangar.go`).
  On a 26.3 server, *Distant Horizons Support* — on both stores, with hashes — does not appear at
  all, which reads as "not in the store".
- **`catalog.Download` enforces neither HTTPS nor a host allowlist**, although `docs/security.md`
  says external downloads do.
- **Distant Horizons today:** DH Support 0.14.0 speaks DH network protocol 15 (DH ≤ 3.2.x); DH 3.3
  moved to 16 (upstream MR !15 is open). Voxy's server side is the community *Voxy Server Side*
  plugin on Modrinth, interoperable with *LOD Server Support*.
- **Command completion is a fixed grammar** (`beacon/lib/command-grammar.ts`: vanilla + Paper). It
  knows nothing about installed plugins.

## Decisions (2026-09-25)

1. **Power controls move to the app sidebar**, under the instance switcher, and leave the page.
   Start is one click; **Stop and Restart always confirm**, naming how many players will be
   disconnected. Kill sits in a `⋯` menu with a confirmation; Delete moves to the instance's
   Settings as a danger zone.
2. **Instance chrome: an Overview section plus a status panel** (audit options D1 + D2). Overview
   becomes the instance's landing page; a small card at the foot of the app sidebar (state and
   uptime, players, TPS, CPU, RAM — a row each, with a popover) replaces the tiles and the right
   sidebar on every other section. (First built as a strip beside the breadcrumb; moved to the
   sidebar the same day, ADR-021.)
3. **A customisable home dashboard**, Twitch Stream Manager style: columns of stacked modules,
   resized by dragging the divider between them, with modules added, removed and reordered in an
   edit mode. Built on **react-resizable-panels v4** (the shadcn *Resizable* component) with a
   small drag layer; layouts stored per user in Beacon's database.
4. **Previews get a View / Edit toggle** in the file header, one mechanism for every file type that
   has a richer view than text.
5. **A player is always shown as face + name**, everywhere the panel names one.
6. **Console history per the spec below**, per user and instance, shared with the pop-out.
7. **Plugins for other Minecraft versions are shown, dimmed, with a warning**, and can be installed
   after a confirmation. Updates respect that choice.
8. **LOD plugins get a first-class integration**: Distant Horizons Support and Voxy Server Side,
   behind one design.
9. **Commands of installed plugins autocomplete** in the console.

## Phases

### Phase 1 — UI fixes and small features (Beacon only)

| # | Item | Notes |
|---|---|---|
| 1.1 | File manager: every column on phones | Column width `min(85%, 22rem)` so the parent peeks; `snap-x`, columns `snap-end`; auto-scroll to the end keyed on the active directory, not the column count; a tap on a half-visible column reveals it instead of choosing a row; ~44 px rows; the file keeps opening full screen over the strip. Revises ADR-020 *Phones*. |
| 1.2 | Power controls in the sidebar | Decision 1. Icon-only when the sidebar is collapsed; inside the sheet on phones. |
| 1.3 | Full-height pages | `min-h-full` on the shell's outer grid, `content-start lg:content-normal` on the inner one. |
| 1.4 | Console and Config files fill the height | Replace the fixed `h-[min(60vh,640px)]` and the 560 px lists. |
| 1.5 | Metrics as a full-page section | No sidebar; the pop-out's fill layout in-page; drop the misleading "sampled every 2s". |
| 1.6 | Console history | Spec below. |
| 1.7 | Word-wrap toggle in the editor | A CodeMirror `Compartment`; persisted per file category with `useStoredFlag` — off for logs, JSON and data, on for prose and configuration. |
| 1.8 | `PlayerName`: face + name everywhere | Players, Access, sidebar, console, player picker, Live view, activity. Uses wardend's cached skin proxy. |
| 1.9 | Small fixes | Members breadcrumb; keyboard-reachable player rows; dates next to times; no nested `<main>`; "Host network" label; hide TPS where the software has no `tps` command. |

**Console history spec.**
- Empty line: ArrowUp/ArrowDown walk history. The suggestion list no longer opens on focus or on an
  empty value; Tab still opens and cycles it on any line.
- Typed text with the list open: arrows walk the list — unless history navigation has begun.
- Typed text with the list closed: prefix search (zsh `up-line-or-beginning-search`).
- The draft is kept: past the newest entry, ArrowDown restores what was being typed.
- Escape closes the list, else leaves history and restores the draft.
- A repeated command moves to the front; 100 entries; ignored while an IME composes.
- Stored in `localStorage` under `beacon.console.history.<userId>.<instanceId>`, synced across
  windows by the `storage` event, so the pop-out shares it. Commands others ran, and the daemon's
  own (`save-off`, whitelist commands), are not part of it.
- Pure logic in `beacon/lib/command-history.ts` with `node:test` tests.

### Phase 2 — Instance chrome and metrics (ADR-021, done 2026-09-25)

- The **Overview** section as the default route: larger resource tiles, status, players online,
  recent activity, next backup.
- The **status panel** at the foot of the app sidebar; tiles, right sidebar and page header
  removed from every section, now that the name lives in the switcher and the breadcrumb.
- **Metrics:** range picker (15m · 1h · 6h · 24h · 7d, in the URL; the daemon accepts a `d`
  suffix); server-side buckets with avg/min/max (`?points=`); a 1-minute rollup past 24 h, which
  makes `docs/api.md` true; gaps drawn as gaps; stopped periods shaded; a shared crosshair;
  Players and Disk charts (already stored).
- "Restart to apply" calls to action on Properties, Plugins and Settings.

### Phase 3 — Previews and structured editing (revises ADR-020, done 2026-09-25)

1. The proxy forwards `Range`, `If-Range`, `If-None-Match`, `If-Modified-Since` upstream and
   `Content-Range`, `Accept-Ranges`, `Content-Length` back.
2. The **View / Edit toggle**:

   | File | View | Edit |
   |---|---|---|
   | `*.log`, `*.log.gz`, `crash-reports/*.txt` | Log view on `PrettyConsole`: level colours, level chips, search, folded stack traces, follow on `latest.log`, tail by range for big files | Editor (`.gz` read-only) |
   | Every `.json` and `.mcmeta` (the server's lists too) | Visual JSON editor: edit values in place, rename keys, change types, add and delete entries — the same draft as the text | Editor |
   | `eula.txt` | Accepted / Accept card | Editor |
   | Images | Checkerboard, integer zoom, dimensions, pixelated only when upscaling; `server-icon.png` card with *Use as server icon*; skins in 3D | — |
   | Audio | The panel's own player: waveform as the seek bar, loop, volume, speed (daemon serves `audio/*`) | — |

   (Revised on review: first built with tables for the server's lists and the Properties form for
   `server.properties`; replaced by one JSON editor for every JSON file, and `server.properties`
   stays text in Files.)

3. With daemon endpoints (in `docs/api.md`): `GET /fs/jar` (full `plugin.yml`/`paper-plugin.yml`,
   manifest, minimum Java), `GET /fs/archive[&entry=]` (jars, datapacks, resource packs,
   `pack.mcmeta`), `GET /fs/nbt` (read-only; `level.dat`, playerdata, schematics), the `.mca`
   header grid, read-only SQLite (CoreProtect, LuckPerms SQLite, Distant Horizons).
   H2 and DuckDB are out of reach.

### Phase 4 — Plugins

| # | Item | Status |
|---|---|---|
| 4.1 | Search and version lists stop filtering by Minecraft version; releases that do not list the instance's version are dimmed ("not listed for 26.2 · up to 26.1.2") and install after a confirmation; the installed record keeps the flag and updates honour it. The search also runs as the admin types. | Done 2026-09-25, [ADR-022](adr/022-plugins-not-listed-for-the-server-version.md) |
| 4.2 | Downloads: HTTPS only on every hop; what the sources host only from known hosts; Hangar external links to any host but only public addresses, shown and confirmed in the panel. | Done 2026-09-25, [ADR-023](adr/023-where-downloads-may-go.md) |
| 4.3 | Plugin command completion in the console: the Warden Agent sends the server's command list whenever it changes and answers live tab-completion for the typed line (every plugin, arguments included); the grammar keeps vanilla. The `plugin.yml` fallback was dropped: the agent is on every server that runs plugins. | Done 2026-09-25, [ADR-024](adr/024-console-command-completion.md) |
| 4.4 | LOD integration for **Distant Horizons Support** and **Voxy Server Side**: install from the panel, a form for their configuration, pre-generation with progress (DHS only — VSS has no pre-generation on Paper), LOD data left out of backups by default (an "Include LOD data" switch archives it as a consistent snapshot instead), disk usage, and a client-protocol compatibility note. | Done 2026-09-25, [ADR-025](adr/025-distant-view.md) |

Later: install from URL with a recorded hash and a trust badge; link uploaded jars to a store by
hash; a GitHub releases source.

### Phase 5 — Home dashboard (new ADR)

1. Embeddability refactors: a `fill` mode separate from `popout` in `useDetachable`; Metrics split
   into four charts; container queries instead of viewport breakpoints; one `InstanceProvider` per
   instance.
2. MVP: columns of modules on react-resizable-panels; edit mode (add, remove, drag to reorder,
   resize by dividers); one layout per user in a `dashboardLayout` table with versioned module
   kinds; a single stacked column on phones; a default preset that reproduces today's Home; one
   Live view per dashboard.
3. More modules: activity feed, log tail, backups summary, plugin updates, properties quick
   toggles, pinned file, whitelist quick-add; one shared WebSocket.
4. Named layouts and organisation-wide presets.

The ADR also takes ownership of the detachable-pane contract (`use-detachable`, the `(popout)`
routes), which no ADR documents today.

## Next step

**Phase 5 — the home dashboard.** Nothing of it is built yet. It needs an ADR of its own (the next
number after ADR-025), which also takes ownership of the detachable-pane contract
(`use-detachable`, the `(popout)` routes), which no ADR documents today.

**What exists to build on** (from the plan's own Phase 5 section)

- `useDetachable` and the `(popout)` routes already detach a pane; a `fill` mode is needed
  alongside `popout`.
- Metrics is one component today; splitting it into four charts is part of the embeddability
  refactor.
- Viewport breakpoints are used where container queries should be, and instance pages do not yet
  have one `InstanceProvider` per instance.

**Scope from the plan:**

1. The embeddability refactors above.
2. An MVP: columns of modules on react-resizable-panels; edit mode (add, remove, drag to reorder,
   resize by dividers); one layout per user in a `dashboardLayout` table with versioned module
   kinds; a single stacked column on phones; a default preset that reproduces today's Home; one
   Live view per dashboard.
3. More modules: activity feed, log tail, backups summary, plugin updates, properties quick
   toggles, pinned file, whitelist quick-add; one shared WebSocket.
4. Named layouts and organisation-wide presets.

**Checks** — as for every change: `CONTRIBUTING.md`.

## After this plan

Agreed on 2026-09-26 to do once Phase 5 is done — not before.

- **World pre-generation with Chunky in the Distant view section** (roadmap 8.6). The LOD plugins
  build LODs, not the world: Distant Horizons Support 0.14.0 generates chunks to build its LODs and
  discards them, so players still generate that terrain when they reach it; Voxy Server Side has no
  pre-generation on Paper and builds LODs as players move, reading the chunks that exist. Chunky
  therefore stays the way to have terrain generated ahead, and the recommended order is Chunky
  first, then DHS's pre-generation (running them together slows both). The shape would follow DHS's
  in ADR-025: install from the panel, per world a centre and radius (or the world border), progress
  read through the agent's `run` request, resumed after a restart, and a hint on the Voxy card to
  pre-generate with it. Check Chunky's current commands and progress output first.
