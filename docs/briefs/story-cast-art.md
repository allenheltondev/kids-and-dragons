# Brief: figures for the story cast, and places for the story to happen

**Status:** open. For the image-generation agent (Codex). This brief is the complete
specification for the art half of the "story feels flat" fix. The code half is already in:
scenes carry a `cast`, the TV stands those characters opposite the party, and the
narration sits on a plate under the stage instead of over it (`content/README.md` "Who is
on stage", `packages/client/src/world/cast.ts`).

You are drawing **character figures** (Part A) and then **location backdrops** (Part B). You
are not changing game code. You will change exactly two kinds of non-art file: `assets/manifest.json`
(declaring what you add) and the `cast` / `art` fields of `content/chapters/*.json` (pointing scenes
at it).

---

## 1. Why

A play-test found the story flat: when the party met a new character, the screen did not
change. Scenes now cast who is present, and 419 of 672 scenes have someone on stage. But they
can only use figures that already exist, so:

- **Grown-ups of the party's own species are drawn as children.** Great-Gran Ashby, the oldest
  dragonling grandmother in the realm, stands on stage as a fledgling dragonling. So do the
  MossHome archivists (bigfoot), Elder Sefa (manticore) and the Elder Unicorn.
- **Named individuals are generic.** Madame Coralie Fenn is famous for her barrel on wheels;
  on stage she is the plain merfolk figure. Pellam the Skywarden clerk is a picture of a whole
  Skywarden squad. Mother Thrum, one ford witch, is the Witch Order group of three.
- **Some people cannot be shown at all** (section 7), so their scenes look like nobody is there.
- **Places do not change.** Gemfall 1 has 46 scenes, from a lighthouse to a noodle stall to a
  caravan yard, all in front of the same Exchange skyline.

---

## 2. Read first

- `docs/asset-brief.md` §2 (style: register, form, colour, face, pose) and §6.4 (the entity
  contract you are extending). Every rule there applies unless this brief says otherwise.
- `assets/entities/*/assembled.png`: the house style for non-player figures. Match it.
- `assets/characters/<species>/fledgling/assembled.png`: the playable species. An adult or elder
  of a species must be unmistakably the **same species**: same anatomy, markings and palette
  family, older and bigger.
- `docs/campaigns/gemfall-illustrations.md`: how the six existing scene backdrops were made and
  recorded. Part B follows it.
- Run `npx playwright test -c <config> e2e/cast-shot.spec.ts` (header explains) to see figures on
  a TV and a phone exactly as players will.

---

## 3. Part A: the figure contract

Every figure is `assets/cast/<id>/assembled.png`, declared in `assets/manifest.json`
`castFigures`:

```json
{ "id": "coralie_fenn", "name": "Madame Coralie Fenn", "basis": "merfolk", "scale": "medium" }
```

- `basis`: the entity id or species id the character is one of (`verify.py` checks it exists).
- `scale`: one of the entity scale words (`tiny` … `colossal`). `medium` stands as tall as a hero.

The image:

| Rule | Value |
|---|---|
| Canvas | 1024 × 1024 RGBA, real transparency, sRGB, ≥ 8px clear margin (same as entities) |
| Feet | lowest opaque row within 12px of **y = 900** (the canvas origin). `verify.py` fails it otherwise. A figure that hovers (a bathtub? no; a will-o-wisp, yes) is the exception; say so in the PR. |
| Fill | the figure fills the canvas height like every entity does; `scale` alone sets on-stage size |
| Facing | **three-quarter view facing left.** The cast stands on the right of the stage, facing the party on the left. |
| Contents | one character, complete, no ground shadow, no props cut by the canvas edge. Their defining prop is part of the figure (Fenn's barrel, Ashby's walking stick, Pellam's ledger). |
| Pose | standing, relaxed, readable silhouette; mid-gesture is fine. Not attacking, not frightened. |
| Text | none. No lettering on ledgers, signs or sashes. |

Then point the content at it: in every `content/chapters/*.json` scene whose `cast` contains that
character's **name** (listed below; find them with
`grep -n '"name": "Pellam"' content/chapters/*.json`), change `figure` to `cast/<id>` and leave
`name` exactly as it is. If the figure's `scale` is not `medium`, also set `"size"` on those cast
entries to the same word. Change nothing else in the chapter files.

### Acceptance for every figure

1. `npm run art:verify -- <id>` green (canvas, alpha, margin, basis, feet).
2. `npm run content:validate` green.
3. `npm run art:portraits` re-run if you add portraits; not required for cast figures.
4. A TV and a phone screenshot from `e2e/cast-shot.spec.ts` of one scene the figure is in,
   in the PR body, beside the old stand-in. **The PR is reviewed from these pictures.**

---

## 4. Part A, order of work

**Pilot first: `coralie_fenn`, `great_gran_ashby`, `pellam`. Then stop** and open the PR. One
recurring individual from each kind of gap: a distinctive prop, an elder of a playable species,
one person standing in for a group picture. Do not start the rest until the pilot is approved.

After approval, one PR per group in the table below, in order.

### A1. Elders and adults of the party's own species (the most visible mismatch)

| id | name(s) in content | basis | scale | look |
|---|---|---|---|---|
| `great_gran_ashby` | Great-Gran Ashby | dragonling | medium | the oldest dragonling grandmother; brisk and tender; taps things with a walking stick; faded scales, shawl |
| `grandmother_tull` | Grandmother Tull | dragonling | medium | dragonling bell-keeper grandmother with the night bell; cosy, brisk |
| `dragonling_grandmother` | Grandmother | dragonling | medium | gate-town grandmother; spectacles on a chain, tally book and pencil; hugs first, inspects later |
| `mosshome_archivist` | Archivist | bigfoot | large | brisk adult bigfoot archivist; knotted cords on her belt; fussy about feet |
| `oldest_archivist` | Oldest Archivist | bigfoot | large | very old, very slow bigfoot; a bird lives in his beard; box of knot-cords |
| `mosshome_eldest` | The Eldest | bigfoot | large | mild MossHome elder holding a cup of moss tea |
| `mosshome_runner` | MossHome Runner | bigfoot | medium_to_large | cheerful, out of breath, mid-jog; bundle of knotted cords over one shoulder |
| `flood_warden` | Flood-Warden | bigfoot | large | MossHome bigfoot in very tall boots holding a jar of mosslight |
| `elder_sefa` | Elder Sefa | manticore | large | elderly manticore pride elder; tail curled carefully away; formal and kind |
| `elder_unicorn` | Elder Unicorn | unicorn | large | older unicorn; calm, frowns with her ears; saddlebags |
| `tamsin` | Tamsin Three-Cards | kitsune | medium | kitsune card-sharp in a tall hat, three cards fanned, twitchy tails |

### A2. Recurring named individuals

| id | name(s) in content | basis | scale | look |
|---|---|---|---|---|
| `coralie_fenn` | Madame Coralie Fenn, Madame Fenn | merfolk | medium | merfolk gem-buyer riding a barrel on wheels; little green book; cheerful, waving |
| `tidewell` | Professor Tidewell | selkie | medium | selkie scholar, ink on both elbows, soggy notes, owl-feather clasp on her coat |
| `mortar` | Mortar | stone_troll | very_large | stone troll noodle cook with a huge ladle and pot; very still |
| `gullet` | Gullet | frogfolk | small_to_medium | frogfolk ferrywoman with a long pole and a hat covered in carved notches |
| `old_ossley` | Old Ossley | frogfolk | small_to_medium | very old frogfolk ferryman in a very old hat; long pauses |
| `old_lintel` | Old Lintel | stone_troll | very_large | toll troll, mostly moss, half a bird's nest on his shoulder, one palm out flat |
| `hesper` | Hesper Longstride | centaur | large | centaur caravan master; sash stitched all over with roads |
| `marda_thorn` | Marda Thorn | centaur | large | grey-dappled centaur innkeeper with an apron |
| `tobble` | Tobble Reedpipe | faun | medium | faun cobbler mid-song, laces over one arm |
| `hob` | Hob Thistledown | faun | medium | faun field foreman waving his hat |
| `nan_rummage` | Nan Rummage | boggart | small | boggart with an armful of lost things (mittens, a teapot lid, an umbrella) |

### A3. One person, currently a group picture

These need a canon call before you draw, see section 7: which people each one is. Draw them
once the PR that owns this brief records the answer here.

| id | name(s) in content | basis | look |
|---|---|---|---|
| `pellam` | Pellam | skywardens | Skywarden bridge clerk with a huge ledger and a pen; dry and precise |
| `captain_voss` | Captain Voss | skywardens | Captain Orla Voss; rigid, honest, never wastes a word |
| `brask` | Engineer Brask | skywardens | engineer, a pencil behind each ear and a forgotten third |
| `holloway` | Sergeant Holloway | skywardens | supply sergeant in silver and violet with a neat ledger |
| `mother_thrum` | Mother Thrum | witch_order | ford witch; pointed hat, spectacles; bell charms |

For the pilot, `pellam`: draw him as one of the peoples already shown in
`assets/entities/skywardens/assembled.png`, in that uniform, and record the choice in the PR.
Allen confirms or redirects at review.

Where the content uses the group as a group ("Skywardens", "Warden Engineers"), leave it.

---

## 5. Part B: places

Separate PRs, after Part A's pilot is approved. Follow `docs/campaigns/gemfall-illustrations.md`
exactly: 1920 × 1080 WebP, quality ~88, `assets/scenes/gemfall/<id>.webp`, listed in
`manifest.sceneIllustrations`, wired with the scene's `art` field, prompts recorded in that doc.

**The composition rule changed.** Backdrops used to sit behind a gradient of text. Now:

- The **bottom ~40%** of the screen is under the narration plate on a TV. Nothing important there.
- The **floor line** where figures stand is about **55–65% down** the image. Keep it open and level
  across the full width: the party stands on the left half, the cast on the right.
- The **landmark** goes in the **top half**, framed so the figures do not cover it.
- **No characters, creatures or people** in a backdrop. The cast system puts them on stage, and a
  painted Mortar behind a drawn Mortar is two Mortars.
- No lettering, UI or border.

Start with Gemfall 1 (46 scenes, one backdrop today). Group its scenes by place:

| id | scenes |
|---|---|
| `exchange-lighthouse` | scene_lighthouse |
| `exchange-docks` | scene_night_docks, scene_docks, check_rumours, scene_boggart, scene_three_rumours |
| `exchange-noodle-stall` | choice_why_north, scene_motive_* (6) |
| `empty-chair-tavern` | scene_tavern, scene_scholar_believed, scene_scholar_theory, rest_empty_chair |
| `exchange-quay` | choice_ember, choice_ember_sell_high, scene_sold, scene_kept, scene_gutter_glint, scene_nobody_claims |
| `outfitters-steps` | scene_market, scene_market_*, check_haggle, scene_laced, scene_lace_tangle |
| `caravan-yard` | scene_caravan_yard, scene_caravan_yard_*, check_signon, scene_hired, scene_turnip_wagon |

Check each scene's narration before wiring it: if the text says they are somewhere else, leave it
on the biome. Then propose the same grouping for the next flattest chapters (gemfall-03a, 03c,
04a, 04c, 05a: no scene art at all) in that PR's description, and do them one chapter per PR.

---

## 6. What you must not change

| Path | Rule |
|---|---|
| `assets/entities/**`, `assets/characters/**` | never modified; they are the references |
| `content/chapters/*.json` | only `cast[].figure`, `cast[].size` (Part A) and scene `art` (Part B) |
| `packages/**`, `schemas/**`, `tools/**` | not at all. If the contract is wrong, say so in the PR. |
| existing `assets/scenes/**` | not replaced |

---

## 7. Open canon questions (Allen answers, not the illustrator)

These people appear in many scenes and have no figure because nothing says **what they are**.
Do not draw them until this section records the answer.

- **The Deep Hollow Cult**: Hessa Wren, Wend, Hollis, the soup women, the choir. In about 30
  scenes across Gemfall 3c–8, the most of any missing group. Painted bark masks, soup ladles.
  Which peoples are members?
- **Prospectors, drovers, caravan masters, carters, the crying gem-buyer, Dunmore, Ma Ruddle,
  Tib**: the gold-rush crowd. Species never stated, and the realm has no humans.
- **The Brassbuckle Expedition** (six in matching brass hats), **Clerk Pennywhistle**, the
  **talking beech tree**, the **cart driver's donkey**.
- **The Skywardens and Mother Thrum** (section 4, A3): which people each individual is.

---

## 8. Reporting

Each PR: the figure list with ids, `basis`, `scale`, the verify output, the before/after
screenshots, and the prompts used (append to `docs/campaigns/gemfall-illustrations.md` under a
new "Cast figures" heading).
