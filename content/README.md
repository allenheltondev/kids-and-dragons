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
  help.json                      the words behind every "?" and long-press → HelpContent   (#256)
  campaigns/<id>.json            a story arc, listing its chapters        → Campaign
  chapters/<id>.json             one ~30-minute sitting                   → Chapter
  maps/<id>.json                 encounter boards — rows + spawn points   → EncounterMap
schemas/
  rules|abilities|items|chapter|campaign|map|help.schema.json  JSON Schema, draft 2020-12
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
illustrative ones are test fixtures outside `content/`. A campaign's mode is part of its identity, so
turning an existing campaign into a graph is a new campaign id, never an edit.

**Writing one?** Start with the
[graph campaign authoring guide](../docs/campaigns/graph-campaigns-authoring.md): step by step from
an empty file to a green build, with the Continental Rift vertical slice (#203) as the worked example
and the checklist a graph campaign has to pass before review.

Tooling for a campaign graph (all read-only; the ordered campaigns are skipped, not inspected):

- `npm run content:validate` — parses the declaration and lints it (unreachable places, dead ends,
  softlocks, rifts that strand a party).
- `npm run content:proofs` — the same check, recording each clean walk of the route search in
  `content/graph-proofs/<campaign>.json`. The search takes seconds (Riftlight walks over a hundred
  thousand states), so the server trusts a proof that matches the content it loads instead of
  walking at every start (`packages/shared/src/graph-proof.ts`). Changing a graph campaign's
  `graph`, `routeSets` or any flag its chapters set makes the proof stale, and
  `content:validate` fails until you run this and commit the proof. Prose edits do not.
- `npm run content:journey -- --campaign <file-or-id>` — an outline of the places, doors and
  endings; `--format mermaid|dot|json` for a diagram or script-ready data; route coverage (what is
  reachable, the shortest way to each ending, what a used-up door leaves behind, where a party can
  get stuck); `--playtest` / `--walk` / `--path` to drive the real runtime and check its invariants;
  `--save file.json` to check a stored journey. See
  [Inspection and playtest tooling (#202)](../docs/campaigns/graph-campaigns.md#inspection-and-playtest-tooling-202).
- `npm run content:graph` is a *chapter*-level tool and is unchanged by any of this.
- `npm run content:continuity` sweeps every campaign file, a graph campaign by its places and ways
  (what every way into a place guarantees, and what each way's gate proves); see
  [Continuity in a graph campaign](../docs/campaigns/graph-campaigns-authoring.md#continuity-introduce-before-you-use).

## Environmental encounters (#201)

An encounter scene may carry an `environment`: a visible rift clock, hazard tiles, timed exits, a
captive to free and monsters the rift moves — plus `onEscape` / `onTimeout` branches for the
endings those make possible. Only the practice uses it (an exit to walk to and a captive to help out of the mud; see "The practice" below), and a scene without it fights
exactly as before. Everything happens where a figure **stops** (turn ends) or as a round starts,
never mid-move. `npm run content:validate` checks the tiles against the scene's map (open ground,
off the party's spawns, reachable) and that exactly the right extra branches are present. The
contract, with a worked sandbox chapter, is
[Environmental combat (#201)](../docs/campaigns/graph-campaigns.md#environmental-combat-201).

Guidance:

- Say the rule in the labels: "The rift closes", "Rift fire", "The tear in the air" — the phone
  builds "The rift closes in 2 rounds" and "stopping on it costs 2 hearts" from them.
- Make every way out a real choice with a price: an exit that opens late, a captive away from it,
  fire on the short path. Write the consequence into the branch (`setFlag`, variants) or the
  rescue's `effects`; a graph campaign turns those flags into world facts with `onComplete`.

## The practice

`campaigns/first-steps.json` and `chapters/first-steps-01.json` are the practice (#255): one short
chapter, offered in the lobby while any seated hero is new, that teaches by doing. The server never
plays it as a campaign (no attempt, no claim, no XP, nothing carried) and marks every seated hero
`practiced` when it ends; that wiring is
[architecture §4.5, "The practice"](../docs/architecture.md#the-practice-255). The content rules,
held by `tools/content/first-steps.test.mjs`:

- **It teaches in order, by doing:** pick a choice, roll a check, take a story turn, move on the
  board, use a card, help a knocked-down friend, rest. Each step is a scene where the party does
  the thing, and that scene carries one `hint`, on every path.
- **A `hint`** is one or two sentences of what to tap, in the game's voice: "This is the board. On
  your turn, tap a gold square to walk there." The shared screen shows it under the narration and
  reads it after it; the phone shows it with a button that reads it again. It is never narration,
  so the recap never sees it. Only the practice has hints: a real chapter trusts
  the table to know the game.
- **Nothing costs anything.** `xpAward` is 0, no objectives or props, and no `damage`, item,
  coin or XP effects. Every failed roll and every lost fight goes on to the same next step, and
  every fight branch heals the party, because HP outlives a scene and a hero knocked down in one
  fight would otherwise start the next one down. The captive has no deadline and nothing can drag
  her away.
- **Help Up is played, not described.** The Bun fight carries `friendDown: true`: with two or more
  heroes seated, the one after the story-turn holder starts that fight knocked down, and the others
  stand beside them and play the real Help Up card. At a table of one there is nobody to help, so
  nobody goes down; Bun (a captive with no deadline) is the lesson there, and is in the fight for
  everybody. Only the practice may use `friendDown`.
- **It is short.** About 15 minutes, so a mixed party is not slowed down much: the 30-scene bar in
  [gemfall-authoring.md §4](../docs/campaigns/gemfall-authoring.md#4-shape-of-a-chapter) is for a
  real evening's chapter, not this. Its fights are the only ones in a shipped chapter with an
  `environment` (an exit to walk to, Bun to help out of the mud), because those are the lessons.

## Help (#256)

`help.json` is what a kid reads, and hears, when they tap "?" on a screen or press and hold a card, a
buff or an item, and the one line on the shared screen that says how to join. It is content so a fix
is an edit here and not a code change. Write it for a child of eight listening to an adult read it
off the TV:

- **One or two short sentences** per entry (at most 28 words), US spelling, no em dashes.
  `npm run content:validate` checks the sentence count, the dashes and the length.
- **`surfaces`** has one entry for every place a player can be looking: story, combat, sheet,
  inventory, map, guide, world, creation. A new surface is a new id in `HELP_SURFACE_IDS`
  (`packages/shared/src/help.ts`) and a new entry here; `help-coverage.test.tsx` fails until both
  exist, and fails again if a screen declares a `data-surface` it does not know.
- **`things`** says what a card, a buff and an item are. A held thing shows its own words first (an
  item's `text`, a card's summary) and these only when it has none.
- **`join`** is the line under the room code and QR. It must be true of a four-letter family room and
  a six-letter visitor room, so it never says how many letters.
- `icon` is an icon id from the shared icon set; a test checks that it exists.

## Priority scenes

Some scenes carry the story and most do not. A non-combat scene (`story`, `check`, `choice_point`,
`rest`) may say so with `priority`:

| | Means | Example | On the shared screen |
|---|---|---|---|
| `1` | A **revelation** — the campaign turns on what the party learns here. | Gemfall's `scene_whole_truth`: the gemstones are a seal, and the seal holds a titan under Mount Red Sky. | A gold **Remember this!** ribbon, a gilded plate, gold words that land slowly. |
| `2` | A **clue** — worth noticing, but the story survives a party that skims it. | Bramblewood's `scene_stone_words`. | A quieter **A clue** ribbon. |

Leave it off everywhere else, which is nearly everywhere: a p1 that turns up every few scenes
stops meaning anything. As a rule of thumb, a chapter has at most one p1 on any path through it.

What it does beyond the look:

- **The ribbon is said aloud** ahead of the narration, so a listener gets it too.
- **The end-of-chapter recap retells every p1 the party walked through**, once each and in its
  own words (variants and `{tokens}` resolved), so the table hears the revelation again before
  they go to bed.

Put the fact in the narration itself, in plain words. The ribbon tells the room to pay attention;
it cannot tell them what to pay attention to.

## The chapter's goal

Every chapter says what the party is trying to do, and the table can see it the whole time
(#356). `goal` is one sentence in kid words and two to four steps:

```json
"goal": {
  "text": "Show you can hold the dragon's leash.",
  "steps": [
    { "id": "ledger", "label": "Get the wardens' ledger", "flag": "got_the_ledger" },
    { "id": "chord", "label": "Learn the choir's chord", "flag": "learned_the_chord" },
    { "id": "answer", "label": "Find a true answer", "flag": ["answered_true", "answered_kind"] }
  ]
}
```

- **It shows itself.** The shared screen draws it under the chapter's name, on the sky above the
  figures; every phone draws it under the hero's strip as one line (the goal and its pips) that a
  tap opens to the steps. Nobody has to tap to see it. In a fight the shared screen folds it to the
  goal and a row of pips in the top corner, and the phones leave it off so the fight's cards have
  the room. On a short pane (a tablet at the largest text)
  it keeps the pips and names only the next step. Read-aloud says the goal after the first scene's
  story; a tick is seen and chimed, never read out.
- **A step ticks when its flag is set**, or any one of a list. It is the same machinery as a bonus
  objective: author a `setFlag` where the thing visibly happens and point the step at it. A step
  may watch an `item` instead, while anybody holds it, when the chapter already hands one over for
  the thing (07l's ledger): one of the chapter's own `props`, given with `grantQuestItem`, so it
  cannot arrive already held or be refused at a full bag. The tick
  gets a moment on screen (a gold box, a few sparks and a chime; under reduced motion, the gold
  only).
- **Every step is on the spine.** `content:validate` refuses a step that some path to a success
  ending can finish without ticking, naming the step and an ending that proves it. A failed roll is
  a path: word the step for what every party does ("Race for the caravan's stone") and tick it on
  both results, never for the success only some get. Set the flag on
  a scene every road walks, on each road's own result scene, or on every branch of a check or
  fight (a failed roll still did the thing). `optional: true` lifts the rule and draws "(if you
  can)"; use it rarely. An optional step is an extra: the goal shows done when its required steps
  are, the pips count the extras apart, and a short pane's "Next" never names one.
- **Chapter-local flags only.** A route-set member can arrive already set from an earlier chapter,
  so the validator refuses one. Never put the flag on an ending scene: the chapter is over by then.
- **Written for scene 1.** It is on screen before anything has happened, so it names nothing the
  party has not met on every way in, counts nothing, names no great stone and spoils nothing. One
  sentence, at most 90 characters; labels at most 40, no full stop. US spelling, no em dashes.
- **Spread the ticks.** The first a quarter of the way in, the last near the end. A step that ticks
  in scene 1 tells the table nothing.
- Only a chapter that is nothing but its ending (a preview's pause) goes without one.

## Interactivity

The table should be playing, not only listening. Four rules, and the two numbers
`npm run content:pacing` reports for each chapter's spine (the shortest path to a success ending):

- **The goal is clear in scene 1.** The entry scene says what the party is here to do.
- **Never more than about three scenes in a row without something to decide.** The `read` column
  is the longest such run: scenes that are not a vote (two or more visible choices), a check or a
  fight. One-button beats and the ending count as reading. The section under the table names the
  scene each spine's longest run starts at.
- **Most spine checks are things the party does, not says.** The `doing` column counts them. A
  check's kind comes from its stat (`might`, `quick` and `clever` are doing; `heart` is
  talking) unless the check overrides it, for the times the stat misleads:

  ```json
  { "type": "check", "stat": "clever", "checkKind": "talking", "prompt": "Talk the troll out of his riddle!" }
  ```

- **New people arrive with a stake for the party.** The scene that introduces someone says what
  they want from the party, or what they can do for it.

Both numbers are a reading list, never a gate: the `!` marks under the table say where to look.
They read the spine only; a typical path's `read` in the table can run longer, so glance at it
too. Bare `npm run content:pacing` lists the Gemfall chapters; `npm run content:pacing -- --chapter ""`
lists every shipped chapter, and `--chapter bramblewood-` any one prefix.

## "Last time…" and "Where you left off"

Before a chapter's first scene the shared screen shows, and reads aloud, a short "Last time…"
built from the route-set flags the party carried in (#357). Each line is authored in the campaign
file, under `lastTime`:

```json
"lastTime": {
  "opener": "A brand new adventure starts tonight...",
  "lines": {
    "route_river": "You picked the River Road, east toward the crossing.",
    "ember_kept": { "holding": "facet_ember", "text": "...still in your pack...", "otherwise": "...not in your pack now." }
  }
}
```

- A campaign with `routeSets` needs `lastTime`, with **one line for every member** and no other
  key (`content:validate`). A party carrying none hears the `opener`.
- `lines` is in **story order**; the screen reads the newest four a party carries, then the
  chapter's goal ("Your goal: ..."), then the first scene's story. The goal is not read again
  after the story.
- A line that names a great stone reads the inventory: `{ holding, text, otherwise }`. A plain line
  may not name one. Never count the party, and in Gemfall no em dashes.
- Write each line so it is true for **every** way a party could have earned the flag (a road can
  be re-set by a later chapter; `funded_the_break` has four setters).

A screen that comes back partway (a resumed room, a reload, a phone back at the table) shows
"Where you left off": the goal, its ticks, and the first sentence of each of the last three scenes
the run walked. A scene whose words have variants or a `{token}` is passed over, so nothing is
quoted that differs by party. Nothing to author for it.

## Story plates: the prologue and chapter plates

A campaign can open with paintings and the story told over them, before the table is asked to
decide anything. Full spec, with the art: [docs/story-plates.md](../docs/story-plates.md).

```json
"prologue": { "plates": [ { "art": "plates/riftlight/prologue-1", "narration": "The Exchange is..." } ] }
```

in the campaign file (3 to 6 plates, before the opening chapter's first scene), and in a chapter
to establish its setting and immediate situation (both Gemfall and Riftlight use one for every
later chapter, including road and pursuit variants):

```json
"plate": { "art": "plates/riftlight/finale", "narration": "You are back on the glacier..." }
```

- Each narration is **at most 45 words**, **the same for every party**: no `{token}`, no counting
  the party, no great stone, no em dash. A chapter plate sets the place and a concrete starting
  situation, without named introductions, solutions or outcomes. Creatures and unnamed local
  helpers may appear when the chapter opens with them. It must read true for every route in.
- A prologue introduces and raises the question; it never answers it, and in a sequel it never
  says how the last campaign ended.
- Every `art` is declared in `assets/manifest.json` → `storyPlates.ids`, and nothing else is
  (`tools/content/story-plates.test.mjs`). The opening chapter takes the prologue **or** a plate.
- A plate whose painting has not shipped is left out when the story plays, so content can land
  before its art. `npm run art:inventory` lists what is owed.
- On a graph campaign, `npm run content:proofs` after adding one.

## The Story page (#358)

The adventure book's Story page lists each chapter a household has played in a campaign: its
goal's sentence, its priority-1 scene in the scene's own words, the `lastTime` lines for the
route-set flags that chapter decided, and the first sentence of the ending it closed on. Nothing
to author for it; it reads what is already here, so it is only as good as those are:

- A p1 scene and an ending are read later, away from the table, against the items the party held
  when each was shown: the engine keeps the bag a p1 scene's words read as it first opens
  (`RunState.revealHeld`), and an ending is read with the bag the chapter closed with. A variant
  whose `when` asks only `item`, `notItem` or `count` is read as it was; one that asks a flag, the
  purse or the party's size is left out, since those are gone by then. `{party}` reads "you". So
  the base narration of a p1 scene or an ending should stand on its own.
- An ending's first sentence (or two, when the first is a word or two) is all of it that is
  shown, so make it say where the party ended up.

## Class places (#311)

A class's room (the Dojo, the Academy, the Rookery, the Conservatory:
[docs/class-mastery.md §2](../docs/class-mastery.md)) is a scene that says which class it teaches:

```json
"dojo": {
  "type": "story",
  "narration": "The teacher has held the same door shut against the wind for forty years.",
  "classPlace": "thornguard",
  "choices": [{ "id": "back", "label": "Back to the square", "icon": "back", "goto": "rest_square" }]
}
```

While the scene is open, every seated hero who is not already that class may switch to it. Each
kid answers alone on their phone ("Be a Thornguard" or "Stay a Songkeeper", and a switch asks
"are you sure?"); there is no vote. The scene's own choices wait until every connected hero who
could switch has answered, and the shared screen shows who switched. A switch changes the worn
class and nothing else: stats stay, every class keeps its rank, and a failed campaign puts back
the class worn when it began.

- **`story` or `choice_point` only, never an ending, one class per scene.** `content:validate`
  refuses an unknown class, any other scene type, and a class place with no way on.
- **Gemfall has none.** It is pinned, and `content:validate` refuses one there.
- **Introduce the teacher on every visit.** A graph campaign's places can be reached in any order,
  so the room cannot lean on an earlier one (§2 of the design).
- **Enter it from a `rest` scene and come back to it.** The room is a side room, not a stop on the
  way: put it off the rest, never on the spine.

## The fitting stall (#312)

The Exchange's fitting stall ([docs/class-mastery.md §1](../docs/class-mastery.md)) lets a **new**
hero, one who has finished no chapter and not used it yet, swap class once, for free, to any class.
It is not a scene field: `rules.json` says where it stands and what the shared screen says there.

```json
"fittingStall": {
  "stands": [{ "chapterId": "gemfall-01", "sceneId": "scene_prologue_city" }],
  "keeper": "Madame Tuck",
  "narration": "Just inside the market gate is a fitting stall... The tailor is a frogfolk named Madame Tuck."
}
```

When a party with at least one new hero enters a scene it stands in, it runs exactly like a class
place: each new hero answers alone on their phone, and the scene's choices wait for every connected
one. A party with nobody new never sees it.

- **Where a campaign opens, at the Exchange.** A `story` or `choice_point` scene in a chapter with
  `index` 1, never an ending and never a class place; `content:validate` refuses the rest.
- **A scene whose only way on is one plain choice.** The way on waits for every new hero, so a vote
  or a gated choice there would be a decision the stall sits on; `content:validate` refuses both.
- **Introduce the keeper in `narration`.** The phone names her (`keeper`) only after the shared
  screen has.
- **It is shown in Gemfall**, so its words keep Gemfall's rules: US spelling, no em dash
  (`content:validate` checks the dash), never count the party.
- **Gemfall's files stay pinned.** Naming a Gemfall scene here changes no Gemfall file and re-takes
  no hash.

## The Bramblewood chapter is reference content

`campaigns/the-hollow-crown.json` and `chapters/bramblewood-01.json` are **the engine's reference
content, not the authored campaign.** Allen hand-writes the first real chapter himself, deliberately,
to learn what the format needs ([roadmap Chapter 3](../docs/roadmap.md#chapter-3--first-playable-)).
This one exists so that the loader, the schema validator, the scene renderer, and the dice have
something valid and complete to run against before that happens.

It is deliberately a superset of what one chapter normally uses: every non-combat scene type
(`story`, `check`, `choice_point`, `rest`), one `encounter`, species-gated choices for all six
species, a flag gate, an item gate, item grants, a quest item, a branch that reconverges, bonus
objectives, a revelation and a clue (`priority` 1 and 2), and — the one that matters — **a failed
roll that keeps the story going.** If a renderer handles this chapter, it handles anything.

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

`npm run content:cast` reports prose that names a known manifest cast figure, entity or
chapter-local nameplate without a matching figure in that scene's cast. Use
`-- --chapter bramblewood-01` to filter by chapter ID prefix, or `-- --json` for findings with
the source text and field location. It also reads check prompts, choice labels, variants and
branch narration, skips encounters (which draw their own enemies), and marks scenes already
at the three-entry cap. This is advisory, like `content:pacing`: memories, remote speakers,
conditional variants and generic roles can all produce candidates that should stay uncast.
It matches complete names and singular entity IDs with spaces in place of underscores or
hyphens; it does not infer nicknames, plurals, pronouns, presence on later scenes, or missing art.
Read every scene before editing; a clean report is not proof of complete casting.

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
- Every figure stands at its **true height** beside the party (canon `height_cm`, or `heightCm` on a
  `cast/` figure in `assets/manifest.json`), so a teapot-sized sprite is a sixth of a faun and a troll
  towers over both. A big guest shrinks the stage a little (never below 85% of true size); a huge one
  overflows the frame instead: a dragon stands on the ground and runs off the top, a cloud whale runs
  off the right, with its name kept on screen. Overflow direction comes from the art's shape, or from
  `figureOverflow` in `assets/manifest.json`.
- `size` is only for when *this* character is not the usual size for their figure: a faun child
  (`"small"` on `entities/faun`), a manticore cub. It moves the figure's height to the nearest point
  inside that band, so a size that restates the figure's own band changes nothing. Leave it off
  otherwise.
- `stance` overrides how the figure occupies the scene: `standing` (feet on the ground), `hovering`
  (lifted a little, bobbing), `flying` (lifted further, drifting) or `swimming` (the ground line is a
  water line hiding the lower body). Defaults to the figure's canon stance. A griffin landed in one
  scene and in flight in the next.
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

## A rift in view: `rift` (#401)

A story, check, choice-point or rest scene may say a rift is standing in front of the party. Every
screen then draws the painted tear (`rift_neutral`) on the floor line, in the gap between the party
and the cast, or just past the party when nobody else is there. It is the same colourless shimmer on
the TV and every phone: a scene's rift has no rules of its own, so there is no Riftlight to read in
it. The colours belong to the journey graph's rift edges, and only the lobby's list of ways on
shows them, on a Starweaver's phone.

```json
"quay":    { "type": "choice_point", "rift": "steady",   "narration": "Two stacks of crates lean toward a thin fold in the air." },
"shimmer": { "type": "story",        "rift": "open",     "narration": "The fold opens." },
"through": { "type": "story",        "rift": "collapse", "narration": "Behind you the fold pinches shut." }
```

- Around the tear the stage draws a deep hole, a soft mist, a still arch line and two rings that turn
  opposite ways, standing on the ground like a doorway. They only turn: nothing ripples, spirals,
  breathes or flickers, because those are the Riftlight rules' own patterns and this shimmer must not
  teach one.
- `"steady"`: the rift is there, shimmering.
- `"open"`: it unfolds once as the scene opens, with the `rift-open` cue, then shimmers.
- `"collapse"`: it folds shut once as the scene opens, with the `rift-collapse` cue, then is gone.
- Under reduced motion nothing unfolds or folds: an opening rift is simply there, a collapsing one
  simply gone.
- Never on a fight: the schema refuses it there, because the board draws its own ground.

Guidance:

- Tag the scenes where the narration puts the rift **in front of the party**, the way `cast` is for
  who is physically there. A rift only mentioned, remembered, sealed behind ice or left behind is not
  in view.
- **Tag every scene it stays in view for**, not only the one that introduces it, or it blinks out and
  back as the story moves on. Mark `"open"` and `"collapse"` on the scene where the narration says it
  happens, and leave the rift off the scenes after it has gone.
- A backdrop never paints the rift (Riftlight art brief, Part C): this is what draws it.
- The stage draws one tear. A scene with a pair of folds (the whale road) shows one and says two.
