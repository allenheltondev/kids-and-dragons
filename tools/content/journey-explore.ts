/**
 * Route coverage and playtesting for graph campaigns — the other half of #202.
 *
 * Two questions, answered two ways, and the point of this file is that they
 * are asked of the *same* rules:
 *
 *   1. COVERAGE (static, exhaustive). What can a party do? Which places,
 *      doors and endings does some playthrough reach; what is the shortest way
 *      to each; what happens to a once-edge or a rift after it is used; and
 *      where can a party get stuck. This reads the explorer behind
 *      `lintCampaignGraph` (`exploreCampaignGraph`, campaign-graph-lint.ts) and
 *      does not search again, so the report and the lint cannot disagree about
 *      what is reachable.
 *
 *   2. PLAYTEST (dynamic, bounded). Does the *runtime* behave? This drives the
 *      real transitions — `startJourney`, `completeVisit`, `takeExit` — along
 *      scripted paths, seeded random walks, and the explorer's own shortest
 *      paths replayed through them, and checks invariants after every step.
 *      The replay is the bridge: it asserts that the state the explorer
 *      predicted (node, flags, world facts, rift lifecycle) is the state the
 *      runtime produced. The lint is only worth trusting while that holds, so
 *      it is checked, not assumed.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANTS, AND WHY THESE
 *
 * After every step of every walk:
 *
 *   - the journey survives JSON unchanged (`JSON.parse(JSON.stringify(j))` is
 *     deep-equal to `j`, `undefined` keys included) and `readJourney` accepts it:
 *     the journey is what gets stored, so anything that does not round-trip is
 *     a lost write waiting for a reload;
 *   - `checkJourneySave` finds nothing wrong with it (journey-save.ts): the
 *     checker and the runtime agree on what a reachable journey looks like;
 *   - no counter goes backwards (visits, completions, traversals): they are
 *     the idempotence keys, and a decrease would let a repeat count twice;
 *   - the current visit is the latest counted, and a finished visit has a
 *     completion;
 *   - a rift that is final (consumed, expired, collapsed) stays that status;
 *   - a visit that is `choosing` at a non-ending has at least one open exit
 *     (the only place with no way on is an ending), and an `ended` journey is
 *     at an ending;
 *   - every transition reported twice is a no-op the second time
 *     (`duplicate: true`, same journey): the double-tap and the dropped
 *     response.
 *
 * Everything is deterministic: a seed fixes a walk, and the report prints the
 * trail of a failing one so it can be replayed by hand (`--path`).
 */

import { isDeepStrictEqual } from "node:util";
import {
  FINAL_RIFT_STATUSES,
  completeVisit,
  currentPlayable,
  exitAvailability,
  exploreCampaignGraph,
  readFact,
  readJourney,
  riftState,
  startJourney,
  takeExit,
} from "@kad/shared";
import type {
  ChapterFlagWrites,
  ChapterOutcome,
  EdgeId,
  GraphExit,
  GraphLintOptions,
  GraphSearch,
  GraphSearchState,
  JourneyState,
  NodeId,
  ParsedCampaignGraph,
} from "@kad/shared";
import { checkJourneySave } from "./journey-save.ts";

/** What a walk needs of the campaign beyond the graph: fork sets. */
type WalkCampaign = { routeSets?: Record<string, string[]> };

// ===========================================================================
// 1. Coverage
// ===========================================================================

/** The shortest known way to a state: the edges taken, and the same in words. */
export interface RoutePath {
  /** The explorer state this path ends at. */
  state: number;
  edges: EdgeId[];
  text: string;
}

export type SoftlockKind = "stranded" | "trapped";

export interface Softlock {
  kind: SoftlockKind;
  node: NodeId;
  path: RoutePath;
  /** For `stranded`: each exit and why it is shut. For `trapped`: empty. */
  blocks: { edge: EdgeId; reason: string }[];
}

/** An edge that can be used up (once, a rift), and what the world looks like afterwards. */
export interface ConsumedLink {
  edge: EdgeId;
  /** Why it is unavailable in the states counted. */
  reason: "spent" | "rift-consumed" | "rift-expired" | "rift-collapsed";
  /** Reachable states in which the link is used up. */
  states: number;
  /** The shortest way to a state where it is used up. */
  firstSpent: RoutePath;
  /**
   * The shortest way to a state where the party stands at the link's start,
   * choosing, with the link used up — where the runtime must refuse it.
   * Absent if the party can never be back there with it used up.
   */
  refusedAt?: RoutePath;
  /** Every state with the link used up can still reach an ending. */
  stillWinnable: boolean;
}

export interface RouteCoverage {
  /** The search ran to completion; every "never" below is an answer, not a guess. */
  complete: boolean;
  states: number;
  /** Reachable by edges alone, guards ignored — the lint's UNREACHABLE_NODE. */
  unreachableNodes: NodeId[];
  /** Connected by edges but no playthrough enters it. */
  neverEntered: NodeId[];
  nodes: { id: NodeId; entered: boolean; shortest?: RoutePath }[];
  endings: { id: NodeId; reached: boolean; shortest?: RoutePath }[];
  endingsReached: number;
  edges: { id: EdgeId; traversable: boolean; shortest?: RoutePath }[];
  consumed: ConsumedLink[];
  softlocks: Softlock[];
  /** An ending is connected but no playthrough finishes (the lint's NO_ENDING_WINNABLE). */
  noEndingWinnable: boolean;
}

/** State indexes from the root to `state`, following BFS parents. */
export function stateChain(search: GraphSearch, state: number): number[] {
  const chain: number[] = [];
  for (let i = state; i !== -1; i = search.states[i]!.parent) chain.unshift(i);
  return chain;
}

export function pathTo(search: GraphSearch, state: number, extra?: EdgeId): RoutePath {
  const chain = stateChain(search, state);
  const edges = chain.map((i) => search.states[i]!.step.edge).filter((edge): edge is EdgeId => edge !== null);
  if (extra !== undefined) edges.push(extra);
  const words = chain.map((i) => {
    const at = search.states[i]!;
    const { edge, label } = at.step;
    const note = label !== "" && label !== "passed through" && label !== "ending" ? ` (${label})` : "";
    return edge === null ? `start at "${at.node}"${note}` : `-[${edge}]-> "${at.node}"${note}`;
  });
  if (extra !== undefined) words.push(`-[${extra}]->`);
  return { state, edges, text: words.join(" ") };
}

/** The states from which some ending is still reachable (reverse BFS from the ended ones). */
export function winnableStates(search: GraphSearch): Set<number> {
  const reverse: number[][] = search.states.map(() => []);
  search.succ.forEach((list, from) => list.forEach(({ to }) => reverse[to]!.push(from)));
  const winnable = new Set<number>();
  const queue: number[] = [];
  search.states.forEach((state, i) => {
    if (state.ended) {
      winnable.add(i);
      queue.push(i);
    }
  });
  for (let head = 0; head < queue.length; head += 1) {
    for (const before of reverse[queue[head]!]!) {
      if (!winnable.has(before)) {
        winnable.add(before);
        queue.push(before);
      }
    }
  }
  return winnable;
}

const SPENT_REASONS = ["spent", "rift-consumed", "rift-expired", "rift-collapsed"] as const;

export function routeCoverage(graph: ParsedCampaignGraph, search: GraphSearch): RouteCoverage {
  const { states, succ } = search;
  const winnable = winnableStates(search);

  // --- nodes and endings: the first state at each is a shortest way there ---
  const firstAt = new Map<NodeId, number>();
  states.forEach((state, i) => {
    if (!firstAt.has(state.node)) firstAt.set(state.node, i);
  });

  // --- edges: the first state that takes each ---------------------------------
  const firstTaking = new Map<EdgeId, number>();
  succ.forEach((list, i) => {
    for (const { edge } of list) if (!firstTaking.has(edge)) firstTaking.set(edge, i);
  });

  // --- statically unreachable, and reachable-by-edges-but-never-entered -------
  const staticReach = new Set<NodeId>([graph.entry]);
  const queue: NodeId[] = [graph.entry];
  for (let head = 0; head < queue.length; head += 1) {
    for (const id of graph.exits[queue[head]!] ?? []) {
      const to = graph.edges[id]!.to;
      if (!staticReach.has(to)) {
        staticReach.add(to);
        queue.push(to);
      }
    }
  }
  const unreachableNodes = graph.nodeOrder.filter((id) => !staticReach.has(id));
  const neverEntered = search.complete ? graph.nodeOrder.filter((id) => staticReach.has(id) && !firstAt.has(id)) : [];

  // --- consumed links ------------------------------------------------------------
  const consumed: ConsumedLink[] = [];
  const tracks = graph.edgeOrder.filter((id) => graph.edges[id]!.once === true || graph.edges[id]!.rift !== undefined);
  for (const id of tracks) {
    const edge = graph.edges[id]!;
    let first = -1;
    let refused = -1;
    let count = 0;
    let reason: ConsumedLink["reason"] | undefined;
    let allWinnable = true;
    const strandedSet = new Set(search.stranded.map((each) => each.state));
    states.forEach((state, i) => {
      if (state.ended) return;
      const block = blockOf(graph, id, state);
      if (block === undefined) return;
      count += 1;
      reason ??= block;
      if (first === -1) first = i;
      if (refused === -1 && state.node === edge.from && !strandedSet.has(i)) refused = i;
      if (!winnable.has(i)) allWinnable = false;
    });
    if (first === -1 || reason === undefined) continue;
    consumed.push({
      edge: id,
      reason,
      states: count,
      firstSpent: pathTo(search, first),
      ...(refused === -1 ? {} : { refusedAt: pathTo(search, refused) }),
      stillWinnable: allWinnable,
    });
  }

  // --- softlocks ---------------------------------------------------------------------
  const softlocks: Softlock[] = [];
  const strandedStates = new Set<number>();
  const seenNodes = new Set<NodeId>();
  for (const { state, blocks } of search.stranded) {
    strandedStates.add(state);
    const node = states[state]!.node;
    if (seenNodes.has(node)) continue;
    seenNodes.add(node);
    softlocks.push({ kind: "stranded", node, path: pathTo(search, state), blocks: blocks.map((b) => ({ edge: b.edge, reason: b.reason })) });
  }
  const anyEnded = states.some((state) => state.ended);
  if (search.complete && anyEnded) {
    states.forEach((state, i) => {
      if (winnable.has(i) || state.ended || strandedStates.has(i)) return;
      const entering = state.parent === -1 || winnable.has(state.parent);
      if (!entering || seenNodes.has(state.node)) return;
      seenNodes.add(state.node);
      softlocks.push({ kind: "trapped", node: state.node, path: pathTo(search, i), blocks: [] });
    });
  }

  const endings = graph.endings.map((id) => {
    const at = states.findIndex((state) => state.ended && state.node === id);
    return at === -1 ? { id, reached: false } : { id, reached: true, shortest: pathTo(search, at) };
  });

  return {
    complete: search.complete,
    states: states.length,
    unreachableNodes,
    neverEntered,
    nodes: graph.nodeOrder.map((id) => {
      const at = firstAt.get(id);
      return at === undefined ? { id, entered: false } : { id, entered: true, shortest: pathTo(search, at) };
    }),
    endings,
    endingsReached: endings.filter((ending) => ending.reached).length,
    edges: graph.edgeOrder.map((id) => {
      const at = firstTaking.get(id);
      return at === undefined ? { id, traversable: false } : { id, traversable: true, shortest: pathTo(search, at, id) };
    }),
    consumed,
    softlocks,
    noEndingWinnable: !anyEnded && graph.endings.length > 0,
  };
}

/** Is `edge` used up in this state, and how — asked of the real `exitAvailability`. */
function blockOf(graph: ParsedCampaignGraph, edge: EdgeId, state: GraphSearchState): ConsumedLink["reason"] | undefined {
  const availability = exitAvailability(graph, edge, state.facts);
  if (availability.available) return undefined;
  return (SPENT_REASONS as readonly string[]).includes(availability.reason)
    ? (availability.reason as ConsumedLink["reason"])
    : undefined;
}

/** Search once, report coverage: the pair most callers want. */
export function exploreRoutes(graph: ParsedCampaignGraph, options: GraphLintOptions = {}) {
  const search = exploreCampaignGraph(graph, options);
  return { search, coverage: routeCoverage(graph, search) };
}

// ===========================================================================
// 2. Playtest
// ===========================================================================

export type ViolationCode =
  | "ROUNDTRIP"
  | "READ_REFUSED"
  | "SAVE_CHECK"
  | "COUNTER_DECREASED"
  | "VISIT_MISMATCH"
  | "RIFT_NOT_FINAL"
  | "NO_OPEN_EXIT"
  | "ENDED_NOT_ENDING"
  | "TRANSITION_REFUSED"
  | "DUPLICATE_NOT_NOOP"
  | "FRESH_REPORTED_DUPLICATE"
  | "SCRIPT_BLOCKED"
  | "EXPLORER_DIVERGES"
  | "SPENT_LINK_NOT_REFUSED";

export interface Violation {
  code: ViolationCode;
  /** Which walk, e.g. `random#3` or `ending:dawn-gate`. */
  walk: string;
  /** 0-based transition number within the walk. */
  step: number;
  message: string;
  /** The walk so far, in words, for replaying by hand. */
  trail: string[];
}

export interface WalkResult {
  walk: string;
  steps: number;
  /** The walk reached an ending. */
  ended: boolean;
  /** Where it stopped. */
  at: NodeId;
  nodes: NodeId[];
  edges: EdgeId[];
  endings: NodeId[];
  violations: Violation[];
  trail: string[];
}

/** What decides a walk: how a chapter ends and which exit is taken. */
interface Driver {
  name: string;
  chapter(j: JourneyState): { outcome: ChapterOutcome; flags: Record<string, boolean> };
  /** An edge id; `null` to stop; the runtime is asked about it either way. */
  exit(j: JourneyState, open: GraphExit[]): EdgeId | null;
  /** Called after each transition; a non-empty string is an EXPLORER_DIVERGES. */
  after?(j: JourneyState): string | null;
  /** Called once the walk stops; extra violations. */
  finish?(j: JourneyState): { code: ViolationCode; message: string }[];
}

interface WalkOptions {
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 200;

function counterDecreases(prev: JourneyState, next: JourneyState): string | null {
  for (const key of ["visits", "completions", "traversed"] as const) {
    for (const [id, before] of Object.entries(prev[key] ?? {})) {
      const after = next[key]?.[id] ?? 0;
      if (after < before) return `${key}["${id}"] went from ${before} to ${after}`;
    }
  }
  return null;
}

/**
 * Drives the real transitions to a stop, checking the invariants listed in the
 * file header. Never throws on a refused transition: a refusal is a finding.
 */
export function playthrough(
  graph: ParsedCampaignGraph,
  campaign: WalkCampaign,
  driver: Driver,
  options: WalkOptions = {},
): WalkResult {
  const max = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const violations: Violation[] = [];
  const trail: string[] = [];
  const nodes = new Set<NodeId>();
  const edges = new Set<EdgeId>();
  const endings = new Set<NodeId>();
  let step = 0;
  const flag = (code: ViolationCode, message: string): void => {
    violations.push({ code, walk: driver.name, step, message, trail: [...trail] });
  };

  let j = startJourney(graph, campaign);
  nodes.add(j.node);
  trail.push(`start at "${j.node}"`);

  /** Invariants on a journey as it stands, and against the one before it. */
  const check = (next: JourneyState, prev: JourneyState | null): void => {
    const copy = JSON.parse(JSON.stringify(next)) as unknown;
    if (!isDeepStrictEqual(copy, next)) flag("ROUNDTRIP", "the journey changes when it goes through JSON (an undefined key, a non-JSON value?)");
    const read = readJourney(graph, copy);
    if (!read.ok) flag("READ_REFUSED", `readJourney refuses the journey: ${read.message}`);
    else if (!isDeepStrictEqual(read.journey, next)) flag("READ_REFUSED", "readJourney does not return the journey it was given");
    const save = checkJourneySave(graph, copy);
    if (save.verdict !== "ok") {
      flag("SAVE_CHECK", `checkJourneySave: ${save.verdict}: ${save.issues.filter((i) => i.severity === "error" || i.class === "dangling").map((i) => `${i.path} ${i.message}`).join("; ")}`);
    }
    if ((next.visits?.[next.node] ?? 0) !== next.visit) {
      flag("VISIT_MISMATCH", `on visit ${next.visit} to "${next.node}" but counting ${next.visits?.[next.node] ?? 0}`);
    }
    if (next.status !== "playing" && (next.completions?.[next.node] ?? 0) === 0) {
      flag("VISIT_MISMATCH", `the visit to "${next.node}" is ${next.status} but nothing there was ever completed`);
    }
    if (next.status === "ended" && graph.nodes[next.node]!.ending === undefined) {
      flag("ENDED_NOT_ENDING", `the journey is ended at "${next.node}", which is not an ending`);
    }
    if (prev) {
      const down = counterDecreases(prev, next);
      if (down) flag("COUNTER_DECREASED", down);
      for (const id of graph.edgeOrder) {
        if (graph.edges[id]!.rift === undefined) continue;
        const before = riftState(graph, id, prev)!.status;
        const after = riftState(graph, id, next)!.status;
        if ((FINAL_RIFT_STATUSES as readonly string[]).includes(before) && before !== after) {
          flag("RIFT_NOT_FINAL", `rift "${id}" was ${before} and is now ${after}`);
        }
      }
    }
    nodes.add(next.node);
    if (next.status === "ended") endings.add(next.node);
  };

  check(j, null);
  const diverged = driver.after?.(j);
  if (diverged) flag("EXPLORER_DIVERGES", diverged);

  for (; step < max; step += 1) {
    const playable = currentPlayable(graph, j);
    if (playable.kind === "ended") break;
    const prev = j;

    if (playable.kind === "play") {
      const result = driver.chapter(j);
      const report = { node: j.node, visit: j.visit, chapterId: j.chapter, outcome: result.outcome, flags: result.flags };
      const done = completeVisit(graph, j, report, campaign);
      if (!done.ok) {
        flag("TRANSITION_REFUSED", `completeVisit refused ${j.node}#${j.visit}: ${done.message}`);
        break;
      }
      if (done.duplicate) {
        flag("FRESH_REPORTED_DUPLICATE", `the first completion of ${j.node}#${j.visit} was reported as a duplicate`);
        break;
      }
      const again = completeVisit(graph, done.journey, report, campaign);
      if (!again.ok || !again.duplicate || !isDeepStrictEqual(again.journey, done.journey)) {
        flag("DUPLICATE_NOT_NOOP", `reporting ${j.node}#${j.visit} complete twice changed the journey`);
      }
      j = done.journey;
      trail.push(`complete "${prev.node}" (${result.outcome})`);
    } else {
      const open = playable.exits.filter((exit) => exit.availability.available);
      if (open.length === 0) {
        flag("NO_OPEN_EXIT", `"${j.node}" is not an ending and none of its exits is open`);
        break;
      }
      const choice = driver.exit(j, open);
      if (choice === null) break;
      const exit = playable.exits.find((each) => each.edge === choice);
      if (!exit || !exit.availability.available) {
        const why = exit && !exit.availability.available ? ` (${exit.availability.reason})` : " (it does not leave this node)";
        flag("SCRIPT_BLOCKED", `the walk asked for "${choice}", which cannot be taken from "${j.node}"${why}`);
        break;
      }
      const crossing = takeExit(graph, j, { edge: choice, visit: j.visit }, campaign);
      if (!crossing.ok) {
        flag("TRANSITION_REFUSED", `takeExit refused "${choice}": ${crossing.message}`);
        break;
      }
      if (crossing.duplicate) {
        flag("FRESH_REPORTED_DUPLICATE", `the first crossing of "${choice}" was reported as a duplicate`);
        break;
      }
      const again = takeExit(graph, crossing.journey, { edge: choice, visit: j.visit }, campaign);
      if (!again.ok || !again.duplicate || !isDeepStrictEqual(again.journey, crossing.journey)) {
        flag("DUPLICATE_NOT_NOOP", `taking "${choice}" twice moved the journey twice`);
      }
      const before = prev.traversed?.[choice] ?? 0;
      if ((crossing.journey.traversed?.[choice] ?? 0) !== before + 1) {
        flag("COUNTER_DECREASED", `taking "${choice}" did not count the crossing once (${before} -> ${crossing.journey.traversed?.[choice] ?? 0})`);
      }
      j = crossing.journey;
      edges.add(choice);
      trail.push(`-[${choice}]-> "${j.node}"`);
    }

    check(j, prev);
    const off = driver.after?.(j);
    if (off) flag("EXPLORER_DIVERGES", off);
  }

  for (const extra of driver.finish?.(j) ?? []) flag(extra.code, extra.message);
  return {
    walk: driver.name,
    steps: step,
    ended: j.status === "ended",
    at: j.node,
    nodes: [...nodes],
    edges: [...edges],
    endings: [...endings],
    violations,
    trail,
  };
}

// --- chapter results ------------------------------------------------------------

/** Mulberry32: tiny, seedable, the same on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a chapter hands back in `flags`: the run was seeded with the journey's
 * flags, so an untouched flag comes back as it went in. A chapter the walker
 * knows can set only what `chapterFlagWrites` says; one it does not know
 * (placeholder fixture chapters) may set any declared flag either way, the
 * explorer's own conservative reading.
 */
function runFlags(
  graph: ParsedCampaignGraph,
  j: JourneyState,
  chapter: string,
  writes: ((chapter: string) => ChapterFlagWrites | undefined) | undefined,
  pick: (flag: string, now: boolean, can: { up: boolean; down: boolean }) => boolean,
): Record<string, boolean> {
  const known = writes?.(chapter);
  const out: Record<string, boolean> = {};
  for (const flag of graph.flags) {
    const now = j.flags?.[flag] === true;
    const can = known === undefined ? { up: true, down: true } : { up: known.setsTrue.includes(flag), down: known.setsFalse.includes(flag) };
    out[flag] = pick(flag, now, can);
  }
  return out;
}

// --- strategies ------------------------------------------------------------------

export interface PlaytestOptions extends WalkOptions {
  chapterFlags?: (chapter: string) => ChapterFlagWrites | undefined;
}

/** A seeded random walk: uniform over open exits, preferring doors not yet taken. */
export function randomWalk(
  graph: ParsedCampaignGraph,
  campaign: WalkCampaign,
  seed: number,
  name: string,
  options: PlaytestOptions = {},
): WalkResult {
  const next = rng(seed);
  const taken = new Set<EdgeId>();
  const driver: Driver = {
    name,
    chapter: (j) => ({
      outcome: next() < 0.5 ? "success" : "setback",
      flags: runFlags(graph, j, j.chapter, options.chapterFlags, (_f, now, can) =>
        now ? !(can.down && next() < 0.3) : can.up && next() < 0.5,
      ),
    }),
    exit: (_j, open) => {
      const fresh = open.filter((exit) => !taken.has(exit.edge));
      const pool = fresh.length > 0 && next() < 0.75 ? fresh : open;
      const pick = pool[Math.floor(next() * pool.length)]!;
      taken.add(pick.edge);
      return pick.edge;
    },
  };
  return playthrough(graph, campaign, driver, options);
}

/**
 * A scripted walk: the named edges, in order. An entry may carry the result
 * of the chapter *before* the exit: `edge:setback` plays that chapter as a
 * setback. Chapters are played as successes that set every flag they can —
 * the generous reading, so a script rarely needs to say how a chapter went.
 */
export function scriptedWalk(
  graph: ParsedCampaignGraph,
  campaign: WalkCampaign,
  script: readonly string[],
  options: PlaytestOptions = {},
): WalkResult {
  let at = 0;
  const parsed = script.map((entry) => {
    const [edge, outcome] = entry.split(":");
    return { edge: edge!, outcome: (outcome === "setback" ? "setback" : "success") as ChapterOutcome };
  });
  const driver: Driver = {
    name: `path:${script.join(",")}`,
    chapter: (j) => ({
      outcome: parsed[at]?.outcome ?? "success",
      flags: runFlags(graph, j, j.chapter, options.chapterFlags, (_f, now, can) => now || can.up),
    }),
    exit: () => {
      const entry = parsed[at];
      at += 1;
      return entry?.edge ?? null;
    },
  };
  return playthrough(graph, campaign, driver, options);
}

/**
 * How the chapter that produced an explorer state ended, read off the step's
 * label (`success, +found_the_lens, -x`: the outcome, then the flags the
 * chapter changed from what the journey held on arrival). The label is the
 * explorer's own account of that completion and is generated in one place
 * (`arrive`, campaign-graph-lint.ts); reading it back here is what lets the
 * replay hand the runtime the chapter's *result* rather than the state after
 * the node's `onComplete` rules, which may have cleared a flag the chapter set
 * (the rules read the flag; replaying the cleared value would never fire them).
 */
function chapterResult(
  graph: ParsedCampaignGraph,
  j: JourneyState,
  label: string,
): { outcome: ChapterOutcome; flags: Record<string, boolean> } {
  const flags: Record<string, boolean> = {};
  for (const flag of graph.flags) flags[flag] = j.flags?.[flag] === true;
  let outcome: ChapterOutcome = "success";
  for (const note of label.split(", ")) {
    if (note === "success" || note === "setback") outcome = note;
    else if ((note.startsWith("+") || note.startsWith("-")) && note.slice(1) in flags) flags[note.slice(1)] = note.startsWith("+");
  }
  return { outcome, flags };
}

/**
 * Replays the explorer's shortest path to a state through the runtime. The
 * explorer says how each chapter ended and which flags it left; the runtime
 * is asked to do exactly that, and after every step must land where the
 * explorer predicted (`EXPLORER_DIVERGES`).
 *
 * `then` adds the scenario the path was chosen for: `take` crosses one more
 * edge after the path (the edge's own coverage walk); `refuse` asks the
 * runtime to refuse an edge in the state reached, for the reason the explorer
 * gives (a used-up link must be refused, not merely absent from a list).
 */
export function replayState(
  graph: ParsedCampaignGraph,
  campaign: WalkCampaign,
  search: GraphSearch,
  target: number,
  name: string,
  then?: { take?: EdgeId; refuse?: { edge: EdgeId; reason: ConsumedLink["reason"] } },
  options: WalkOptions = {},
): WalkResult {
  const chain = stateChain(search, target);
  let k = 0;
  let took = false;
  const at = (): GraphSearchState => search.states[chain[k]!]!;
  const driver: Driver = {
    name,
    chapter: (j) => {
      // Past the end of the explorer's path (the destination of `then.take`)
      // there is nothing to follow: play the chapter the generous way.
      if (took) return { outcome: "success", flags: Object.fromEntries(graph.flags.map((flag) => [flag, j.flags?.[flag] === true])) };
      return chapterResult(graph, j, at().step.label);
    },
    exit: () => {
      const next = chain[k + 1];
      if (next !== undefined) {
        k += 1;
        return search.states[next]!.step.edge;
      }
      if (then?.take !== undefined && !took) {
        took = true;
        return then.take;
      }
      return null;
    },
    after: (j) => (took ? null : compare(graph, at(), j)),
    finish: (j) => {
      const out: { code: ViolationCode; message: string }[] = [];
      if (then?.refuse) {
        const { edge, reason } = then.refuse;
        const refused = takeExit(graph, j, { edge, visit: j.visit }, campaign);
        if (refused.ok || refused.code !== "unavailable" || refused.reason !== reason) {
          out.push({
            code: "SPENT_LINK_NOT_REFUSED",
            message: `"${edge}" should be refused as ${reason} here, but takeExit said ${refused.ok ? "ok" : `${refused.code}${refused.reason ? ` (${refused.reason})` : ""}`}`,
          });
        }
      }
      if (k !== chain.length - 1) {
        out.push({ code: "EXPLORER_DIVERGES", message: `the walk stopped ${chain.length - 1 - k} step(s) short of the explorer's path` });
      }
      return out;
    },
  };
  return playthrough(graph, campaign, driver, options);
}

/**
 * The explorer's state against the runtime's. Compared: where the party is,
 * and — once the visit is done, which is the moment the explorer's state
 * describes — the tracked flags, lock overrides, world facts, completions of
 * tracked nodes, and every rift's lifecycle status, each read through the same
 * helpers the runtime reads them with. (Visit counts are the explorer's
 * capped projection and are not compared.)
 */
function compare(graph: ParsedCampaignGraph, state: GraphSearchState, j: JourneyState): string | null {
  if (j.node !== state.node) return `the runtime is at "${j.node}" but the explorer expected "${state.node}"`;
  if (state.ended) return j.status === "ended" || j.status === "playing" ? null : `the runtime is ${j.status} at the ending "${j.node}"`;
  if (j.status === "playing") return null;
  for (const [flag, value] of Object.entries(state.facts.flags ?? {})) {
    if ((j.flags?.[flag] === true) !== (value === true)) {
      return `flag "${flag}" is ${j.flags?.[flag] === true} in the runtime but ${value === true} in the explorer`;
    }
  }
  for (const [id, over] of Object.entries(state.facts.edges ?? {})) {
    if (j.edges?.[id] !== over) return `edge "${id}" lock override is ${String(j.edges?.[id])} in the runtime but ${over} in the explorer`;
  }
  for (const [id, value] of Object.entries(state.facts.facts ?? {})) {
    const fact = graph.facts[id];
    if (!fact) continue;
    const mine = readFact(fact, j.facts?.[id]);
    if (mine !== readFact(fact, value)) return `fact "${id}" is ${JSON.stringify(mine)} in the runtime but ${JSON.stringify(value)} in the explorer`;
  }
  for (const id of Object.keys(state.facts.completions ?? {})) {
    if ((j.completions?.[id] ?? 0) === 0) return `"${id}" is completed in the explorer but not in the runtime`;
  }
  for (const id of Object.keys(state.facts.traversed ?? {})) {
    if ((j.traversed?.[id] ?? 0) === 0) return `edge "${id}" is taken in the explorer but not in the runtime`;
  }
  for (const id of graph.edgeOrder) {
    if (graph.edges[id]!.rift === undefined) continue;
    const mine = riftState(graph, id, j)!;
    const theirs = riftState(graph, id, state.facts)!;
    if (mine.status !== theirs.status) return `rift "${id}" is ${mine.status} in the runtime but ${theirs.status} in the explorer`;
  }
  return null;
}

// ===========================================================================
// 3. The whole playtest
// ===========================================================================

export interface PlaytestReport {
  walks: WalkResult[];
  violations: Violation[];
  /** What the walks between them entered, took and finished. */
  covered: { nodes: NodeId[]; edges: EdgeId[]; endings: NodeId[] };
}

export interface PlaytestPlan extends PlaytestOptions {
  /** Seeded random walks: `runs` of them from `seed`. */
  random?: { seed: number; runs: number };
  /** Scripted walks, each a list of edge ids. */
  paths?: string[][];
  /**
   * Replay the explorer's shortest path to every ending, to every edge, and to
   * every spent link (then ask the runtime to refuse it), through the runtime.
   */
  replay?: { search: GraphSearch; coverage: RouteCoverage };
}

export function playtest(graph: ParsedCampaignGraph, campaign: WalkCampaign, plan: PlaytestPlan): PlaytestReport {
  const walks: WalkResult[] = [];
  for (const script of plan.paths ?? []) walks.push(scriptedWalk(graph, campaign, script, plan));
  if (plan.random) {
    for (let run = 0; run < plan.random.runs; run += 1) {
      walks.push(randomWalk(graph, campaign, plan.random.seed * 7919 + run, `random#${run}`, plan));
    }
  }
  if (plan.replay) {
    const { search, coverage } = plan.replay;
    for (const ending of coverage.endings) {
      if (ending.shortest) walks.push(replayState(graph, campaign, search, ending.shortest.state, `ending:${ending.id}`, undefined, plan));
    }
    for (const edge of coverage.edges) {
      if (edge.shortest) walks.push(replayState(graph, campaign, search, edge.shortest.state, `edge:${edge.id}`, { take: edge.id }, plan));
    }
    for (const link of coverage.consumed) {
      if (link.refusedAt) {
        walks.push(replayState(graph, campaign, search, link.refusedAt.state, `spent:${link.edge}`, { refuse: { edge: link.edge, reason: link.reason } }, plan));
      }
    }
  }
  const nodes = new Set<NodeId>();
  const edges = new Set<EdgeId>();
  const endings = new Set<NodeId>();
  for (const walk of walks) {
    walk.nodes.forEach((id) => nodes.add(id));
    walk.edges.forEach((id) => edges.add(id));
    walk.endings.forEach((id) => endings.add(id));
  }
  return {
    walks,
    violations: walks.flatMap((walk) => walk.violations),
    covered: {
      nodes: graph.nodeOrder.filter((id) => nodes.has(id)),
      edges: graph.edgeOrder.filter((id) => edges.has(id)),
      endings: graph.endings.filter((id) => endings.has(id)),
    },
  };
}
