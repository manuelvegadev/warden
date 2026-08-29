# Tooling for assisted development (MCP + skills)

Configured on 2026-08-28. The project MCPs live in `.mcp.json` (root); skills in `.claude/skills/` (installed with `npx skills add …`, versioned in the repo).

## MCP servers (`.mcp.json`)
| Server | Purpose | Source |
|---|---|---|
| `better-auth` (remote `https://mcp.better-auth.com/mcp`) | Search Better Auth docs and examples from the agent | https://better-auth.com/docs/ai-resources/mcp |
| `shadcn` (`pnpm --dir beacon dlx shadcn@latest mcp`) | List/add components and blocks from the shadcn/ui registry | https://ui.shadcn.com/docs/mcp |
| `next-devtools` (`npx next-devtools-mcp`) | Build/runtime errors, routes and logs from the live `next dev` (Next 16+) | https://nextjs.org/docs/app/guides/mcp |
| `gopls` (`gopls mcp`) | Go definitions, references, diagnostics (gopls ≥ 0.20; v0.23 installed) | https://go.dev/gopls/features/mcp |

Additionally, the official Claude Code plugin `gopls-lsp@claude-plugins-official` (installed at user level) for Go LSP.
After cloning: `claude` at the root asks to approve the project MCPs; `/mcp` to view them.

## Skills (`.claude/skills/`)
| Skill | Origin |
|---|---|
| `better-auth-best-practices`, `better-auth-security-best-practices`, `email-and-password-best-practices` | `better-auth/skills` (official) |
| `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines` | `vercel-labs/agent-skills` (official Vercel) |
| `shadcn` | Claude Code plugin (user) |

Next.js: in addition to the React skill, `create-next-app` generated `beacon/AGENTS.md` with the official Next 16 guidelines (Vercel recommends AGENTS.md over skills for Next). Go: there is no official skill; we follow https://go.dev/doc/effective_go and https://google.github.io/styleguide/go/ (see `wardend/AGENTS.md`).

Update skills: `npx skills update -p`.

## Quality conventions
- **Beacon**: `pnpm lint` (eslint-config-next), `pnpm typecheck`, shadcn components in `components/ui`, Better Auth plugin imports by subpath (`better-auth/plugins/jwt`); typography and theme tokens per `docs/design.md`.
- **wardend**: `gofmt`, `go vet`, `go test ./...`; stdlib `net/http` with method patterns (Go 1.22+); typed errors; context on all I/O.
