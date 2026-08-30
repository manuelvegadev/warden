# ADR-015: Importing existing servers

**Status:** accepted · 2026-08-30

## Context

People arrive with a server already running somewhere: a folder with `server.properties`, worlds,
plugins and a jar. Recreating it through the create dialog and copying files by hand defeats the
point of a panel. Backups (`docs/api.md`) restore *our* archives into *our* instances; they never
carry the jar and there is no upload path, so they cannot bootstrap a server from outside.

## Decision

1. **One endpoint, one task.** `POST /instances/import` takes a multipart upload (text fields
   first, then the archive) and behaves like `POST /instances`: the instance is created up front
   (id/port validation and `409`s happen synchronously), the archive streams to
   `<data>/imports/`, and an `import` task does the work with the usual `task.progress` stream.
   The panel's flow is "upload with a progress bar, then land on the console" — no second step.
2. **Archives people actually have.** `.zip`, `.tar`, `.tar.gz`/`.tgz` and our own `.tar.zst`.
   A single wrapper folder is unwrapped; desktop junk is dropped.
3. **Untrusted input.** Extraction lives in `backup.Unpack` next to the backup extractor and
   shares its rules: paths confined to the destination, no symlinks or special files, plus hard
   caps on uncompressed size and entry count (decompression bombs). The upload itself is capped
   by `http.MaxBytesReader`.
4. **Detect, don't ask.** `instance.DetectServer` reads the jar name (Paper, Purpur, Fabric,
   vanilla naming and the Fabric installer layout), the `version.json` inside any jar, and
   `.paper/version_history.json` (trusted only when it matches the jar's version). The
   software/version fields in the dialog are the user's answer for what detection cannot
   settle: no jar → that build is downloaded, like an install; an unidentifiable jar → it is
   labelled with them; a recognised jar wins over them.
5. **Tasks are cancellable per instance.** `tasks.Manager` keeps a cancel function per running
   task; `DELETE /instances/{id}` cancels and waits before removing files, and `POST …/install`
   is refused while a task runs. Pages seed their task banner from `GET /tasks?instance=` so a
   task that finished before the WebSocket subscribed is still reported.
6. **The manifest wins on network settings.** Ports come from the create step (collision-checked),
   so `server-port`/`query.port`/`rcon.port` are rewritten on import. Everything else in the
   archive is kept as is, including an accepted `eula.txt`.

## Consequences

- Imported instances are ordinary instances: upgrades, backups and plugins work unchanged because
  the manifest ends up identical to one written by `Install`.
- `libraries/`, `cache/` and `versions/` from the source server are imported if present (Paper
  regenerates them; importing them only costs disk).
- A failed import leaves the instance in `installing` so the Files tab can be used to see what
  arrived; `Delete` cleans up. There is no retry: re-import with the fallback fields set.
- Not covered: importing from a path on the daemon's host, and re-pointing the panel at a server
  that should stay where it is. Both would be separate endpoints.
