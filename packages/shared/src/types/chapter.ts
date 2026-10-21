/**
 * Chapter format — docs/architecture.md §5.
 *
 * A chapter is one JSON file, authored offline, validated in CI, and served as
 * a static asset. A malformed chapter fails the build, never the play session.
 */

import type { CampaignGraph, FactId, FactTest } from "./campaign-graph.js";
import type { SlowEffect } from "./buffs.js";
import type { ClassId, ItemDef, SpeciesId, StatId } from "./domain.js";

export type SceneId = string;

/** Who receives a granted item. */
export type GrantTarget = "roller" | "party" | (string & {});

export type Effect =
  | { type: "grantItem"; itemId: string; to?: GrantTarget }
  | { type: "grantQuestItem"; itemId: string }
  /**
   * Removes one copy of an item from whoever in the party holds it: the cake
   * that was shared, the stone that was handed over. A list is an order of
   * preference ("a supper bundle, or failing that a honeycake"), and the first
   * id anybody holds is the one taken. Holding none is a no-op, which is why
   * `content:validate` insists the choice carrying it is gated on holding it.
   */
  | { type: "takeItem"; itemId: string | string[] }
  /** Adds to the party's purse (`RunState.coins`). */
  | { type: "grantCoins"; amount: number }
  /**
   * Takes from the party's purse, never below zero. Gate the choice on
   * `when: { coins: { min } }` so a party that cannot pay never sees it.
   */
  | { type: "spendCoins"; amount: number }
  /** Nonlethal story hazards leave a standing hero at 1 HP; never revive a downed hero. */
  | { type: "damage"; amount: number; to?: GrantTarget; nonlethal?: boolean }
  | { type: "heal"; amount: number; to?: GrantTarget }
  | { type: "grantXp"; amount: number }
  | { type: "setFlag"; flag: string; value?: boolean };

/**
 * A test against the party and the run's flags (#158). Every field is
 * optional and every field present must hold: they are ANDed, and an empty
 * condition always holds. Evaluated by `evaluateCondition` (chapter-graph.ts),
 * the one evaluator that choice gating and narration variants share.
 */
export interface Condition {
  /** This run flag is set. */
  flag?: string;
  /** This run flag is not set. */
  notFlag?: string;
  /** Somebody in the party holds this item (inventory or quest items). */
  item?: string;
  /** Nobody in the party holds this item. */
  notItem?: string;
  /**
   * How many **distinct** item ids the party holds between them, across every
   * member's inventory and quest items: an item two members both carry counts
   * once. `of` is an exact id, a prefix ending in `*` (`"facet_*"`), or a list
   * of exact ids. Bounds are inclusive; `max: 0` means "has none".
   */
  count?: { of: string | string[]; min?: number; max?: number };
  /** How many coins are in the party's purse. Bounds are inclusive. */
  coins?: { min?: number; max?: number };
  /** How many members are seated, connected or not. Bounds are inclusive. */
  partySize?: { min?: number; max?: number };
}

/**
 * Extra narration shown when its condition holds (#159).
 *
 * Composed when the scene opens: the base narration plus every variant whose
 * `when` holds, in authored order. `at: "start"` goes before the base, the
 * default (`"end"`) after it, and `replace: true` drops the base. If several
 * matching variants replace, the first one wins (the validator reports it as
 * an authoring error).
 *
 * **Evaluated against the party as it is when the scene opens.** The scene's
 * own `onEnter` effects have already applied (and, for branch narration, the
 * branch's effects too), so an item the scene grants on entry counts.
 *
 * After composition the `{facets}` and `{party}` tokens are filled
 * (narration.ts), and the result is stored in `RunState.narration`, so a reload
 * mid-scene shows the same words rather than recomputing them.
 */
export interface NarrationVariant {
  when: Condition;
  text: string;
  at?: "start" | "end";
  replace?: boolean;
}

export interface Branch {
  goto: SceneId;
  effects?: Effect[];
  /** Optional narration override shown before the transition. */
  narration?: string;
  /**
   * Conditional additions to `narration`, shown on the scene this branch leads
   * to exactly as `narration` is. See `NarrationVariant`.
   */
  variants?: NarrationVariant[];
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
  /**
   * Same semantics as `requiresSpecies`, for class (#228): offered when anyone
   * seated has one of the listed classes, hidden otherwise, with no hint. Read
   * against the seated party each time, never stored — a class-gated choice
   * that matters later sets a flag, and guards read the flag (#199).
   */
  requiresClass?: ClassId | ClassId[];
  requiresFlag?: string;
  requiresItem?: string;
  /**
   * Hidden (never disabled) unless this holds (#158). Checked alongside the
   * `requires*` gates above; see `Condition`. The label's `{facets}` /
   * `{party}` tokens are filled when the prompt opens; variants do not apply
   * to labels.
   */
  when?: Condition;
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

/**
 * What the party is trying to do this chapter, in kid words, with the steps
 * that get it done (#356). The shared screen and every phone show it the whole
 * chapter, with nothing to tap, and a step ticks itself when its flag is set.
 *
 * It rides on the same flag machinery as `ChapterObjective`: a step watches a
 * run flag that some `setFlag` in the chapter sets where the thing happens.
 * Nothing new decides "the party did it". `content:validate` holds every
 * shipped chapter to having one, every step's flag to being set somewhere in
 * the chapter, and every step that is not `optional` to being ticked on every
 * path to a success ending.
 */
export interface ChapterGoal {
  /** One sentence an eight-year-old follows: "Show you can hold the dragon's leash." */
  text: string;
  /** Two to four, in the order a party usually meets them. */
  steps: GoalStep[];
}

/** One tick on a chapter's goal: it watches a run flag, or an item the party holds. */
export type GoalStep = GoalStepBase & (GoalStepFlag | GoalStepItem);

export interface GoalStepBase {
  id: string;
  /** A short thing to do: "Get the wardens' ledger". */
  label: string;
  /**
   * A step some roads skip. Drawn as "if you can" and never held to the
   * spine. Absent is the normal case.
   */
  optional?: boolean;
}

export interface GoalStepFlag {
  /**
   * Ticks when this run flag is set, or any of these when it is a list (a step
   * a party can do more than one way). Chapter-local flags only: a route-set
   * member can arrive already set from an earlier chapter and tick before
   * anybody did anything, so `content:validate` refuses every one.
   */
  flag: string | string[];
  item?: never;
}

export interface GoalStepItem {
  /**
   * Ticks while anybody in the party holds this item: the ledger borrowed, the
   * chord learned, when the chapter already hands one over for the thing. One
   * of this chapter's own `props`, so it cannot arrive already held.
   */
  item: string;
  flag?: never;
}

/**
 * Somebody standing in a story scene with the party (schemas/chapter.schema.json
 * `castMember`). The shared screen draws them opposite the heroes, so meeting
 * the selkie professor is something the room *sees* rather than only reads.
 *
 * Presence, not mention: a scene casts whoever is physically there and part of
 * the moment. Field Guide `discovers` is a different fact (the first meeting);
 * a recurring character is cast in every scene they stand in and discovered in
 * one.
 */
export interface CastMember {
  /**
   * `entities/<id>`, `characters/<species>` or `cast/<id>`: a path under
   * `assets/` that tools/content/validate.mjs resolves to a real file.
   */
  figure: string;
  /** The nameplate. Omitted for an unnamed creature. */
  name?: string;
  /** How big they stand beside the party. Defaults per figure (world/cast.ts). */
  size?: CastSize;
  /**
   * How many of them are there (default 1, at most 6). The stage draws that
   * many figures huddled together, so "three cinder wolves" in the narration
   * is three on screen. One nameplate, under the group.
   */
  count?: number;
}

export type CastSize =
  | "tiny"
  | "tiny_to_small"
  | "small"
  | "small_to_medium"
  | "medium"
  | "medium_to_large"
  | "large"
  | "very_large"
  | "colossal";

/**
 * How much a scene matters to the story — "p1" and "p2" (content/README.md,
 * "Priority scenes").
 *
 * - `1`, a **revelation**: the campaign turns on what the party learns here.
 *   The gemstones are a seal; the seal holds a titan under the mountain. Miss
 *   it and the rest of the campaign stops making sense.
 * - `2`, a **clue**: worth remembering, and worth the table noticing, but the
 *   story survives a party that skims it.
 *
 * Absent is an ordinary scene, which is nearly all of them. Both levels are
 * drawn differently on the shared screen, and every p1 the party walked
 * through is retold, in its own words, on the end-of-chapter recap.
 */
export type ScenePriority = 1 | 2;

/**
 * What a check asks of the table, for the pacing report's interactivity count
 * (content/README.md, "Interactivity"): `"doing"` is something the party does
 * (heave, climb, dodge, sneak, puzzle out a lock), `"talking"` is something
 * they say (persuade, comfort, plead). Read from the stat (might, quick and
 * clever do; heart talks) unless the check overrides it with `checkKind`. Nothing at play time reads it.
 */
export type CheckKind = "doing" | "talking";

/**
 * What to tap here, for a player who is still learning (#255): "Tap a gold
 * square to walk there." The screens show it under the narration and read
 * it aloud after it (`speak()`, with a button for `hear()`), and it is never
 * part of the narration itself, so the recap never sees it.
 * Only the practice (`PRACTICE_CAMPAIGN_ID`) uses it: a real chapter trusts
 * the table to know the game. One sentence or two, in the game's voice.
 */
export type SceneHint = string;

export interface StoryScene {
  type: "story";
  art?: string;
  music?: string;
  narration: string;
  /** Conditional narration, composed when the scene opens. See `NarrationVariant`. */
  variants?: NarrationVariant[];
  /** How much this scene matters to the story. See `ScenePriority`. */
  priority?: ScenePriority;
  /** One line for a player still learning what to tap. See `SceneHint`. */
  hint?: SceneHint;
  onEnter?: Effect[];
  /**
   * Canon ids (keys of `content/field-guide.json` entries) the kids meet in
   * this scene. See `discoveries.ts` and content/README.md.
   */
  discovers?: string[];
  /** Who is standing here with the party. See `CastMember`. */
  cast?: CastMember[];
  /** Makes this scene a class's room. See `ClassPlace`. */
  classPlace?: ClassPlace;
  choices: Choice[];
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  outcome?: ChapterOutcome;
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  endsCampaign?: true;
}

/**
 * The class a class place teaches (docs/class-mastery.md §2, §3): the Dojo
 * says `"thornguard"`. While a scene carrying it is open, every seated hero
 * not already that class may switch to it, each kid alone on their phone
 * (`SWITCH_CLASS`, or `KEEP_CLASS` to say no), and the way on waits until
 * every connected hero who could switch has answered (`RunState.classPlace`).
 * One class per place. Story and Choice Point scenes only, never an ending,
 * and never in Gemfall: `content:validate` refuses the rest.
 */
export type ClassPlace = ClassId;

export interface CheckScene {
  type: "check";
  art?: string;
  music?: string;
  stat: StatId;
  tn: number;
  prompt: string;
  narration?: string;
  /**
   * Conditional narration, composed when the scene opens over the base text
   * (`narration`, or `prompt` without it). See `NarrationVariant`.
   */
  variants?: NarrationVariant[];
  /** How much this scene matters to the story. See `ScenePriority`. */
  priority?: ScenePriority;
  /** One line for a player still learning what to tap. See `SceneHint`. */
  hint?: SceneHint;
  onEnter?: Effect[];
  /**
   * Canon ids (keys of `content/field-guide.json` entries) the kids meet in
   * this scene. See `discoveries.ts` and content/README.md.
   */
  discovers?: string[];
  /** Who is standing here with the party. See `CastMember`. */
  cast?: CastMember[];
  /**
   * Which player rolls. Default ("party"): whoever has rolled the fewest
   * checks. "all": everyone rolls, and half or more succeeding carries it.
   */
  roller?: "party" | "active" | "best" | "all";
  /**
   * Overrides the `CheckKind` the stat implies, for a check whose stat
   * misleads: a heart check to coax a goat across a plank is doing; a clever
   * check to talk a troll out of his riddle is talking. Pacing only.
   */
  checkKind?: CheckKind;
  onSuccess: Branch;
  onFailure: Branch;
}

export interface ChoicePointScene {
  type: "choice_point";
  art?: string;
  music?: string;
  narration: string;
  /** Conditional narration, composed when the scene opens. See `NarrationVariant`. */
  variants?: NarrationVariant[];
  /** How much this scene matters to the story. See `ScenePriority`. */
  priority?: ScenePriority;
  /** One line for a player still learning what to tap. See `SceneHint`. */
  hint?: SceneHint;
  onEnter?: Effect[];
  /**
   * Canon ids (keys of `content/field-guide.json` entries) the kids meet in
   * this scene. See `discoveries.ts` and content/README.md.
   */
  discovers?: string[];
  /** Who is standing here with the party. See `CastMember`. */
  cast?: CastMember[];
  /** Makes this scene a class's room. See `ClassPlace`. */
  classPlace?: ClassPlace;
  /** Party votes; ties broken by the active turn marker. spec §6.1. */
  choices: Choice[];
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  outcome?: ChapterOutcome;
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  endsCampaign?: true;
}

export interface RestScene {
  type: "rest";
  art?: string;
  music?: string;
  narration: string;
  /** Conditional narration, composed when the scene opens. See `NarrationVariant`. */
  variants?: NarrationVariant[];
  /** How much this scene matters to the story. See `ScenePriority`. */
  priority?: ScenePriority;
  /** One line for a player still learning what to tap. See `SceneHint`. */
  hint?: SceneHint;
  onEnter?: Effect[];
  /**
   * Canon ids (keys of `content/field-guide.json` entries) the kids meet in
   * this scene. See `discoveries.ts` and content/README.md.
   */
  discovers?: string[];
  /** Who is standing here with the party. See `CastMember`. */
  cast?: CastMember[];
  /** Heals the party by this much on entry. */
  heal?: number;
  choices: Choice[];
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  outcome?: ChapterOutcome;
  /** Only read when this scene ends the chapter — see `EndingScene`. */
  endsCampaign?: true;
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
  /**
   * A numbing sting (#227): every hit this enemy lands leaves the hero
   * Numbed — `slow.steps` fewer steps for `slow.turns` of their turns, then
   * full again. A second sting refreshes it and never stacks; it ends with the
   * fight. Absent on every enemy before it existed, which fights as it always
   * did.
   */
  onHit?: { slow: SlowEffect };
  /**
   * The same sting as a defense (#227), pufferfish-style. The enemy starts
   * the fight NOT puffed; the first hero hit on it puffs it up (that hit does
   * not sting — it was not puffed when struck). While puffed, a hero who
   * *hits* it is Numbed. A miss touches nothing, puffed or not.
   *
   * It stays puffed for `puffTurns` of its own turns (default
   * `DEFAULT_PUFF_TURNS`, 2), then deflates; being hit while puffed starts the
   * count again.
   */
  retaliation?: { slow: SlowEffect; puffTurns?: number };
  /**
   * How this creature fights in a place that fights back (#220) — the
   * "second sentence for a specific creature" enemy-ai.ts leaves the door
   * open for. Read only in a fight with an `environment`; anywhere else it
   * fights exactly as if it were not written.
   */
  rift?: RiftBehavior;
}

/**
 * A creature's own way with the place (#220). Each is a sentence a child can
 * learn by watching: "the salamander walks through fire", "the gatekeeper
 * always guards the way out", "the bramble-troll shoves you into the thorns".
 */
export interface RiftBehavior {
  /** Ground it does not mind: hazards of these kinds do nothing to it, and it stops on them freely. */
  ignores?: EnvironmentHazard["kind"][];
  /**
   * What it watches when it has nobody to hit: always the way out, always a
   * captive, or never anything (it only ever goes for the heroes). Absent:
   * whichever the board gives it (the nearest monster to each, enemy-ai.ts).
   */
  post?: "exit" | "captive" | "none";
  /**
   * At the end of its turn, a hero beside it whose far side is active
   * hazard ground is shoved one square onto it — and the ground bites them
   * there and then. One shove a turn, the first such hero in reading order.
   */
  shoves?: true;
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

/** A tile of the battle map, as `EncounterMap` spawns are written. */
export interface MapTile {
  x: number;
  y: number;
}

/**
 * The place fighting back (#201): an encounter that happens *in* a rift
 * rather than merely beside one. Every part is optional and opt-in per scene;
 * a scene without `environment` — every chapter written before it, Gemfall's
 * sixteen included — fights exactly as it always did. The rules are in
 * `environment.ts` and `endTurnWithEvents` (encounter.ts); the authoring
 * contract is docs/campaigns/graph-campaigns.md, "Environmental combat".
 *
 * Everything here is read at **turn ends and round starts**, never in the
 * middle of a move or a swing: "where you stop" is a rule an 8-year-old can
 * plan around, and it keeps the base combat loop — moves, actions, legality —
 * exactly what it was.
 */
export interface EncounterEnvironment {
  clock?: RiftClock;
  hazards?: EnvironmentHazard[];
  exits?: RiftExit[];
  /** One captive, or a list of up to three (#220), each freed on its own. */
  rescue?: RescueObjective | RescueObjective[];
  relocate?: EnemyRelocation[];
  /** Something to do besides surviving (#220): hold ground, close a tear. Up to three. */
  objectives?: EnvironmentObjective[];
  /** The place's own numbers (#220): "−1 Guard for everyone in the storm". Up to three. */
  modifiers?: EnvironmentModifier[];
  /**
   * The same place, changed by the world (#220): the first variant whose
   * `when` holds replaces each part it lists when the fight begins — a
   * raging wyrm sets the grass alight, a sealed rift has no tear to escape
   * through. Parts it leaves out stay as authored above. None holding (or
   * a run with no world facts: every ordered campaign) is the place as
   * authored. Up to four.
   */
  variants?: EnvironmentVariant[];
}

/** A changed version of an environment, and the world facts it needs (#220). */
export interface EnvironmentVariant extends Omit<EncounterEnvironment, "variants"> {
  /**
   * World facts (#198) the variant needs, each tested as a graph condition
   * tests them; every one must pass. Only facts: a chapter run carries the
   * journey's facts and nothing else of it.
   */
  when: { facts: Record<FactId, FactTest> };
}

/**
 * A number the place changes for the whole fight (#220) — the storm that
 * makes everyone easier to hit, the ice that slows every step. It rides the
 * temporary-buff seam (#200): at the start of the fight it becomes one
 * `CombatBuff` per figure it is on, read by `buffBonus` like any other, so
 * it counts against the same per-kind limit (`BUFF_LIMITS`) as the party's
 * own buffs — a storm cannot push a number past what any buff could.
 */
export interface EnvironmentModifier {
  /** Unique within the environment; not `"numbed"` or `"slowed"`, which the fight writes itself. */
  id: string;
  /** What the phones call it: "Storm winds". */
  label: string;
  kind: "guard" | "damage" | "move" | "roll";
  /** A non-zero whole number within the kind's limit. Negative is a burden. */
  amount: number;
  /** Who it is on. Default `"everyone"`: the rift takes no sides. */
  on?: "everyone" | "party" | "monsters";
}

/**
 * The visible timer. It counts **rounds** (one full turn order: every hero
 * and every monster once), because a round is what the table can see pass —
 * the marker coming back round to the first seat.
 */
export interface RiftClock {
  /** Rounds the fight has before the rift acts, 1 to 12. */
  rounds: number;
  /** What the rift does, as the phone says it: "The rift closes" → "The rift closes in 2 rounds". */
  label: string;
  /**
   * `"collapse"` — when the last round ends, the fight is over and the story
   * takes `onTimeout` (which is then required). `"surge"` — the fight goes
   * on, but every round that starts past the clock hurts every hero still on
   * the board by `surge` (default 1): staying is allowed, and it costs.
   */
  onExpire: "collapse" | "surge";
  surge?: number;
}

/**
 * Ground that bites. A figure — hero or monster, the rift does not take sides
 * — that **ends its turn** on one of `tiles` while the hazard is active takes
 * `damage`, and then whatever else the ground does: `slow`, `root`, `push`
 * (#220). Walking across is free; stopping there is not. Not a hit: Brace
 * does not redirect it and a ward does not shave it.
 *
 * A hazard does at least one thing. Damage comes first; a figure it knocks
 * down is not also slowed, held or pushed.
 */
export interface EnvironmentHazard {
  id: string;
  /** What it looks like, and so which glyph and word the phone uses. */
  kind: "fire" | "thorns" | "rift";
  /** What the phone calls it: "Rift fire". */
  label: string;
  tiles: MapTile[];
  /** 1 to 5. Absent: it does not hurt, only slows, holds or pushes (#220). */
  damage?: number;
  /**
   * Sticky ground (#220): the figure is Slowed — `steps` fewer steps for
   * `turns` of its own turns, the numbing sting's slow (#227) under another
   * name. A second stop refreshes it; it never stacks.
   */
  slow?: SlowEffect;
  /** Grabbing ground (#220): the figure starts its next turn with no steps, as Tanglelight does. */
  root?: true;
  /**
   * Ground that throws (#220): the figure slides `tiles` (default 1, at most
   * 3) toward `direction` (north is up the map), stopping early at a wall, the
   * board's edge or another figure. Where it lands does nothing more this turn.
   */
  push?: HazardPush;
  /** Active from this round (default 1) … */
  fromRound?: number;
  /** … through this one (default: the rest of the fight). */
  untilRound?: number;
}

/** How a pushing hazard throws a figure (#220). */
export interface HazardPush {
  direction: "north" | "south" | "east" | "west";
  /** 1 to 3; default 1. */
  tiles?: number;
}

/**
 * A way out that is only sometimes there. A hero who **ends their turn** on
 * one of `tiles` while it is open steps through and leaves the fight. Once
 * every hero still standing has gone (knocked-down friends are pulled
 * through by the others — nobody is left on the board, §7.3), the fight ends
 * and the story takes `onEscape` (which is then required).
 */
export interface RiftExit {
  id: string;
  label: string;
  tiles: MapTile[];
  /** Open from this round (default 1) … */
  opensRound?: number;
  /** … through this one (default: the rest of the fight). */
  closesRound?: number;
}

/**
 * Somebody to save. The captive stands on `at` (nobody else can) until a
 * hero **ends a turn** next to them, which frees them. A captive not freed by
 * the end of round `byRound` — or, without one, by the time the clock runs
 * out — is lost to the rift. `effects` apply when the fight ends, however it
 * ends, if the captive was freed; they are where the rescue becomes a story
 * fact (`setFlag`, then a journey flag and a node's `onComplete`).
 */
export interface RescueObjective {
  /** "Pip the ferry-sprite". */
  name: string;
  at: MapTile;
  byRound?: number;
  effects?: Effect[];
  /**
   * A captive the monsters can get at (#220), 1 to 6. A monster that ends
   * its turn beside a waiting captive *without having swung at anybody*
   * spends that turn dragging at them, and takes one away; at none, they
   * are lost to the rift. No roll, nobody hurt: the captive is pulled away,
   * the same loss as running out of time. Absent: nothing can touch them.
   */
  hp?: number;
}

/**
 * A thing the party can get done in the fight (#220), besides beating the
 * monsters, getting out or freeing somebody. Progress is counted where the
 * rest of the environment is — at turn ends and round starts — and shown on
 * every phone as "2 of 3".
 *
 * Done is a story fact the same way a rescue is: `effects` apply when the
 * fight ends, however it ends, if it was done. With `endsFight`, getting it
 * done ends the fight there and then as a **victory** — the story takes
 * `onVictory`, whose variants can read the effects' flag.
 */
export type EnvironmentObjective = HoldObjective | CloseObjective;

interface ObjectiveBase {
  /** Unique within the environment (shared with hazards and exits). */
  id: string;
  /** What the phones call it: "Hold the beacon stones". */
  label: string;
  effects?: Effect[];
  endsFight?: true;
}

/**
 * Hold ground: a round counts when it **ends** with a standing hero on one of
 * `tiles` and no monster on any of them. `rounds` such rounds (not in a row)
 * and it is done.
 */
export interface HoldObjective extends ObjectiveBase {
  kind: "hold";
  tiles: MapTile[];
  /** 1 to 12. */
  rounds: number;
}

/**
 * Close a tear: each time a hero **ends a turn** on or beside `at`, it
 * closes a little; `turns` of those (any heroes, any order) and it is done.
 */
export interface CloseObjective extends ObjectiveBase {
  kind: "close";
  at: MapTile;
  /** 1 to 12. */
  turns: number;
}

/**
 * The rift spits a monster somewhere else. At the start of `round`, enemy
 * `enemy` — a derived id, `<spec id>#<n>` (encounter.ts) — is moved to `to`,
 * if it is still standing and the tile is free.
 */
export interface EnemyRelocation {
  /** At the start of this round (2 or later). Exactly one of `round` and `whenHurt`. */
  round?: number;
  /**
   * Instead of a round (#220): at the start of the first round in which the
   * monster has half its hearts or fewer, the rift pulls it away — it picks
   * its moment. Once, and only if the tile is free then.
   */
  whenHurt?: true;
  enemy: string;
  to: MapTile;
}

export interface EncounterScene {
  type: "encounter";
  map: string;
  art?: string;
  music?: string;
  narration?: string;
  /** One line for a player still learning what to tap. See `SceneHint`. */
  hint?: SceneHint;
  onEnter?: Effect[];
  /**
   * Canon ids (keys of `content/field-guide.json` entries) the kids meet in
   * this scene. See `discoveries.ts` and content/README.md.
   */
  discovers?: string[];
  enemies: EnemySpec[];
  onVictory: Branch;
  /** Never a game over — the story branches. spec §7.3. */
  onDefeat: Branch;
  /**
   * The practice's Help Up lesson (#255): with two or more heroes seated, the
   * next one after the story-turn holder (a connected one where there is one)
   * starts this fight knocked down, so somebody has to stand beside them and
   * play Help Up. A party of one starts as it always does: there is nobody to
   * help. Only the practice uses it, and every branch out of that fight heals.
   */
  friendDown?: true;
  /** The place fighting back (#201). See `EncounterEnvironment`. */
  environment?: EncounterEnvironment;
  /** Every hero still standing went out through an open `environment.exits` tile. */
  onEscape?: Branch;
  /** A `"collapse"` clock ran out with the fight still on. */
  onTimeout?: Branch;
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
 * or an encounter can never be one, since both always carry at least two
 * branches (an environmental encounter, #201, may carry four). A
 * chapter may have several endings, which is exactly why the outcome is
 * declared on the scene rather than on the chapter: spec §8.2 wants "which
 * endings are setbacks" to be authored, not inferred.
 */
export type EndingScene = StoryScene | ChoicePointScene | RestScene;

/*
 * `endsCampaign` on an ending: the campaign finishes here, before its last
 * beat. A campaign's shape is the story's, and a story may have an exit that
 * is not at the end of the road — Gemfall's Walk turns south at the tree line
 * in chapter 7 and never enters the mountain. Without this, the only way to
 * finish a campaign was to finish a chapter at its highest index, and an early
 * exit had to be faked as a chapter of its own.
 */

/**
 * The chapter's voice guide for its authors: the tone, the reading level,
 * what never appears, and how its chapter-scoped characters sound. Authored
 * data, read by people and by the canon checks; nothing at play time reads it.
 * Renamed from its live-narration-era name in #347.
 */
export interface VoiceGuide {
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
  /**
   * A `MUSIC_SPECS` track id (packages/client/src/audio/paths.ts) that plays
   * instead of the biome's track for this chapter. A scene's own `music` wins
   * over it. Absent is the normal case: the biome's track, as before (#226).
   */
  music?: string;
  estimatedMinutes: number;
  xpAward: number;
  entry: SceneId;
  scenes: Record<SceneId, Scene>;
  /** Optional bonus objectives, spec §8.2. Absent is the normal case. */
  objectives?: ChapterObjective[];
  /**
   * What the party is trying to do, always on screen (#356). Every shipped
   * chapter has one (`content:validate`); absent only on test fixtures and on
   * a chapter that is nothing but its ending, which has nothing to aim at.
   */
  goal?: ChapterGoal;
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
  voiceGuide?: VoiceGuide;
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
  /**
   * The purse to hand a campaign attempt that was already past its first
   * chapter when the party purse was introduced, and so never saved one.
   * `coins` is the base; `byFlag` adds an amount for each carried route flag
   * the attempt holds (Gemfall's Ember sale). Absent means such an attempt
   * starts its next chapter with an empty purse.
   */
  purseBackfill?: { coins: number; byFlag?: Record<string, number> };
  /**
   * Campaigns the household must have finished before this one can be started
   * (#221). Met by a `complete` attempt at each — a loss ending counts, a
   * `failed` or abandoned attempt does not. Absent means no prerequisite,
   * which is every campaign authored before it existed, Gemfall included. Per
   * household, never per character: a late joiner still takes the tier floor
   * (spec §8.4). See `unmetPrerequisites`.
   */
  requires?: string[];
  /**
   * Makes this a graph campaign (#192): the next chapter is chosen by the
   * graph's edges, not by `index`. Absent — every campaign authored before it
   * existed, Gemfall included — is an ordered campaign, played exactly as it
   * always was. See `CampaignGraph`, `campaignMode` and
   * docs/campaigns/graph-campaigns.md.
   *
   * A campaign's mode is part of its identity. Turning an ordered campaign
   * into a graph one under attempts already in flight would strand them
   * (their `lastIndex` names a beat, not a node), so that is a new campaign
   * id, never an edit.
   */
  graph?: CampaignGraph;
}
