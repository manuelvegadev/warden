# ADR-021: Instance pages — an Overview, a status panel, and metrics over a week

Date: 2026-09-25 · Status: accepted · **Revises** the instance page chrome of the panel (header,
stat tiles, facts sidebar) · **Extends** the metrics store and endpoint (`docs/api.md`).

## Context

Every instance section carried the same chrome: a header with the name, the state badge, the
address and the power buttons; four resource tiles; and a 280 px sidebar with Status, Players online
and Server cards. An audit of the pages (docs/panel-ux-plan.md) found it costly and mostly
irrelevant:

- The state, the port and the RAM were each shown two or three times, and the name three (the
  switcher, the breadcrumb, the header).
- The tiles and the sidebar took about 200 px of height and 280 px of width from sections — a file
  editor, the properties form, a player table — that had no use for them.
- On short pages the sidebar's divider stopped halfway down.
- *Stop* and *Restart* sat right above the Live view's toolbar and read as that viewer's.
- There was no page that answered "how is this server doing?": an instance opened on Console.

Metrics had the opposite problem. The daemon kept a sample every 2 s for 7 days, but the panel asked
for the last hour, kept the last sample of every 20 s bucket (so spikes vanished), and drew four
160 px charts next to the sidebar. `docs/api.md` promised a 1-minute rollup past a day that did not
exist.

## Decision

### An Overview, and sections that have the page to themselves

- **Overview** (`/instances/{id}/overview`) is the instance's landing page: the resource tiles over
  the last hour, Status (with the address), Players online, Server facts, the recent activity, and
  where backups stand (latest, next scheduled, *Back up now*).
- **No chrome on the other sections**: no title, no tiles, no facts sidebar. Only a task in progress,
  a missing server jar, or changes waiting for a restart are announced above the section.
- **Heights** (`Section.layout`): a *viewer* is as tall as the view at every width (Live view, Files,
  Metrics); a *fill* section is from `lg` up and stacks at its own heights below (Console, Config
  files); every other page is at least as tall as the view, so its save bar sits at its foot.
- **Save bars** of the pages portal to the foot of the page (`SaveBarSlot`), full width and sticky;
  a viewer keeps its bars inside its panes.

### The status panel in the app sidebar

The figures that must stay in sight on every page — state and uptime, players online, TPS, CPU,
RAM — live in a small card at the foot of the app sidebar, below Members and Java runtimes, one row
per figure (`StatusPanel`). Each row opens a popover beside the sidebar with its detail: the address
and the process, the list of players, the last minutes as a sparkline, and a link to the section
that owns it. The sidebar is rendered by the dashboard layout, outside the instance's provider, so
the instance page portals the panel into an empty slot the sidebar leaves (`StatusSlot`).

A first version put the figures in a strip beside the breadcrumb; it was moved to the sidebar the
same day, where it has room for labels and does not compete with the page title.

### Power, confirmed, in the sidebar

Start, Stop and Restart sit under the instance switcher. Stop and Restart always ask first and name
who would be disconnected; Kill is in an overflow menu; Delete is the last card of the instance's
Settings. When a change saved while the server runs only applies on a restart — `server.properties`,
the instance settings, plugins — the page shows *Restart to apply* with a Restart button until the
server next stops (kept per tab in `sessionStorage`).

### Metrics over a week, bucketed by the daemon

- **Storage**: every 2 s sample for 24 h in `metrics`; past that, one row per instance and minute in
  `metrics_1m` with the averages, the peaks (`cpu_max`, `mem_rss_max`, `tps1_min`) and the number of
  samples it stands for (`Store.Rollup`, hourly and at start); 7 days in all.
- **API**: `GET /instances/{id}/metrics?range=&points=` — `range` a duration or whole days, clamped
  to the week; `points` buckets the series (`metrics.Bucket`) into at most that many steps of whole
  seconds, averages weighted by samples, with `cpuMax`, `memRssMax` and `tpsMin` beside them, and a
  step without samples left out, so a stopped server stays a gap.
- **Panel**: a range picker (15m · 1h · 6h · 24h · 7d, in the URL); 360 buckets per chart, re-read
  as new ones appear; the time axis over the whole window with round ticks; the average drawn and
  the peak shaded behind it; stretches without samples shaded grey and left as gaps; one crosshair
  across the charts; Players and Disk beside CPU, Memory, TPS and Host network. TPS is hidden for
  software that has no `tps` command (Vanilla, Fabric).

## Consequences

- Sections gain the height and width the chrome took; a phone opens straight onto the section.
- The figures stay one glance away on every page but no longer repeat; the details are one click
  away in popovers or on the Overview.
- On a phone the status panel is inside the sidebar sheet, not on the page.
- The metrics database stops growing past a day at full resolution: a week is about 43 000 raw rows
  and 8 600 minutes per instance instead of 300 000 samples. Averages across the 24 h boundary weigh
  each minute by the samples it stands for.
- The pending-restart notice is the panel's memory, not the daemon's: another browser, or a change
  made outside Beacon, does not raise it.
- The Overview became the customisable dashboard (roadmap 8.5, ADR-026): the same cards, as modules
  each user arranges.
