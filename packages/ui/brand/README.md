# Brand assets

Generated — do not edit by hand. The source is `../src/lib/brand.ts` (paths and hex colours);
`build.ts` writes the SVG masters and tiles here, Beacon's `app/icon.svg` and PWA PNGs, and the
landing favicon. Rules and colours: `docs/design.md` → "Brand".

```bash
pnpm --filter @warden/ui brand:build   # needs rsvg-convert (brew install librsvg)
```
