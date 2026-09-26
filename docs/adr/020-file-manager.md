# ADR-020: File manager — the server directory, in columns

Date: 2026-09-05 · Status: accepted · **Extends** ADR-017 (per-instance roles) · **Revises** the "no file browser" stance of the confined config editor (`docs/api.md`, Phase 2).

## Context

Beacon edits configuration through allowlists: `server.properties` has its own editor, and the
*Config files* section lists a fixed set of Bukkit/Paper/world/plugin files. That was a deliberate
choice — the panel should not be a general file browser — and it holds up for the routine: MOTD,
paper-global, a plugin's config. It does not hold up for everything else an administrator does
with a server directory: reading a crash report, dropping a datapack into `world/datapacks`,
renaming a world folder before restoring an old one, deleting a plugin's data directory, checking
what a plugin wrote to `logs/`. For those the answer was "SSH in", which is what the panel exists
to make unnecessary.

## Decision

A **file manager** section, Finder-style: one column per open directory, the chosen file in a
pane on the right, an editor when it is text. It browses the **whole server directory** of an
instance — `server/` and nothing above it — and lets a manager create, upload, download, rename,
move and delete.

### Daemon: `/instances/{id}/fs`

- `GET /fs?path=` lists a directory; `GET /fs/content?path=` streams a file (ranges, conditional
  requests; `&download=1` makes it an attachment); `PUT /fs/content?path=` writes one;
  `POST /fs/upload?path=` takes multipart uploads; `POST /fs/mkdir`, `POST /fs/rename`,
  `DELETE /fs?path=`. Paths are slash-separated and relative to `server/`; `""` is the root.
- **Confinement** is the same discipline as the config editor, generalised. Every path is cleaned
  (`..` cannot climb: `../instance.json` *is* `instance.json` in the server root) and resolved
  through symlinks; a target whose real path lands outside the server directory is refused
  (`403`). Renames and deletions resolve the parent only, so a link inside the directory is
  renamed or removed *as a link* — never through to what it points at. `instance.json`, the
  backups and the other instances live above `server/`, unreachable by construction.
- **Protected files.** The server jar (`manifest.jar`) and the Warden Agent jar are wardend's:
  upgrades swap the first, the live view depends on the second. They can be read and downloaded,
  not written, renamed or removed (`409 protected`).
- **Writes** keep the guarantees the config editor gave: YAML and JSON are syntax-checked
  (`400 invalid_syntax`), files are written atomically, and `server.properties` goes through the
  properties writer (schema validation, the rewrite-on-stop snapshot for a running server).
  The editor caps at 2 MiB; bigger files travel as uploads and downloads.
- **Uploads** stream to a temporary sibling and are renamed into place; an existing name is
  refused (`409 exists`) unless `overwrite=1`, so the panel can ask first.
- **One role, `files`, at `manager`** (`access-vectors.json`). The directory holds
  `server.properties` with `rcon.password` and every plugin's secrets; there is no read-only
  tier below manager that would be safe to hand it to.

### Panel

- Section *Files* (`/instances/{id}/files`) in the Configuration group, full-page like the live
  view. The confined editor moves to *Config files* (`/config`): grouped, quick, still the
  better tool for the routine edits.
- Miller columns of a fixed width, the strip scrolling to keep the newest in view; Up/Down move
  the choice inside a column, Left/Right cross columns. A path bar (`server/…`) takes a typed
  path. Right-click on an entry: open or download, rename, delete. Files dropped on a column are
  uploaded into that directory (an element-scoped drop hook, `hooks/use-drop-zone.ts`, next to
  the window-level one).
- The preview pane: text in CodeMirror (YAML, JSON, properties, TOML, shell, Markdown, XML, INI,
  JavaScript, SQL, or plain) with the same draft/save cycle as the other editors, a line-wrap
  switch remembered per kind of file (off for logs and data), pictures, a player for sounds,
  everything else download-only. The daemon decides which is which from the extension and the first bytes
  (`Content-Type`). The editor uses the panel's code font at 13 px with a 1.6 leading and a
  palette of its own on the console's ground (`code-editor-theme.ts`); like the console, the pane
  can go full screen or open in its own window (`/file/{id}?path=`).
- **Views** (revised 2026-09-25): a file that reads better as something other than text gets a
  view, and a *View / Text* switch in its header when it is also editable text. A text file has
  one draft and one save bar whichever way it is shown; the editor stays mounted behind the view.
  Which file gets which view is one pure function (`lib/file-views.ts`):
  - **Logs** — `*.log`, the gzipped `*.log.gz` the server rotates (gunzipped in the browser) and
    crash reports — read like the console: the level from each line's prefix, the kind filters,
    a search, stack traces folded into the line that logged them (`logLines`). A log over the
    editor's limit shows its last 2 MB (a `Range` request); `latest.log` follows new lines.
  - **JSON** — every `.json` and `.mcmeta`, the server's own lists as much as any other — in a
    visual editor (`lib/json-edit.ts`): objects and arrays fold, a value is changed by clicking it
    (a boolean flips), a key renamed the same way, each entry's menu changes its type or deletes
    it, a container's + adds to it. Every edit rewrites the draft in the file's own indentation.
    A file with integers beyond what JavaScript holds exactly (a seed) stays read-only there.
  - `eula.txt` as whether the EULA is accepted, with the button that accepts it.
    `server.properties` is text here; its form is the Properties section.
  - **Pictures** on a checkerboard, fitted or at whole-number zooms, sharp while they are pixel
    art (256 px or less, or zoomed in), with their size; a 64×64 PNG can become the server icon
    and a 64×64 or 64×32 one be looked at as a skin in 3D. **Sounds** in a player of the panel's
    own (not the browser's): the waveform, decoded with Web Audio, is the seek bar; play and
    pause, time, loop, volume and speed.
  - **What the daemon reads out of binaries**, read-only, through `/fs/jar`, `/fs/archive`,
    `/fs/nbt` and `/fs/sqlite` (docs/api.md):
    - a **jar** as the plugin or mod it is — the first descriptor found (`paper-plugin.yml` before
      `plugin.yml`, then Velocity, BungeeCord, Fabric, Quilt, NeoForge, Forge), its version,
      authors, dependencies, commands and permissions, the manifest, the Java its classes need —
      with the descriptor itself and the files inside. YAML scalars are kept as written, so a
      version `1.10` is not the number 1.1; TOML descriptors are shown as text (no TOML parser);
    - a **zip** (datapack, resource pack) as its files, one opening beside the list, a pack's
      description and format on top;
    - an **NBT** document — level.dat, playerdata, maps, structures, schematics; gzip, zlib or raw —
      as a tree of typed tags, big arrays and lists shown in part, with the facts of level.dat or a
      player's file first. The decoder is our own (`mc/nbt.go`, table-tested) rather than a library:
      the format is small and stable, and the Go libraries for it had gone unmaintained;
    - a **region** file as its 32×32 chunks, from the 8 KiB header alone (a Range request, parsed
      in the browser), shaded by when each was last saved;
    - a **SQLite** database (CoreProtect, LuckPerms with SQLite storage) as its tables and pages of
      rows, opened `mode=ro` with `query_only`; rows are not counted. H2 and DuckDB files are not
      readable here.
  The BFF forwards `Range` and the conditional headers, so tails, seeking and 304s reach
  `http.ServeContent`.
- **Phones** (under 768 px, `useIsMobile`): the same columns, each `min(85%, 22rem)` wide so the
  parent peeks in at the left, snapping to their right edge as the strip is swiped. The strip
  scrolls to its end whenever the open directory changes; a tap on a column shown only in part
  brings it into view rather than choosing the row under the finger; rows and the header are
  sized for a finger, and the last column's header has a back chevron that goes up a level. A
  chosen file covers the page like a modal, header to save bar, until its back arrow, and the
  columns underneath are where they were. The toolbar keeps the path bar and turns the buttons
  into icons. (Revised 2026-09-25: phones first showed one level at a time, which left nothing to
  scroll to.)
- **Icons** are the Atom Material Icons set (MIT, Elior "Mallowigi" Boukhobza), the icons behind
  the IntelliJ *Atom Material Icons* plugin. `scripts/file-icons.mjs` takes a curated subset of
  its name → icon rules — what a Minecraft server directory holds plus the usual text and code
  types, and a few rules of our own for `.dat`/`.mca`, rotated logs, crash reports, world and
  region folders — bakes the rule colours into the SVGs and writes them as data URIs to
  `lib/file-icons/icons.generated.ts` (about 120 KB, loaded with the section). The generated file
  is committed with the licence notice; regenerating needs a checkout of the
  `AtomMaterialUI/iconGenerator` repository. The rules run in the browser exactly as the plugin
  runs them: a regular expression per rule, highest priority first, over the file name — or the
  path, for the rules that mention directories.

## Consequences

- SSH is no longer needed for the everyday: datapacks, crash reports, plugin data, world
  folders, logs. The confined editor stays as the tidy view of the files most people edit.
- The daemon exposes more surface, all of it manager-only and all of it confined to `server/`.
  What it still refuses: touching the server jar and the agent, and writing files over 2 MiB
  through the editor. What it does not do yet: extract or create archives, move entries between
  directories by drag, or notice changes made outside the panel (a *Refresh* button covers that).
- `files` is a new action in the shared access vectors; both test suites pin it.
- The icon set is a build-time asset: adding a file type is a name in the script's curated list
  and a regeneration, not a runtime download.
