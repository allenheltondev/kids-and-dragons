/**
 * Chapter format — docs/architecture.md §5.
 *
 * A chapter is one JSON file, authored offline, validated in CI, and served as
 * a static asset. A malformed chapter fails the build, never the play session.
 */

import type { ItemDef, SpeciesId, StatId } from "./domain.js";

export type SceneId = string;

/** Who receives a granted item. */
export type GrantTarget = "roller" | "party" | (string & {});

export type Effect =
  | { type: "grantItem"; itemId: string; to?: GrantTarget }
  | { type: "grantQuestItem"; itemId: string }
  | { type: "damage"; amount: number; to?: GrantTarget }
  | { type: "heal"; amount: number; to?: GrantTarget }
  | { type: "grantXp"; amount: number }
  | { type: "setFlag"; flag: string; value?: boolean };

export interface Branch {
  goto: SceneId;
  effects?: Effect[];
  /** Optional narration override shown before the transition. */
  narration?: string;
}

export interface Choice {
  id: string;
  label: string;
  icon: string;
  goto: SceneId;
  /**
   * Hidden — not greyed out — when nobody in the party matches.
   * See architecture §5.
   */
  requiresSpecies?: SpeciesId | SpeciesId[];
  requiresFlag?: string;
  requiresItem?: string;
  effects?: Effect[];
}

/**
 * How a chapter ended — spec §8.2. Success pays the full `xpAward`, a setback
 * pays half, rounded down.
 *
 * Absent means `"success"`, and that is load-bearing rather than lazy: every
 * chapter authored before setbacks existed ends successfully, and none of them
 * should have to be edited to keep doing so.
 *
 * A setback is not a loss screen and not a retry. Play simply ended at that
 * ending, the same way a failed check or a party wipe branches rather than
 * stops (§6.1, §7.3).
 */
export type ChapterOutcome = "success" | "setback";

/**
 * An optional objective that pays a bonus to the whole party or to nobody —
 * never to an individual, because uniform party XP is what keeps everybody
 * transforming on the same evening (spec §8.2, "Why XP is never individual").
 *
 * It rides on the flag machinery that already exists: author a `setFlag`
 * effect wherever the thing happens, and point `flag` at it. There is
 * deliberately no second way to say "the party did the thing".
 */
export interface ChapterObjective {
  id: string;
  /** Shown on the completion screen, so it reads as a sentence to an 8-year-old. */
  label: string;
  /** Paid when this run flag is set at the moment the chapter completes. */
  flag: string;
  /**
   * Bonus XP for the whole party. The objectives of one chapter may total no
   * more than 25% of its `xpAward` (spec §8.2) — enforced at authoring time by
   * tools/content/validate.mjs and clamped again in the engine.
   */
  xp: number;
}

export interface StoryScene {
  type: "story";
  art?: string;
  narration: string;
  onEnter?: Effect[];
  choices: Choice[];
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  outcome?: ChapterOutcome;
}

export interface CheckScene {
  type: "check";
  art?: string;
  stat: StatId;
  tn: number;
  prompt: string;
  narration?: string;
  onEnter?: Effect[];
  /** Which player rolls. Default: the party picks. */
  roller?: "party" | "active" | "best";
  onSuccess: Branch;
  onFailure: Branch;
}

export interface ChoicePointScene {
  type: "choice_point";
  art?: string;
  narration: string;
  onEnter?: Effect[];
  /** Party votes; ties broken by the active turn marker. spec §6.1. */
  choices: Choice[];
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  outcome?: ChapterOutcome;
}

export interface RestScene {
  type: "rest";
  art?: string;
  narration: string;
  onEnter?: Effect[];
  /** Heals the party by this much on entry. */
  heal?: number;
  choices: Choice[];
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  outcome?: ChapterOutcome;
}

export interface EnemySpec {
  id: string;
  name?: string;
  count: number;
  /**
   * The canon creature this is one of — its `asset_id` in `canon/creatures.yaml`
   * (docs/canon-contract.md D9).
   *
   * Canon owns what a creature *is* and what it is worth in a fight; this is the
   * thread back to it. Before the field existed the only link was the `art`
   * string by convention, so a chapter could quietly disagree with canon about
   * how much HP a bramblewisp has and nothing would notice.
   *
   * **The stats below are resolved from it**, not copied beside it. A chapter
   * authors `{ "id": "wisp", "name": "Bramblewisp", "creature": "will_o_wisp" }`
   * and the content loader fills the rest from `content/bestiary.json`
   * (`resolveEnemy` in bestiary.ts) — so retuning the `skirmisher` band is an
   * edit to `content/rules.json` and nothing else.
   *
   * This interface describes the **loaded** chapter, which is why every stat is
   * required: `setup()` should never wonder whether a monster has HP. The
   * authored shape, where they are optional, is `AuthoredEnemySpec`, and it is
   * what `schemas/chapter.schema.json` validates.
   *
   * Overriding is still allowed — a chapter that wants a weakened wisp says
   * `"hp": 4` and means it — and an override that merely restates canon's own
   * number is refused, because that is the duplication this replaced.
   */
  creature?: string;
  hp: number;
  guard: number;
  /**
   * Initiative, on the same scale as a character's Quick (§7.2 — highest first,
   * rerolled each encounter).
   *
   * Authored rather than inferred from `guard`. Deriving the two from one
   * number makes armour and speed the same dial, which quietly forbids a whole
   * archetype: a heavily-armoured brute would necessarily act *first*, and a
   * slow tank could not be written at all. The Bramblewisp is the other end of
   * the same bug — 5 steps and a low guard would have made the fastest thing in
   * the chapter the last to move.
   */
  quick: number;
  steps: number;
  attack: number;
  art?: string;
}

/**
 * A battle map — `content/maps/<id>.json`, referenced by `EncounterScene.map`.
 *
 * Terrain is ASCII on purpose: `.` open, `#` blocked, one character per tile,
 * one string per row. It is the only representation a person can author, review
 * in a pull request, and eyeball for "is this actually playable" without a tool
 * — and `grid.ts`'s `parseBoard()` already reads exactly this shape.
 *
 * Spawns are authored rather than derived because the engine refuses to guess a
 * formation (see `EncounterSetup`). `EnemySpec.count` is expanded against
 * `enemySpawns` in order, so a map decides where a fight starts and the chapter
 * decides what is in it.
 */
export interface EncounterMap {
  id: string;
  /** 8 rows of 10 characters — the board in spec §7.1. */
  rows: string[];
  /** Where the party stands. At least three; §7.1 seats three players. */
  partySpawns: { x: number; y: number }[];
  /** At least four, the most enemies §7.1 allows. Consumed in order. */
  enemySpawns: { x: number; y: number }[];
}

export interface EncounterScene {
  type: "encounter";
  map: string;
  art?: string;
  narration?: string;
  onEnter?: Effect[];
  enemies: EnemySpec[];
  onVictory: Branch;
  /** Never a game over — the story branches. spec §7.3. */
  onDefeat: Branch;
  /**
   * The chapter-4 gate. The engine's combat is built and tested, but until the
   * phones grow a combat UI (docs/briefs/combat-rendering.md) a fight is a
   * scene nobody can tap — the table dead-ends with the state advanced and
   * nothing to press. A scene carrying this resolves straight through
   * `onVictory` (the pre-combat placeholder behavior, now opt-in per scene
   * and authored in content rather than hardcoded in the engine). Turning a
   * fight on is deleting one line of JSON, chapter by chapter, as the UI
   * lands.
   */
  autoResolve?: "victory";
}

export type Scene =
  | StoryScene
  | CheckScene
  | ChoicePointScene
  | RestScene
  | EncounterScene;

export type SceneType = Scene["type"];

/**
 * The scenes that can be a chapter's ending, and therefore the only ones whose
 * `outcome` is ever read.
 *
 * A chapter ends at a scene with nowhere left to go, and the only representable
 * way to say that is an empty `choices` array (content/README.md) — so a check
 * or an encounter can never be one, since both always carry two branches. A
 * chapter may have several endings, which is exactly why the outcome is
 * declared on the scene rather than on the chapter: spec §8.2 wants "which
 * endings are setbacks" to be authored, not inferred.
 */
export type EndingScene = StoryScene | ChoicePointScene | RestScene;

export interface LlmHints {
  tone: string;
  vocabulary: string;
  forbidden: string[];
  /**
   * Chapter-scoped characters — D8's other half, and the counterpart to
   * `props` above.
   *
   * The wisp who speaks in rhyme and the very embarrassed door exist because
   * this chapter happened. When it ends they are gone, and that is the correct
   * outcome; nothing in the Realm is poorer for it.
   *
   * A character the *world* has goes in `canon/individuals.yaml` instead, and
   * the test is whether a place would miss them. Pib keeps Bramblewood's
   * hedges, so Pib is canon; the door is not. `canon/individuals.yaml` states
   * the rule, and `individual.home` being required is what enforces it.
   */
  npcVoices?: Record<string, string>;
}

export interface Chapter {
  id: string;
  campaignId: string;
  /**
   * Position within the campaign, 1-based.
   *
   * **Not unique.** A story beat that happens in three different countries is
   * three chapter files at the same index — see `route` below — because the
   * party tours eight chapters through a corpus of sixteen.
   */
  index: number;
  title: string;
  biome: string;
  estimatedMinutes: number;
  xpAward: number;
  entry: SceneId;
  scenes: Record<SceneId, Scene>;
  /** Optional bonus objectives, spec §8.2. Absent is the normal case. */
  objectives?: ChapterObjective[];
  /**
   * Items this chapter brings into the world and the world does not otherwise
   * have — D7's chapter-scoped props.
   *
   * The rusted key that opens *this* chapter's door is a consequence of the
   * chapter, not a fact about the Realm, and putting it in `canon/items.yaml`
   * would claim otherwise. It still needs mechanics, so it is authored here,
   * beside the door it opens.
   *
   * "Scoped" describes where it is *authored*, not how long it lasts. A quest
   * item granted in chapter one is still on the character in chapter three,
   * and an inventory screen that could not name it would be a bug — so
   * `content/items.json` is generated from canon **and** every chapter's
   * `props`, and the catalog the game reads is one flat namespace. The
   * generator refuses a prop that collides with a canon item or with another
   * chapter's prop, which is what keeps that namespace honest.
   */
  props?: Record<string, ItemDef>;
  /**
   * Which member of a routed index this is, if the index is routed.
   *
   * A campaign whose middle branches has several chapters per beat: the same
   * beat, a different country, chosen by something the party did earlier.
   * Gemfall's chapters 3-5 are triples keyed on the road out of Bramblewood,
   * and its chapter 7 is a triple keyed on the pursuit the party has been
   * playing toward — different axis, same mechanism, which is why the set is
   * named rather than assumed.
   *
   * This is a chapter *variant*, not a scene branch, and the difference is
   * load-bearing: `biome` drives backdrop, palette and music, so three roads
   * through three countries cannot be one file however clever the graph is.
   *
   * Absent means the index has exactly one chapter, which is every chapter
   * ever authored before this existed.
   */
  route?: ChapterRoute;
  llmHints?: LlmHints;
}

/** A chapter's membership of a routed index. */
export interface ChapterRoute {
  /** Which set of alternatives this index is chosen from (`Campaign.routeSets`). */
  set: string;
  /** The story flag that selects this member. */
  flag: string;
}

export interface Campaign {
  id: string;
  title: string;
  blurb: string;
  /**
   * Every chapter file in the campaign, including every member of a routed
   * index. A playthrough visits one member per index, so this list is longer
   * than the campaign is — sixteen files, eight indexes, in Gemfall's case.
   */
  chapters: string[];
  /**
   * The named sets a routed index chooses from, each a list of story flags.
   *
   * Declared here rather than inferred from the chapters that exist, because
   * the failure this prevents is a *missing* member: author 3A and 3B, forget
   * 3C, and a party that took the third road arrives at a beat with no
   * chapter in it. Only a declared set can notice an absence — which is why
   * `content:validate` requires a routed index to cover its set exactly.
   */
  routeSets?: Record<string, string[]>;
  /**
   * Setbacks before the campaign fails — spec §8.3's "fails at three
   * setbacks, tunable per campaign". Absent means three; authored here so a
   * short, gentle campaign can afford one and a long one can afford four
   * without either touching code.
   */
  setbackLimit?: number;
}
