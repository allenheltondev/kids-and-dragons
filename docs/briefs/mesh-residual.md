# Brief: the manticore mesh residual

Four rigs failed `art:verify:rig:rest` because their mesh triangle indices were
serialized in the wrong encoding. This brief preserves the investigation that
isolated it.

**Status:** resolved in `rive-mcp` commit `660bcc0`. Rive decodes
`triangleIndexBytes` as concatenated varuints, but the writer emitted packed
little-endian `Uint16`s. The fixed writer uses the existing varuint encoder and
has a 20×32 regression test that crosses indices 127/128 and 255/256.

All four regenerated manticore rigs now pass the 99.80% rest floor with **zero
missing pixels**. An independent render measured fledgling at 99.97% (103
differing, 62 extra), sworn at 99.98% (59 differing, 49 extra), and
radiant/mythic at 100.00%. The manticore motion gate also passes all 52 clip
measurements and all four state-machine drives; its existing leap-speed
heuristic warnings remain informational.

---

## 1. The symptom

`assets/characters/manticore/{fledgling,sworn,radiant,mythic}/rig.riv` do not
reproduce their approved art at rest. Every other rig scores 100.00%.

```
npm run art:verify:rig:rest -- manticore

FAIL  manticore/fledgling  99.61%  (1404 of 363952 px differ, floor 99.80%)
FAIL  manticore/sworn      98.73%  (4411 of 348008 px differ)
FAIL  manticore/radiant    99.49%  (1914 of 377170 px differ)
FAIL  manticore/mythic     99.58%  (1573 of 378680 px differ)
```

The differing pixels are **present in `assembled.png` and absent from the
render** — dropped, not displaced. On mythic: 1573 missing against **0 extra**.
That ratio holds at every grid size tested, and it is the most constraining fact
here. Nothing is being moved to the wrong place; things are not being drawn.

---

## 2. What it is not

Each of these was tested, not assumed. Please do not spend the day re-testing
them.

**Not the crop bug.** That was a real defect in the same code — the mesh crop
was taken from the largest connected component, so a barbed tail lost its barbs
— and it is fixed and merged (`rive-mcp#5`). It accounted for 15.1% of the
part. This residual is what is left after it.

**Not any of the follow-up weighting fixes.** Area-filtered `kept` components,
and cell-level retained-art detection, both merged. Rest scores did not move a
pixel across either, which is expected and is itself the next point.

**Not the skin bind pose.** Rive's `Skin` carries a bind matrix and each
`Tendon` carries its bone's inverse bind, so at rest every bone composes to
identity and a linear blend of identities is identity *for any weights
whatsoever*. Rest renders are structurally blind to weighting. This is why a
weighting change cannot alter these numbers, and why it is not the cause.

**Not the mesh being the wrong shape at rest.** Same reason.

**Not the seams visible in the client.** Faint quad seams do appear on the
griffin and manticore in `art/review/tv-lineup.png`, but they show on
**non-mesh** rigs too and the CLI renders those same rigs at 100.00%. That is a
client-side rendering artifact, a different animal. Do not conflate them.

**It IS the mesh.** Rebuild any failing tier with `meshParts` removed from
`art/rig/manticore.rig.json` and it scores **100.00%, 0 px differing**.
manticore is the only species with a mesh (`meshParts: { tail: { bones: 5 } }`).

---

## 3. The evidence

### 3.1 It tracks mesh resolution, and not monotonically

`manticore/mythic`, varying `meshParts.tail.cols/rows`:

| grid | vertices | rest score | missing px | extra px |
|---|---|---|---|---|
| 4×4 | 25 | 98.69% | 4946 | 0 |
| 8×12 | 117 | **99.72%** | **1050** | 0 |
| default (~8×14) | ~135 | 99.58% | 1573 | 0 |
| 12×20 | 273 | 93.82% | 23400 | 0 |
| 20×32 | 693 | 93.13% | 26008 | 0 |

There is a cliff between 12 and 20 columns. A monotonic "denser is worse" story
would point at accumulating numerical error; this does not look like that. It
looks like a threshold being crossed.

The same effect appeared independently: anchoring cell size to the primary
component (a denser grid) regressed sworn/radiant/mythic from
98.73/99.49/99.58% to 96.53/97.22/96.18%. That experiment is described in
`pageScript.ts` above `const cell`, and is why the density guard suggested in
review was rejected.

### 3.2 The loss is whole blocks, not hairlines

Horizontal run-lengths of missing pixels at 20×32:

```
n=636 runs   median width 22px   mean 40.9   max 181
runs <= 3px wide (hairline seams):  13  (2%)
runs >= 20px wide (solid blocks):  438  (69%)
```

Rendered, the missing regions are **axis-aligned rectangles** with hard edges —
see the tail base and the notches along the haunch. They are the size and shape
of mesh cells.

**Whole quads are not being drawn.** Combined with zero extra pixels, that is
the shape of the bug.

`art/review/mesh-residual-20x32.png` is that render, cropped to the tail: the
straight-edged bites out of the tail base and the haunch are the missing cells.

---

## 4. Where to look

Upstream: **`allenheltondev/rive-mcp`**, currently at `13fd997`. Nothing in
`kids-and-dragons` needs changing; it only consumes the output.

| File | What lives there |
|---|---|
| `src/pageScript.ts` L900-975 | Crop bounds, `cell`/`cols`/`rows`, and the per-vertex `arcs` grid (`keptNear`, the 32px vs unbounded search, `-1` meaning "pin to the base bone"). Runs in the browser. |
| `src/rigFromParts.ts` (the `meshParts` block) | Turns the spine into a bone chain, maps `spineGrid.arcs` into `weights` as `[boneA, wA, boneB, wB]`, swaps the cropped PNG in as the image, and sets `img.mesh = { columns, rows, bones, weights }`. **Note: git treats this file as binary — use `grep -a`.** |
| `src/rivWriter.ts` L910-1015 | Emits the mesh: triangle indices (`tl,bl,tr / tr,bl,br` as Uint16), one `MeshVertex` per grid point with `x/y/u/v`, a `Weight` per vertex (byte-packed values, 1-based bone indices), then `Skin` + one `Tendon` per bone. |

The most suspicious surface, given "whole quads missing, zero extras, threshold
behaviour", is the **writer** rather than the geometry: triangle index
emission, vertex/weight pairing, or something in the emitted mesh that the
runtime rejects past a certain size. Worth checking early whether the runtime
logs anything — the CLI prints `No WebGL support. Image mesh will not be drawn.`
in some contexts, and if a mesh is being partially rejected there may be a
signal nobody has read.

---

## 5. Reproducing it

```bash
# Written when the CLI had to be built from source. It is now the
# `rive-mcp-server` devDependency, so `npm ci` is the setup and `npm run` finds
# `rive-mcp-build` on PATH — see art-pipeline.md section 6.3. The overrides below
# still work and are what to use against an upstream working tree.
export KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js
# Only if your browsers are not under ~/.cache/ms-playwright
export RIVE_MCP_CHROME=/path/to/chrome-linux/chrome

cd /path/to/kids-and-dragons
node $KAD_RIVE_CLI rig \
  --parts assets/characters/manticore/mythic/parts \
  --config art/rig/manticore.rig.json \
  -o /tmp/m.riv --contract assets/manifest.json --set hero

npm run art:verify:rig:rest -- manticore          # the gate
node $KAD_RIVE_CLI render /tmp/m.riv --animation idle --time 0 --width 1400 -o /tmp/m.png
```

To see it directly, crop `/tmp/m.png` to the canvas window at the stage offset
(188,188 for a 1024 canvas) and diff against
`assets/characters/manticore/mythic/assembled.png`.

To sweep grid sizes, add `cols`/`rows` to `meshParts.tail` in a scratch copy of
the config — the schema accepts both.

---

## 6. Done looks like

`npm run art:verify:rig:rest -- manticore` green on all four tiers, at the
existing 99.80% floor. Do not move the floor: it is descriptive of what a clean
build actually achieves (23 of 24 rigs are pixel-exact), and lowering it to
admit these four would delete the only signal that this bug exists.

Regenerate all four tiers afterwards and commit them, then re-run
`art:verify:rig:motion` — it renders every clip and is the only thing that would
notice if a fix traded rest fidelity for motion.

---

## 7. Two things worth knowing before starting

**Rest is blind to weights.** Any hypothesis of the form "the weights are wrong"
cannot explain a rest-frame defect, for the bind-matrix reason in §2. A rest
symptom means geometry, coverage, or emission.

**8×12 beats the default.** `99.72%` against `99.58%`, both still under the
floor. If a real fix proves elusive, tuning `cols`/`rows` per species is a
tempting mitigation — but it is a mitigation, and the cliff at 12→20 columns
would still be sitting there waiting for the next mesh part somebody adds.
