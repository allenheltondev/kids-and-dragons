# Brief: camp art

**Status:** Phase 1 open (#615). The design is [docs/camp.md](../camp.md) (§3.1 backdrops, §4.1
frame stages, §8.3 lanes and stand points, §8.4 actions and moving parts). The prompts are in
[docs/camp-art-prompts.json](../camp-art-prompts.json); the paintings are made from them, then
checked by `npm run art:verify` and counted by `npm run art:inventory`.

## The contract: `assets/manifest.json` → `camp`

The manifest's `camp` section is the one place the layout lives. The art is painted for it, the
client walks figures over it, and `tools/art/verify.py` checks it. Change a lane and the backdrop
prompt's pixel figures change with it.

- **Coordinates are fractions of `backdropCanvas`** (1920 × 1080): x from the left, y from the
  top. A lane's `y` is the ground line where a figure's or piece's ground contact (the figure
  canvas origin, 512, 900) stands.
- **Backdrops** (`backdrops[]`, one per terrain family in `biomeFamilies`) carry the ground:
  two or three `lanes`, back to near (each lower on screen and no smaller in `scale` than the one
  behind), and the `crossings` where a figure may change lanes. `open_plains` is required: it is
  the fallback for every family not painted yet.
- **Frames** (`frames[]`, one per frame stage) carry the camp: `pieces` standing on a lane,
  `movingParts` laid over a piece, `standPoints`, and the `trailhead`. Frames are shared by every
  backdrop, so a frame's lanes and x positions must fit every backdrop's lanes.
- **Clear of the words.** No lane, and so no stand point, is below 78 percent of the height: the
  lobby panels cover the bottom 22 percent. The camp's pieces keep to the middle third; free
  wander spots (no action) stay outside it.
- **Every frame seats the full party**: one `rest` stand point for each seat 0 to 3.

## Formats

| Art | Path | Canvas | Format |
| --- | --- | --- | --- |
| Camp backdrop | `assets/camp/backdrops/<family>.webp` | 1920 × 1080 | WebP, opaque (the biome background format) |
| Piece | `assets/camp/frames/stage<N>/<piece>.png` | 1024 × 1024 | PNG, RGBA cutout, lowest opaque row at y 900 (±12), 8px clear margin |
| Moving part | `assets/camp/frames/stage<N>/<piece>-<part>.png` | 1024 × 1024 | PNG, RGBA, registered pixel for pixel over its piece, nothing below y 912 |

- **Style**: the storybook gouache of the biome backgrounds and the story props (the backdrop
  matches `assets/biomes/plains/bg.webp`; the pieces match `assets/story-props/camp-firepit.webp`).
  No text, no heroes drawn (the existing hero figures stand in the camp), never scary.
- **Backdrops are empty campsites**: a calm clearing with a plain, readable ground band where the
  lanes fall, the middle third the openest part of it, a quiet lower band, and the trail leaving
  at the trailhead's edge. Nothing a figure could seem to stand inside.
- **Pieces fill their canvas the way figures do**: whole object inside the margin, resting on
  y 900. The client sizes them on the stage.
- **A moving part only where a stand point animates the piece** (§8.4), and made from the
  finished piece itself (cut from the same painting, its base feathered into the piece) so the
  two always stack. A piece nobody uses needs none.
- **One painting can serve many pieces**: the four stage-1 bedrolls share `bedroll.png`.

## Pending art

Missing camp art is owed, not a failure: `art:verify` warns "not yet delivered" and passes (also
under `--strict`, as it does for story plates and key art), `art:inventory` lists it under
**Camp art**, and the client draws its own stand-in until the painting lands. There are no
placeholder files: a file at a declared path counts as delivered, so nothing goes there until it
is the real painting. Any file under `assets/camp/` the manifest does not declare fails
`art:verify`.

## Phase 1 (#615)

The `open_plains` backdrop and the stage-1 frame: a small campfire, a neutral bedroll and pack
(the same painting at all four seats), the trailhead post, and the campfire's flame (motion
`flicker`). Five paintings in all.

## Phase 2: hero-colored kit (to be agreed with the client work before it is painted)

Phase 2 gives each hero their own tent, bedroll and pack in their own color (§4.5: the palette
rule heroes already use). The proposed convention, **not yet agreed with the client camp stage and
not to be painted until it is**:

- **Two layers per kit piece, on one canvas.** `<style>.png` is the **untinted detail layer**:
  everything that keeps its own color (outlines, poles, ropes, pegs, buckles, stitching, shading
  accents), with the colored cloth left transparent. `<style>-tint.png` is the **tint layer**:
  only the cloth, painted near-greyscale (the same saturation limit as tintable effects,
  `tolerance.tintableMaxSaturation`, 0.15), with its light and shade in value alone. The client
  multiplies the tint layer by the hero's color and draws the detail layer over it, so one
  painting serves every hero color.
- **Both layers share the figure canvas and ground contact** and stack pixel for pixel; a tent's
  flap (its moving part, motion `sway`) gets the same pair.
- **Open questions for the client work**: draw order (tint under or over detail), the blend
  (multiply against a mid-grey or a lightness-preserving tint), which palette slot of the hero's
  color is used, and how styles are named in the manifest. Settle these in the client PR, then
  add the layers to `camp` and these formats here, and extend `art:verify` to check the tint
  layer's saturation.
