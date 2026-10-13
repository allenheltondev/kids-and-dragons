# Brief: recut every character part set

**Status:** open. Assigned to an implementing agent. This brief is the complete
specification. Where it and an older document disagree (asset-brief §3.3 in
particular), **this brief wins**.

You are recutting the layered part PNGs that every character rig is built from,
so that the rigs stop opening gaps and showing straight cut edges when they
move. You are not changing the characters' art, the rigs' animation, the rig
generator, or any game code.

---

## 1. Why: the defect, in one paragraph

Each character is a stack of registered, full-canvas part PNGs (`body.png`,
`arm_l.png`, …) that the rig generator turns into a bone rig. The current parts
were cut **edge to edge**: along every seam the two parts butt against each
other with nothing underneath, except for one ~50px disc stamped at each joint.
That disc exists only to pass an old check ("≥ 2,000 shared pixels per pair").
So the moment a joint rotates, the background shows through along the rest of
the seam. The cuts are also crude: straight-edged slabs (bigfoot's body is
nearly a rectangle, legs are vertical strips), "arm" parts that contain thigh
pixels, and a body part that owns the bottoms of the paws. A build-time stopgap
(`underpaint`, art-pipeline.md §6.4) hides the worst idle gaps. It cannot fix
the cuts. You can.

Read before starting:
- `docs/art-pipeline.md` §6.4 for the defect, the measurements, and what underpaint does.
- `docs/briefs/part-fragments.md` for the duplicated-fragment defect, which this recut must also clear.
- `docs/asset-brief.md` §2–§4 for the art rules (palette, pose, registration). **§3.3 is superseded by §5 below.**

---

## 2. Scope

**66 part sets**, each a directory containing `assembled.png`, `parts/*.png`,
`joints.json` and `rig.riv`:

- **24 base sets:** `assets/characters/<species>/<tier>/` for species `unicorn dragonling griffin bigfoot kitsune manticore` × tiers `fledgling sworn radiant mythic`.
- **42 class sets:** `assets/character-rigs/<class>/<tier>/<species>/`, one per entry of `rigVariants` in `assets/manifest.json`.

**Order of work, mandatory:**

1. **Pilot: `bigfoot/fledgling` only.** Do it completely (every rule in §4–§7, every check in §8). Then **stop** and report per §10. Do not start another set until the pilot has been reviewed and approved.
2. After approval: the other three bigfoot tiers, then one species at a time (`unicorn`, `kitsune`, `manticore`, `dragonling`, `griffin`), all four tiers of each.
3. Last: the 42 class sets. Each is the base set of the same species/tier plus gear layers, so reuse the recut base parts and only cut and underpaint the gear (§6).

One pull request per species (base tiers plus that species' class sets is fine
once the class work starts). Never one giant PR.

**The builder's underpaint is switched off per config, as each config's sets are
recut.** Every config in `art/rig/` sets `underpaint: 48`, a build-time stopgap
that grows each part 48px further under its neighbours (art-pipeline.md §6.4).
On a recut set the hand-painted continuation already covers the seam. The
stopgap then smears 48px more past it, which shows as wedges and streaks beside
the torso in motion. So:

- One config covers all four base tiers of a species (`art/rig/<species>.rig.json`).
  A species' base PR recuts **all four tiers** and sets `underpaint` to `0` in
  that config, in the same PR. A PR that recuts only some tiers of a species
  does not merge: the config cannot be right for both kinds of set.
- Each class set has its own config (`art/rig/<class>-<tier>-<species>.rig.json`).
  Set its `underpaint` to `0` in the PR that recuts that set.
- **Judging the pilot:** because the pilot recuts only `bigfoot/fledgling`, build
  and render it once with `underpaint: 0` in a **local, uncommitted** copy of
  `art/rig/bigfoot.rig.json` (`npm run art:rig:build -- bigfoot/fledgling`).
  Report the walk/attack frames from both builds side by side, so the wedges
  can be attributed to the stopgap or to the hand-painted fill. Restore the
  file before committing.

---

## 3. What you must not change

| Path | Rule |
|---|---|
| `assets/**/assembled.png` | **Never modify.** It is the approved art and the ground truth for every check. |
| Part file names and the part list | Exactly the names in `assets/manifest.json` (`species[].parts`, `rigVariants[].parts`). No new parts, no renamed parts, no removed parts. |
| `art/rig/*.rig.json` | Do not edit, except to set `underpaint` to `0` as §2 describes. zOrder, adjacency, root and every other key are fixed. |
| `assets/manifest.json` | Do not edit. |
| `art/rig/rive-mcp.pin.json`, `tools/art/*`, `.github/*`, `packages/*` | Do not edit. If a check seems wrong, report it (§10); do not change the check. |
| `art/rig/motion-baseline.json` | Do not update. A human blesses the baseline after review. |
| `<set>/joints.json` | Do not edit, except per §7.3. |
| `<set>/rig.riv` | Only by running `npm run art:rig:build` (§8). Never hand-edit or produce it any other way. |

---

## 4. Format of every part PNG (unchanged from asset-brief §3, restated)

- PNG, RGBA, 8 bits per channel, sRGB or no profile, non-interlaced.
- **Full canvas, 1024 × 1024**, the part drawn exactly where it sits on the assembled character, transparent everywhere else. No trimming, no atlas.
- Canvas origin (feet contact point) at (512, 900). Nothing moves.
- No opaque pixel within 8px of any canvas edge.
- **Alpha:** keep the antialiased (soft) alpha that `assembled.png` has, but **only on the character's outer silhouette**. Every pixel you paint that is hidden at rest (§5) is **fully opaque (alpha 255)**. No soft alpha along internal seams.

---

## 5. Cut rules: who owns which visible pixel

"Visible at rest" means the pixel as seen when all parts are stacked in the
rig config's `zOrder` (back to front), which must reproduce `assembled.png`
(§8, check A). Every visible pixel belongs to exactly one part, by anatomy:

1. **Limbs own everything from the joint to the tip.** `arm_l`/`arm_r` (front limbs on quadrupeds) and `leg_l`/`leg_r` own the whole limb, from the shoulder or hip seam down to and including the paw, hoof, foot, talons and claws. **The body owns no visible pixel within 40px of the standing line (y ≥ 860).** Neither do the head or the mane. Feet belong to limbs.
2. **The head owns the head**, from the neck seam up, minus what the mane, horn or other head parts own.
3. **The mane owns the mane hair**, including any part of it lying over the neck, chest or shoulders.
4. **The tail owns the tail** from the tail root outward. **Wings own the wings** from the wing root outward.
5. **The body owns the torso** and nothing else: no thigh, no forearm, no paw, no talon tip, no piece of the head.
6. **One island per part.** Each part's opaque pixels (alpha ≥ 128) form one connected region. The only exception is a part that is genuinely two separate things in the art (both wings in one `wings` layer, say), each of which is a large, real piece. **No small detached fragments**: no stamped discs, no copies of another part's art, no leftover slivers. `python3 tools/art/verify.py <set> --fail-fragments` must pass.
7. **Seams run across the joint, following the anatomy.** The visible boundary between a limb and the body is a natural contour across the shoulder, hip or neck: the line along which a cutout animator would hinge it. It is **not** a straight vertical or horizontal cut through fur. **No visible straight seam segment longer than 40px** unless it follows a straight edge that is in the drawing itself.
8. **Each pivot lies on its seam.** `joints.json` gives each joint's pivot in canvas pixels. The visible seam between a child and its parent must pass within roughly 30px of that pivot, and **both parts must paint the pivot pixel** (checked).
9. **Outline strokes belong to the part they outline.** Where a limb is drawn over the body, the dark outline stroke along the limb's edge is part of the limb. Cut on the outside of the stroke, so the stroke travels with the limb and does not stay painted on the body when the limb moves.

---

## 6. Hidden paint: what lies under each seam

This is the core of the work, and the reason the rigs gap today.

For every **moving pair** let **F** be the part drawn in front (later in the
rig config's `zOrder`) and **B** the part drawn behind. The moving pairs are
each acting child with its parent (head/body, arm_l/body, arm_r/body,
leg_l/body, leg_r/body, tail/body, wings/body, wherever those parts exist),
plus body/mane.

1. **Band.** B must be painted, fully opaque, under **every pixel F paints opaquely within 24px of their visible seam**. This applies whichever of the two is the parent: a leg drawn behind the body extends at least 24px up under the body, and the body extends at least 24px under an arm drawn over it.
2. **Joint zone.** When B is the parent (the body under an arm, under the head, under the tail…), B must also be painted under **every pixel F paints opaquely within 64px of the pivot** in `joints.json`. The most is revealed at the shoulder.
3. **Paint B's own continuation, not a copy of F.** The hidden pixels of B are what B would look like if F were not there: the torso's fur continuing under the arm, the thigh continuing up under the belly. **Do not** sample the hidden area from `assembled.png` (that copies F's art into B, which shows a ghost of F the moment F moves). `verify_seams.py` warns when more than 50% of B's hidden band, where the art is textured, is identical to `assembled.png`. Equality doesn't prove copying (a flat coat painted honestly under a flat arm is equal too), so a warning is a prompt to look, not a failure. Look, and say in the report what you found.
4. **Match B's own surface.** Use B's colours, value range and texture (the palette in asset-brief §2.3 and the art around the seam). Continue markings plausibly (spots, stars, stripes), or leave them out. Don't invent new features.
5. **No outlines inside hidden areas.** Don't paint an outline stroke along F's edge on B's hidden paint. B's own outline only appears where B's real silhouette is.
6. **Don't paint beyond what's needed.** Hidden paint stays under F. It must never extend past F's footprint, because at rest it must stay invisible (check A). It also must not cross onto an unrelated part (e.g. a leg's hidden paint must not reach under the other leg).
7. **Gear (class sets).** Gear layers that ride the body (armour, `gear_visible`, `focus_stone`, collars…) don't rotate relative to the body, so they need no band. Two rules still apply. First, the body must be fully painted under every gear layer drawn over it. Second, every gear layer that overlaps a moving limb seam is cut so the limb's band (rule 1) is satisfied by the body or limb, not by the gear.

**How to produce the hidden paint** is your choice, provided the output meets §4–§6:
- Generative inpainting constrained to B's region, with B's visible pixels as context. Review every result at full size.
- Hand-style extension (clone, extend and blend B's own nearby texture into the hidden area).
- A combination.

Any scripts you write for this go under `tools/art/recut/`, with a short README.
They must be re-runnable on a single set (`<script> bigfoot/fledgling`).
Keep any intermediate files (masks, seam drawings) out of `assets/`. Put them
under `art/recut/<set>/` if worth keeping.

---

## 7. Joints

### 7.1 What `joints.json` is

Each set's `joints.json` maps every child part to its pivot on its parent, in canvas pixels:

```json
{ "arm_l": { "parent": "body", "x": 625.11, "y": 474.45 } }
```

The rig generator uses these pivots directly (`source: "pinned"`). They are not
re-measured from the parts. That is what lets you add real overlap bands
without moving every joint to the middle of a limb. The current values were
recorded from the joint discs the old parts carried, and the committed rigs
rebuild byte-identically from them.

### 7.2 Your job with respect to joints

Cut each seam through its pivot (§5 rule 8). Do not move pivots to suit a cut.
Move the cut.

### 7.3 When a pivot is anatomically wrong

If a recorded pivot is clearly not where the limb hinges (for example, the
disc was stamped mid-limb), you may correct it. You must also:
- change only that entry, and keep the other three tiers of the same species consistent (asset-brief §3.2: joints are at the same place across tiers, within 70px normalised);
- list every changed pivot in the PR description with old → new coordinates and one sentence of reason;
- run the motion check (§8, G) for that set.

---

## 8. Checks: every one must pass for every set you touch

Setup, once: the rig CLI is built from a private repo.

```bash
npm ci
pip install -r requirements-dev.txt
RIVE_MCP_TOKEN=<read token for allenheltondev/rive-mcp> npm run art:rig:setup
# or, with a local checkout: KAD_RIVE_SRC=/path/to/rive-mcp npm run art:rig:setup
# if the Chromium download is blocked, point at an installed Chromium:
export RIVE_MCP_CHROME=/path/to/chrome
```

`python3` below means Python 3. On Windows, where it may be called `python`,
run the Python commands with `python` and say so in the report. `npm run
art:verify` calls `python3` itself, so on Windows run check A's command
directly instead.

Then, for a set `<set>` (e.g. `bigfoot/fledgling`, or
`thornguard/sworn/bigfoot`), in this order:

| | Command | Must show |
|---|---|---|
| A | `python3 tools/art/verify.py <species>/<tier> --fail-fragments` (base sets; class sets are covered by B–G) | PASS: recomposite IoU ≥ 0.999 and mean RGB delta ≤ 2.0, format, bounds, no fragments |
| B | `python3 tools/art/verify_seams.py <set>` | `ok`: band ≥ 98%, joint zone ≥ 98%, ground, pivots painted by both parts. A `note … no visible seam` line is fine. Every `warn … copy?` line is explained in the report (§10) |
| C | `npm run art:rig:build -- <set>` | `ok`, every pivot `pinned`, `contract ok` |
| D | `npm run art:rig:build -- --check <set>` | reproducible |
| E | `npm run art:verify:rig:strict` | PASS |
| F | `node tools/art/verify-rig-rest.mjs <species> --tier <tier>` | the set passes at ≥ 99.80%, ideally unchanged from before |
| G | `node tools/art/verify-rig-motion.mjs <species> --tier <tier>` | **0 FAILED** for the set. `changed` baseline lines are expected; do not update the baseline. Report the count of `comes apart` warnings before and after |
| H | `node tools/art/rig-sheet.mjs --clip idle --tier <tier>` and the same for `--clip walk` and `--clip attack` | contact sheets in `art/review/`. Look at them: no gaps, no straight cut edges sweeping out of the silhouette, no ghost limbs, no smears. Attach them to the PR |

Then, before opening the PR: `npm run art:verify` (all sets) and
`npm run typecheck && npm test` must still pass.

**Do not weaken, skip or edit any check to make it pass.** If you believe a
check is wrong for a specific set, stop and report it (§10) with the evidence.

**Report every check from the candidate you are submitting.** A result from an
earlier candidate does not count for a later one. Rerun A–H on the final PNGs.

---

## 9. Deliverables per set

- `parts/*.png`: recut and underpainted, per §4–§6.
- `rig.riv`: rebuilt by `npm run art:rig:build` (check C), committed.
- `joints.json`: unchanged, or changed per §7.3.
- Nothing else in `assets/`.

---

## 10. Reporting

**For the pilot (`bigfoot/fledgling`), and in each PR description:**

1. The output of checks A–G for each set (pass lines and numbers, not just "passed").
2. `verify_seams.py` before and after for each set: the band and joint percentages per pair, and every `copy?` warning with what you found when you looked.
3. The `comes apart` warning count from check G, before and after.
4. The contact sheets from H, plus one full-size frame of `walk` and one of `attack` per species, rendered with the rig CLI on a dark background, before and after side by side.
5. Every pivot changed under §7.3, old → new, with the reason.
6. How the hidden paint was produced (tool, model, prompts if generative) and anything you had to judge by eye.
7. Anything in this brief you could not satisfy, and why. **Do not silently relax a rule.**

**Stop and ask** rather than guess when:
- a rule in §5 conflicts with the drawing (e.g. anatomy is ambiguous about where a limb begins);
- passing a check seems to require changing `assembled.png`, a config, the manifest or a check;
- the generated hidden paint changes the character's look anywhere it can be seen.

---

## 11. Done means

All 66 sets pass checks A–G, every config has `underpaint: 0`, and a human has
approved the contact sheets. `art:verify:seams` is then made a CI gate.
