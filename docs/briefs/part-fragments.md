# Brief: duplicated part fragments

**115 parts across all 24 tier sets carry a detached copy of artwork another
part already draws.** They are invisible at rest and fly off when the part
rotates. This is the worklist for re-cutting them, and the record of how the
whole pipeline missed it.

**Status:** open. `art:verify` warns (`duplicated part fragments`); it does not
fail yet — see §5.

---

## 1. The symptom

A human looked at a contact sheet of `attack` and saw limbs coming apart. At
full resolution, `bigfoot/fledgling` at t=0.33s has sharp axis-aligned holes
punched through the torso and hips, with rectangular fragments floating beside
the forearms.

The cause is not in the rig. `arm_l.png` as delivered contains a detached disc
and a hard-edged block that are not arm. At rest they sit exactly where they
were cut from, so the parts stack back into `assembled.png` perfectly. The
moment the arm rotates, the fragments travel with it.

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

## 5. Why the check warns instead of failing

`check_part_fragments` in `verify.py` is a warning today because 179 fragments
are in the corpus as delivered, and a check that reds the build on art nobody
has re-cut yet is a check people learn to skip. **Flip
`rep.warn` to `rep.fail` once the re-cut lands** — the discriminator is tested
(`verify_fragments.test.ts`, which fails against a naive any-detached-fragment
rule), so the only thing standing between it and blocking is the backlog.

## 6. Also open

The `down` clips rotate the figure rigidly rather than collapsing it — it reads
as tilting, not as a knockdown. That is an authoring judgement, not a defect,
and it is separate from everything above.

**bigfoot/fledgling**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 53x53 | (599,449) | 100% |
| `head` | 2,100 px | 51x51 | (485,410) | 100% |
| `leg_l` | 2,100 px | 51x51 | (565,595) | 100% |
| `leg_r` | 2,100 px | 51x51 | (405,595) | 100% |
| `mane` | 2,100 px | 51x51 | (475,205) | 100% |

**bigfoot/mythic**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (600,462) | 100% |
| `arm_r` | 2,100 px | 51x51 | (358,463) | 100% |
| `body` | 2,100 px | 51x51 | (358,463) | 100% |
| `body` | 166 px | 14x33 | (603,619) | 100% |
| `head` | 2,100 px | 51x51 | (486,424) | 100% |
| `leg_l` | 1,934 px | 46x53 | (564,602) | 100% |
| `leg_l` | 166 px | 14x33 | (603,619) | 100% |
| `leg_r` | 2,100 px | 51x51 | (407,603) | 100% |
| `mane` | 2,100 px | 51x51 | (477,214) | 100% |

**bigfoot/radiant**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,099 px | 53x53 | (598,468) | 100% |
| `head` | 2,100 px | 51x51 | (486,431) | 100% |
| `leg_l` | 2,100 px | 51x51 | (564,607) | 100% |
| `mane` | 2,100 px | 51x51 | (477,214) | 100% |

**bigfoot/sworn**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 55x55 | (591,463) | 100% |
| `head` | 2,100 px | 51x51 | (485,427) | 100% |
| `leg_l` | 2,100 px | 52x52 | (560,605) | 100% |
| `mane` | 2,100 px | 51x51 | (475,214) | 100% |

**dragonling/fledgling**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (275,415) | 100% |
| `body` | 2,100 px | 51x51 | (520,415) | 100% |
| `body` | 2,100 px | 46x57 | (203,492) | 100% |
| `leg_l` | 2,100 px | 51x51 | (595,525) | 100% |
| `leg_r` | 2,100 px | 51x51 | (485,535) | 100% |
| `mane` | 2,100 px | 82x38 | (557,530) | 100% |
| `mane` | 204 px | 10x22 | (203,517) | 100% |
| `tail` | 2,100 px | 51x51 | (655,585) | 100% |

**dragonling/mythic**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (276,467) | 100% |
| `arm_r` | 2,100 px | 51x51 | (170,468) | 100% |
| `body` | 4,152 px | 56x100 | (602,451) | 100% |
| `body` | 2,100 px | 51x51 | (253,382) | 100% |
| `body` | 2,100 px | 51x51 | (276,467) | 100% |
| `body` | 2,100 px | 51x51 | (170,468) | 100% |
| `body` | 2,100 px | 51x51 | (486,510) | 100% |
| `leg_l` | 2,100 px | 52x53 | (606,498) | 100% |
| `leg_r` | 2,100 px | 51x51 | (486,510) | 100% |
| `tail` | 2,086 px | 68x105 | (659,585) | 100% |

**dragonling/radiant**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (259,381) | 100% |
| `body` | 2,100 px | 51x51 | (555,415) | 100% |
| `body` | 2,100 px | 51x51 | (282,466) | 100% |
| `body` | 2,100 px | 51x51 | (180,467) | 100% |
| `leg_l` | 2,100 px | 51x51 | (602,498) | 100% |
| `leg_r` | 2,100 px | 51x51 | (485,509) | 100% |
| `mane` | 2,100 px | 51x51 | (280,145) | 100% |
| `tail` | 2,100 px | 49x55 | (694,583) | 100% |

**dragonling/sworn**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (264,382) | 100% |
| `body` | 2,100 px | 51x51 | (565,415) | 100% |
| `body` | 2,100 px | 51x51 | (286,467) | 100% |
| `body` | 2,100 px | 51x51 | (185,468) | 100% |
| `leg_l` | 2,100 px | 51x51 | (602,500) | 100% |
| `leg_r` | 2,100 px | 51x51 | (486,510) | 100% |
| `mane` | 2,100 px | 51x51 | (290,145) | 100% |
| `mane` | 2,100 px | 51x51 | (620,490) | 100% |
| `tail` | 2,100 px | 53x53 | (699,584) | 100% |

**griffin/fledgling**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (530,380) | 100% |
| `body` | 2,100 px | 51x51 | (220,500) | 100% |
| `leg_l` | 2,100 px | 51x51 | (640,525) | 100% |
| `leg_r` | 2,100 px | 51x51 | (490,530) | 100% |
| `mane` | 2,100 px | 51x51 | (290,185) | 100% |
| `tail` | 2,061 px | 74x85 | (682,529) | 100% |

**griffin/mythic**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (318,504) | 100% |
| `arm_r` | 2,100 px | 40x85 | (215,486) | 100% |
| `body` | 2,100 px | 51x51 | (545,380) | 100% |
| `body` | 2,100 px | 51x51 | (284,430) | 100% |
| `body` | 2,100 px | 40x85 | (215,486) | 100% |
| `body` | 2,100 px | 51x51 | (318,504) | 100% |
| `body` | 180 px | 15x15 | (735,603) | 100% |
| `body` | 110 px | 8x25 | (754,620) | 100% |
| `leg_l` | 2,100 px | 55x57 | (660,526) | 100% |
| `leg_r` | 2,100 px | 51x51 | (491,534) | 100% |
| `mane` | 2,100 px | 72x43 | (319,206) | 100% |
| `tail` | 180 px | 15x15 | (735,603) | 100% |
| `tail` | 110 px | 8x25 | (754,620) | 100% |

**griffin/radiant**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_r` | 2,123 px | 51x52 | (182,485) | 99% |
| `body` | 2,100 px | 51x51 | (515,380) | 100% |
| `body` | 2,100 px | 51x51 | (182,485) | 100% |
| `leg_l` | 2,100 px | 53x53 | (661,510) | 100% |
| `leg_r` | 2,100 px | 51x51 | (491,516) | 100% |
| `mane` | 2,100 px | 59x59 | (271,181) | 100% |
| `mane` | 2,100 px | 41x61 | (330,460) | 100% |

**griffin/sworn**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (540,380) | 100% |
| `body` | 2,100 px | 51x51 | (215,510) | 100% |
| `body` | 422 px | 28x32 | (733,596) | 100% |
| `head` | 2,100 px | 51x51 | (307,438) | 100% |
| `leg_l` | 2,100 px | 51x51 | (644,534) | 100% |
| `leg_r` | 2,100 px | 51x51 | (491,539) | 100% |
| `mane` | 2,100 px | 51x51 | (300,185) | 100% |
| `tail` | 422 px | 28x32 | (733,596) | 100% |

**kitsune/fledgling**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (295,520) | 100% |
| `arm_r` | 2,100 px | 51x51 | (195,520) | 100% |
| `body` | 6,109 px | 66x141 | (295,430) | 100% |
| `body` | 2,100 px | 51x51 | (630,475) | 100% |
| `body` | 2,100 px | 51x51 | (195,520) | 100% |
| `leg_l` | 2,100 px | 51x51 | (595,545) | 100% |
| `leg_r` | 2,100 px | 51x51 | (445,555) | 100% |
| `mane` | 2,100 px | 51x51 | (260,245) | 100% |

**kitsune/mythic**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (286,507) | 100% |
| `body` | 4,152 px | 87x83 | (286,475) | 100% |
| `body` | 2,100 px | 51x51 | (302,413) | 100% |
| `body` | 2,100 px | 51x51 | (641,475) | 100% |
| `body` | 2,100 px | 51x51 | (182,507) | 100% |
| `body` | 2,100 px | 51x51 | (598,533) | 100% |
| `mane` | 2,100 px | 51x51 | (278,245) | 100% |

**kitsune/radiant**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (282,516) | 100% |
| `body` | 6,277 px | 79x142 | (282,425) | 100% |
| `body` | 2,100 px | 51x51 | (635,475) | 100% |
| `body` | 2,100 px | 51x51 | (175,516) | 100% |
| `body` | 2,100 px | 51x51 | (603,541) | 100% |
| `leg_l` | 2,100 px | 51x51 | (603,541) | 100% |
| `mane` | 2,100 px | 51x51 | (265,245) | 100% |

**kitsune/sworn**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (286,515) | 100% |
| `arm_r` | 2,100 px | 51x51 | (181,515) | 100% |
| `body` | 2,100 px | 51x51 | (302,424) | 100% |
| `body` | 2,100 px | 51x51 | (323,475) | 100% |
| `body` | 2,100 px | 51x51 | (648,475) | 100% |
| `body` | 2,100 px | 51x51 | (181,515) | 100% |
| `body` | 2,100 px | 51x51 | (286,515) | 100% |
| `leg_l` | 2,100 px | 51x51 | (600,541) | 100% |
| `mane` | 2,100 px | 51x51 | (278,245) | 100% |

**manticore/fledgling**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (320,520) | 100% |
| `arm_r` | 2,100 px | 54x65 | (212,510) | 100% |
| `body` | 2,100 px | 54x65 | (212,510) | 100% |
| `body` | 2,100 px | 51x51 | (320,520) | 100% |
| `leg_l` | 2,100 px | 51x51 | (675,530) | 100% |
| `leg_r` | 2,100 px | 51x51 | (530,540) | 100% |

**manticore/mythic**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (321,531) | 100% |
| `body` | 2,100 px | 51x51 | (219,524) | 100% |
| `body` | 2,100 px | 51x51 | (321,531) | 100% |
| `leg_l` | 2,100 px | 51x51 | (673,541) | 100% |
| `leg_r` | 2,100 px | 51x51 | (529,551) | 100% |

**manticore/radiant**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (322,517) | 100% |
| `arm_r` | 2,100 px | 51x51 | (221,509) | 100% |
| `body` | 2,100 px | 51x51 | (221,509) | 100% |
| `body` | 2,100 px | 51x51 | (322,517) | 100% |
| `leg_l` | 2,100 px | 51x51 | (673,527) | 100% |
| `leg_r` | 2,100 px | 51x51 | (529,537) | 100% |

**manticore/sworn**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_l` | 2,100 px | 51x51 | (326,534) | 100% |
| `arm_r` | 2,100 px | 52x53 | (227,526) | 100% |
| `body` | 2,100 px | 52x53 | (227,526) | 100% |
| `body` | 2,100 px | 51x51 | (326,534) | 100% |
| `leg_l` | 2,100 px | 51x51 | (669,543) | 100% |
| `leg_r` | 2,100 px | 51x51 | (529,553) | 100% |

**unicorn/fledgling**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 1,408 px | 85x33 | (181,397) | 98% |
| `head` | 3,728 px | 71x80 | (159,87) | 96% |
| `head` | 517 px | 45x23 | (309,93) | 96% |
| `head` | 219 px | 22x19 | (494,362) | 97% |
| `head` | 184 px | 20x13 | (224,81) | 100% |
| `mane` | 372 px | 25x22 | (181,396) | 100% |
| `mane` | 160 px | 14x13 | (224,81) | 100% |

**unicorn/mythic**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 2,089 px | 61x61 | (635,415) | 100% |
| `body` | 1,555 px | 45x38 | (242,408) | 100% |
| `head` | 914 px | 51x42 | (267,251) | 100% |
| `horn` | 716 px | 35x24 | (332,327) | 100% |
| `horn` | 470 px | 17x34 | (255,316) | 100% |

**unicorn/radiant**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `arm_r` | 104 px | 8x13 | (206,494) | 100% |
| `body` | 2,101 px | 51x51 | (430,395) | 100% |
| `body` | 2,100 px | 51x51 | (681,415) | 100% |
| `body` | 447 px | 22x33 | (212,389) | 100% |
| `body` | 396 px | 18x33 | (190,380) | 100% |
| `body` | 359 px | 37x22 | (527,365) | 100% |
| `body` | 104 px | 8x13 | (206,494) | 100% |
| `head` | 2,100 px | 59x50 | (253,167) | 100% |
| `head` | 447 px | 22x33 | (212,389) | 100% |
| `head` | 396 px | 18x33 | (190,380) | 100% |
| `head` | 359 px | 37x22 | (527,365) | 100% |
| `horn` | 346 px | 27x36 | (178,213) | 96% |
| `horn` | 95 px | 15x9 | (183,261) | 97% |
| `horn` | 76 px | 13x12 | (372,113) | 97% |
| `horn` | 75 px | 13x8 | (324,109) | 96% |
| `horn` | 66 px | 13x9 | (324,101) | 97% |
| `horn` | 64 px | 11x9 | (360,104) | 98% |
| `mane` | 66 px | 10x12 | (394,412) | 100% |

**unicorn/sworn**

| part | fragment | bbox | at | duplicated |
|---|---|---|---|---|
| `body` | 2,100 px | 51x51 | (682,405) | 100% |
| `body` | 91 px | 15x10 | (262,405) | 100% |
| `head` | 2,100 px | 55x50 | (244,162) | 100% |
| `mane` | 64 px | 10x12 | (435,495) | 100% |

