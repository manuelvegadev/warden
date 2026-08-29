# ADR-002: Web interface (React + TypeScript) embedded in the binary

Date: 2026-08-28 · Status: accepted, **amended by ADR-007** (the UI is no longer embedded in the binary: it is a separate Next.js app)

## Context
The server is a headless Ubuntu box; it is managed from a PC or phone. Options: web, native desktop app (Tauri/Electron), TUI.

## Decision
- SPA with **React + TypeScript + Vite**, Tailwind + shadcn/ui for components, `xterm.js` for the console and a lightweight charting library for resources.
- Compiled to static assets and embedded in the Go binary with `embed`; a single port serves UI + API.
- Communication: **REST** (`/api/...`) for actions and **WebSocket** (`/ws`) for console, events and metrics.
- PWA manifest so it can be "installed" on the phone.

## Rationale
- All reference panels are web-based; zero installation on the client.
- A single binary/port simplifies deployment and auth.

## Alternatives considered
- Tauri/Electron: forces maintaining an extra client and would need the same API anyway.
- HTMX/Go templates: viable and simpler, but the live console and real-time charts are more natural with a SPA.

## Update 2026-08-28
Author's preference: React + **shadcn/ui** or **Mantine**. **shadcn/ui** is chosen (Tailwind, components copied into the repo, easy to customize and to generate with tooling). Mantine remains a valid alternative if shadcn turns out to be heavy to maintain; both cover the tables, forms, dialogs and notifications the panel needs.
