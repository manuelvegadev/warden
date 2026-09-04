# Releasing

A release is a tag. Pushing `vX.Y.Z` to `main` runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which publishes everything at
once; there is no separate changelog file, so the tag's own message is the changelog.

## What a tag publishes

| Job | What it does |
| --- | --- |
| `wardend amd64` / `arm64` | `make test`, then `make linux` (which builds the agent jar and embeds it) |
| `GitHub Release` | the two binaries, a `SHA256SUMS`, the install snippet and GitHub's generated notes under the tag message |
| `Image (wardend)` / `Image (beacon)` | `ghcr.io/manuelvegadev/warden-{wardend,beacon}` for amd64 and arm64, tagged `X.Y.Z`, `X.Y` and `latest` |
| `Redeploy Beacon on Dokploy` | the webhook that makes the panel pull the new image |

The jobs are independent apart from the release needing the binaries and the redeploy needing the
images, so **a release can publish half of itself**: binaries and release notes can appear while the
images fail. Check every job, not the run's first green tick.

## Before tagging

1. **`main` is green for the exact commit you are about to tag.** Not "the tests pass here" — the
   run for that commit:

   ```bash
   git fetch origin && git status -sb          # on main, clean, up to date
   gh run list --workflow=ci.yml --branch main --limit 3
   gh run view <id>                            # every job, not just the conclusion
   ```

   CI runs on every push to `main`, so a red main is a release that will fail. It has gone
   unnoticed for days before: the web job stays green while an image job fails, and nothing else
   complains.

2. **Run what you can locally**, from the repository root unless stated:

   ```bash
   cd wardend && make lint test                # gofmt, vet, race tests
   cd agent   && ./gradlew build               # the plugin the daemon embeds
   pnpm lint && pnpm typecheck                 # the whole workspace
   MC_ASSETS=skip pnpm build                   # beacon (next build type-checks) + landing
   ```

   **These do not build the container images.** Every dependency install, `Dockerfile` stage and
   lockfile change is only exercised by the image jobs, so a change to `package.json` scripts,
   `pnpm-workspace.yaml` or either `Dockerfile` is unverified until CI says otherwise. With Docker
   running you can close that gap:

   ```bash
   docker build -f beacon/Dockerfile .         # from the repository root: the panel needs packages/ui
   cd wardend && make agent && docker build -f Dockerfile .
   ```

3. **Pick the number from the tags that exist**, not from memory:

   ```bash
   git tag -l | sort -V | tail -5
   git log --oneline $(git describe --tags --abbrev=0)..HEAD
   ```

   While the project is `0.x`: a minor bump for features, a patch for fixes. A tag may already
   exist for the number you assume — the release before this document was written was tagged twice
   for that reason.

## Writing the tag

The tag message is what readers get: the landing's "Changelog" link points at the releases page, and
GitHub shows the annotated message above its generated commit list. Write it for someone who runs a
server, not for someone who reads diffs.

- A title line naming the release the way a product would ("Voice chat, and a world that looks like
  the game"), then a blank line and one or two sentences saying what is new.
- Grouped bullets after that: by feature area when the release is large, `Features` and `Fixes`
  otherwise. Say what it does, not which files moved.
- Cover everything since the previous tag, which is rarely just your own last few commits.

```bash
git tag -a v0.12.0 -F /tmp/notes.txt          # -F keeps the formatting; -m mangles long messages
git push origin v0.12.0
```

## After pushing the tag

```bash
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
gh run view <id>                               # confirm all six jobs
gh release view vX.Y.Z --json assets --jq '[.assets[].name]'
```

## When a release fails

**Never move, delete or re-push a tag that is already on the remote.** People and machines have
already fetched it, and the release, the binaries and the images that did publish keep pointing at
it.

Fix forward:

1. Commit the fix on `main` and let CI prove it.
2. Tag a patch release from the fixed commit, saying in its message what it repairs and that it
   carries the previous release's contents.

That is what `v0.11.1` is: `v0.11.0` published its binaries and its release page, both images
failed, and the patch tag published the images the minor release could not.
