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
  world.json                     where every place is on the realm map    → WorldMap       (generated)
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

## Gemfall is the campaign; Bramblewood is the fixture

`campaigns/gemfall.json` is the authored main arc — eight beats, sixteen files, routed by road
and by pursuit — and it is what the lobby launches. Its wiring is
[docs/campaigns/gemfall-authoring.md](../docs/campaigns/gemfall-authoring.md). Two things it uses
that the reference chapter below does not:

- **Flags that outlive a chapter.** Only members of a campaign's `routeSets` cross the chapter
  boundary, so every fork a later chapter reads — the road, the pursuit, what the party did with
  the Harvest Stone — is declared there, even the ones that select no chapter. `content:validate`
  lets a chapter gate on those without setting them itself, and refuses any path that sets two
  members of one set (the engine would quietly keep neither).
- **Text and choices that depend on the party.** `when` on a choice, `variants` on a scene or
  branch, and the `{facets}` / `{party}` tokens. `content:validate` fails a bad flag, item,
  range, token, or overlapping `replace`. The patterns (absence, scaling, callbacks with a
  fallback, party size) are in
  [gemfall-authoring.md §5](../docs/campaigns/gemfall-authoring.md#5-writing-for-the-party-you-have).
- **Costs that cost.** A party purse (`grantCoins` / `spendCoins`, gated by `when.coins`) and
  `takeItem` for the cake that was shared or the supper thrown to the wolves. A choice that
  spends or takes without a matching gate fails `content:validate`. See
  [gemfall-authoring.md §3](../docs/campaigns/gemfall-authoring.md#coins-and-food-are-real).
- **Facets as quest items.** Quest items outlive the chapter that grants them, which is what makes
  a collection collectable.

## Ordered campaigns and graph campaigns

Gemfall is an **ordered** campaign: its next chapter is chosen by chapter `index` (and, at a routed
beat, by flag), and it stays that way. A campaign that declares a `graph` — named places, the ways
between them, revisits, several endings — is a **graph** campaign instead, and its next chapter is
chosen by edge. That contract is
[docs/campaigns/graph-campaigns.md](../docs/campaigns/graph-campaigns.md). None ships yet; the
illustrative one is a test fixture outside `content/`. A campaign's mode is part of its identity, so
turning an existing campaign into a graph is a new campaign id, never an edit.

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

- **Player-facing text uses US spelling** (color, gray, traveled, center, defense, realize, mom,
  cozy). `tools/content/spelling.test.mjs` scans narration, labels, prompts, names, descriptions,
  and `variants[].text` in chapters, the generated JSON here, and `canon/*.yaml`, never ids, and
  fails naming file, line, field, and the fix. Exceptions: "Sunbloom Draught", "afterwards".
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

## Field Guide tags: `discovers`

Any scene (story, check, choice point, rest, encounter) may carry `"discovers": ["creature.embermoth", "npc.pib"]` —
canon ids that the Field Guide fills in when the party enters that scene. Valid ids are exactly the keys of
`entries` in `content/field-guide.json` (`creature.*`, `biome.*`, `location.*`, `character.*`, `npc.*`,
`individual.*`, `faction.*`; features and routes are not in the guide). `npm run content:validate` fails with the
chapter and scene named if an id is unknown or repeated within a scene.

Two things are discovered **without** a tag, by `packages/shared/src/discoveries.ts`: the chapter's `biome`
(when the chapter starts) and every `creature` in an encounter's `enemies` (when the fight's scene is entered).
Tag only what those rules miss.

Guidance:

- Tag a thing when the scene lets the kids actually **meet** it (see it, talk to it, stand in it), not when it is
  merely mentioned in passing narration.
- Do not tag protected mysteries: if the story withholds what something is, leave it out until the scene that
  reveals it.
- Tag the scene where the meeting happens, not an earlier one that only foreshadows it.

## Who is on stage: `cast`

A story, check, choice-point or rest scene may say who is standing there with the party. The shared
screen draws them opposite the heroes, the heroes turn to face them, and they walk in when they arrive
and out when the story leaves them behind. Without it, meeting a selkie professor looks exactly like
reading about one.

```json
"cast": [
  { "figure": "entities/selkie", "name": "Professor Tidewell" },
  { "figure": "characters/dragonling", "name": "Grandmother Tull", "size": "small" }
]
```

- `figure` is a path under `assets/`: `entities/<id>` (a creature or people's figure),
  `characters/<species>` (that playable species' fledgling art, for NPCs of the party's own kinds), or
  `cast/<id>` (a named character's own figure, `assets/cast/<id>/assembled.png`). `npm run
  content:validate` fails, naming the expected file, if the art is not there.
- `name` is the nameplate (32 characters at most). Omit it for an unnamed creature.
- `size` defaults to the entity's `scale` in `assets/manifest.json`, or `medium` (a hero's height).
- Three at most, and never a party member.

Guidance:

- Cast who is **physically there and part of the moment**. Not who is mentioned, remembered, far away,
  or a crowd in the background. Same rule as `discovers`, applied to every scene they stand in rather
  than only the first.
- **Keep figure and name identical across consecutive scenes.** The stage keys a cast member on the
  pair, so the same pair stays put while a changed one walks off and a "new" one walks on.
- `discovers` and `cast` are different facts and often sit together: the scene where the kids first
  meet Mortar discovers `npc.stone_troll` and casts Mortar; the next four scenes only cast him.
- Characters who still stand in for a generic figure (Tidewell as `entities/selkie`) are listed in
  [`docs/briefs/story-cast-art.md`](../docs/briefs/story-cast-art.md), which commissions their own.
