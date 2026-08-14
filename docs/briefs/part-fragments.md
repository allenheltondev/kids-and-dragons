# Brief: duplicated part fragments

**115 parts across all 24 tier sets carry a detached copy of artwork another
part already draws.** They are invisible at rest and fly off when the part
rotates. This is the worklist for re-cutting them, and the record of how the
whole pipeline missed it.

**Status:** open, and this brief blames the wrong defect for the symptom that
started it — see §1.1, which a render settles. Separately, **most of the
worklist turned out not to be deletable**.
28 of the 179 fragments are gone (`tools/art/recut_fragments.py`). The other
151 are load-bearing: they are the seam overlap the rig derives its joints
from, and deleting them opens the joint they were holding shut. §4.1 has the
measurement and §4.2 what it leaves to do. `art:verify` still warns; the flip
to failing described in §5 cannot happen until those 151 are resolved.

---

## 1. The symptom

A human looked at a contact sheet of `attack` and saw limbs coming apart. At
full resolution, `bigfoot/fledgling` at t=0.33s has sharp axis-aligned holes
punched through the torso and hips, with rectangular fragments floating beside
the forearms.

> **The cause named below is wrong.** It was written from the source art
> without re-rendering, and rendering it disproves it: deleting all five of
> `bigfoot/fledgling`'s duplicated fragments and rebuilding the rig leaves the
> holes and the floating blocks exactly where they were. §1.1 has what is
> actually happening. Everything from §2 on is about duplicated fragments,
> which are a real defect — just not this one.

The cause is not in the rig. `arm_l.png` as delivered contains a detached disc
and a hard-edged block that are not arm. At rest they sit exactly where they
were cut from, so the parts stack back into `assembled.png` perfectly. The
moment the arm rotates, the fragments travel with it.

### 1.1 What is actually happening

Rebuilt from parts with every duplicated fragment deleted, that frame is
unchanged: transparent pixels inside the figure went 144,655 → 147,132, and the
rig came back with five joints whose pivots it had to guess, because deleting
the discs is also what takes a joint's overlap away (§4.1).

Rendering rest against t=0.33 and mapping each opening back to the source art
says who took the pixels:

| opening | drawn at rest by |
|---|---|
| 7,353 px | **arm_l 86%**, body 12%, leg_l 2% |
| 6,318 px | **arm_r 97%**, mane 1% |
| 4,583 px | **arm_r 83%**, body 14% |
| 3,986 px | **arm_l 99%**, mane 0% |

The arms are the *sole* owners of pixels sitting over the torso. Nothing else
draws them, so when the arm swings they leave a hole — and this is the exact
opposite of a duplicate, which leaves no hole precisely *because* another part
still draws it. Same symptom, opposite cause.

It is invisible to every source-level check for that reason. `check_recomposite`
is satisfied by any partition of the image, this one included. The block is
attached to the arm's own artwork, so it is not a detached component and no
fragment rule sees it. And it is not duplicated, so the redundancy measure in
§3 scores it at zero — the one number that would flag a duplicate is the number
that clears this.

`tools/art/rig_holes.py` measures it: renders each rig at rest and mid-clip,
keeps the openings the figure *encloses* — a wing sweeping away leaves empty
space, and that is animation — and names the part that drew each one. It needs
the Rive CLI, like the other two rig gates.

### 1.2 The corpus, and what it is a worklist for

`python3 tools/art/rig_holes.py`, two ticks of `attack`:

| set | holes | largest | carried off by |
|---|---|---|---|
| dragonling/radiant | 3 | 5,587 px | arm_r, wings |
| griffin/radiant | 6 | 4,106 px | wings |
| dragonling/sworn | 3 | 3,430 px | arm_r, wings |
| griffin/mythic | 2 | 2,662 px | wings |
| bigfoot/fledgling | 1 | 2,238 px | arm_l |
| griffin/sworn | 2 | 2,183 px | wings |
| kitsune/radiant | 4 | 2,022 px | mane |
| bigfoot/mythic | 2 | 1,737 px | arm_l, mane |
| manticore/sworn | 3 | 1,591 px | arm_r, mane |
| manticore/radiant | 1 | 1,584 px | arm_r |
| kitsune/sworn | 2 | 1,508 px | mane |
| bigfoot/sworn | 2 | 1,338 px | arm_l, mane |
| kitsune/mythic | 2 | 1,301 px | mane |
| kitsune/fledgling | 1 | 1,208 px | mane |
| dragonling/fledgling | 1 | 1,157 px | wings |
| manticore/mythic | 1 | 1,121 px | arm_r |

**36 holes across 16 of 24 sets** — wings ×15, mane ×13, arm_r ×5, arm_l ×3.
Two ticks of one clip, so this is a floor and not an inventory: `down` and
`hurt` move parts `attack` barely touches, and each clip would add its own.

The fix is per hole, and it is a drawing: the part underneath needs to draw the
pixels the moving part is currently the only source of. Where `arm_l` is 99% of
an opening, the body should carry that artwork too and the arm should keep only
what is arm. That makes the pixels duplicated on purpose — which is what a seam
is, and why §3's redundancy measure cannot be the whole rule for what a part
may carry.

Note the shape of the list against §4's. That one is led by manticore and
bigfoot; this one by griffin and dragonling wings, and by manes. They are
different defects in different sets, and the only reason to read them together
is that one was mistaken for the other.

Two theories were tested and killed first, which is worth recording so nobody
re-runs them:

- **Not the triangle-index encoding** (the manticore mesh bug, §6.3 of
  art-pipeline). Rebuilding `bigfoot/fledgling` with the fixed writer produces a
  **byte-identical** file.
- **Not mesh deformation.** `rivWriter.ts` creates a mesh only under
  `if (img.mesh)`, which comes from `meshParts`, and manticore's tail is the
  only declared mesh in the project. Bigfoot's parts are rigid images, and a
  rigid image cannot deform into a rectangle.

## 2. Why every gate passed

| Gate | Why it cannot see this |
|---|---|
| `verify.py` `check_recomposite` | Asks that parts stack back into `assembled.png`. **Any** partition satisfies that, including one that gives the same pixels to two parts. |
| `art:verify:rig` | Reads the `.riv` as data. Nothing about part cutouts is in it. |
| `art:verify:rig:rest` | Renders frame 0, where a duplicate sits exactly on its original. Invisible by construction. |
| `art:verify:rig:motion` | **Measured it and said nothing.** Enclosed gaps on that bigfoot frame go 683 px at rest → 3,399 mid-attack. `INTERIOR_GAP_WARN` is 15,000, and it is a warning rather than a failure. |

That last row looks like a loose threshold and is not one. The gap the defect
opens is 3,399 − 683 = **2,716 px**, and clean clips of demonstrably good rigs
reach **6,198 px** — the defect is *below* the clean population, so no setting of
`INTERIOR_GAP_WARN` catches it without firing constantly on legitimate
animation. Enclosed area cannot separate "a joint came apart" from "a leg
lifted", which is why the gate's own comment says it warns instead of failing.

The consequence is that this defect class has to be caught at source, which is
what §3 does: no renderer, no threshold, and it fires on the art rather than on
one clip that happens to swing the arm far enough. The motion gate's own
follow-up is separate and smaller — it now reports how thickly each enclosed gap
is walled in, which is the figure that *does* separate the two cases, so the
warning it already prints is triageable without a re-render.

## 3. Telling a duplicate from real artwork

Detached artwork is legitimate and common, so "a part must be one component" is
the wrong rule. The manticore's barbed tail is six components and the barbs do
not touch the shaft — nothing else draws them, and removing them loses art.

Distance does not separate the two: manticore's barbs sit at 2, 8, 10, 30, 43
and 61+ px from the shaft, spanning the same range as the bad fragments.

**Redundancy does.** For each detached fragment ≥64 px, measure how much of it
some other part in the same set already draws. Across all 24 sets, 743
fragments split cleanly:

| another part already draws… | fragments |
|---|---|
| 0–1% of it | 507 |
| 1–95% | 63 |
| **95–100%** | **173** |

Manticore's tail barbs score 0.00 and are not flagged. The bigfoot arm discs
score exactly 1.00 and are. The threshold is 0.95 and lands in the empty middle.

## 4. What to re-cut

179 fragments across 115 parts. **131 of them are the same 53×53 disc of
2,100 px** — one artifact, stamped into parts across every species and tier, so
whatever produced it is a single step in the cutting process and fixing that one
thing removes 73% of the list.

| species | fragments | parts affected |
|---|---|---|
| dragonling | 35 | arm_l, arm_r, body, leg_l, leg_r, mane, tail |
| griffin | 34 | arm_l, arm_r, body, head, leg_l, leg_r, mane, tail |
| unicorn | 34 | arm_r, body, head, horn, mane |
| kitsune | 31 | arm_l, arm_r, body, leg_l, leg_r, mane |
| manticore | 23 | arm_l, arm_r, body, leg_l, leg_r |
| bigfoot | 22 | arm_l, arm_r, body, head, leg_l, leg_r, mane |

A fragment is fixed by deleting it from the part that should not have it. It is
duplicated by definition, so nothing is lost: the pixels stay in whichever part
legitimately draws them, and `check_recomposite` still passes.

Regenerate this list any time with `npm run art:verify` — the per-tier counts
are in the warnings.

### 4.1 Except that deleting them breaks the rig

The paragraph above is true about pixels and wrong about rigs, and running the
re-cut is what showed it. Deleting all 179 leaves every set recompositing at
IoU=1.00000 — and **fails `check_seams` on 21 of the 24 sets**.

`check_seams` requires adjacent parts to share at least 2,000 px, because a
joint with no overlap opens a gap the moment it rotates. At most joints in this
corpus **the duplicated disc is that overlap**. Delete it and the pair shares
nothing at all:

```
unicorn/sworn seam overdraw
  expected: every adjacent pair >= 2,000px shared
  actual:   head/horn=0px, body/tail=256px
```

It is worse than a failed check. `joint_centroids` derives each pivot as the
centroid of the seam band, and `rive-mcp` rigs from the same geometry — so
where the disc is the only overlap, the disc *is* the joint definition.
Measured across all 179 fragments, against the pivot of the nearest joint:

| | count | median distance to pivot | within 2 px of it |
|---|---|---|---|
| the joint's only overlap | 141 | **0.0 px** | 98 of 141 |
| joint overlaps without it | 38 | 110.5 px | 0 of 38 |

The load-bearing ones sit *on* the pivot. A disc centred on the pivot rotates
in place and keeps the joint sealed, which is what it is for. The redundant
ones sit as much as 323 px away, on no pivot at all, and those are the ones
that swing.

A second, quieter version of the same trap: a fragment can be redundant for
`check_seams` and still be part of the band whose centroid *locates* the joint.
Removing 3 such fragments moved dragonling's `head/body` joint far enough to
fail cross-tier registration by 93 px against a 70 px tolerance — art deleted,
skeleton moved.

### 4.2 What was re-cut, and what is left

`tools/art/recut_fragments.py` removes what is safely removable and reports the
rest. It imports the verifier's own detection rather than restating it, and
holds back three classes: the last copy of any artwork, anything that is a
joint's only overlap, and anything whose removal would move a structural joint
more than 5 px.

**Removed: 28 fragments, 27,357 px, across 12 sets.** `art:verify` is 740 pass
/ 28 warn / 0 fail, recomposite unchanged at IoU=1.00000, cross-tier
registration unchanged. Each guard is pinned by `recut_fragments.test.ts` and
fails without it — the seam case removes 2,209 px with the guard defeated, and
the seam and joint guards are not redundant with each other: the seam guard
alone holds 38, the joint guard alone holds 10, and 103 are held by both.

**This does not fix what the human saw.** `bigfoot/fledgling` — the contact
sheet in §1 — has 5 fragments and all 5 are load-bearing, so none of them came
out. Whatever is punching holes in that torso at t=0.33s, deleting duplicated
artwork is not the fix for it, and §1's diagnosis should be treated as
unconfirmed until someone re-renders that clip and looks. The rest gate cannot
see it and the motion gate reports area, which §2 already establishes cannot
tell this defect from a lifted leg.

**Left: 151 fragments, and they are not a deletion job.** Each one is a joint
whose two parts share no artwork of their own. Fixing them properly means
drawing real overlap into the parts — the arm's own pixels extending under the
shoulder — after which the disc becomes redundant and the re-cut takes it. That
is an art change, so it belongs to whoever owns the drawings (art-pipeline §3),
not to this tool. `python3 tools/art/recut_fragments.py` prints the list, joint
by joint, with what each would drop to.

The alternative is to decide these discs are the intended joint-cap mechanism
and teach `check_part_fragments` to exempt a fragment sitting on a pivot it is
the overlap for. That is a smaller change and a real option — but it should be
a decision about how these rigs are built, not a way to silence a warning.

## 5. Why the check warns instead of failing

`check_part_fragments` in `verify.py` is a warning today because 179 fragments
are in the corpus as delivered, and a check that reds the build on art nobody
has re-cut yet is a check people learn to skip. The discriminator is tested
(`verify_fragments.test.ts`, which fails against a naive any-detached-fragment
rule).

**It was going to flip to failing once the re-cut landed. It cannot.** 151
fragments remain and none of them can be deleted — §4.1 — so a failing check
would red the build on art that is doing its job. The flip now waits on the
decision in §4.2: either the joints get real overlap drawn, or the check learns
to exempt a fragment that sits on the pivot it is the overlap for. Until one of
those happens, warning is the honest setting, and the count in the warning is
the backlog.

## 6. Also open

The `down` clips rotate the figure rigidly rather than collapsing it — it reads
as tilting, not as a knockdown. That is an authoring judgement, not a defect,
and it is separate from everything above.
## 7. The 151 still held, joint by joint

Regenerate with `python3 tools/art/recut_fragments.py`. "Holding" is why the
re-cut refuses it: *all of `x/y`* means that pair shares nothing else, so the
fragment is the joint; *`x/y` pivot* means removing it would move that joint by
the distance shown. Fragments already removed are not listed — this is what is
left, not what was delivered.

**unicorn/fledgling** — 1 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 1,408 px | 85x33 | (181,397) | `head/body` pivot (28px) |

**unicorn/sworn** — 2 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (682,405) | all of `body/tail` |
| `head` | 2,100 px | 55x50 | (244,162) | all of `head/horn` |

**unicorn/radiant** — 8 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (681,415) | all of `body/tail` |
| `body` | 447 px | 22x33 | (212,389) | `head/body` pivot (9px) |
| `body` | 396 px | 18x33 | (190,380) | `head/body` pivot (10px) |
| `body` | 359 px | 37x22 | (527,365) | `head/body` pivot (10px) |
| `head` | 2,100 px | 59x50 | (253,167) | all of `head/horn` |
| `head` | 447 px | 22x33 | (212,389) | `head/body` pivot (9px) |
| `head` | 396 px | 18x33 | (190,380) | `head/body` pivot (10px) |
| `head` | 359 px | 37x22 | (527,365) | `head/body` pivot (10px) |

**unicorn/mythic** — 5 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,089 px | 61x61 | (635,415) | all of `body/tail` |
| `body` | 1,555 px | 45x38 | (242,408) | `head/body` pivot (29px) |
| `head` | 914 px | 51x42 | (267,251) | all of `head/horn` |
| `horn` | 716 px | 35x24 | (332,327) | all of `head/horn` |
| `horn` | 470 px | 17x34 | (255,316) | all of `head/horn` |

**dragonling/fledgling** — 7 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,100 px | 46x57 | (203,492) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (275,415) | all of `head/body` |
| `body` | 2,100 px | 51x51 | (520,415) | all of `body/wings` |
| `leg_l` | 2,100 px | 51x51 | (595,525) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (485,535) | all of `body/leg_r` |
| `mane` | 2,100 px | 82x38 | (557,530) | all of `body/mane` |
| `tail` | 2,100 px | 51x51 | (655,585) | all of `body/tail` |

**dragonling/sworn** — 9 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (185,468) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (264,382) | `head/body` pivot (39px) |
| `body` | 2,100 px | 51x51 | (286,467) | all of `body/arm_l` |
| `body` | 2,100 px | 51x51 | (565,415) | all of `body/wings` |
| `leg_l` | 2,100 px | 51x51 | (602,500) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (486,510) | all of `body/leg_r` |
| `mane` | 2,100 px | 51x51 | (290,145) | all of `head/mane` |
| `mane` | 2,100 px | 51x51 | (620,490) | all of `body/mane` |
| `tail` | 2,100 px | 53x53 | (699,584) | all of `body/tail` |

**dragonling/radiant** — 8 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (180,467) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (259,381) | `head/body` pivot (39px) |
| `body` | 2,100 px | 51x51 | (282,466) | all of `body/arm_l` |
| `body` | 2,100 px | 51x51 | (555,415) | all of `body/wings` |
| `leg_l` | 2,100 px | 51x51 | (602,498) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (485,509) | all of `body/leg_r` |
| `mane` | 2,100 px | 51x51 | (280,145) | all of `head/mane` |
| `tail` | 2,100 px | 49x55 | (694,583) | all of `body/tail` |

**dragonling/mythic** — 10 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (276,467) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 51x51 | (170,468) | all of `body/arm_r` |
| `body` | 4,152 px | 56x100 | (602,451) | all of `body/leg_l` |
| `body` | 2,100 px | 51x51 | (170,468) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (253,382) | all of `head/body` |
| `body` | 2,100 px | 51x51 | (276,467) | all of `body/arm_l` |
| `body` | 2,100 px | 51x51 | (486,510) | all of `body/leg_r` |
| `leg_l` | 2,100 px | 52x53 | (606,498) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (486,510) | all of `body/leg_r` |
| `tail` | 2,086 px | 68x105 | (659,585) | all of `body/tail` |

**griffin/fledgling** — 5 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (220,500) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (530,380) | all of `body/wings` |
| `leg_l` | 2,100 px | 51x51 | (640,525) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (490,530) | all of `body/leg_r` |
| `tail` | 2,061 px | 74x85 | (682,529) | all of `body/tail` |

**griffin/sworn** — 6 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (215,510) | all of `body/arm_r` |
| `body` | 422 px | 28x32 | (733,596) | all of `body/tail` |
| `head` | 2,100 px | 51x51 | (307,438) | all of `head/mane` |
| `leg_l` | 2,100 px | 51x51 | (644,534) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (491,539) | all of `body/leg_r` |
| `tail` | 422 px | 28x32 | (733,596) | all of `body/tail` |

**griffin/radiant** — 6 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_r` | 2,123 px | 51x52 | (182,485) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (182,485) | all of `body/mane` |
| `body` | 2,100 px | 51x51 | (515,380) | all of `body/wings` |
| `leg_l` | 2,100 px | 53x53 | (661,510) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (491,516) | all of `body/leg_r` |
| `mane` | 2,100 px | 59x59 | (271,181) | all of `head/mane` |

**griffin/mythic** — 12 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (318,504) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 40x85 | (215,486) | all of `body/arm_r` |
| `body` | 2,100 px | 40x85 | (215,486) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (284,430) | all of `head/body` |
| `body` | 2,100 px | 51x51 | (318,504) | all of `body/arm_l` |
| `body` | 180 px | 15x15 | (735,603) | all of `body/tail` |
| `body` | 110 px | 8x25 | (754,620) | all of `body/tail` |
| `leg_l` | 2,100 px | 55x57 | (660,526) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (491,534) | all of `body/leg_r` |
| `mane` | 2,100 px | 72x43 | (319,206) | all of `head/mane` |
| `tail` | 180 px | 15x15 | (735,603) | all of `body/tail` |
| `tail` | 110 px | 8x25 | (754,620) | all of `body/tail` |

**bigfoot/fledgling** — 5 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 53x53 | (599,449) | all of `body/arm_l` |
| `head` | 2,100 px | 51x51 | (485,410) | all of `head/body` |
| `leg_l` | 2,100 px | 51x51 | (565,595) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (405,595) | all of `body/leg_r` |
| `mane` | 2,100 px | 51x51 | (475,205) | all of `head/mane` |

**bigfoot/sworn** — 4 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 55x55 | (591,463) | all of `body/arm_l` |
| `head` | 2,100 px | 51x51 | (485,427) | all of `head/body` |
| `leg_l` | 2,100 px | 52x52 | (560,605) | all of `body/leg_l` |
| `mane` | 2,100 px | 51x51 | (475,214) | all of `head/mane` |

**bigfoot/radiant** — 4 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,099 px | 53x53 | (598,468) | all of `body/arm_l` |
| `head` | 2,100 px | 51x51 | (486,431) | all of `head/body` |
| `leg_l` | 2,100 px | 51x51 | (564,607) | all of `body/leg_l` |
| `mane` | 2,100 px | 51x51 | (477,214) | all of `head/mane` |

**bigfoot/mythic** — 8 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (600,462) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 51x51 | (358,463) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (358,463) | all of `body/arm_r` |
| `body` | 166 px | 14x33 | (603,619) | all of `body/leg_l` |
| `head` | 2,100 px | 51x51 | (486,424) | all of `head/mane` |
| `leg_l` | 1,934 px | 46x53 | (564,602) | all of `body/leg_l` |
| `leg_l` | 166 px | 14x33 | (603,619) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (407,603) | all of `body/leg_r` |

**kitsune/fledgling** — 8 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (295,520) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 51x51 | (195,520) | all of `body/arm_r` |
| `body` | 6,109 px | 66x141 | (295,430) | all of `head/body` |
| `body` | 2,100 px | 51x51 | (195,520) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (630,475) | all of `body/tail` |
| `leg_l` | 2,100 px | 51x51 | (595,545) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (445,555) | all of `body/leg_r` |
| `mane` | 2,100 px | 51x51 | (260,245) | all of `head/mane` |

**kitsune/sworn** — 8 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (286,515) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 51x51 | (181,515) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (181,515) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (286,515) | all of `body/arm_l` |
| `body` | 2,100 px | 51x51 | (302,424) | all of `head/body` |
| `body` | 2,100 px | 51x51 | (648,475) | all of `body/tail` |
| `leg_l` | 2,100 px | 51x51 | (600,541) | all of `body/leg_l` |
| `mane` | 2,100 px | 51x51 | (278,245) | all of `head/mane` |

**kitsune/radiant** — 6 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (282,516) | all of `body/arm_l` |
| `body` | 6,277 px | 79x142 | (282,425) | all of `head/body` |
| `body` | 2,100 px | 51x51 | (175,516) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (603,541) | all of `body/leg_l` |
| `leg_l` | 2,100 px | 51x51 | (603,541) | all of `body/leg_l` |
| `mane` | 2,100 px | 51x51 | (265,245) | all of `head/mane` |

**kitsune/mythic** — 6 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (286,507) | all of `body/arm_l` |
| `body` | 4,152 px | 87x83 | (286,475) | all of `body/arm_l` |
| `body` | 2,100 px | 51x51 | (182,507) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (302,413) | all of `head/body` |
| `body` | 2,100 px | 51x51 | (598,533) | all of `body/leg_l` |
| `mane` | 2,100 px | 51x51 | (278,245) | all of `head/mane` |

**manticore/fledgling** — 6 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (320,520) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 54x65 | (212,510) | all of `body/arm_r` |
| `body` | 2,100 px | 54x65 | (212,510) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (320,520) | all of `body/arm_l` |
| `leg_l` | 2,100 px | 51x51 | (675,530) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (530,540) | all of `body/leg_r` |

**manticore/sworn** — 6 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (326,534) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 52x53 | (227,526) | all of `body/arm_r` |
| `body` | 2,100 px | 52x53 | (227,526) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (326,534) | all of `body/arm_l` |
| `leg_l` | 2,100 px | 51x51 | (669,543) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (529,553) | all of `body/leg_r` |

**manticore/radiant** — 6 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (322,517) | all of `body/arm_l` |
| `arm_r` | 2,100 px | 51x51 | (221,509) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (221,509) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (322,517) | all of `body/arm_l` |
| `leg_l` | 2,100 px | 51x51 | (673,527) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (529,537) | all of `body/leg_r` |

**manticore/mythic** — 5 held

| part | fragment | bbox | at | holding |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (321,531) | all of `body/arm_l` |
| `body` | 2,100 px | 51x51 | (219,524) | all of `body/arm_r` |
| `body` | 2,100 px | 51x51 | (321,531) | all of `body/arm_l` |
| `leg_l` | 2,100 px | 51x51 | (673,541) | all of `body/leg_l` |
| `leg_r` | 2,100 px | 51x51 | (529,551) | all of `body/leg_r` |
