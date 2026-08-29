# Design conventions (Beacon)

## Typography
| Use | Font | Notes |
|---|---|---|
| UI text | Geist Sans | `--font-geist-sans`, loaded with `next/font/google` |
| Generic monospace (badges, paths) | Geist Mono | `--font-geist-mono` |
| **Console, log viewer, code** | **Google Sans Code** (public release of Google Sans Mono — the maintainer's preferred code font) | `--font-console`, **line-height 1.1** (`--console-line-height`) |

Rules:
- Any terminal-like or code surface (xterm console, log viewer, future file editor) must use `--font-console` and `--console-line-height`. Never hard-code a font family in a component; read the tokens from `beacon/app/globals.css`.
- Fonts are self-hosted through `next/font` (no runtime requests to Google Fonts).
- If a licensed Google Sans Mono file is added later, load it with `next/font/local` and point `--font-console` at it; components need no changes.

## Theme
- Dark theme by default (`<html class="dark">`), shadcn/ui tokens (`bg-background`, `text-muted-foreground`, …).
- Console background `#0a0a0a`; log levels: WARN amber, ERROR/FATAL red, STDIN cyan, SYSTEM magenta, DEBUG grey.
- State badges: running emerald, starting/stopping amber, crashed red, installing sky, stopped muted.
