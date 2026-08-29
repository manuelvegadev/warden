# Contributing

## Language
Everything in this repository — code, comments, docs, UI text, commit messages — is written in **English**.

## Commits
We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short, specific summary>
```

- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`.
- **Scopes**: `wardend` (Go daemon), `beacon` (Next.js panel), `docs`, `repo` (root tooling), or a narrower area when useful (`wardend/java`, `beacon/console`).
- **Keep commits small and scoped.** A large change set is split into several commits, one per block of work, each with its own specific description. Never squash unrelated work into one giant commit with a long body; the message should be one clear line (a short body only when it adds real information).
- Breaking changes: `!` after the scope and a `BREAKING CHANGE:` footer.

Examples:
```
feat(wardend): paper catalog via fill v3 with sha256-verified downloads
feat(beacon): log files dialog with tail selector and downloads
fix(wardend): do not block startup on jwks registration
docs(adr): managed java runtimes (ADR-010)
```

## Before committing
- `wardend/`: `gofmt -l .`, `go vet ./...`, `go test ./...`
- `beacon/`: `pnpm typecheck`, `pnpm lint` (Biome; `pnpm lint:fix` applies safe fixes and formatting)
- Editors: the root `.editorconfig` mirrors Biome (2 spaces, LF, 120 cols) and gofmt (tabs); install the Biome editor extension for format-on-save
- Record non-trivial decisions as an ADR in `docs/adr/`.
