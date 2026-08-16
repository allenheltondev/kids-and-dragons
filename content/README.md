# `content/` — the game as data

Rules, items, campaigns, and chapters are JSON, not code. Adding content never requires a deploy of
game code (roadmap, "Content as data"). Everything here is validated in CI by
`npm run content:validate`, because **a malformed chapter must fail the build, never the play
session** ([architecture §5](../docs/architecture.md#5-chapter-schema)).

```
content/
  rules.json                     species, classes, stats, levels, tiers   → RulesContent
  abilities.json                 what abilities do on the board           → AbilityCatalog
  items.json                     the item catalog, keyed by itemId        → ItemCatalog   (generated)
  bestiary.json                  canon's creatures, ready for a board     → Bestiary       (generated)
  campaigns/<id>.json            a story arc, listing its chapters        → Campaign
  chapters/<id>.json             one ~30-minute sitting                   → Chapter
  maps/<id>.json                 encounter boards — rows + spawn points   → EncounterMap
schemas/
  rules|abilities|items|chapter|campaign|map.schema.json     JSON Schema, draft 2020-12
```

## Authoring XP

Three campaigns take a character from creation to Mythic, one tier each ([spec §8.1](../docs/spec.md#81-leveling)).
Because campaigns run 4–8 chapters, the number to author against is the **campaign total**, not the
per-chapter award — a four-chapter campaign simply uses larger ones.

| Campaign | Levels | Total XP across its chapters | Roughly, per chapter |
|---|---|---|---|
| 1st | 1 → 4 (**Sworn**) | ~700 | 100 for the first, ~150 after |
| 2nd | 4 → 7 (**Radiant**) | ~1900 | ~300 |
| 3rd | 7 → 10 (**Mythic**) | ~3700 | ~600 |

Two rules that keep the pacing a promise rather than an average:

- A **setback** ending pays half, and **bonus objectives** are capped at 25% of `xpAward`. Together
  those hold a campaign within about 25% of its intended total, which moves a tier by at most one
  chapter.
- Aim the tier to land **one chapter before the campaign's finale**, so the climax is played as the
  new thing rather than rewarded with it.

The first chapter of the first campaign is special: award 100, so level 2 arrives at the end of the
very first sitting.

The TypeScript types in `packages/shared/src/types/` are the contract. The schemas are kept in
lockstep with them; **where the two disagree, the TS types win** and the schema is the thing that
needs fixing.

## The Bramblewood chapter is reference content

`campaigns/the-hollow-crown.json` and `chapters/bramblewood-01.json` are **the engine's reference
content, not the authored campaign.** Allen hand-writes the first real chapter himself, deliberately,
to learn what the format needs ([roadmap Chapter 3](../docs/roadmap.md#chapter-3--first-playable-)).
This one exists so that the loader, the schema validator, the scene renderer, and the dice have
something valid and complete to run against before that happens.

It is deliberately a superset of what one chapter normally uses: every non-combat scene type
(`story`, `check`, `choice_point`, `rest`), one `encounter`, species-gated choices for all six
species, a flag gate, an item gate, item grants, a quest item, a branch that reconverges, bonus
objectives, and — the one that matters — **a failed roll that keeps the story going.** If a renderer
handles this chapter, it handles anything.

It carries **two** rest scenes, and the difference between them is the point. `rest_lanternfall`
ends the chapter; `rest_mossbank` is a waypoint the party passes through on every route out of the
shrine. A banked stat point can only be spent at a Rest scene *while the run is still in play*
(`prepareStatPointSpend` refuses one outside `phase: "scene"`), so a chapter whose only rest is its
ending gives a levelled character nowhere to spend what they earned. Any real chapter wants at least
one of each.

Its two objectives watch `scouted_the_path` and `made_a_doorway` — flags the chapter already sets
from optional choices, because spec §8.2's rule is that an objective is *pointed at* a `setFlag` and
never given a mechanism of its own. Their 15 + 10 is exactly the 25%-of-`xpAward` ceiling, so the
shared budget is exercised rather than left with slack in it.

What it still does **not** have is a **setback ending** (spec §8.2). Every route through it
succeeds, so the halved award, the setback counter, and — through that counter — campaign failure
and the souvenir it leaves behind are all unreachable in play, though each is built and unit-tested.
Whoever writes the first authored chapter should give it an ending that declares
`"outcome": "setback"`; it is one key on one terminal scene.

## Conventions the schema cannot state

- **Icons are short slugs** (`fist`, `wing`, `eye`, `spark`, `hand`, `flame`, `key`, …), never file
  paths. The client resolves a slug to an inline SVG, so every element gets an icon (spec §11).
  One slug namespace covers rules, choices, and items alike, so there is exactly one icon lookup
  in the client.
- **A scene with an empty `choices` array ends the chapter.** The `Chapter` type has no terminal
  marker, and this is the only representable one. `rest_lanternfall` is that scene here, which
  matches spec §6.1 — Rest *is* the end-of-session beat. Every chapter needs at least one, and every
  other scene must lead somewhere; the validator enforces both. Note what follows: a rest scene with
  choices is a waypoint and a rest scene without them is the ending, so the *same scene type* means
  two different things depending on one array. `rest_mossbank` and `rest_lanternfall` are both here
  so a renderer cannot pass by handling only one of them.
- **`items.json` and `bestiary.json` are generated — do not edit them.** Both are projections of
  `canon/*.yaml`, which is the source of truth ([canon contract](../docs/canon-contract.md)). Run
  `npm run canon:items` / `npm run canon:bestiary`; CI regenerates and fails on any diff. They carry
  a `$comment` saying as much, and `$`-prefixed keys are not items — `itemCatalog()` in
  `@kad/shared` is the one place that rule is written down.
- **An item is authored in one of two places, and the test is ownership.** The world owns a
  honeycake, so it lives in `canon/items.yaml` with a `mechanics` block. One chapter owns the rusted
  key that opens its own door, so it lives in that chapter's `props` (D7). Both project into
  `items.json`, because a quest item outlives the chapter that granted it and an inventory screen
  still has to name it — so the ids may not collide, and the generator refuses it if they do.
- **A chapter names its monsters; it does not restate their stats.** `"creature": "will_o_wisp"` is
  the whole spec, and the loader fills `count`, `name`, `art` and the five numbers from
  `bestiary.json`. Writing a stat is an *override* and means it; writing one that merely repeats
  canon's own value is a validation failure, because that is the duplication this replaced.
- **Trinkets stay small on purpose.** +1 to a stat, +1 step, +2 max HP, one reroll per encounter —
  and nothing bigger, ever. The level-up transformation is the reward the game is built around and
  no item may compete with it (spec §9.3).
- **`levelXp` holds the nine thresholds *above* level 1.** `levelXp[n]` is the total XP needed to
  reach level `n + 2`, and the cap is `levelXp.length + 1`. That is what `levelForXp()` and
  `maxLevel()` in `packages/shared/src/rules.ts` implement, and it is why the array does not start
  with a `0` — a leading zero would hand every character level 2 for free.
- **XP is a chapter award.** `xpAward` is the payout; the single `grantXp` in the reference chapter
  is a small exploration bonus, kept small so that exploring and talking stay worth about as much as
  fighting (spec §8.1).
