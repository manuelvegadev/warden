# ADR-010: Managed Java runtimes (Temurin via Adoptium), not system-wide installs

Date: 2026-08-28 · Status: accepted

## Context
Minecraft's Java requirement moves fast: 26.1+ needs Java 25, 1.20.5–1.21.x Java 21, 1.17–1.20.4 Java 17, older versions Java 8. A host running several instances needs several JDKs side by side, and asking the operator to `apt install` the right one is error-prone. Launchers such as Prism solve this by downloading runtimes into their own directory.

## Decision
- `wardend` manages runtimes under `<data>/java/<id>/` (e.g. `temurin-25`), one directory per major, each with a `runtime.json` (vendor, version, absolute `bin/java` path). Nothing is installed at the OS level and no `PATH`/`JAVA_HOME` is touched.
- Source: **Eclipse Temurin** JRE builds from the Adoptium API (`https://api.adoptium.net/v3/assets/latest/{major}/hotspot?os=&architecture=&image_type=jre&vendor=eclipse`), downloaded with SHA-256 verification and extracted with a path-traversal guard. Linux x64/aarch64 and macOS aarch64/x64 are supported.
- The system `java` on `PATH` is detected and listed as `system` (never removed by wardend).
- Each instance manifest may pin `javaRuntime` (an id) or `javaPath` (explicit binary). When neither is set (**auto**), wardend picks the newest installed runtime whose major ≥ the requirement for the instance's Minecraft version; during the `install` task it downloads the required Temurin major if none qualifies.
- Starting an instance with a pinned runtime that is too old fails with a clear error instead of letting the JVM crash.
- API: `GET /java`, `GET /java/required?mc=`, `POST /java {major}` (task), `DELETE /java/{id}`; `GET /system` includes `java[]`. Beacon exposes **Settings → Java** and a runtime selector in the create dialog.

## Consequences
- ~180 MB per runtime on disk; the operator can remove unused ones from the UI.
- wardend must be able to reach `api.adoptium.net` and `github.com` (release assets).
- JRE, not JDK: enough for running servers; plugin developers use their own JDK.
- Future: other vendors (GraalVM, Zulu) can be added behind the same `Manager` if needed.
