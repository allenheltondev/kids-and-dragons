/**
 * Authoritative run state.
 *
 * The server owns this object. Clients hold a mirror kept current by JSON Patch
 * (architecture §4.2) and never mutate it locally.
 */

import type { EncounterState } from "../encounter.js";
import type { ResolvedCharacter, StatId } from "./domain.js";
import type { ChapterOutcome, SceneId, ScenePriority, SceneType } from "./chapter.js";
import type { FieldGuideFind } from "../field-guide-record.js";
import type { FactId, FactValue, JourneyView, NodeId } from "./campaign-graph.js";
import type { BuffId, CheckBuffOffer, RunBuff } from "./buffs.js";

export type RoomMode = "party" | "travel";

export interface DiceRoll {
  die: number;
  mod: number;
  total: number;
  tn: number;
  result: "success" | "failure" | "hit" | "miss";
  /** Who rolled. */
  characterId: string;
  stat?: StatId;
  /** A friend's die, already counted in `total`. Checks only. */
  help?: { characterId: string; sides: number; value: number };
  /**
   * A story-check buff spent on this roll (#222), already counted in `total`.
   * Checks only; absent on every roll no buff touched.
   */
  buff?: { id: BuffId; label: string; amount: number };
  /**
   * On the last roll of a whole-party check (`roller: "all"`): how many made
   * it, out of how many, and so how the party did. Half or more is a success.
   */
  group?: { made: number; of: number; result: "success" | "failure" };
}

/** A member of the party, as the clients see them. */
export interface PartyMember {
  character: ResolvedCharacter;
  playerId: string;
  hp: number;
  /** spec §7.3 — knocked down, never dead. */
  down: boolean;
  connected: boolean;
  ready: boolean;
  /**
   * The household this hero lives in, when it is not the room's (#249): a
   * visitor's. Its XP, items and Field Guide finds are written back there.
   * Absent for everybody from the room's own household, which is every member
   * of a room that was never opened to visitors (`memberHome`).
   */
  homeHouseholdId?: string;
}

export type PhaseKind =
  | "lobby"
  | "creation"
  | "scene"
  | "check"
  | "encounter"
  | "chapter_complete";

/** The household's progress through a campaign, as the screens need it. */
export interface CampaignView {
  id: string;
  title: string;
  /**
   * The campaign's premise, as authored (`Campaign.blurb`). The lobby shows it
   * before chapter 1, so the table knows what it is setting out on before the
   * first scene drops it into the middle of things. Optional: absent on runs
   * persisted before it existed.
   */
  blurb?: string;
  /** How many chapters a playthrough visits — beats, not files. */
  chapters: number;
  /** The chapter "Begin" would start; null only at a fork nobody has chosen. */
  next: { index: number; title: string } | null;
  /**
   * Set by the chapter completion that ended the attempt — the campaign was
   * finished (the gains are kept for good) or failed at its setback limit (the
   * gains are taken back, a souvenir is kept). Cleared when a chapter starts.
   */
  ended?: "complete" | "failed";
  /**
   * Set while the household cannot start this campaign yet (#221): the
   * campaigns it still has to finish, and the plain reason the lobby shows
   * ("Finish Gemfall first"). Absent for every campaign without a prerequisite,
   * and once it is met. The server refuses the start either way; this is how
   * the screens know not to offer it.
   */
  locked?: { requires: string[]; reason: string };
  /**
   * A graph campaign's journey (#194): where the party is, whether it is
   * playing that place or choosing a way on, and the exits a screen draws.
   * `next` is null while it is choosing — a fork nobody has chosen at, which
   * `CHOOSE_EXIT` answers. Present only for graph campaigns (`campaignMode`);
   * an ordered campaign's view never carries it. See `JourneyView`.
   */
  journey?: JourneyView;
}

/** A decision the game is waiting on. Only one is ever open at a time. */
export type Prompt =
  | {
      kind: "choice";
      sceneId: SceneId;
      /**
       * Choices already filtered for party eligibility (`requires*` and
       * `when`), with label tokens already filled (#159).
       */
      options: { id: string; label: string; icon: string }[];
      /** Empty means anyone may answer. */
      forPlayerIds: string[];
      /** choice_point scenes tally votes rather than taking the first answer. */
      vote: boolean;
      votes?: Record<string, string>;
    }
  | {
      kind: "roll";
      sceneId: SceneId;
      stat: StatId;
      tn: number;
      prompt: string;
      characterId: string;
      /** Who has offered to help, and the die they will add. One per check. */
      helper?: { characterId: string; sides: number };
      /**
       * A whole-party check (`roller: "all"`): everyone rolls their own d20 +
       * stat, and half or more succeeding carries the party. `pending` is who
       * still has to roll; `characterId` is the first of them.
       */
      group?: { pending: string[]; rolls: DiceRoll[] };
      /**
       * The party's story-check buff this roll would spend (#222): with
       * `spend: "choose"` the roller's phone asks first ("Use Riftspark
       * (+2)?") and `ROLL.spendBuff` answers; with `"auto"` it is spent on
       * the roll whatever the phone says. Absent when the party holds none —
       * every ordered campaign's check, and every graph one's before #222.
       */
      buff?: CheckBuffOffer;
    }
  | {
      kind: "item_swap";
      characterId: string;
      incomingItemId: string;
    }
  | { kind: "ready"; forPlayerIds: string[] };

export interface RunState {
  runId: string;
  roomCode: string;
  mode: RoomMode;
  seq: number;
  phase: PhaseKind;
  campaignId: string | null;
  /**
   * The household's campaign attempt this chapter was started under
   * (`CampaignProgressRecord.attemptId`), or null when it started a fresh one.
   * Stamped by the server at chapter start, and checked when the chapter
   * settles: two rooms can play the same household's campaign at once, and a
   * completion from a room whose attempt has moved on — or ended and been
   * replaced — must not award the beat again or move the attempt backwards.
   * Optional because runs persisted before it existed carry none.
   */
  campaignAttemptId?: string | null;
  /**
   * The journey visit this chapter plays, for a graph campaign (#194): the
   * node and its visit ordinal, stamped by the server at chapter start beside
   * `campaignAttemptId`. With the attempt id it names one visit exactly, and
   * that is what the completion is reported against (`completeVisit`): a
   * second room finishing the same visit, or a retry of this one, is a repeat
   * and moves nothing. Absent on every ordered campaign's run.
   */
  journeyVisit?: { node: NodeId; visit: number } | null;
  /**
   * The temporary buffs this chapter run holds (#200), graph campaigns only:
   * seeded from the journey at chapter start (`EngineContext.campaignBuffs`)
   * beside the journey flags, each one's declaration resolved so the engine
   * and the phones can read it without the graph. Fights spend them, a Rest
   * scene or a setback may end some, and when the visit completes what is
   * left is read back into the journey (`completeVisit`).
   *
   * Absent on every ordered campaign's run — no graph, nothing to seed — and
   * on every run started before #200; a fight in such a run has no buffs.
   * Never written to a character: a buff is an overlay on a fight.
   */
  buffs?: RunBuff[];
  /**
   * The journey's world facts (#198) as this chapter started (#220), every
   * declared fact at its current value: what an environment's `variants`
   * test when a fight begins. Read-only to the run — a chapter changes the
   * world through flags and the graph's `onComplete`, never by writing here.
   * Absent on every run without a graph that declares facts, whose fights
   * are always the place as authored.
   */
  facts?: Record<FactId, FactValue>;
  /**
   * Where the household stands in the campaign this room plays, for the
   * screens: the lobby says which chapter is next, and the completion screen
   * says when the whole campaign has just ended. Computed by the server from
   * the household's attempt — the client cannot know either. Optional: absent
   * on runs persisted before it existed and on rooms with no campaign.
   */
  campaign?: CampaignView | null;
  /**
   * The campaigns this lobby can play: the one the room was opened for, then
   * every other campaign the household has part-way through, so a party that
   * started something on another evening can pick it back up. Computed by the
   * server from the household's attempts — and recomputed when a phone claims
   * a TV's room for its household. One option means there is nothing to
   * decide; two or more and the lobby votes (`campaignVotes`, `lobbyCampaign`).
   * Optional: absent on runs persisted before it existed.
   */
  campaignOptions?: CampaignView[];
  /**
   * The lobby's vote on which campaign to play, playerId → campaign id. Only
   * cast while there is more than one option; cleared when a chapter starts,
   * so the next time the party is back in the lobby it decides again.
   */
  campaignVotes?: Record<string, string>;
  chapterId: string | null;
  /**
   * The chapter in play, by the name and number the table knows it by — the
   * shared screen heads every scene with "Chapter 1 of 8 · The City That
   * Smelled Opportunity" rather than a file id. Set at chapter start, cleared
   * with `chapterId`. Optional for runs persisted before it existed.
   */
  chapterInfo?: { index: number; title: string } | null;
  sceneId: SceneId | null;
  sceneType: SceneType | null;
  /**
   * Rendered narration for the current scene (authored, or LLM-validated).
   *
   * Composed once, when the scene opens: branch narration and the scene's own,
   * each with its matching `variants` applied, then `{facets}` / `{party}`
   * filled (narration.ts, #159). Stored, never recomputed by a client, so a
   * reload mid-scene shows the same words.
   */
  narration: string;
  art: string | null;
  /**
   * The current scene's `priority` (chapter.ts `ScenePriority`), so the shared
   * screen can mark a revelation as one. Null for an ordinary scene and outside
   * one. Optional: absent on runs persisted before it existed, read as null.
   */
  scenePriority?: ScenePriority | null;
  party: PartyMember[];
  prompt: Prompt | null;
  lastRoll: DiceRoll | null;
  /** Story flags set by effects, scoped to the run. */
  flags: Record<string, boolean>;
  /**
   * The party's shared purse. One purse, not one per character, for the same
   * reason XP is never individual: what the party can afford is a table
   * decision. Unlike `flags` it outlives the chapter, through
   * `EngineContext.campaignCoins` and `CampaignProgressRecord.coins`.
   *
   * Optional because RunState is persisted as plain JSON and a run written
   * before the purse existed has to keep loading; read it as `?? 0`.
   */
  coins?: number;
  xpEarned: number;
  /**
   * How the chapter now in `chapterId` ended, once it has (spec §8.2). Null
   * while one is still being played.
   *
   * The client needs it to play a different ending beat, and the persistence
   * layer needs it to count setbacks toward the three that fail a campaign
   * (§8.3). It is *not* derivable from `xpEarned`, because bonus objectives and
   * `grantXp` effects mean a successful chapter and a setback can pay the same
   * number.
   *
   * Optional, along with `bonuses`, because RunState is persisted and shipped
   * as plain JSON: a run written before these fields existed has to keep
   * loading, and a Friday-evening session must not end because the shape of the
   * object changed under it. `createRunState` always writes both.
   */
  chapterOutcome?: ChapterOutcome | null;
  /**
   * The bonus objectives this run met, itemised for the completion screen.
   * Their XP is already folded into `xpEarned`; this is the breakdown, not a
   * second pot.
   */
  bonuses?: EarnedBonus[];
  /**
   * How each fight in a place that fought back ended (#220), in the order
   * they were fought, for the completion screen: through the rift, out of
   * time, won, lost — and who was freed or lost, what got done. Only a fight
   * with an `environment` adds one; absent on every other run, so the screen
   * is exactly what it was. Cleared when a chapter starts.
   */
  fightEndings?: FightEnding[];
  /**
   * Every scene this run has entered, in order — the spine of the story, for
   * the end-of-chapter recap (roadmap chapter 7, architecture §6).
   *
   * On the run rather than derived from the event log, because the log is a
   * server-side store and the recap is written from what a *client* can see: a
   * phone that mirrors the state has the whole road it travelled without a
   * second fetch.
   *
   * Optional, and readers coalesce, for the reason `bonuses` above is: `RunState`
   * is persisted plain JSON and a run in flight across a deploy predates the
   * field. A missing trail means a recap with a thinner spine, never a crash.
   */
  visited?: SceneId[];
  /**
   * The live layer's end-of-chapter recap, or null when there isn't one —
   * which is every run with the layer off, and every run where the model
   * declined or failed its gate (architecture §6.5, §6.6).
   *
   * Null is the normal case, not an error state. The completion screen has its
   * own content and this rides on top of it.
   */
  recap?: string | null;
  /**
   * The fight in progress, or null when there is not one (spec §7).
   *
   * Held on the run rather than beside it because everything else about a
   * reconnect already works by mirroring this object: a phone that died halfway
   * through a round gets the board, the turn order and everybody's HP back from
   * the same snapshot that carries the scene. A separate store for combat would
   * need its own replay path, and the one thing an eight-year-old cannot forgive
   * is losing a fight to a dropped connection.
   *
   * Optional for the same reason as the two above — a run written before
   * combat existed has to keep loading.
   */
  encounter?: EncounterState | null;
  /**
   * Hand-offs waiting on an answer (spec §9.4). Only ever non-empty during a
   * Rest scene; `enterSceneDraft` clears it on every scene change, so an offer
   * can never be accepted three scenes later in the middle of a fight.
   *
   * Optional for the same reason as the three above, and this one is load
   * bearing: a run persisted before trading existed comes back without the
   * key, and every reader coalesces rather than indexing into `undefined`.
   */
  trades?: TradeOffer[];
  /**
   * The story turn marker (spec §6.1): the party index whose turn it is to
   * pick the next Story choice, and whose vote breaks a tie at a Choice point.
   * Moves on to the next seat each time a choice resolves, so the story is
   * taken in turns rather than by whoever taps fastest.
   *
   * Optional, and read as 0 when absent, for the same reason as the fields
   * above: runs persisted before it existed come back without it.
   */
  storyTurn?: number;
  /**
   * A d20 face the next roll will come up (roadmap chapter 6's playtest mode).
   *
   * On the run rather than in the request that sets it, because loading the die
   * and rolling it are two taps and usually two devices: an author pins a 3 on
   * the laptop and then hands the phone to whoever is testing the failure
   * branch. Spent by the first roll that draws it — see `loadDie`.
   *
   * Optional for the same reason as everything above it, and it is read behind
   * `EngineContext.playtest` besides: a run persisted by a dev server and
   * somehow opened by a deployed one rolls honest dice.
   */
  playtestDie?: number | null;
  /**
   * How many checks each character has rolled this run, by character id. A
   * check the party shares (`roller: "party"`) goes to whoever has rolled the
   * fewest, so the dice go round the table instead of always landing on the
   * character with the best stat. Kept across chapters: one evening is one
   * rotation. Optional for runs persisted before it existed, which simply
   * start counting from zero.
   */
  checkRolls?: Record<string, number>;
  /**
   * Characters who have helped on a check since the party last rested. Help
   * recharges at a Rest scene and at the start of each chapter, so it is a
   * thing you save for the roll that matters rather than tap every time.
   */
  helpSpent?: string[];
  /**
   * The household's Field Guide — canon id → who found it first and when
   * (epic #101, #106). A **mirror** of the household's `FIELDGUIDE` record,
   * carried on the run for the reason `campaignOptions` is: it is household
   * data every screen in the room needs, and riding the run state means the
   * join, the TV's watch, a snapshot resync and an event replay all deliver
   * the same book with no second fetch or second sync path.
   *
   * The server writes it, never the engine (which cannot reach the store):
   * loaded when a room opens for a settled household or is first joined,
   * re-read from the store at every chapter start (which heals any drift from
   * a second room of the same household), and grown by `applyAction` on every
   * step that discovers something, in the same patch as the scene it was found
   * in. The store record stays the truth — this copy may briefly disagree
   * about *who* found something first when two rooms find it at once.
   *
   * Absent while the room's household is unsettled (a TV-opened room before a
   * phone joins, architecture §4.5) and on runs persisted before it existed;
   * readers treat absent as an empty book.
   *
   * What is *new* is not derivable from here on purpose: replaying patches on
   * a reconnect would re-announce everything. That signal rides the live
   * broadcast only (`ServerMessage.discovered`).
   */
  fieldGuide?: Record<string, FieldGuideFind>;
  /**
   * Players the room's host took out of this game (#267). They stay in `party`
   * with `connected: false`, which every turn, vote, roll and ready-gate
   * already reads as away, so taking someone out mid-fight cannot strand the
   * table. What this list adds is that they cannot come back: the server
   * refuses their join, their actions and their channel subscription.
   * Absent until somebody is removed.
   */
  removed?: string[];
  /**
   * Everybody who has joined this room, by player id, for the host's view
   * (#263): who is in, on what, including a kid still making their hero, who
   * is not in `party` yet. Written by the join, so it survives a refresh of
   * the host's screen, where the arrival notices do not.
   */
  seats?: Record<string, RoomSeat>;
  /**
   * The host locked the room (#263): nobody new may join. Everybody already
   * seated (`seats`) can still come back to it, from any device. Absent when
   * open.
   */
  locked?: true;
  /**
   * The host turned quiet mode on (#260): every device in the room caps its
   * volume, drops sudden stingers and impacts, skips screen shake, softens
   * flashes and dims the display. A device can still go lower on its own.
   * Absent when off.
   */
  quiet?: true;
  /**
   * A chapter this household stopped partway and can pick up again (#259):
   * the lobby offers "keep going", and the one-line recap is what it says.
   * Written when a room opens or refreshes its lobby (`offerCampaigns`) and
   * gone from the room once it is taken up. Absent when there is nothing
   * saved, which is nearly every room.
   */
  saved?: SavedGameView;
  /**
   * The host closed the room (#263). Every screen leaves, nothing more is
   * accepted, and the code is free again. Terminal: a closed room never
   * reopens.
   */
  closed?: true;
  /**
   * The host stopped the game to pick it up another day (#259), rather than
   * just closing it. Always beside `closed`, and it only changes what the
   * leaving screens say: the game is saved, not over.
   */
  stopped?: true;
  /**
   * The room is open to visitors (#249): phones from other households may
   * join it, with this code. It is the room's code and two more letters,
   * which every screen in the room shows in place of the short one, and it
   * works only while it is here. Turned on by a signed-in owner of the room's
   * household, never the host alone. Absent on a room that is not open,
   * which is every room until an owner opens it. An open room closes itself
   * once it has been idle for `OPEN_ROOM_IDLE_MS`.
   */
  visitorCode?: string;
  /**
   * This room has been open to visitors at some point, and never forgets it.
   * Whoever was given its visitor code was also shown its own four letters
   * (they are inside the long code, in the room's URL, on every screen), so
   * from then on knowing the short code proves nothing. A phone nobody has
   * seen before is never made a member of the room's household here: it comes
   * in as a visitor, on the visitor code, while the room is open, and not at
   * all otherwise (`admitNewPhone`). Absent on a room never opened.
   */
  visitorsOpened?: true;
  updatedAt: string;
}

/** A stopped chapter, as the lobby offers it (`RunState.saved`, #259). */
export interface SavedGameView {
  campaignId: string;
  campaignTitle: string;
  chapter: { index: number; title: string };
  /** Where the party was, in a sentence or two read aloud: "Last time, ...". */
  recap: string;
  /** The heroes who were playing, by name. */
  heroes: string[];
  savedAt: string;
}

/** One entry on the host's roster (`RunState.seats`, #263). */
export interface RoomSeat {
  /** The profile's name; a hero's name, once there is one, is in `party`. */
  name: string;
  color: string;
  /** What they joined on: their own phone, or the family's shared tablet (#250). */
  device: "phone" | "tablet";
  /**
   * A visitor's own household (#249), when it is not the room's. A visitor
   * who has joined may come back to the room from then on, as anybody on
   * the roster can.
   */
  homeHouseholdId?: string;
}

/**
 * An item one player has offered another at a Rest scene (spec §9.4).
 *
 * The offer is a *claim on* the item, not a move of it: the thing stays in the
 * giver's bag until the receiver taps accept, the same rule `addItem` follows
 * when it returns `needs_swap` rather than applying anything. That is what
 * makes a declined offer cost nobody anything, and it is why an offer carries
 * no slot reservation — the receiver's room is re-checked when they answer,
 * because a bag can fill between the offer and the tap.
 *
 * Not a `Prompt`. Only one prompt is ever open, and the Rest scene's own
 * choices are already in it; trading is meant to be the part of the evening
 * where three people talk to each other, so it runs beside the question on the
 * table rather than blocking it, and several offers may be in the air at once.
 */
export interface TradeOffer {
  /**
   * Derived from the three ids rather than generated, so it is stable across a
   * replay of the event log and cannot collide: the engine refuses a second
   * offer of the same item to the same person, which is exactly the case that
   * would otherwise need a counter.
   */
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  itemId: string;
}

/**
 * One bonus objective the party earned, as paid.
 *
 * `xp` is what was actually awarded rather than what the chapter asked for:
 * the engine clamps against the 25% ceiling (spec §8.2), and a screen that
 * itemised the authored number would not add up to `xpEarned`.
 */
/** One environmental fight's ending, as the completion screen tells it (#220). */
export interface FightEnding {
  outcome: "victory" | "defeat" | "escaped" | "timedOut";
  /** Won by finishing an objective that ends the fight, while monsters still stood: its label. */
  byObjective?: string;
  /** Captives freed, and lost, by name. */
  freed: string[];
  lost: string[];
  /** Objectives done, by label. */
  done: string[];
}

export interface EarnedBonus {
  id: string;
  label: string;
  xp: number;
}

export interface RoomSummary {
  code: string;
  runId: string;
  mode: RoomMode;
  expiresAt: string;
}
