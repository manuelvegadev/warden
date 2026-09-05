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
  JavaScript, SQL, or plain) with the same draft/save cycle as the other editors, images inline,
  everything else download-only. The daemon decides which is which from the extension and the
  first bytes (`Content-Type`).
- **Phones** (under 768 px, `useIsMobile`): one level at a time — the open directory at full width
  with a back chevron in its header — and a chosen file covers the page like a modal, header to
  save bar, until its back arrow. The toolbar keeps the path bar and turns the buttons into icons.
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
