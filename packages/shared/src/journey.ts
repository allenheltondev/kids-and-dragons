/**
 * Graph campaigns — the journey runtime (#194).
 *
 * `campaign-graph.ts` reads a declaration and answers questions about a
 * journey; this file *moves* one. The contract it implements is §6 of
 * docs/campaigns/graph-campaigns.md, and the words there mean exactly what
 * they mean here: a journey changes at three moments and no others —
 *
 *   - **enter** a node (a fresh attempt at the entry, or by taking an edge):
 *     a new visit, `visits[node]` + 1, the variant resolved on arrival;
 *   - **complete** the visit (its chapter run settled): `completions[node]`
 *     + 1, the outcome recorded, the journey flags read back from the run,
 *     and the node's `onComplete` rules applied (#198, world state);
 *   - **take an exit** (only once the visit is done): the edge counted, its
 *     effects applied, and then the destination entered.
 *
 * Rifts (#196) move inside these three and nowhere else — crossed, aged and
 * settled by `rifts.ts` in the order its file comment gives — so a rift's
 * lifecycle commits with the journey write that caused it.
 *
 * ---------------------------------------------------------------------------
 * WHY PURE, AND WHY HERE
 *
 * For the reason `routes.ts` is in shared. The server moves the journey and
 * persists it; the phones (#195) and the inspection tools (#202) have to draw
 * the same journey the server will act on. And for the reason the engine is
 * pure: no clock, no randomness, no store. The same journey and the same
 * report always produce the same next journey, so a resumed session on
 * Thursday sees exactly the doors Monday's left open, and a test can walk a
 * whole graph without a database.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCE IS PART OF THE RULE, NOT THE STORE'S PROBLEM
 *
 * Two phones tap the same exit; a response is lost and the tap is retried;
 * two rooms of one household finish the same visit. The store's optimistic
 * lock (`campaignProgressExpectedVersion`) makes sure only one *write* wins.
 * But the loser re-reads and tries again — and must then be told "that already
 * happened", not "you may not", and above all must not happen twice. That is a
 * question about the journey, so it is answered here: every report names the
 * visit it is about (`(node, visit)`, with the attempt id the store's key), and
 *
 *   - a report about a visit that is already past that point is a
 *     **duplicate** — answered `ok` with the journey unchanged;
 *   - a report about a visit the journey never had, or one it left by another
 *     way, is **stale** — refused;
 *   - anything else is judged on its merits.
 *
 * Refusals are values, never throws, in the handlers' `{ refusal }` style:
 * every one of them is something a real table can provoke.
 */

import type { Campaign, ChapterOutcome } from "./types/chapter.js";
import type {
  EdgeId,
  GraphEffect,
  FactId,
  FactValue,
  JourneyExitView,
  JourneyFactView,
  JourneyPlaceView,
  JourneyRiftActionView,
  JourneyState,
  JourneyView,
  NodeId,
  RiftActionKind,
  VisitStatus,
} from "./types/campaign-graph.js";
import {
  arrivalAt,
  chapterAtNode,
  completionEffects,
  exitAvailability,
  exitsFrom,
  evaluateGraphCondition,
  RIFT_ACTION_KINDS,
  riftDestination,
  type Arrival,
  type ExitBlock,
  type GraphExit,
  type ParsedCampaignGraph,
} from "./campaign-graph.js";
import { crossRift, riftDestinationRevealed, riftView, settleRifts, tickRifts } from "./rifts.js";
import { applyRiftEffect, isRiftEffect, riftActionChange, riftActionsFrom, riftCanReopen } from "./rift-actions.js";
import { readFact, storedFacts, worldFacts, writeFact } from "./world-state.js";

/**
 * The version of the stored journey record (`JourneyState.version`) this
 * build writes and reads. Separate in meaning from `CampaignGraph.version`
 * (the declaration's) though both are 1 today: a change to what a *saved*
 * journey means bumps this one, adds a step to `migrateJourney`, and leaves
 * every declaration alone.
 */
export const JOURNEY_VERSION = 1;

/** The part of a campaign the journey's rules read beyond the graph: fork sets. */
export type JourneyCampaign = Pick<Campaign, "routeSets">;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Why a transition or a read was refused.
 *
 * - `"unreadable"` — the stored value is not a journey at all.
 * - `"version"` — written by a build this one cannot read (a newer one).
 * - `"unknown-node"` — the journey stands at a node the declaration no longer
 *   has: content renamed an id under a save, which is a migration (§6).
 * - `"unknown-edge"` — no such edge in this graph.
 * - `"not-here"` — the edge does not leave the node the journey is at.
 * - `"stale-visit"` — the report names a visit that is not the current one
 *   and is not a repeat of something already done.
 * - `"still-playing"` — an exit asked for before the visit's chapter is done.
 *   There is no leaving a node mid-chapter.
 * - `"ended"` — the journey reached an ending; it goes nowhere now.
 * - `"unavailable"` — the exit is blocked; `reason` says why (`ExitBlock`).
 * - `"wrong-chapter"` — a completion reported for a chapter this visit does
 *   not play.
 */
export type JourneyRefusalCode =
  | "unreadable"
  | "version"
  | "unknown-node"
  | "unknown-edge"
  | "not-here"
  | "stale-visit"
  | "still-playing"
  | "ended"
  | "unavailable"
  | "wrong-chapter";

export interface JourneyRefusal {
  ok: false;
  code: JourneyRefusalCode;
  /** One sentence, for a log or an error response. */
  message: string;
  /** For `"unavailable"`: the first reason the exit is blocked. */
  reason?: ExitBlock;
}

/**
 * A completion that was already counted: the journey as it stands, unchanged.
 * Not an error — the visit did complete — but nothing is owed again: no XP,
 * no counter, no write.
 */
export interface JourneyDuplicate {
  ok: true;
  duplicate: true;
  journey: JourneyState;
}

export type VisitCompletion =
  | JourneyDuplicate
  | {
      ok: true;
      duplicate: false;
      journey: JourneyState;
      /**
       * This chapter's first completion in the attempt, and so the one its XP
       * pays on (§6: once per chapter per attempt). False on a replay.
       */
      firstCompletion: boolean;
      /** The visit completed an ending: the attempt is over (status `"ended"`). */
      ended: boolean;
    };

export type ExitCrossing =
  | JourneyDuplicate
  | {
      ok: true;
      duplicate: false;
      journey: JourneyState;
      /** What arriving was: `"new"`, `"replay"` or `"pass"` (`arrivalAt`). */
      arrival: Exclude<Arrival, "closed">;
    };

/** What the journey wants next (`currentPlayable`). */
export type Playable =
  /** Play this chapter — a fresh visit, or resuming one under way. */
  | { kind: "play"; node: NodeId; visit: number; chapter: string }
  /** The visit is done: choose a way on. `exits` is every exit, as `exitsFrom` says. */
  | { kind: "choose"; node: NodeId; visit: number; exits: GraphExit[] }
  /** An ending was completed: the attempt is over. */
  | { kind: "ended"; node: NodeId; visit: number; ending: NodeId };

const refuse = (code: JourneyRefusalCode, message: string, reason?: ExitBlock): JourneyRefusal => ({
  ok: false,
  code,
  message,
  ...(reason === undefined ? {} : { reason }),
});

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const count = (record: Readonly<Record<string, number>> | undefined, id: string): number => record?.[id] ?? 0;

const bump = (record: Readonly<Record<string, number>> | undefined, id: string): Record<string, number> => ({
  ...(record ?? {}),
  [id]: count(record, id) + 1,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const STATUSES: readonly VisitStatus[] = ["playing", "choosing", "ended"];

/** The route set(s) a flag is a member of — a fork, so setting one clears its siblings. */
function siblings(campaign: JourneyCampaign | undefined, flag: string): string[] {
  const out: string[] = [];
  for (const members of Object.values(campaign?.routeSets ?? {})) {
    if (Array.isArray(members) && members.includes(flag)) {
      for (const other of members) if (other !== flag) out.push(other);
    }
  }
  return out;
}

/**
 * Journey flags are stored true-only: an absent flag is false, which is what
 * every guard already reads, and a record that never accumulates `false` keys
 * stays the same shape however many chapters have touched it.
 */
function setFlag(
  flags: Record<string, boolean>,
  flag: string,
  value: boolean,
  campaign: JourneyCampaign | undefined,
): void {
  if (value) {
    for (const other of siblings(campaign, flag)) delete flags[other];
    flags[flag] = true;
  } else {
    delete flags[flag];
  }
}

/**
 * An edge's effects, or a completed node's `onComplete` effects (#198), in
 * order. World facts are written through their declarations (`writeFact`):
 * a counter clamps, and a fact the graph does not declare is left alone — the
 * parser refuses such a write, so only a hand-built journey could ask.
 *
 * The facts written are stored as values on the journey (`JourneyFacts.facts`)
 * — a new record each time, never the declaration's or the previous
 * journey's, so nothing outside this attempt's next journey changes.
 */
function applyEffects(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  effects: readonly GraphEffect[] | undefined,
  campaign: JourneyCampaign | undefined,
): JourneyState {
  if (!effects || effects.length === 0) return journey;
  const flags = { ...(journey.flags ?? {}) };
  const edges = { ...(journey.edges ?? {}) };
  const facts: Record<FactId, FactValue> = { ...(storedFacts(journey) as Record<FactId, FactValue>) };
  let rifts = journey.rifts;
  let touchedFlags = false;
  let touchedEdges = false;
  let touchedFacts = false;
  let touchedRifts = false;
  for (const effect of effects) {
    if (isRiftEffect(effect)) {
      // A rift action (#197) reads the journey as the effects before it left
      // it — a `setFlag` that satisfies an `opensWhen` counts — so it is
      // applied to that journey, in order, and only its rifts are kept.
      const now: JourneyState = { ...journey, flags, edges, facts, ...(rifts ? { rifts } : {}) };
      const after = applyRiftEffect(graph, now, effect);
      if (after !== now) {
        rifts = after.rifts;
        touchedRifts = true;
      }
      continue;
    }
    if (effect.type === "setFact" || effect.type === "adjustFact") {
      const declared = graph.facts[effect.fact];
      if (!declared) continue;
      facts[effect.fact] = writeFact(declared, readFact(declared, facts[effect.fact]), effect);
      touchedFacts = true;
      continue;
    }
    if (effect.type === "setFlag") {
      setFlag(flags, effect.flag, effect.value ?? true, campaign);
      touchedFlags = true;
    } else if (effect.type === "unlock") {
      edges[effect.edge] = "open";
      touchedEdges = true;
    } else if (effect.type === "lock") {
      edges[effect.edge] = "locked";
      touchedEdges = true;
    }
  }
  return {
    ...journey,
    ...(touchedFlags ? { flags } : {}),
    ...(touchedEdges ? { edges } : {}),
    ...(touchedFacts ? { facts } : {}),
    ...(touchedRifts ? { rifts } : {}),
  };
}

/**
 * Begins a visit at `node`. The journey passed in is already as it stands on
 * arrival — the incoming edge's effects applied — so the variant read here is
 * the one the edge made true (§3 `variants`).
 */
function enter(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  node: NodeId,
): { journey: JourneyState; arrival: Exclude<Arrival, "closed"> } {
  // `"closed"` cannot reach here: an exit into a completed closed node is
  // unavailable (`exitAvailability`), and the entry is never completed when an
  // attempt starts. Should content ever make it so, entering as a replay is
  // the answer that cannot strand the party.
  const raw = arrivalAt(graph, node, journey);
  const arrival = raw === "closed" ? "replay" : raw;
  const visits = bump(journey.visits, node);
  const chapter = chapterAtNode(graph, node, journey) ?? graph.nodes[node]!.chapter;
  const { ending: _ending, ...rest } = journey;
  return {
    journey: {
      ...rest,
      visits,
      node,
      visit: visits[node]!,
      // A pass revisit begins done: straight to the exit choice, no chapter,
      // and no completion counted (§6).
      status: arrival === "pass" ? "choosing" : "playing",
      chapter,
    },
    arrival,
  };
}

/**
 * The journey flags a completed run hands back (§5): each declared journey
 * flag's value in the run *becomes* its journey value — the run was seeded
 * with the journey's flags, so an untouched flag comes back as it went in.
 *
 * Route set members keep the fork rule the ordered campaigns' `routesTaken`
 * has: one road per set, and the newly taken one wins. Two members standing
 * after a chapter, of which exactly one is new, is a re-route; two *new* ones
 * is a content bug no rule resolves, and the set is left as it was.
 */
function readBackFlags(
  graph: ParsedCampaignGraph,
  before: Readonly<Record<string, boolean>> | undefined,
  run: Readonly<Record<string, boolean>>,
  campaign: JourneyCampaign | undefined,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const flag of graph.flags) if (run[flag] === true) next[flag] = true;
  for (const members of Object.values(campaign?.routeSets ?? {})) {
    if (!Array.isArray(members)) continue;
    const standing = members.filter((flag) => next[flag] === true);
    if (standing.length < 2) continue;
    const fresh = standing.filter((flag) => before?.[flag] !== true);
    if (fresh.length === 1) {
      for (const flag of members) if (flag !== fresh[0]) delete next[flag];
    } else {
      for (const flag of members) {
        if (before?.[flag] === true) next[flag] = true;
        else delete next[flag];
      }
    }
  }
  // Undeclared flags in `before` (content dropped one under a save) are not
  // carried: only declared flags cross the chapter boundary.
  return next;
}

// ---------------------------------------------------------------------------
// Reading a stored journey
// ---------------------------------------------------------------------------

/**
 * The migration ladder for stored journeys — the hook a later issue fills.
 *
 * Today there is one version, so the ladder is a single rung: a version-1 row
 * is returned as it is, and anything else is refused. When `JOURNEY_VERSION`
 * becomes 2, a `case 1:` here rewrites a version-1 row into version 2's shape
 * (and falls through), exactly as `migrate.ts` does for characters. A row from
 * a *newer* build is always refused: its meanings might be anything, and a
 * guess would play the party through doors that are not there.
 */
export function migrateJourney(raw: Record<string, unknown>): Record<string, unknown> | null {
  switch (raw.version) {
    case JOURNEY_VERSION:
      return raw;
    default:
      return null;
  }
}

/**
 * A stored journey (`CampaignProgressRecord.journey`), checked before anybody
 * acts on it.
 *
 * - absent → `{ ok: true, journey: null }`: nothing written yet. For a graph
 *   campaign that reads as a fresh start (`resumeJourney`); for an ordered one
 *   it is the only state there is, and nothing calls this.
 * - a version this build does not read → refused (`"version"`), never crashed
 *   on and never guessed at.
 * - standing at a node the declaration no longer has → refused
 *   (`"unknown-node"`): an id was renamed under the save, which §6 calls a
 *   migration. Counters for ids that are gone are ignored, not refused.
 */
export function readJourney(
  graph: ParsedCampaignGraph,
  raw: unknown,
): { ok: true; journey: JourneyState | null } | JourneyRefusal {
  if (raw === undefined || raw === null) return { ok: true, journey: null };
  if (!isRecord(raw)) return refuse("unreadable", "the saved journey is not a journey");
  const migrated = migrateJourney(raw);
  if (!migrated) {
    return refuse(
      "version",
      `the saved journey is version ${JSON.stringify(raw.version)}; this build reads version ${JOURNEY_VERSION}`,
    );
  }
  const journey = migrated as unknown as JourneyState;
  if (
    typeof journey.node !== "string" ||
    typeof journey.chapter !== "string" ||
    !Number.isInteger(journey.visit) ||
    journey.visit < 1 ||
    !STATUSES.includes(journey.status)
  ) {
    return refuse("unreadable", "the saved journey is missing where the party is");
  }
  if (!graph.nodes[journey.node]) {
    return refuse("unknown-node", `the saved journey stands at "${journey.node}", which this campaign no longer has`);
  }
  return { ok: true, journey };
}

// ---------------------------------------------------------------------------
// The three transitions
// ---------------------------------------------------------------------------

/**
 * A fresh attempt's journey: the first visit to the entry, playing.
 *
 * Deterministic — no clock, no id — so "an attempt with no journey written
 * yet" and "this" are the same journey for every reader, which is what lets
 * a graph attempt be created, or read, before its journey is ever stored.
 */
export function startJourney(graph: ParsedCampaignGraph, _campaign?: JourneyCampaign): JourneyState {
  const empty: JourneyState = {
    version: JOURNEY_VERSION,
    node: graph.entry,
    visit: 0,
    status: "playing",
    chapter: graph.nodes[graph.entry]!.chapter,
  };
  return settleRifts(graph, enter(graph, empty, graph.entry).journey);
}

/**
 * A stored journey, or the fresh one if none is stored — what CONTINUE
 * resumes. `fresh` says the journey has not been written yet.
 */
export function resumeJourney(
  graph: ParsedCampaignGraph,
  raw: unknown,
  campaign?: JourneyCampaign,
): { ok: true; journey: JourneyState; fresh: boolean } | JourneyRefusal {
  const read = readJourney(graph, raw);
  if (!read.ok) return read;
  if (read.journey) return { ok: true, journey: read.journey, fresh: false };
  return { ok: true, journey: startJourney(graph, campaign), fresh: true };
}

/** What a completed chapter run reports about the visit it played. */
export interface VisitReport {
  /** The visit, as the run was stamped at chapter start (`RunState.journeyVisit`). */
  node: NodeId;
  visit: number;
  /** The chapter the run played. Must be the one the visit resolved. */
  chapterId: string;
  outcome: ChapterOutcome;
  /** The run's flags as it ended; the journey flags are read back from these. */
  flags: Readonly<Record<string, boolean>>;
}

/**
 * The visit's chapter completed (§6, "A visit completes").
 *
 * - The current visit, still playing → completed: `completions` + 1, the
 *   outcome recorded as the node's latest, the journey flags read back, the
 *   chapter added to `chaptersCompleted` (and `firstCompletion` says whether
 *   that is news — XP pays only then). An ending node ends the journey.
 * - The current visit, already done → a duplicate.
 * - A visit the journey has had and left → a duplicate: a visit is only ever
 *   left by an exit, and an exit is only offered once the visit is done.
 * - A visit the journey never had → refused (`"stale-visit"`).
 */
export function completeVisit(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  report: VisitReport,
  campaign?: JourneyCampaign,
): VisitCompletion | JourneyRefusal {
  const current = report.node === journey.node && report.visit === journey.visit;
  if (!current) {
    if (Number.isInteger(report.visit) && report.visit >= 1 && report.visit <= count(journey.visits, report.node)) {
      return { ok: true, duplicate: true, journey };
    }
    return refuse(
      "stale-visit",
      `visit ${report.visit} to "${report.node}" is not one this journey has had (it is at visit ${journey.visit} to "${journey.node}")`,
    );
  }
  if (journey.status !== "playing") return { ok: true, duplicate: true, journey };
  if (report.chapterId !== journey.chapter) {
    return refuse(
      "wrong-chapter",
      `visit ${journey.visit} to "${journey.node}" plays "${journey.chapter}", not "${report.chapterId}"`,
    );
  }

  const node = graph.nodes[journey.node]!;
  const paid = journey.chaptersCompleted ?? [];
  const firstCompletion = !paid.includes(journey.chapter);
  const ended = node.ending !== undefined;
  // Rifts (#196): the chapter that just settled is one tick of the session
  // clock for every timed rift that was open while it played — then the
  // completion and its rules, then whatever they opened or ended (`rifts.ts`,
  // "when a rift moves").
  const aged = tickRifts(graph, journey, "chapters");
  const settled: JourneyState = {
    ...aged,
    completions: bump(journey.completions, journey.node),
    outcomes: { ...(journey.outcomes ?? {}), [journey.node]: report.outcome },
    flags: readBackFlags(graph, journey.flags, report.flags, campaign),
    chaptersCompleted: firstCompletion ? [...paid, journey.chapter] : [...paid],
    status: ended ? "ended" : "choosing",
    ...(ended ? { ending: journey.node } : {}),
  };
  // The node's completion rules (#198) read the journey the chapter has just
  // produced — this outcome, the flags it handed back — and write the world;
  // a rift that world opens (#196) opens now, at age 0.
  const next = applyEffects(graph, settled, completionEffects(graph, journey.node, settled), campaign);
  return { ok: true, duplicate: false, journey: settleRifts(graph, next), firstCompletion, ended };
}

/** An exit choice, as `CHOOSE_EXIT` reports it. */
export interface ExitReport {
  edge: EdgeId;
  /** The visit being left — `JourneyView.visit` as the screen saw it. */
  visit: number;
}

/**
 * Take an exit (§4, §6): only from the node the journey is at, only once its
 * visit is done, only if the exit is available. The edge is counted, its
 * effects applied in order, and then the destination is entered — so the
 * destination's variants see what the edge did.
 *
 * The same crossing reported again (`lastExit` matches) is a duplicate,
 * wherever the journey has got to since. A crossing from a visit the journey
 * is no longer at is refused (`"stale-visit"`): the screen that offered it is
 * out of date, and acting on it would move the party from somewhere it is not.
 */
export function takeExit(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  report: ExitReport,
  campaign?: JourneyCampaign,
): ExitCrossing | JourneyRefusal {
  const edge = graph.edges[report.edge];
  if (!edge) return refuse("unknown-edge", `there is no way called "${report.edge}"`);
  const last = journey.lastExit;
  if (last && last.edge === report.edge && last.node === edge.from && last.visit === report.visit) {
    return { ok: true, duplicate: true, journey };
  }
  if (journey.status === "ended") return refuse("ended", "this journey has reached its ending");
  if (edge.from !== journey.node) {
    return refuse("not-here", `"${report.edge}" leads out of "${edge.from}", and the party is at "${journey.node}"`);
  }
  if (report.visit !== journey.visit) {
    return refuse(
      "stale-visit",
      `the party is on visit ${journey.visit} to "${journey.node}", not visit ${report.visit}`,
    );
  }
  if (journey.status === "playing") {
    return refuse("still-playing", `"${journey.node}" has not been finished yet — there is no leaving mid-chapter`);
  }
  const availability = exitAvailability(graph, report.edge, journey);
  if (!availability.available) {
    return refuse("unavailable", `"${report.edge}" cannot be taken (${availability.reason})`, availability.reason);
  }

  // Where it leads is read *before* the crossing: a redirected rift (#197)
  // takes the party where it led when they chose it, whatever the crossing's
  // own effects then do to it.
  const destination = riftDestination(graph, report.edge, journey);
  // A rift crossing (#196) is this one party-wide move: counted against the
  // rift (and its linked partner) first, then one tick of the move clock for
  // every timed rift, then the edge's own bookkeeping, effects and arrival —
  // all in the one journey this returns, so it commits whole or not at all.
  const moved = tickRifts(graph, crossRift(graph, journey, report.edge), "visits");
  const crossed = applyEffects(
    graph,
    {
      ...moved,
      traversed: bump(journey.traversed, report.edge),
      lastExit: { node: journey.node, visit: journey.visit, edge: report.edge },
    },
    edge.effects,
    campaign,
  );
  const entered = enter(graph, crossed, destination);
  return { ok: true, duplicate: false, journey: settleRifts(graph, entered.journey), arrival: entered.arrival };
}

/** A rift action, as `RIFT_ACTION` reports it (#197). */
export interface RiftActionReport {
  action: RiftActionKind;
  /** The rift edge acted on — one of the exits of the node the party is at. */
  edge: EdgeId;
  /** The visit the party is choosing on — `JourneyView.visit` as the screen saw it. */
  visit: number;
  /** For `"redirect"`: where to turn the rift. */
  to?: NodeId;
}

/**
 * Why a rift action was refused (#197), beyond `takeExit`'s own reasons.
 *
 * - `"not-a-rift"` — the edge is not a rift.
 * - `"not-offered"` — this rift offers no such action, or its rule's `when`
 *   does not hold now.
 * - `"bad-destination"` — a redirect to somewhere the rift does not declare.
 * - `"no-change"` — the action would do nothing: a final rift, a persistent
 *   one that cannot close, a rift already as asked. (A party action is only
 *   ever offered when it would change something; this is the stale screen.)
 */
export type RiftActionRefusalCode =
  | Extract<JourneyRefusalCode, "unknown-edge" | "not-here" | "stale-visit" | "still-playing" | "ended">
  | "not-a-rift"
  | "not-offered"
  | "bad-destination"
  | "no-change";

export interface RiftActionRefusal {
  ok: false;
  code: RiftActionRefusalCode;
  message: string;
}

export type RiftActionResult =
  | JourneyDuplicate
  | { ok: true; duplicate: false; journey: JourneyState }
  | RiftActionRefusal;

const refuseAction = (code: RiftActionRefusalCode, message: string): RiftActionRefusal => ({ ok: false, code, message });

/**
 * The party acts on a rift (#197) — a fourth transition, beside enter,
 * complete and take an exit, and like taking an exit only between visits:
 * while the journey is choosing, at the node the rift leaves from.
 *
 * The action happens (`rifts.ts`), then its rule's effects in order, then
 * whatever that implies for every rift (`settleRifts` — a flag the action
 * set may wake another). No clock ticks: an action is neither a move nor a
 * chapter. The party stays where it is, still choosing — the same visit, so
 * the exits it now offers are answered against this journey.
 *
 * Idempotent on `(node, visit, action, edge, to)` — `lastAction`, checked
 * before anything else can refuse, exactly as `takeExit` checks `lastExit`:
 * a double tap or a retry after a lost response is the same action, answered
 * as done, and its effects never apply twice. Anything else is judged on its
 * merits, and an action is only taken when it would change something — so a
 * stale screen asking for something already done is refused (`"no-change"`),
 * never applied again.
 */
export function takeRiftAction(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  report: RiftActionReport,
  campaign?: JourneyCampaign,
): RiftActionResult {
  const edge = graph.edges[report.edge];
  if (!edge) return refuseAction("unknown-edge", `there is no way called "${report.edge}"`);
  if (!edge.rift) return refuseAction("not-a-rift", `"${report.edge}" is not a rift`);
  const last = journey.lastAction;
  if (
    last &&
    last.node === edge.from &&
    last.visit === report.visit &&
    last.action === report.action &&
    last.edge === report.edge &&
    last.to === report.to
  ) {
    return { ok: true, duplicate: true, journey };
  }
  if (journey.status === "ended") return refuseAction("ended", "this journey has reached its ending");
  if (edge.from !== journey.node) {
    return refuseAction("not-here", `"${report.edge}" leads out of "${edge.from}", and the party is at "${journey.node}"`);
  }
  if (report.visit !== journey.visit) {
    return refuseAction("stale-visit", `the party is on visit ${journey.visit} to "${journey.node}", not visit ${report.visit}`);
  }
  if (journey.status === "playing") {
    return refuseAction("still-playing", `"${journey.node}" has not been finished yet — the rift can wait`);
  }
  const rule = (RIFT_ACTION_KINDS as readonly string[]).includes(report.action)
    ? edge.rift.actions?.[report.action]
    : undefined;
  if (!rule) return refuseAction("not-offered", `the rift "${report.edge}" offers no "${String(report.action)}"`);
  if (!evaluateGraphCondition(rule.when, journey, edge.from, { facts: graph.facts })) {
    return refuseAction("not-offered", `"${report.action}" on the rift "${report.edge}" is not offered now`);
  }
  if (report.action === "redirect" && !riftDestinationRevealed(graph, report.edge, journey)) {
    return refuseAction("not-offered", `the party does not know where the rift "${report.edge}" leads, so cannot turn it`);
  }
  const change = riftActionChange(graph, journey, report.action, report.edge, report.to);
  if (!change.ok) {
    return refuseAction(change.code === "bad-destination" ? "bad-destination" : "no-change", change.message);
  }
  if (!change.changed) return refuseAction("no-change", `the rift "${report.edge}" is already so`);

  const acted: JourneyState = {
    ...change.journey,
    lastAction: {
      node: journey.node,
      visit: journey.visit,
      action: report.action,
      edge: report.edge,
      ...(report.to !== undefined ? { to: report.to } : {}),
    },
  };
  return { ok: true, duplicate: false, journey: settleRifts(graph, applyEffects(graph, acted, rule.effects, campaign)) };
}


// ---------------------------------------------------------------------------
// Reading where the journey is
// ---------------------------------------------------------------------------

/**
 * What the journey wants next — the one question CONTINUE asks.
 *
 * Resuming is not revisiting (§6): a `"playing"` journey answers the *same*
 * visit and the *same* chapter it resolved on arrival (variants are not
 * re-read), a `"choosing"` one answers the exit choice, never a replay.
 */
export function currentPlayable(graph: ParsedCampaignGraph, journey: JourneyState): Playable {
  if (journey.status === "ended") {
    return { kind: "ended", node: journey.node, visit: journey.visit, ending: journey.ending ?? journey.node };
  }
  if (journey.status === "choosing") {
    return { kind: "choose", node: journey.node, visit: journey.visit, exits: exitsFrom(graph, journey.node, journey) };
  }
  return { kind: "play", node: journey.node, visit: journey.visit, chapter: journey.chapter };
}

/** What an unlabelled rift with a hidden destination says on the screen. */
export const HIDDEN_RIFT_LABEL = "Into the rift";

/**
 * The journey as the screens draw it (`CampaignView.journey`). `titleOf`
 * turns a chapter id into its title, for nodes and exits without their own;
 * without it (or for a chapter it does not know) the node id stands in.
 * `campaign` is `takeExit`'s: the route sets that make a `setFlag` effect a
 * fork, needed here only to ask what a crossing *would* find on arrival.
 *
 * What it must not do is spoil (#195). Three rules, each the answer to "what
 * does a kid who has not been there learn from this?":
 *
 * - **An unexplored exit's label is the author's.** The edge's `label`, else
 *   the destination's own map `title`, else a neutral "Somewhere new" - never
 *   the destination's *chapter* title, which names the story beat ("The
 *   Dragon's Secret") the way a map label does not. A place the party has
 *   finished is theirs to name, so there the chapter title is fine.
 * - **`changed` is a flag, not a variant.** It says the place would be found
 *   different, not how, and only for a place already finished.
 * - **Hidden blocked exits are absent** (`exitsFrom`'s `visible`), as they
 *   were; `places` lists only nodes the party has entered.
 */
export function journeyView(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  titleOf: (chapterId: string) => string | undefined = () => undefined,
  campaign?: JourneyCampaign,
): JourneyView {
  const placeTitle = (node: NodeId): string =>
    graph.nodes[node]?.title ?? titleOf(graph.nodes[node]?.chapter ?? "") ?? node;
  const exits: JourneyExitView[] =
    journey.status !== "choosing"
      ? []
      : exitsFrom(graph, journey.node, journey)
          .filter((exit) => exit.visible)
          .map((exit) => {
            const edge = graph.edges[exit.edge]!;
            const rift = riftView(graph, exit.edge, journey);
            // A rift whose destination the players have not learned (#196)
            // must not be named by anything sent to a phone: not `to`, not a
            // title-derived label, not an arrival that says "been there", not
            // `changed`. Its crossing is not even simulated — what it would
            // find is exactly what the view may not say.
            const hidden = !riftDestinationRevealed(graph, exit.edge, journey);
            // An available exit is answered by the crossing itself, so the
            // edge's own effects count: a world fact it writes can turn the
            // destination's variant — and with it a variant's `revisit`
            // (#198) — before the party arrives. A blocked exit cannot be
            // crossed, and is told what the place is now.
            const crossing =
              exit.availability.available && !hidden ? simulateCrossing(graph, journey, exit.edge, campaign) : null;
            const arrival = hidden ? "new" : (crossing?.arrival ?? arrivalAt(graph, exit.to, journey));
            const label =
              edge.label ??
              (hidden
                ? HIDDEN_RIFT_LABEL
                : arrival === "new"
                  ? (graph.nodes[exit.to]?.title ?? "Somewhere new")
                  : placeTitle(exit.to));
            const changed = crossing !== null && foundChanged(journey, crossing);
            return {
              edge: exit.edge,
              to: hidden ? "" : exit.to,
              kind: exit.kind,
              label,
              available: exit.availability.available,
              ...(exit.availability.available ? {} : { reason: exit.availability.reason }),
              arrival,
              ...(edge.irreversible === true ? { irreversible: true as const } : {}),
              ...(edge.once === true ? { once: true as const } : {}),
              ...(changed ? { changed: true as const } : {}),
              ...(rift ? { rift } : {}),
              ...(hidden ? { hiddenDestination: true as const } : {}),
            };
          });
  const ending = journey.status === "ended" ? (journey.ending ?? journey.node) : undefined;
  const facts = visibleFacts(graph, journey);
  const riftActions = journey.status === "choosing" ? riftActionViews(graph, journey, exits, placeTitle) : [];
  // Nowhere to go and nothing to do (#197): the lint refuses content that can
  // get here, so only content changing under a save can. Said plainly.
  const stuck =
    journey.status === "choosing" &&
    riftActions.length === 0 &&
    !exitsFrom(graph, journey.node, journey).some((exit) => exit.availability.available);
  const places: JourneyPlaceView[] = graph.nodeOrder
    .filter((node) => count(journey.visits, node) > 0)
    .map((node) => ({
      node,
      title: placeTitle(node),
      visits: count(journey.visits, node),
      completed: count(journey.completions, node) > 0,
      ...(node === journey.node ? { here: true as const } : {}),
    }));
  return {
    node: journey.node,
    title: placeTitle(journey.node),
    visit: journey.visit,
    status: journey.status,
    chapter: journey.chapter,
    exits,
    ...(ending !== undefined
      ? { reachedEnding: { node: ending, title: graph.nodes[ending]?.ending?.title ?? placeTitle(ending) } }
      : {}),
    places,
    ...(facts.length > 0 ? { facts } : {}),
    ...(riftActions.length > 0 ? { riftActions } : {}),
    ...(stuck ? { stuck: true as const } : {}),
  };
}

/** What a rift action's button says when its rule has no `label` (#197). */
const ACTION_VERB: Readonly<Record<Exclude<RiftActionKind, "redirect">, string>> = {
  discover: "Search for a hidden way",
  open: "Open the rift",
  close: "Close the rift",
  stabilize: "Steady the rift",
};

/**
 * The rift actions offered now, as the screens draw them (#197). A label is
 * the rule's, else a verb — with the exit's own label when the exit is drawn,
 * which already keeps a hidden destination hidden (a discover says only
 * "Search for a hidden way": the rift it finds is not drawn yet). A redirect
 * names the place it turns toward the way an exit would: the map title for a
 * place not yet finished, never its chapter's.
 */
function riftActionViews(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  exits: readonly JourneyExitView[],
  placeTitle: (node: NodeId) => string,
): JourneyRiftActionView[] {
  return riftActionsFrom(graph, journey.node, journey).map((offer) => {
    const exit = exits.find((each) => each.edge === offer.edge);
    let label = offer.rule.label;
    if (label === undefined && offer.action === "redirect") {
      const to = offer.to!;
      const place = count(journey.completions, to) > 0 ? placeTitle(to) : (graph.nodes[to]?.title ?? "somewhere new");
      label = `Turn the rift toward ${place}`;
    } else if (label === undefined) {
      const verb = ACTION_VERB[offer.action as Exclude<RiftActionKind, "redirect">];
      label = exit && offer.action !== "discover" ? `${verb}: ${exit.label}` : verb;
    }
    return {
      action: offer.action,
      edge: offer.edge,
      label,
      ...(offer.to !== undefined ? { to: offer.to } : {}),
      ...(offer.action === "close" && !riftCanReopen(graph, offer.edge) ? { irreversible: true as const } : {}),
    };
  });
}


/**
 * The world facts the players may see (#198): those declared `visible`, in
 * authored order, with their values read through the declaration. A fact not
 * declared visible is never sent to a phone — the author's surprise stays one
 * — and a graph with no visible fact sends no `facts` key at all.
 */
function visibleFacts(graph: ParsedCampaignGraph, journey: JourneyState): JourneyFactView[] {
  const values = worldFacts(graph.facts, journey);
  return graph.factOrder
    .filter((id) => graph.facts[id]!.visible === true)
    .map((id) => {
      const fact = graph.facts[id]!;
      return { id, domain: fact.domain, label: fact.label ?? id, type: fact.type, value: values[id]! };
    });
}

/**
 * Would taking `edge` find its (already finished) destination different?
 *
 * Asked of `takeExit` itself rather than re-derived, so edge effects - the
 * mill wheel the crossing starts - count exactly as they will on the real
 * crossing: the chapter the destination would resolve to, against the
 * chapters this attempt has completed. "Different" is "a chapter the party has
 * never played" (`chaptersCompleted`): the journey keeps no per-place
 * "last played", and a place that flips back to a version they already played
 * is not news. A refusal (cannot happen for an available exit) is "no".
 */
function foundChanged(
  journey: JourneyState,
  crossing: { arrival: Exclude<Arrival, "closed">; chapter: string },
): boolean {
  // Only a place already finished can be found different. A `"pass"` arrival
  // counts too (#198): the restored village is walked through, not replayed,
  // but it is not the village the party left.
  if (crossing.arrival === "new") return false;
  return !(journey.chaptersCompleted ?? []).includes(crossing.chapter);
}

/** What crossing `edge` would be — arrival and the chapter resolved — or null when it cannot be crossed. */
function simulateCrossing(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  edge: EdgeId,
  campaign?: JourneyCampaign,
): { arrival: Exclude<Arrival, "closed">; chapter: string } | null {
  const crossed = takeExit(graph, journey, { edge, visit: journey.visit }, campaign);
  if (!crossed.ok || crossed.duplicate) return null;
  return { arrival: crossed.arrival, chapter: crossed.journey.chapter };
}
