# Warden

Monorepo: `wardend/` (Go daemon), `agent/` (Paper plugin, embedded in the daemon), `beacon/`
(Next.js panel), `landing/` (Astro site), `packages/ui` (shared components).

## Read before you work

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the checks to run before committing, and what CI runs.
- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit and talk.
- [`docs/api.md`](docs/api.md) — the daemon's REST and WebSocket contract. Keep it in step with the
  code; it is the specification, not a description.
- [`docs/adr/`](docs/adr/) — the decisions. Record a non-trivial one as a new ADR, and update the
  ADR that owns an area when you change how it works.
- [`docs/roadmap.md`](docs/roadmap.md) — what is done and what is next; tick items as they land.

## Releasing

**[`docs/release.md`](docs/release.md) is the checklist. Follow it.** The two things that have gone
wrong: the local checks do not build the container images, so a release can fail on a red `main`
nobody noticed; and a tag that already exists is easy to assume free. A tag's message is the
changelog — there is no changelog file — and a published tag is never moved: fix forward with a
patch release.

## Conventions

- Repository artifacts are written in English: code, comments, commits, documentation.
- Conventional Commits (`type(scope): summary`), one logical change per commit.
- Go: `gofmt`, `go vet`, table tests. TypeScript: Biome, 120 columns, no default exports for
  components. Both formatters are wired to the root `.editorconfig`.
- Tests live beside what they test and are named for the behaviour they pin, not the function.
