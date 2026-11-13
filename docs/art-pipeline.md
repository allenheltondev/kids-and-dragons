# Character artwork pipeline

Finished art is saved into `assets/` as below, then uploaded with `npm run assets:push`, which
records it in `assets.lock.json` for the commit. The files themselves live in the S3 asset store,
not git ([asset-store.md](./asset-store.md)).

Characters are finished transparent illustrations with subtle procedural breathing.
Rive rigs, split body parts, underpainting, and animation contracts are retired.

- Deliver one `assembled.png` per species/tier: RGBA, 1024 x 1024, feet at (512, 900).
- Class figures use the same contract, listed in `assets/manifest.json` under `figureVariants`.
  Their existing `assets/character-rigs/<class>/<tier>/<species>/assembled.png` paths are retained.
- NPCs and enemies remain single transparent cutouts. Opaque gear portraits remain portrait art.
- Review the finished image for seams, silhouette, and background remnants at gameplay size.
  Existing composites can be replaced in place with a polished single illustration.
- Run `npm run art:verify` for format, transparency, ground placement, and shared asset checks.
- Run `npm run art:inventory` to see missing finished illustrations.

## Declaring art: the manifest's lists are kept in order

Every piece of art is declared in `assets/manifest.json`, so every art branch edits that one
file. Its growing lists used to grow at the end, and two branches that each added a painting
to the same list conflicted on the same last line. They are now kept in order instead: the
plain string order of each entry's key (the string itself, an object's `id`, or a member's
name), which is what `[...keys].sort()` gives. Two branches' new entries then land on different
lines unless they sort next to each other, and git merges them, on GitHub too.

- The lists are named in [`tools/art/manifest-order.ts`](../tools/art/manifest-order.ts):
  `castFigures`, `coatMasks.paintings`, `entities`, `paintedIcons.ids`, `sceneIllustrations`,
  `stageFigures`, `storyPlates.ids`, `storyProps.ids` and `storyProps.motions`. Nothing reads
  them in order. A list whose order means something does not belong there.
- Put a new entry in its place, or add it anywhere and run `npm run art:sort`. It moves each
  entry's own text and nothing else, so the file's hand formatting survives.
- `npm run art:verify` runs the check first (`npm run art:sort -- --check`) and fails on a list
  out of order or an entry declared twice.
- For two new entries that do sort next to each other, and for a branch cut before the lists
  were sorted, a merge driver ([`tools/art/merge-manifest.ts`](../tools/art/merge-manifest.ts))
  merges these lists entry by entry and the rest of the file by line. `npm run setup` registers
  it. GitHub's merge button does not run merge drivers: if it reports a conflict in the
  manifest, merge `main` into the branch locally. An entry both sides changed differently keeps
  ours and is named in the merge's output for you to decide.
- The driver calls a merge clean only when the result parses and has its lists in order with
  nothing declared twice. Where it cannot merge by entry (a side that is not JSON, or one that
  declares an entry twice) it falls back to git's line merge and holds that result to the same
  standard: lines that merge into an invalid manifest leave the file conflicted, with what is
  wrong in the merge's output.
- A merge that still stops on the manifest is finished with `npm run art:resolve` (or
  `node tools/art/merge-manifest.ts --resolve` when `package.json` is conflicted too). It merges
  the three versions git is holding the way the driver would have, and stages the result when
  nothing is left to decide. A branch cut before the lists were sorted needs it once, the first
  time `main` is merged into it: git takes the driver's name from the branch being merged into,
  and that branch does not have it yet.
- The file is checked out with Unix line endings on every OS (`.gitattributes`).

Story and combat share a six-second breath of at most 0.8% vertical stretch around
fixed feet, with different phases per actor. Creation uses the same amplitude and
period in CSS. Reduced motion returns figures to their resting scale. Combat owns
travel, falls, numbers, targeting, sound, and spell effects independently of art.

Historical rig briefs and original source paintings may remain as reference. They
are not delivery requirements. Git history retains the retired rigs and parts.

Camp art (the crew's campsite, docs/camp.md) follows the same rules with its own layout
contract in `assets/manifest.json` under `camp`: opaque 1920 x 1080 WebP backdrops per terrain
family, and 1024 x 1024 RGBA piece and moving-part cutouts standing on (512, 900). Missing camp
art is owed in `art:inventory`, never a placeholder file. Conventions, including the proposed
Phase 2 hero-colored kit layers, are in `docs/briefs/camp.md`; prompts in
`docs/camp-art-prompts.json`.

## Half-size copies for phones

A backdrop is painted 1920 x 1080, a story plate 1600 x 900 and a figure 1024 x 1024, for a
television. Two kinds of copy stand beside a painting, both made by `npm run art:small` and
both asked for through one function (`packages/client/src/world/art-paths.ts`, `fitArt`):

| Copy | Name | Made for | Who asks for it |
| --- | --- | --- | --- |
| Half size, lossy WebP (quality 82, Lanczos) | `bg.webp` → `bg@0.5x.webp`, `assembled.png` → `assembled@0.5x.webp` | scene and biome backdrops, camp backdrops (`camp/backdrops/`), story plates (`plates/`), entity and cast figures | a phone |
| Full size, lossy WebP (quality 90) | `assembled.png` → `assembled@1x.webp`, `<species>.png` → `<species>@1x.webp` | entity and cast figures; hero paintings (`characters/`, `character-rigs/`) and gear portraits (`gear-portraits/`) | every other screen, and a phone for a hero |

A phone's world pane shows a backdrop about 800 pixels wide and a figure a few hundred, so the
half is a quarter of the pixels to download and to hold decoded. The full-size WebP is for the
bytes alone: a figure's PNG is about a megabyte, and the same pixels as a WebP are a fifth to
a tenth of that (measured over the store: 366 figures, 355 MB of PNG, 55 MB as `@1x.webp`).
WebP keeps the alpha plane lossless, so a cut-out's edge is the painting's exactly. Both names
are Pixi's own convention for a texture's resolution, so a sprite made from a copy has the
painting's size and nothing that places it changes.

**A hero has a full-size copy and no half.** Her coat is tinted on the device from her
painting and its coat mask, pixel for pixel (`hero-coat-pass.ts`; [hero-looks.md](hero-looks.md)),
and the pass refuses a mask that is not on its painting's canvas. The full-size WebP is on
that canvas with that alpha, so the tinter reads it with the mask as painted: the swap takes
each pixel's lightness and chroma and each part's medians, none of it exact-valued, and on
the real paintings the tinted result from the WebP differs from the tinted PNG by no more
than the WebP differs from the PNG. A half would not be wrong for the mask (its channels are
soft coverage weights, which a box filter halves exactly, kept lossless), but the tinted
texture a stage draws is made at resolution 1 (`hero-art-pixi.ts`), so a half-size tint would
stand half as tall, and a phone shows her portrait larger than half its pixels. Masks
(`coat-mask.png`, `<species>.coat-mask.png`) are never copied: a lossy WebP stores colour at
half resolution and would bleed one part's weight into another's.

Not copied at all: tile sheets and effect sheets (cut up by pixel), camp pieces and kits
(recoloured from 1024 x 1024 pixels, `camp-kit-canvas.ts`), props, icons, and anything
already small.

- `npm run art:small` makes every copy that is missing or whose painting changed, and records
  the painting each was made from in `assets.small.json`. It needs the paintings on disk
  (`npm run assets:pull`) and Pillow.
- Then `npm run assets:push`, and commit `assets.lock.json` and `assets.small.json` together.
- `npm run art:small -- --check` lists what is owed and writes nothing.

A build turns the copies on, both kinds at once, only when every one is in the lock and was
made from the painting the lock holds now (`packages/client/small-art-build.ts`). So a repaint
that skipped `art:small` never leaves a screen on the old picture: `tools/art/small-art.test.ts`
fails in that PR, and a build made anyway serves every device the paintings themselves. The
service worker is told the same thing by the same build, so what it warms overnight
(`sw/chapter-art.ts`) is what the device then draws.
