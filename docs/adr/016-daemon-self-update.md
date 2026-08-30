# ADR-016: Updating the daemon from Beacon

**Status:** accepted · 2026-08-30

## Context

Upgrading wardend meant ssh-ing to the host and re-running the install script. Beacon already
knows the daemon's version (`GET /system`); people expect an "Update" button there. The daemon
runs as the unprivileged `warden` user under a hardened unit (`ProtectSystem=strict`,
`NoNewPrivileges=true`), so it cannot write `/usr/local/bin` and `sudo` cannot help.

## Decision

Two halves, each with the privileges it needs:

1. **Daemon (user `warden`)** — `POST /system/update` runs a `daemon.update` task: fetch the
   release's `SHA256SUMS`, download `wardend-linux-<arch>` into `<data>/update/wardend`, verify
   it, then write `<data>/update/tag` last. The data dir is the one place the unit may write.
2. **Root helper (systemd)** — `wardend install` also installs `wardend-update.path`
   (`PathExists=<data>/update/tag`) and `wardend-update.service` (oneshot, root:
   `wardend update-apply <data>/update`). The helper trusts only the tag: it fetches that
   release's `SHA256SUMS` itself, verifies the staged binary again, installs it atomically over
   `/usr/local/bin/wardend` and runs `systemctl --no-block restart wardend`. The marker is removed
   whatever happens, so a bad stage cannot retrigger it.

`GET /system/update` reports `canApply` only when the platform has a release binary and the path
unit exists; otherwise Beacon tells the operator to re-run the install script. `dev` builds never
report an update. Beacon follows the task, then polls `/system` until the new version answers.

## Consequences

- A compromised daemon can stage a binary but cannot get root to install anything that does not
  match the GitHub release checksums; the trust anchor is GitHub Releases over HTTPS, the same as
  `install.sh`.
- Hosts installed before this ADR need one more `wardend install --yes` (or the install script) to
  get the units; until then the button explains that.
- A daemon restart stops the Minecraft servers (they are its child processes). On the way out the
  daemon writes `<data>/resume.json` with the running ids and the next daemon starts them again
  (`Manager.ResumeAll`, marker consumed so a crash loop cannot keep restarting servers). Expect a
  couple of minutes of downtime per update: Paper waits up to 60 s for its worker pools twice.
- Downgrades and pinned versions are out of scope: the daemon only moves to the newest release.
