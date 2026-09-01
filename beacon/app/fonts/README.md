# MinecraftDefault

The typeface the game itself renders with (Mojangles, `minecraft:default`), used only where Beacon
shows something the player will see in the client: the MOTD editor and the multiplayer-list preview.
Nothing else in the panel uses it.

Minecraft's font is not a font file — it is a set of bitmap atlases plus a per-glyph advance width
table. These `.woff2` files are subsets of the TrueType conversion published by
[tryashtar/minecraft-ttf](https://github.com/tryashtar/minecraft-ttf), which generates them from the
game's own font definitions. That makes them pixel-exact and, being derived from Mojang's assets,
covered by the [Minecraft Usage Guidelines](https://www.minecraft.net/usage-guidelines) rather than a
software licence.

If Warden ever needs a font under an open licence, [IdreesInc/Minecraft-Font](https://github.com/IdreesInc/Minecraft-Font)
(OFL-1.1) is a clean-room redraw and a drop-in swap — but its advances do not match the game's, so
`lib/motd.ts` would need its width table regenerated from the replacement.

## Why the metrics matter

`unitsPerEm` is 1200, so at `font-size: 12px` one Minecraft pixel is exactly one CSS pixel and every
advance is a whole number. Beacon renders at 24px, the 2x GUI scale, with an 18px line height (the
client advances 9 Minecraft pixels per line) and a shadow at `.08333em` — one twelfth of an em, the
one-pixel offset the game draws.

## Subset

Latin-1 plus the symbols people put in an MOTD (arrows, stars, box drawing, suits, ticks): 283
glyphs, ~18 KB across the four faces. `lib/motd.ts` carries the advance widths of exactly this set,
read out of `MinecraftDefault-Regular` with fontTools; regenerate both together.
