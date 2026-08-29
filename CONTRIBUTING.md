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

## Continuous integration
`.github/workflows/ci.yml` runs on every push to `main` and on pull requests: `make lint test linux` for wardend (gofmt, vet, race tests; the linux/amd64 binary is uploaded as an artifact); Biome and `next build` (which type-checks) for Beacon; and, in parallel, both container images are built (not pushed). Run the same locally before opening a PR: `make lint test` in `wardend/`, `pnpm lint && pnpm build` in `beacon/`.

## Releases
Tag `main` with `vX.Y.Z` and push the tag: `.github/workflows/release.yml` runs the tests, builds `wardend-linux-{amd64,arm64}`, attaches them (with `SHA256SUMS` and generated notes) to a GitHub Release, and pushes `ghcr.io/manuelvegadev/warden-{wardend,beacon}:X.Y.Z` (plus `X.Y` and `latest`) for amd64 and arm64.
