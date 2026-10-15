# Brief: figures for the story cast, and places for the story to happen

**Status:** open. For the image-generation agent (Codex). This brief is the complete
specification for the art half of the "story feels flat" fix. The code half is already in:
scenes carry a `cast`, the TV stands those characters opposite the party, and the
narration sits on a plate under the stage instead of over it (`content/README.md` "Who is
on stage", `packages/client/src/world/cast.ts`).

You are drawing **character figures** (Part A), **location backdrops** (Part B), and
**designing the peoples the story needs but canon does not have yet**, lore and figure both
(Part C). Where this brief says "you decide", you do: make the call, write down why in the PR,
and the review will push back if it disagrees. You are not changing game code beyond the one
lookup table section 6 names.

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
- **Some people cannot be shown at all**, because canon never says what kind of creature they
  are: the Deep Hollow Cult, the whole gold-rush crowd of prospectors, drovers and caravan
  masters, and a few more (Part C). Their scenes look like nobody is there.
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

Part C's lore-only proposal PR (section 6) may be opened alongside the pilot: they review
independently.

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

You decide which people each of these is. The Skywardens are a mixed order
(`assets/entities/skywardens/assembled.png` shows several peoples in one uniform) and the Witch
Order is a learned role open to any people (`canon/npcs.yaml`, `npc.witch_order`). Pick what
suits each personality, keep the order's uniform or trappings, record the choice and the reason
in the PR, and set `basis` to the order (`skywardens`, `witch_order`).

| id | name(s) in content | basis | look |
|---|---|---|---|
| `pellam` | Pellam | skywardens | Skywarden bridge clerk with a huge ledger and a pen; dry and precise |
| `captain_voss` | Captain Voss | skywardens | Captain Orla Voss; rigid, honest, never wastes a word |
| `brask` | Engineer Brask | skywardens | engineer, a pencil behind each ear and a forgotten third |
| `holloway` | Sergeant Holloway | skywardens | supply sergeant in silver and violet with a neat ledger |
| `mother_thrum` | Mother Thrum | witch_order | ford witch; pointed hat, spectacles; bell charms |

Where the content uses the group as a group ("Skywardens", "Warden Engineers"), leave it.

The same freedom applies anywhere a stand-in above looks wrong to you once drawn (the agents who
cast these scenes assumed, for example, that the MossHome runner and the Eldest are bigfoot,
because MossHome is a bigfoot town). If you think a character is a different people, say so in the
PR and draw them as that.

---

## 5. Part B: places

Separate PRs, after Part A's pilot is approved. Follow `docs/campaigns/gemfall-illustrations.md`
exactly: 1920 × 1080 WebP, quality ~88, `assets/scenes/gemfall/<id>.webp`, listed in
`manifest.sceneIllustrations`, wired with the scene's `art` field, prompts recorded in that doc.

**The composition rule changed.** Backdrops used to sit behind a gradient of text. Now:

- On a TV the stage raises the painting so its floor meets the feet, which puts roughly the bottom
  fifth of the image under the narration plate, and crops a little off the top. Nothing important
  in either.
- The **floor line** where figures stand is **80% down the image**. The stage lines that row up
  with the figures' feet wherever the text plate puts them (`BACKDROP_FLOOR` in
  `packages/client/src/world/scene.ts`), so a painting whose ground is elsewhere makes everyone
  float or sink. The walkable band should run from about 70% to the bottom. Keep it open and level
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

## 6. Part C: the missing peoples, lore and figures

[`story-cast-missing.md`](story-cast-missing.md) lists every character the chapters put on stage
who has no figure, with their scenes. Most are missing because **canon has no people for them**:

- **The Deep Hollow Cult** (`faction.deep_hollow_cult` in `canon/factions.yaml`): Hessa Wren,
  Wend, Hollis, the soup women, the masked choir. About 30 scenes across Gemfall 3c–8, more than
  any other gap. Painted bark masks, soup ladles, humming crystals on strings.
- **The gold-rush crowd**: prospectors, drovers, caravan masters, carters, gem-buyers, Dunmore,
  Ma Ruddle, Tib (a small one in an orange hat who talks to ponies as equals).
- **The Brassbuckle Expedition** (six Burrowfolk in matching brass hats; the scout and
  recordkeeper represent them on stage), **Clerk Pennywhistle**, the
  **talking beech tree**, and the **working animals** (the cart driver's donkey, mules, ponies).

**You decide what each of them is.** For each group, either:

1. **Assign an existing people** (`canon/npcs.yaml` `people_ids`, or a playable species) when one
   genuinely fits the role and canon's homelands. The gold rush draws travellers from everywhere,
   so a mixed crowd is plausible; or
2. **Design a new people** when none fits, or when the realm visibly lacks a kind of person the
   story keeps needing. The play-test asked for this: the world should have more peoples in it,
   not only more costumes on the same ones.

Rules for a new people, all from canon's own `agent_instructions` (read them in `canon/npcs.yaml`):

- **No humans.** The realm has none; that is a fixed design decision.
- **No people is a villain.** The Deep Hollow Cult is a *faction*, a learned allegiance of kind,
  sincere, misguided folk, and its members must come from more than one people, the way the Witch
  Order's do. Do not invent a "cult species".
- **Family-friendly, age 8**, in the house style of `assets/entities/` (asset-brief §2).
- Distinct from every existing people in silhouette and palette. Check against the contact sheet
  (`npm run art:sheet`).
- The Exchange has no native people; a new people has a homeland elsewhere, chosen from the
  biomes in `assets/manifest.json`.

What a new people needs, in one PR per people:

| File | What |
|---|---|
| `canon/npcs.yaml` | a full `npcs[]` entry with every field the existing ones carry (`id: npc.<id>`, `asset_id`, `title`, `canon_status: newly_defined`, `classification`, `sapience`, `scale`, `short_description`, `visual_identity`, `common_story_uses`, `canon_constraints`, `speech_register`, `standard_behavior`, `lore`, `relationships`), and the id added to `people_ids`. Write the `lore` as well as centaur's or selkie's: where they come from, what they are known for, why they are on the road in a gold rush. |
| `content/field-guide.json` | regenerate it: `npm run canon:field-guide` (never hand-edit) |
| `assets/entities/<id>/assembled.png` | the figure, on the entity contract (asset-brief §6.4), facing left |
| `assets/entities/<id>/portrait.webp` | `npm run art:portraits` |
| `assets/manifest.json` `entities[]` | `id`, `classification`, `primaryBiome`, `canonicalLocations`, `scale` |
| `packages/client/src/world/cast.ts` `ENTITY_SIZES` | one line, `<id>: "<scale>"`; `cast.test.ts` fails until it matches the manifest. The only code you touch. |
| `content/chapters/*.json` | `cast` entries for that people's characters in the scenes the appendix lists, plus `discovers: ["npc.<id>"]` on the scene where the party first meets one |

Named individuals who need their own look (Hessa Wren, Tib, Ma Ruddle) then follow Part A's
contract as `assets/cast/<id>/` figures with `basis` set to their people.

**Order:** open a first, lore-only PR that proposes the whole set: for each group in the appendix,
the existing people you assign or the new people you design, with its draft `canon/npcs.yaml`
entry and one concept image per new people. That PR is where the decisions get reviewed, so
make the case for each. Then one PR per people for the figures and wiring.

Acceptance for every Part C PR: `npm run canon:check`, `npm run canon:field-guide` (no diff left
after it), `npm run art:verify`, `npm run content:validate`, `npm test`, and the before/after
screenshots from section 3.

---

## 7. What you must not change

| Path | Rule |
|---|---|
| `assets/entities/**`, `assets/characters/**` | existing figures are never modified; they are the references. You add new entity directories. |
| `content/chapters/*.json` | only `cast` (Parts A and C), scene `art` (Part B) and `discovers` for a new people (Part C) |
| `canon/*.yaml` | add entries; never rewrite an existing people's lore |
| `packages/**`, `schemas/**`, `tools/**` | not at all, except the `ENTITY_SIZES` line in Part C. If the contract is wrong, say so in the PR. |
| existing `assets/scenes/**` | not replaced |

---

## 8. Reporting

Each PR: the figure list with ids, `basis`, `scale`, every "you decide" call with its reason,
the verify output, the before/after screenshots, and the prompts used (append to `docs/campaigns/gemfall-illustrations.md` under a
new "Cast figures" heading).
