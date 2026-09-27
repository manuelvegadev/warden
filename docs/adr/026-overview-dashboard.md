# ADR-026: The Overview dashboard, and the detachable-pane contract

Date: 2026-09-26 · Status: accepted · Phase 8.5 of docs/roadmap.md (panel UX plan, Phase 5) ·
Takes ownership of the detachable-pane contract (`use-detachable`, the `(popout)` routes), which no
ADR documented.

## Context

An instance's Overview (ADR-021) is its landing page: fixed rows of the last hour's resources, its
state, who is on, what it runs, the recent activity and where backups stand. The panel UX plan
(decision 3) agreed on a customisable dashboard instead, in the style of Twitch's Stream Manager:
columns of stacked modules, resized by dragging the dividers between them, with modules added,
removed and reordered in an edit mode, and a layout kept per user. It was first built as Beacon's
Home; it belongs on the instance's Overview, where every module already has its server — Home stays
the list of instances and the daemon's and host's tiles it was.

What stood in the way:

- **Viewport breakpoints.** The components that become modules (Console, Metrics, Live view, the
  Overview cards, the activity feed) laid themselves out with `sm:`/`lg:`/`xl:`, i.e. by the window's
  width. In a narrow column of a wide screen they would lay out as if wide. Container queries were
  not used anywhere.
- **Display modes grown by hand.** `useDetachable(path, name, popout)` gives Console, Metrics and
  Live view fullscreen and a pop-out window (the `(popout)` routes, one page each, with their own
  `InstanceProvider`). Console and Metrics also took a `fill` prop ("stretch to the bottom of the
  section", from `lg` up); Live view did not. The contract was not written down.
- **Metrics is one component** rendering up to six charts (CPU, memory, TPS, players, disk, network)
  with the range in the URL.

## Decision

### The dashboard (an instance's Overview)

- The Overview becomes the dashboard. Its actions — **Edit**, and while editing "+ Column" and
  **Reset** — go in the site header's page-actions slot, as every page's do. Across the top, a
  **strip of key figures** at full width (the pattern modern dashboards share: KPIs above the fold,
  the big panels under them): CPU, RAM, TPS, players, uptime and host network by default, disk on
  offer, each a tile with its trend, sharing the row. Under it, the **canvas**, filling the rest of
  the screen and **never scrolled**: 1–4 **columns** whose widths
  are resized by dragging the dividers between them; inside a column, 0–6 **modules** stacked, 20 px
  apart as on the other pages. A module is as tall as its content and never scrolls — Resources and
  Host are their tiles, Status its card — except the **fill** modules (Console, Metrics, Live view,
  Recent activity), which share the height the column leaves them, resizable against each other, squeezing down to
  8rem each rather than let the canvas scroll (only a console's own log scrolls, as it does
  everywhere; the activity feed shows as many entries as fit, fading out at its foot). Dividers work
  at all times (shown on hover); edit mode adds the rest.
- **The instance is the page's.** Every server module shows the instance whose Overview it is; there
  is no server selector.
- **Edit mode:** each module gets a dashed outline and a slim bar naming it — drawn in the 20 px gap
  above it, so editing adds no height — with a handle to drag it within its column or to another, its
  settings (Metrics' charts) and a ✕ to remove it; the key figures get the same outline and bar,
  with a gear to pick them and a ✕ to hide the strip (a line then offers it back); "+ Add module" at
  the foot of each column (a menu of kinds); "+ Column" and **Reset** in the header, beside Done; a ✕
  on an empty column removes it.
  Outside edit mode a module has no chrome of the dashboard's at all: its own cards are the whole of
  it. Changes save on their own, 500 ms after the last one.
- **Phones:** the key figures two to a row, then one column holding every module in column order —
  the fill modules at a fixed height per kind, the rest as tall as their content — the Overview
  scrolling as a whole; in edit mode, up/down buttons instead of dragging.
- **Modules in this step** (all built from existing pieces):

  | The instance | The daemon and its host |
  |---|---|
  | Resources (the last hour) | Wardend (version, uptime, instances, players) |
  | Status · Players online · Server facts | Host (CPU, memory, disk) |
  | Recent activity · Backups summary | |
  | Console | |
  | Metrics (which charts, and the range) | |
  | Live view (at most one per dashboard) | |

  A module that does not apply to the instance says why in its place (TPS on Vanilla, Live view
  without the agent, a stopped server). A module kind the panel no longer knows shows as "Module
  unavailable" instead of breaking the layout. Each module sits in its own error boundary: one that
  fails shows so, and the rest keep working. Fullscreen and pop-out sit in the module's body, the same
  controls its section carries.
- **The default preset:** the key figures across the top; under them the live Console as the page's
  centrepiece, in a column of about two thirds; Status, Backups and Recent activity in the other. The
  Metrics charts are not in it — the key figures already carry each figure's trend, and the Metrics
  section the detail — but stay on offer as a module.

### The layout and where it is kept

```json
{ "version": 1, "kpis": ["cpu", "memory", "tps", "players", "uptime", "network"],
  "columns": [ { "id": "c1", "size": 34, "modules": [ { "id": "m1", "kind": "status", "size": 20 },
                                                       { "id": "m2", "kind": "console", "size": 80 } ] },
               { "id": "c2", "size": 66, "modules": [ { "id": "m3", "kind": "metrics", "size": 100,
                                                         "settings": { "charts": ["cpu", "memory"], "range": "1h" } } ] } ] }
```

Sizes are percentages; every column and every module carries an `id`; `kpis` is the strip, in
order (`[]`: hidden; missing, as in a layout stored before the strip: the default one). One layout
per user, the same on every instance.

- **Beacon's database**, a table beside `instanceAccess`, created by the same idempotent schema in
  `lib/db.ts`: `dashboardLayout(userId TEXT PRIMARY KEY, layout TEXT NOT NULL, updatedAt TEXT NOT NULL)`.
- **`lib/dashboard-layout.ts`**: pure `defaultLayout()`, `normalizeLayout(raw)` (1–4 columns, each
  with an id, 0–6 modules per column, sizes renormalised to 100, unique ids, per-kind settings checked
  against the module registry, a second Live view dropped, unknown kinds kept and marked, the strip
  checked by `lib/kpis.ts`'s `normalizeKpis`) and
  `migrate(layout)` (versioned kinds; v1 today).
- **`lib/dashboard-layout-store.ts`**: `getLayout`/`saveLayout`/`deleteLayout` with prepared
  statements, as `lib/org.ts` does, and `parseLayoutBody` (a PUT body as a layout to store, or the
  `400`/`413` to answer instead; a body over 32 KB is refused before it is parsed).
- **`lib/dashboard-edit.ts`**: the edit-mode operations — add/remove a module, add/remove a column,
  move a module (phones' up/down buttons), and apply a drag-and-drop result — as pure functions on
  the layout, normalised the same way; each returns a new layout or, when the operation is refused
  (over a limit, or no actual change), the same object (`===`); a drag-and-drop result is applied so
  a module is never lost or duplicated.
- **Beacon routes** (the layout is Beacon's; the daemon is not involved), for the signed-in user
  only — no instance role is involved:
  `GET /api/dashboard-layout` → the layout, or the preset with `isDefault: true`;
  `PUT /api/dashboard-layout` → normalised and saved, returned as saved (`400` when it cannot be
  normalised, `413` beyond 32 KB — checked against `Content-Length` before the body is even read,
  and again on what was actually received); `DELETE /api/dashboard-layout` → Reset: the row is
  removed and the preset returned. Removing a member deletes their row.
- **No flash on load:** the instance layout (a server component) reads the layout and hands it to a
  provider above the sections, which holds it from then on — leaving the Overview for another section
  and coming back shows it as last edited, not as first loaded.
- Saving is optimistic; two tabs are last-write-wins; a failed save says so and is retried with the
  next change. A size only saves once `react-resizable-panels` reports the change as a user
  interaction (not its own initial-mount callback), still debounced 500 ms; a save still pending
  when the tab is hidden or closed is flushed at once with `fetch`'s `keepalive` instead.

### The embeddability refactors

1. **The detachable-pane contract.** One display mode replaces the `popout`/`fill` props:
   `mode: "section" | "fill" | "popout"`, with fullscreen as an overlay on any of them.
   `section` takes the height its page gives it; `fill` fills its container at any width (a
   dashboard module); `popout` is the window of a `(popout)` route, which stay as they are.
   `useDetachable(path, name, mode)` keeps returning `rootRef`, `fullscreen`, `toggleFullscreen`,
   `openPopout`, `fillHeight` and `showPopout`. Console, Metrics and Live view take `mode`; Live view
   gains `fill`. `FilePreview` is out of scope: it is not a dashboard module, so it keeps its own
   `popout?: boolean` prop rather than taking `mode`.
2. **Container queries.** Every module, and every section that uses the same pieces, is wrapped in
   an `@container`. Inside the reused components the old viewport breakpoints become container ones
   by the rule that a section's content is about the viewport minus 16rem (the app sidebar plus
   padding), so a module needs a bigger container breakpoint than the viewport breakpoint it
   replaces: `sm:` → `@md:`, `md:` → `@lg:`, `lg:` → `@3xl:`, `xl:` → `@5xl:` (Tailwind v4, no
   plugin). `sm:` maps up two steps, not one: below 768 px there is no app sidebar, so a module's
   content is close to the bare viewport rather than the viewport minus 16rem, and `@sm:` (24rem)
   would turn on at about 416 px — well short of where `sm:` used to. Sections look as they do today,
   since their container is about as wide as the page.
3. **Metrics gains a `charts` filter.** `MetricsChart` stays one component rendering CPU, memory,
   TPS, players, disk and host network from one data hook per range, sharing a `syncId` for the
   crosshair; it now also takes an optional `charts` list of which of them to draw (default: all).
   The Metrics section and its pop-out (`MetricsView`) still pass every chart, with the range in the
   URL; the dashboard module (`MetricsPanel`) passes the chosen ones, with the range from its
   settings.
4. **The daemon's figures, polled once.** The Wardend and Host modules read `useSystemInfo`, a single
   shared poller: one subscription, polled every 5 s while at least one caller is mounted, rather than
   each opening its own interval. The server modules read the instance's `InstanceProvider`, which
   the instance page already mounts with its one WebSocket.
5. **A module registry**, the single source for module kinds as `SECTIONS` is for sections:
   `lib/dashboard-modules.ts` holds each kind's scope (the instance, or the daemon and its host),
   title, whether it fills (and then its height on phones and minimum share), uniqueness (Live view)
   and settings (defaults and validation, e.g. Metrics' `charts`/`range`);
   `components/dashboard/modules.tsx` renders each kind and says when it does not apply (a stopped
   server, software without the agent).

### Dependencies

- `react-resizable-panels` **4.13.3** in `packages/ui`, as shadcn's Resizable component: the dividers
  and the column and fill-module panels.
- `@dnd-kit/react` **0.5.0** and `@dnd-kit/helpers` **0.5.0** in `beacon`: sortable modules within
  and across columns, with animation. The actively developed dnd-kit line; being 0.x, versions are
  pinned exactly (a minor release may change the API). The classic `@dnd-kit/core`/`sortable` have
  had no release since 2024.

Both support React 19 (Beacon runs 19.2.8 with Next 16.3.3).

### Next steps (designed here, built later)

- **More modules (plan 5.3):** log tail, plugin updates, properties quick toggles, a pinned file,
  whitelist quick-add.
- **Named layouts and organisation-wide presets (plan 5.4):** a user keeps several named layouts and
  switches between them from the header; owners and admins publish presets to the organisation,
  offered in "Reset" and to new members. That needs organisation-level storage, which Beacon lacks
  today (a new table beside `dashboardLayout`), and its own section of this ADR when built.

## Consequences

- The Overview's content moves into modules; users who never edit see the Overview they had.
- Home is untouched: the list of instances and the daemon's and host's tiles.
- Every reused component follows container queries from here on: a new component meant to be
  embeddable must not use viewport breakpoints for its own layout.
- The detachable-pane contract is now written down: a new detachable pane takes `mode` and
  `useDetachable`, and gets a `(popout)` route.
- Three new dependencies, one of them pre-1.0 and pinned.
