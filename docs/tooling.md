# Tooling para desarrollo asistido (MCP + skills)

Configurado el 2026-08-28. Los MCP del proyecto están en `.mcp.json` (raíz); las skills en `.claude/skills/` (instaladas con `npx skills add …`, se versionan en el repo).

## MCP servers (`.mcp.json`)
| Servidor | Para qué | Fuente |
|---|---|---|
| `better-auth` (remoto `https://mcp.better-auth.com/mcp`) | Búsqueda de docs y ejemplos de Better Auth desde el agente | https://better-auth.com/docs/ai-resources/mcp |
| `shadcn` (`pnpm --dir beacon dlx shadcn@latest mcp`) | Listar/añadir componentes y bloques del registry de shadcn/ui | https://ui.shadcn.com/docs/mcp |
| `next-devtools` (`npx next-devtools-mcp`) | Errores de build/runtime, rutas y logs del `next dev` en vivo (Next 16+) | https://nextjs.org/docs/app/guides/mcp |
| `gopls` (`gopls mcp`) | Definiciones, referencias, diagnósticos de Go (gopls ≥ 0.20; instalado v0.23) | https://go.dev/gopls/features/mcp |

Además, plugin oficial de Claude Code `gopls-lsp@claude-plugins-official` (instalado a nivel usuario) para LSP de Go.
Tras clonar: `claude` en la raíz pide aprobar los MCP del proyecto; `/mcp` para verlos.

## Skills (`.claude/skills/`)
| Skill | Origen |
|---|---|
| `better-auth-best-practices`, `better-auth-security-best-practices`, `email-and-password-best-practices` | `better-auth/skills` (oficiales) |
| `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines` | `vercel-labs/agent-skills` (oficiales de Vercel) |
| `shadcn` | plugin de Claude Code (usuario) |

Next.js: además de la skill de React, `create-next-app` generó `beacon/AGENTS.md` con las guías oficiales de Next 16 (Vercel recomienda AGENTS.md sobre skills para Next). Go: no hay skill oficial; se sigue https://go.dev/doc/effective_go y https://google.github.io/styleguide/go/ (ver `wardend/AGENTS.md`).

Actualizar skills: `npx skills update -p`.

## Convenciones de calidad
- **Beacon**: `pnpm lint` (eslint-config-next), `pnpm typecheck`, componentes shadcn en `components/ui`, imports de plugins de Better Auth por subpath (`better-auth/plugins/jwt`).
- **wardend**: `gofmt`, `go vet`, `go test ./...`; stdlib `net/http` con patrones de método (Go 1.22+); errores tipados; contexto en todo I/O.
