# ADR-022: Plugins not listed for the server's Minecraft version

Date: 2026-09-25 · Status: accepted · **Revises** ADR-005 (the catalog no longer filters by
Minecraft version) · Phase 8.4 of docs/roadmap.md.

## Context

The plugin catalog filtered by the instance's Minecraft version everywhere: Hangar searches sent
`version=<mc>`, Modrinth searches added the `versions:<mc>` facet, and both version lists dropped
releases that did not name the version. A plugin that had not declared the newest Minecraft was
invisible.

That is most plugins for the weeks after a Minecraft release. On 2026-09-25, with Paper on 26.2,
EssentialsX (825 k downloads on Modrinth) listed releases up to 26.1.2, and a search for
"essentials" on a 26.2 server opened on EssentialsX add-ons with a thousandth of its downloads. Many
plugins run unchanged across versions, and authors update the list late or never. The admin is the
one who can judge whether to try; hiding the plugin only sent them to download the jar by hand
and upload it, which loses the source, the hash check and the updates.

## Decision

- **The sources do not filter.** `PluginSource.Search` and `Versions` take no Minecraft version.
  Search hits carry the versions their project lists (`MCVersions`: Hangar
  `supportedPlatforms.PAPER`, Modrinth `versions`), and releases keep their `mcVersions`. The
  source caches no longer key on the version.
- **The registry marks.** `SearchPlugins(…, mc)` sets `listed` and `newestMc` on each hit;
  `PluginVersions(…, mc)` returns every release with `listed`. A project or release that lists no
  versions counts as listed — there is nothing to contradict. `newestMc` compares versions by their
  numbers (`CompareMC`), since Hangar returns them in text order.
- **The order stays the sources'.** A search does not move listed hits ahead: the popular plugin a
  release behind is what most searches are after, and the dimming says the rest.
- **"latest" means listed.** `FindVersion(versions, "latest")` is the newest listed release (the
  newest listed pre-release when no release is listed) and finds nothing when nothing is listed. An
  install of `latest` then fails with a message that says to pick a release; an install by release
  id succeeds whatever that release lists. Nothing is installed off-version without a choice.
- **The panel asks.** The install dialog dims unlisted hits with `not listed for 26.2 · up to
  26.1.2`, picks the newest listed release by default (else the newest release, marked), marks
  unlisted releases in the picker, and confirms before installing any queued release that is not
  listed ("Install anyway").
- **The choice is remembered.** An off-version install records `unlisted: true` in `instance.json`.
  Updates for such a plugin are the newest listed release when one appears, else the newest release
  there is; for every other plugin they stay listed-only. An update that is itself unlisted carries
  `unlisted: true` and shows in amber. The plugins table marks unlisted installs.
- **The search runs as the admin types** (`hooks/use-plugin-search.ts`); there is no Search
  button. It asks 300 ms after the last keystroke (Enter asks at once), not for a single
  character, and never twice for the same normalized query; a newer query aborts the request it
  replaces, and the proxy hands the abort to the daemon (`req.signal`), which drops its calls to
  Hangar and Modrinth. Answers are remembered while the dialog is open (50 queries), and the shown
  hits stay until the next answer arrives. Every prefix of every query now reaches the catalog's
  10-minute cache, so that cache holds at most 512 entries per source, dropping expired entries
  first and then those closest to expiring.
- The voice-chat plugin (ADR-019) takes the newest listed release and falls back to the newest
  release, as it did before through a second unfiltered query.

## Consequences

- One cached version list per project serves every instance, whatever its Minecraft version.
- Modrinth searches return plugins for every version, so a search can show old, abandoned projects
  among current ones. They are dimmed and their newest listed version is on the badge.
- Loading an unlisted plugin can fail. The server log says why, and removing the jar from Plugins
  undoes it; Warden does not try to predict compatibility.
