# Rig configs

One `<species>.rig.json` per species — six files, and the reason there are only six is
art-pipeline §6: **one skeleton per species, four tiers built from it.** A tier is not a
different rig, it is the same config pointed at a different `parts/` directory, so the
twenty-four `.riv` files on disk are twenty-four *builds* of six authored things.

## What is in a config, and what is deliberately not

The clip table is **not here.** Ticks, events, loop/hold flags, the `down` → `down_loop`
hand-off and the full input list all come from `assets/manifest.json`'s `rigContract` at
build time (`--contract assets/manifest.json --set hero`). Restating the table in a second
file is where an off-by-one gets in, and the whole point of `tools/art/verify-rig.ts` is
that one table is the table.

What a config carries is what the contract cannot know:

| Key | What it says |
|---|---|
| `root`, `adjacency` | how this species' parts hang off each other. The hierarchy is derived from the graph; joints are **measured per tier** from that tier's own alpha overlaps, so cross-tier joint drift is absorbed at build time rather than nudged by hand |
| `zOrder` | back to front — the manifest's own `zOrder` filtered to the parts this species has, so a rig composites the same way `assembled.png` does |
| `origin`, `ground`, `artboardWidth/Height`, `scale` | the manifest's 1024×1024 canvas and its (512, 900) standing point, 1:1. A rig and its `assembled.png` line up pixel for pixel, which is what lets `art-paths.ts`'s `ANCHOR_X/Y` stay true when the renderer swaps. **`scale: 1` is load-bearing** — the builder's default fits the figure to 90% of the artboard height, which looks fine in isolation and stands in the wrong place in the game |
| `wiring` | trigger → clip names (`move` → `walk`, `helpUp` → `lift`) and the two bool-driven entries. `when.from` is scoped rather than any-state on purpose: a level-held `knockedDown == true` on an any-state transition re-fires the instant `down` hands off to `down_loop`, and the figure falls forever |

No config carries `tintSlots`. The player-colour slots were built, measured and pulled — a `color`
blend at the manifest's palette hexes repaints between 5% and 10% of each figure's approved pixels
before anybody chooses anything, and the traced silhouettes spill onto neighbouring parts the
moment a property is set to anything but white. art-pipeline §6.2 carries the numbers and the
property names each species will expose when the slots come back; each config's
`$paletteComment` carries its own half.

## Building

```bash
npm run art:rigs
```

`tools/art/build-rigs.mjs` loops species × tiers and shells out to the Rive CLI, which is
**not** a dependency of this repo — point `KAD_RIVE_CLI` at it, or have `rive-mcp-build` on
your PATH:

```bash
KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js npm run art:rigs
```

Every build is contract-checked in the same process it is written in, **and compared at rest
against the art it was built from** — frame 0 of `idle` against that tier's `assembled.png`, with
the floor set to the manifest's own `recompositeIouMin`. Twenty-three of the twenty-four are
pixel-exact; the radiant unicorn's ~500 px of alpha-1 fringe where the horn crosses the forelock is
the part split's tolerance showing through, not a rig fault.

`npm run art:verify:rig` then opens each delivered file with the official runtime and compares it
to `rigContract` clip by clip. All three have to be green.

Then the motion gate, which renders every clip and checks what it actually draws — the floor, the
frame, the joints, the loop, and every trigger fired through the real state machine
(art-pipeline §6.4):

```bash
npm run art:verify:rig:motion
```

It also keeps `motion-baseline.json`: a hash per clip, so after a rebuild it tells you **which
clips changed** instead of leaving you to re-watch all 312. That list is the review queue. Look at
what moved, then bless it:

```bash
node tools/art/verify-rig-motion.mjs --update-baseline
```

To look at the motion rather than the numbers:

```bash
npm run art:sheet:rig                                   # idle, fledgling, all six
node tools/art/rig-sheet.mjs --clip attack --tier mythic
```

## unicorn_fledgling_idle.riv

The Chapter 0 spike — one artboard, one `idle` animation, the eleven inputs and nothing
behind them. It is kept because it is the file the Rive-vs-custom-rig decision (§7) was made
against, and it is *here* rather than under `assets/characters/` on purpose: it does not meet
the hero set, and the gate only reads rigs that ship.
