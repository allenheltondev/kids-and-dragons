# Matchups: who is good at what, and who is bad at what

> **Status.** Design and contract. Types are in
> [`matchups.ts`](../packages/shared/src/types/matchups.ts); values go in `content/rules.json` under
> `matchups`. The pieces below are built in parallel; each names the files it owns.

Before matchups, every class could handle every monster the same way, and species were a flat +1 and a
once-a-fight trick. Nothing made a table look at a foe and say "we need the Starweaver for this one", and
nothing made a hero worse at anything. Matchups give the game small, readable reasons to choose, and a
reason to decide whether to fight at all.

## Rules of the design

1. **A matchup is a roll bonus or penalty of 1 or 2**, never a lock. Hidden gates stay as they are. A bad
   matchup is a worse roll, so a fight can be lost and walking away is a real choice.
2. **Every one is a sentence a child can say out loud.** "Bramble Wall makes thorny things think twice."
   "Wolves trust unicorns." No stacking arithmetic: at most the numbers the table can add in its head, and
   the log names each one.
3. **The field guide is where you learn them; the TV only reminds.** The guide shows a creature's traits,
   who it likes and dislikes, and who is good against it. The TV shows a three-to-five word hint at the
   start of a fight and a short callout when one moves a roll.
4. **Gemfall is pinned.** `rules.matchups.exemptCampaigns` lists campaigns that play with matchups off, byte
   for byte. Gemfall is on it. The gameplay digests in `gemfall-compat.test.ts` must not move, and no
   Gemfall file changes.
5. **Pros come with cons.** Every species has at least one edge for and one edge against. No class is best
   against everything.

## The four parts

### 1. Monster traits

A creature has up to two **traits** (`TraitId`): `thorny`, `skittish`, `armored`, `flier`, `swarming` and
so on, defined in `matchups.traits` with a name, icon, field guide sentence and TV hint. Canon owns them:
`canon/creatures.yaml` gets `encounter.traits`, `tools/canon/bestiary.ts` projects them into
`content/bestiary.json`, and `resolveEnemy` copies them onto `EnemySpec.traits` like it does stats.

A trait does nothing by itself. **Edges** (below) say which abilities are strong or weak against it.

### 2. Likes and dislikes move the dice

Canon already says which kinds a creature likes and dislikes, and some of those are playable species
(`of: character.dragonling`). Those become `EnemySpec.likes` / `dislikes`, projected into the bestiary.
`matchups.opinion` sets the numbers:

- A creature **swings at a hero it likes with a lower roll** ("it holds back") and **at one it dislikes
  with a higher roll** ("it singles them out").
- A **check scene** that `discovers` or `cast`s the creature rolls **higher for a liked species and lower
  for a disliked one**.

### 3. Species drawbacks

Each species gets edges that are minuses as well as plusses. These are **contextual**, not stat changes:
nothing in `resolveCharacter` changes. They are `MatchupEdge`s with `hero.species` set:

| Species | Good at | Worse at |
|---|---|---|
| Unicorn | healing, calm creatures | foes that are `armored` (a horn glances off), force checks |
| Dragonling | force, `flier`s (can reach them) | sneak checks (smoke), `skittish` foes (they bolt) |
| Griffin | `flier`s, climbing, scouting | `armored` foes in a straight fight (light bones) |
| Bigfoot | force, `armored`, holding the line | sneak checks, `swarming` foes (too big to catch them all) |
| Kitsune | `charm`, tricks, `skittish` foes | force checks, `armored` foes |
| Manticore | pounce on `skittish`, climb | `thorny` foes (the pounce lands in them) |

These are a first tuning, to be playtested. The agent building them may change a row if the story reads
better; keep one plus and one minus per species.

### 4. Class and species pairings

Edges may name both `hero.class` and `hero.species`. A Thornguard bigfoot's Brace is steadier; a
Starweaver kitsune's Glimmer reaches farther in the dark. A pairing is always a plus. They make a species
and class feel chosen together and are also the "why this class" for a table.

Class edges (no species) cover the combat roles: Burst, Shove, Bramble Wall, Tanglelight, Vanish and so on
are strong or weak against particular traits.

## The engine

`packages/shared/src/matchups.ts` (new) owns all of it. The rest of the code calls it and never reads
`rules.matchups` directly.

```ts
/** Matchups are on unless the campaign is exempt. */
export function matchupsOn(rules: RulesContent, campaignId: string | null): boolean;

/** Every note moving this swing: edges, then opinions. Pure. */
export function attackNotes(rules, hero: HeroKind, foe: FoeKind, abilityId: string): MatchupNote[];
export function defendNotes(rules, hero: HeroKind, foe: FoeKind): MatchupNote[];
export function checkNotes(rules, hero: HeroKind, scene: { tags?: string[]; creatures?: ... }): MatchupNote[];

/** For the field guide and the creation sheet. */
export function edgesForHero(rules, hero: { species: SpeciesId; class: ClassId }): MatchupEdge[];
export function edgesAgainst(rules, traits: TraitId[]): MatchupEdge[];

/** For the TV at the start of a fight: the few that matter, strongest first. */
export function fightHints(rules, state: EncounterState): FightHint[];
```

`HeroKind` is `{ species, class }`. `FoeKind` is `{ traits, likes, dislikes }`. The combat engine gets the
hero's species and class onto the `Combatant` (new optional fields, absent in exempt campaigns so
persisted fights and Gemfall are unchanged). `EncounterContext.matchups?: MatchupRules` is the switch: set
by the server when `matchupsOn`, absent otherwise.

Applied in `applyEffect`'s `attack` case (roll and damage, both directions) and in the check resolution in
`engine.ts`. Each applied note becomes an `EncounterEvent` of type `matchup` (new), so the log, TV and
phone show "Bramble Wall is strong here!" next to the roll. `resolveCheck` for check scenes does the same
through the existing roll event path.

## Presentation

- **Field guide** (main place): a creature page gets a **Fighting it** section (traits, who it likes, who
  it dislikes, who is good against it, a "to fight or not to fight" line). A species or class page gets
  **Good at** and **Watch out**. Written once, from `edgesAgainst` / `edgesForHero` and canon.
- **TV**: at the start of a fight, up to three hint chips from `fightHints` ("Thorny: Burst works well").
  During play a callout beside the roll when a matchup applied.
- **Phone**: the same chips on the hero's own sheet in the fight, plus the matchup noted on the check
  prompt (a small badge, "Sneak: Bigfoot is loud").
- **Creation**: the species and class cards show their best and worst, in words.

## Checks

A `CheckScene` may carry `tags` (keys of `matchups.checkTags`). Existing chapters have none, so nothing
changes for them. A small first pass tags the Riftlight spine checks where the tag is plain. Tags are
mechanical, never shown as story text.
