# `content/` — the game as data

Rules, items, campaigns, and chapters are JSON, not code. Adding content never requires a deploy of
game code (roadmap, "Content as data"). Everything here is validated in CI by
`npm run content:validate`, because **a malformed chapter must fail the build, never the play
session** ([architecture §5](../docs/architecture.md#5-chapter-schema)).

```
content/
  rules.json                     species, classes, stats, levels, tiers   → RulesContent
  abilities.json                 what abilities do on the board           → AbilityCatalog
  items.json                     the item catalog, keyed by itemId        → ItemCatalog
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
species, a flag gate, an item gate, item grants, a quest item, a branch that reconverges, and — the
one that matters — **a failed roll that keeps the story going.** If a renderer handles this chapter,
it handles anything.

## Conventions the schema cannot state

- **Icons are short slugs** (`fist`, `wing`, `eye`, `spark`, `hand`, `flame`, `key`, …), never file
  paths. The client resolves a slug to an inline SVG, so every element gets an icon (spec §11).
  One slug namespace covers rules, choices, and items alike, so there is exactly one icon lookup
  in the client.
- **A scene with an empty `choices` array ends the chapter.** The `Chapter` type has no terminal
  marker, and this is the only representable one. `rest_lanternfall` is that scene here, which
  matches spec §6.1 — Rest *is* the end-of-session beat. Every chapter needs at least one, and every
  other scene must lead somewhere; the validator enforces both.
- **`items.json` carries no `$comment` key.** It is a bare `Record<itemId, ItemDef>` and anything at
  the top level is treated as an item. Comments for it live here.
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
