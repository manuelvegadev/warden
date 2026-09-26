# ADR-024: Console completion for the server's own commands

Date: 2026-09-25 · Status: accepted · Extends the agent protocol of [ADR-018](018-live-world-view.md) ·
Phase 8.4 of docs/roadmap.md (panel UX plan 4.3).

## Context

The console's completion was a fixed grammar in Beacon (`lib/command-grammar.ts`: vanilla plus the
Paper commands). It knew nothing about the plugins a server runs: their commands were not offered,
nor their arguments, and a plugin that took over a vanilla command (EssentialsX's `give`,
`gamemode`) was completed with vanilla's syntax.

A plugin's `plugin.yml` lists command names, but not arguments, and Paper plugins
(`paper-plugin.yml`) declare none at all: they register commands in code, through Brigadier. Only
the running server knows the full set. The Warden Agent (ADR-018) runs inside every server that
loads plugins — wardend installs it on all of them, with no switch — and already holds a WebSocket
to the daemon, but that socket only carried one-way messages.

## Decision

**The server completes its own commands, through the agent.** Beacon keeps the grammar for what it
knows; the agent answers for the rest.

### Agent

- `hello` gains `"features":["complete"]`. An agent without it (a jar from before, which stays until
  the server restarts) is never asked.
- **Command list** (`CommandCatalog`): the command map grouped by command — a name, its aliases, the
  plugin that registered it (`PluginIdentifiableCommand`; absent for the server's own), its
  description and usage, with Bukkit's `<command>` filled in and colour codes dropped. Bukkit
  prints the usage when a command fails, so many plugins put an error message there (Simple Voice
  Chat: "Invalid command syntax"): a usage is kept only when it starts with a slash and one of the
  command's labels, after a leading "Usage:". Namespaced
  labels (`luckperms:lp`) are left out. It is rebuilt on the main thread every 2 s and on
  `ServerLoadEvent`, and sent as `{"type":"commands","commands":[…]}` only when it differs from what
  the current socket last carried (always after `hello.ok`). A plugin enabled, disabled or
  registering commands late reaches the panel within 2 s, without a restart of anything.
- **Completion** (`CommandCompleter`): `{"type":"complete","id":"17","line":"lp user Ste"}` is
  answered as the server's own console completes a line — `AsyncTabCompleteEvent` off the main
  thread first (plugins that complete asynchronously answer it, with tooltips); otherwise
  `CommandMap#tabComplete` as the console sender on the main thread. On Paper 26.2 the command map
  is backed by Brigadier's dispatcher, so this covers Bukkit commands, Paper plugins' Brigadier
  commands and vanilla's, `execute … run` included (checked against Chunky, EssentialsX, GrimAC,
  Geyser, LuckPerms, ViaVersion, Simple Voice Chat and spark).
- A plugin's completer cannot be interrupted once it runs, so the tick is protected by keeping **at
  most one request waiting**: a newer one replaces it (answered `superseded`), and one the main
  thread has not answered within 500 ms is answered `timeout` and its late result dropped. Every
  request gets exactly one `complete.result`: `{"id","suggestions":[{"text","tooltip"?}],"truncated"?}`
  or `{"id","error"}`. Answers are deduplicated and capped at 500 (`truncated` says so).

### Daemon

- `world.Service` correlates requests with answers (an id per request, a waiter per id) and fails
  every pending one at once when the agent disconnects or is replaced. It keeps the agent's last
  command list in memory while the agent is connected.
- `GET /instances/{id}/console/complete?line=…` (operator, as sending a command): waits for the
  answer, the request's context (an aborted browser request ends the wait) or 1 s. `409
  agent_unavailable` without an agent that completes, `409 superseded`, `504 timeout`.
- The hub sends `console.commands` `{commands:[…]}` to a new subscriber (with `console.history` and
  `state`) when the daemon holds a list, broadcasts it when the agent sends a new one, and
  broadcasts an empty list when the agent disconnects.

### Beacon

- The instance provider keeps the list (`useConsoleCommands`); an empty list means no agent.
- **Who completes what** (`lib/command-complete.ts`, pure): with the server's list, command names
  come from it, one row per command under the first of its labels that matches, labelled with the
  plugin (an alias names its command beside it). The arguments of a command stay with the grammar,
  local and instant, when it knows the command and no plugin owns it; otherwise they are the
  server's, with the command's usage line as the hint before anything is typed. Without the list —
  a stopped server, Vanilla, Fabric, an old agent — completion is the grammar's alone.
- **Asking** (`hooks/use-command-completion.ts`, with the memory in `lib/command-remote.ts`): the
  line up to the caret, after a 120 ms pause; a newer line aborts the request it replaces. Answers
  are remembered (50), and an answer for a token serves every longer token of the same argument,
  narrowed locally the way Minecraft matches (from the start, or after `:` `_` `.` `-` `/`) unless
  it was truncated — so typing through one argument costs one request. A new command list forgets
  them. Errors are silent: the list simply has nothing from the server. Tab pressed while the
  server answers keeps the focus in the input. History navigation (panel UX plan 1.6) is unchanged.

### Not done

A fallback from each jar's `plugin.yml` when no agent is connected. The agent is on every server
that can run plugins, the fallback would only show names (no arguments), and Paper plugins declare
none; without the agent the console behaves as before.

## Consequences

- A server that stops, or whose agent drops, stops offering plugin commands at once; they come back
  when the agent reconnects, which also covers plugins installed from the panel and loaded by the
  restart.
- Each argument typed costs about one request of ~50 ms on a local server (measured on Paper 26.2),
  plus the network between Beacon and the daemon. A slow plugin completer delays only its own
  answer, never more than one tick's worth of work is queued, and the panel shows nothing rather
  than stale suggestions.
- The agent rebuilds the command list every 2 s on the main thread; building it walks the command
  map once (a few hundred entries) and is sent only when it changed.
- The grammar still owns vanilla commands: their hints (`<seconds>`) and instant answers stay, at the
  cost of not offering server-side values such as scoreboard objectives there.
