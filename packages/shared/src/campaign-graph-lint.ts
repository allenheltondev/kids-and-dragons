/**
 * Graph campaigns — can the declaration actually be walked? (#193)
 *
 * `parseCampaignGraph` (campaign-graph.ts) answers "does every name in the
 * declaration point at something". This file answers the question after it:
 * given a graph whose names all resolve, can a party get from the entry to an
 * ending, and is there any way to get *stuck* on the way? It reads the
 * `ParsedCampaignGraph` that function produces and never the raw JSON.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RUNS THE SAME RULES THE RUNTIME WILL
 *
 * A hand-rolled approximation of "which doors are open" would be a second
 * implementation of the rule `exitAvailability` already is, and the two would
 * drift: the validator would bless graphs the server then strands a party in,
 * or reject graphs the server would walk fine. So the softlock search below
 * does not re-derive anything. It builds a `JourneyFacts` for every abstract
 * state and asks `exitsFrom`, `arrivalAt` and `chapterAtNode` — the same
 * helpers #194's transitions and #195's screens call — and applies an edge's
 * effects the way the doc says they apply. Where it simplifies, it simplifies
 * *what it tracks*, never what a guard means.
 *
 * Imports `./campaign-graph.ts` with its extension because
 * tools/content/validate.mjs loads this file straight under Node, which strips
 * types but resolves no `.js`-for-`.ts` specifiers (the reason
 * campaign-graph.ts itself imports only types). The one runtime import is
 * therefore spelled the way Node needs it.
 *
 * ---------------------------------------------------------------------------
 * THE CHECKS
 *
 * Static (read off the edges, guards ignored — "possibly reachable"):
 *
 * - `UNREACHABLE_NODE`            no chain of edges leads from the entry here.
 * - `NO_ENDING_REACHABLE`         no ending is reachable from the entry.
 * - `DEAD_END`                    a non-ending node with no exits at all.
 * - `CANNOT_FINISH`               reachable, has exits, but every route out
 *                                 circles back without ever reaching an ending.
 * - `UNINTENTIONAL_CYCLE`         a cycle with no `return` edge in it.
 * - `LOCKED_EDGE_NEVER_UNLOCKED`  `locked: true` and no edge has an `unlock`
 *                                 effect for it.
 * - `GUARD_CONTRADICTION`         one guard that cannot hold (flag and notFlag
 *                                 the same flag, visited and notVisited the
 *                                 same node, ...).
 * - `GUARD_FLAG_NEVER_SET` (warn) a guard needs a flag that no edge effect and
 *                                 no chapter on the graph can set true.
 * - `FACT_VALUE_NEVER_SET` (warn) a world fact's state that is not its initial
 *                                 and that no effect ever writes (#198); for a
 *                                 counter, a counter nothing ever moves.
 * - `FACT_UNUSED` (warn)          a world fact no guard reads and the players
 *                                 are not shown (`visible`).
 * - `RIFT_ONE_WAY_HAS_WAY_BACK`   a `oneWay` rift with a rift edge straight back
 *                                 (#196: the claim, checked).
 * - `RIFT_ONCE_AND_USES` (warn)   `once` and `rift.uses` count the same crossings.
 * - `RIFT_REVEAL_MOOT` (warn)     `reveal: "when-open"` on a rift open from the
 *                                 start hides nothing.
 *
 * A rift's `opensWhen` is a guard like any other for the checks above, and so
 * is a rift action rule's `when` (#197). A redirectable rift is a way to each
 * of its declared destinations for reachability, dead ends and cycles.
 *
 * Dynamic (an exhaustive search of what a party can have done — below):
 *
 * - `STRANDED`                    a state with a non-ending node and no
 *                                 available exit, with the path that gets there.
 * - `TRAPPED`                     a state that still has exits but from which
 *                                 no ending can ever be reached (a `once` edge
 *                                 spent, a closed place completed, a `lock`).
 * - `NO_ENDING_WINNABLE`          the search finishes and no ending is entered.
 * - `NODE_NEVER_ENTERED`          the search finishes and a node (an ending, for
 *                                 `ENDING_NEVER_REACHED`) is never entered.
 * - `EDGE_NEVER_AVAILABLE` (warn) an edge out of an entered node that no state
 *                                 ever offers.
 * - `IRREVERSIBLE_NOT`            an edge marked `irreversible` after which its
 *                                 `from` node can be entered again.
 * - `VARIANT_NEVER_CHOSEN` (warn) a node variant no play-through ever plays:
 *                                 its `when` never holds on an entry that
 *                                 plays the node, or an earlier variant
 *                                 always wins first (#198).
 * - `RIFT_ACTION_NEVER_OFFERED` (warn) a rift action rule (#197) the party is
 *                                 never offered where it stands.
 * - `RIFT_EFFECT_ON_FINAL` (warn) a rift effect (#197) that every time it runs
 *                                 meets a used-up, expired or collapsed rift.
 * - `SEARCH_TRUNCATED` (warn)    the state cap was hit; the "never" and
 *                                 "cannot finish" checks above are skipped
 *                                 because they would be guesses.
 *
 * Errors are things the party can hit or the author plainly got wrong.
 * Warnings are things that are probably wrong but strand nobody: they go to
 * `content:validate`'s warning list and not to the server loader.
 *
 * ---------------------------------------------------------------------------
 * THE SEARCH, AND WHAT IT ASSUMES
 *
 * An abstract state is a node (the party is at the exit choice there) plus the
 * parts of the journey that can change what happens next. Everything else is
 * projected away so that the state space stays small:
 *
 * - a flag is tracked only if some guard reads it;
 * - a node's visited / completed facts only if a guard reads them, or the node
 *   is `pass` / `closed` (which `arrivalAt` and `exitAvailability` read);
 * - a node's latest outcome only if an `outcome` guard is about it;
 * - an edge's traversed fact only if a guard reads it or it is `once`;
 * - an edge's lock override only if an effect names it;
 * - a world fact's value (#198) only if some guard reads it — its domain is
 *   bounded (`WorldFact`), so tracking one multiplies the state space by at
 *   most its number of values;
 * - a node's visit *count* only if a `visit` test is about it, capped just
 *   past the largest bound any such test names (beyond it, every count reads
 *   the same) — or if a flickering rift (#196) leaves it, whose rhythm reads
 *   the count modulo its period. One count serves both: below `cap + period`
 *   it is exact, and from there it steps back by `period`, which keeps every
 *   `visit` test's reading (all counts ≥ cap read alike) and every flicker's
 *   (the count mod period is kept);
 * - every rift's lifecycle (#196): status, age, latch, and crossings counted
 *   only up to the highest threshold that reads them (`uses`,
 *   `collapsesAfter`) — a rift is moved by the same `rifts.ts` functions in
 *   the same order as `journey.ts` moves it (cross, tick, settle); and what a
 *   rift action changes (#197): steadied, found, revealed, redirected.
 *
 * Besides the exits, a choosing state has the party's **rift actions**
 * (#197, `riftActionsFrom` — the runtime's own list) as transitions: the
 * party stays put, the rift and the action's effects change, and the state
 * after is explored like any other. So a single-use rift whose only way on
 * is "steady it first", a `fallback` edge (offered only when nothing else
 * is), and a party that could close its last door are all judged on what the
 * party can actually do. "Stranded" means no exit *and* no action.
 *
 * Effects are applied wherever the runtime applies them: an edge's when it is
 * crossed, a node's `onComplete` rules (#198) when its chapter completes, each
 * completion branch judged separately (`completionEffects`, the runtime's
 * own reading).
 *
 * Entering a node runs the chapter, and a chapter's result is not the graph's
 * to know, so completion BRANCHES: both outcomes ("success", "setback") are
 * explored wherever an outcome is read, and
 *
 *   **chapters are the only thing that writes journey flags besides edge
 *   effects, and the explorer knows them only through `chapterFlags`.**
 *
 * For a chapter it can describe (`chapterFlagWrites`: the `setFlag` effects in
 * its scenes), a flag it never writes keeps its value, and one it can set true
 * may come out true or unchanged. For a chapter it cannot (no provider, or the
 * provider returns `undefined` — a placeholder fixture chapter, a chapter that
 * failed to load) EVERY tracked flag may come out either way: the conservative
 * reading, which can only make the search find *more* states, so an
 * "unreachable" or "cannot finish" verdict is never an artifact of ignorance.
 * (A reported STRANDED can, in principle, be one a real chapter would not
 * produce; the message gives the path so the author can judge.) Chapters are
 * assumed to write flags only on completion, as the doc says, and a variant is
 * chosen by `chapterAtNode` exactly as on arrival.
 *
 * Route-set forks: when a `routeSets` map is passed, setting a member true
 * clears the others, for edge effects and chapter results alike.
 *
 * The search is breadth-first, so every path it reports is a shortest one. It
 * stops at `maxStates` states (default 50,000, ample for a few dozen nodes);
 * past that it says so rather than guess.
 */

import type { Chapter } from "./types/chapter.js";
import type {
  EdgeId,
  FactId,
  FactValue,
  GraphCondition,
  GraphEffect,
  JourneyFacts,
  NodeId,
  RiftActionKind,
  WorldFact,
} from "./types/campaign-graph.js";
import {
  arrivalAt,
  completionEffects,
  edgeDestinations,
  exitsFrom,
  RIFT_ACTION_KINDS,
  riftOwner,
  riftState,
  variantAtNode,
  type ExitBlock,
  type ParsedCampaignGraph,
} from "./campaign-graph.ts";
import { crossRift, settleRifts, tickRifts } from "./rifts.ts";
import { applyRiftEffect, isRiftEffect, riftActionChange, riftActionsFrom, riftEffectCanApply } from "./rift-actions.ts";
import { factTestValues, initialFact, readFact, storedFacts, writeFact } from "./world-state.ts";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type GraphFindingCode =
  | "UNREACHABLE_NODE"
  | "NO_ENDING_REACHABLE"
  | "DEAD_END"
  | "CANNOT_FINISH"
  | "UNINTENTIONAL_CYCLE"
  | "LOCKED_EDGE_NEVER_UNLOCKED"
  | "GUARD_CONTRADICTION"
  | "GUARD_FLAG_NEVER_SET"
  | "STRANDED"
  | "TRAPPED"
  | "NO_ENDING_WINNABLE"
  | "NODE_NEVER_ENTERED"
  | "ENDING_NEVER_REACHED"
  | "EDGE_NEVER_AVAILABLE"
  | "IRREVERSIBLE_NOT"
  | "SEARCH_TRUNCATED"
  | "DUPLICATE_KEY"
  | "FACT_VALUE_NEVER_SET"
  | "FACT_UNUSED"
  | "VARIANT_NEVER_CHOSEN"
  | "RIFT_ONE_WAY_HAS_WAY_BACK"
  | "RIFT_ONCE_AND_USES"
  | "RIFT_REVEAL_MOOT"
  | "RIFT_EFFECT_ON_FINAL"
  | "RIFT_ACTION_NEVER_OFFERED";

export interface GraphFinding {
  /** Stable: tests, docs and any tool that filters key on this. */
  code: GraphFindingCode;
  severity: "error" | "warning";
  /** A JSON pointer inside the campaign, like `parseCampaignGraph`'s problems. */
  path: string;
  /** What is wrong, naming the node/edge. */
  message: string;
  /** What to change. */
  hint: string;
}

/** The flags a chapter can write when it completes (see the file comment). */
export interface ChapterFlagWrites {
  /** Flags some effect in the chapter can set true. */
  setsTrue: readonly string[];
  /** Flags some effect in the chapter can set false. */
  setsFalse: readonly string[];
}

export interface GraphLintOptions {
  /**
   * What a chapter can do to the journey's flags, by chapter id. Omitted, or
   * `undefined` for a chapter, means "unknown": it may write any flag either way.
   */
  chapterFlags?: (chapter: string) => ChapterFlagWrites | undefined;
  /** The campaign's `routeSets`, so a fork clears its siblings as it does in play. */
  routeSets?: Readonly<Record<string, readonly string[]>>;
  /** State cap for the search. Default {@link DEFAULT_MAX_STATES}. */
  maxStates?: number;
}

export interface GraphLintResult {
  findings: GraphFinding[];
  /** How the search went: states visited, and whether it ran to completion. */
  search: { states: number; complete: boolean };
}

export const DEFAULT_MAX_STATES = 50_000;

/**
 * The `setFlag` effects anywhere in a chapter, as {@link ChapterFlagWrites}.
 *
 * A structural walk rather than a read of `onEnter`/`choices`/`onSuccess`..:
 * the shape of "where effects live" is chapter.ts's to change, and a walk that
 * finds `{ type: "setFlag", flag }` wherever it is cannot fall behind it.
 */
export function chapterFlagWrites(chapter: Pick<Chapter, "scenes">): ChapterFlagWrites {
  const setsTrue = new Set<string>();
  const setsFalse = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const each of value) walk(each);
    } else if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      if (record.type === "setFlag" && typeof record.flag === "string") {
        (record.value === false ? setsFalse : setsTrue).add(record.flag);
      }
      for (const each of Object.values(record)) walk(each);
    }
  };
  walk(chapter.scenes);
  return { setsTrue: [...setsTrue].sort(), setsFalse: [...setsFalse].sort() };
}

// ---------------------------------------------------------------------------
// Duplicate keys
// ---------------------------------------------------------------------------

/**
 * Keys that appear twice in one JSON object, with their JSON pointer.
 *
 * `JSON.parse` keeps the last of two equal keys and says nothing, so two
 * nodes (or two edges) with one id become one — the first silently vanishes,
 * along with every edge that was meant to reach it. Only the file text can
 * show it, which is why this reads text and the other checks read the parsed
 * graph.
 */
export function duplicateJsonKeys(text: string): { path: string; key: string }[] {
  type Frame = { kind: "object"; keys: Set<string>; key: string | null } | { kind: "array"; index: number };
  const found: { path: string; key: string }[] = [];
  const stack: Frame[] = [];
  /** The pointer to `key` in the innermost object: its ancestors' current keys, then it. */
  const pointer = (key: string): string => {
    const parts = stack.slice(0, -1).map((frame) => (frame.kind === "object" ? frame.key ?? "" : String(frame.index)));
    parts.push(key);
    return parts.map((part) => `/${part.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
  };
  let expectKey = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "{") {
      stack.push({ kind: "object", keys: new Set(), key: null });
      expectKey = true;
    } else if (ch === "[") {
      stack.push({ kind: "array", index: 0 });
      expectKey = false;
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      expectKey = false;
    } else if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top?.kind === "array") top.index += 1;
      expectKey = top?.kind === "object";
    } else if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top?.kind === "object" && expectKey) {
        let key: string;
        try {
          key = JSON.parse(text.slice(i, end + 1)) as string;
        } catch {
          key = text.slice(i + 1, end);
        }
        if (top.keys.has(key)) found.push({ path: pointer(key), key });
        top.keys.add(key);
        top.key = key;
        expectKey = false;
      }
      i = end;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ids = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const seg = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");
const nodePath = (id: NodeId): string => `/graph/nodes/${seg(id)}`;
const edgePath = (id: EdgeId): string => `/graph/edges/${seg(id)}`;
const quoted = (list: readonly string[]): string => list.map((each) => `"${each}"`).join(", ");

/** A guard, where it lives, and the node its `outcome` is about. */
interface Guard {
  path: string;
  cond: GraphCondition;
  subject: NodeId;
  /** What the guard gates, for a message: `exit "x"` / `variant 0 of "y"`. */
  what: string;
  edge?: EdgeId;
}

function guardsOf(graph: ParsedCampaignGraph): Guard[] {
  const guards: Guard[] = [];
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    if (edge.when) {
      guards.push({ path: `${edgePath(id)}/when`, cond: edge.when, subject: edge.from, what: `exit "${id}"`, edge: id });
    }
    // A triggered rift's `opensWhen` is a guard on when it opens (#196),
    // judged against its owner's `from` — once per linked pair.
    if (edge.rift?.opensWhen && riftOwner(graph, id) === id) {
      guards.push({
        path: `${edgePath(id)}/rift/opensWhen`,
        cond: edge.rift.opensWhen,
        subject: edge.from,
        what: `rift "${id}" opening`,
        edge: id,
      });
    }
    // A rift action's rule (#197) is a guard on when the party may take it —
    // judged against the rift's `from`, like the edge's own `when`. Not tied
    // to the edge (`edge` absent): an action never offered is not an exit
    // never available.
    for (const kind of RIFT_ACTION_KINDS) {
      const rule = edge.rift?.actions?.[kind];
      if (!rule?.when) continue;
      guards.push({
        path: `${edgePath(id)}/rift/actions/${kind}/when`,
        cond: rule.when,
        subject: edge.from,
        what: `rift action "${kind}" on "${id}"`,
      });
    }
  }
  for (const id of graph.nodeOrder) {
    (graph.nodes[id]!.variants ?? []).forEach((variant, i) => {
      guards.push({
        path: `${nodePath(id)}/variants/${i}/when`,
        cond: variant.when,
        subject: id,
        what: `variant ${i} of "${id}"`,
      });
    });
    (graph.nodes[id]!.onComplete ?? []).forEach((rule, i) => {
      if (!rule.when) return;
      guards.push({
        path: `${nodePath(id)}/onComplete/${i}/when`,
        cond: rule.when,
        subject: id,
        what: `completion rule ${i} of "${id}"`,
      });
    });
  }
  return guards;
}

/**
 * Every effect the graph can apply, wherever it lives: an edge's, or a node's
 * completion rule's (#198). The static checks ask "does anything ever unlock
 * this / set this", and a completion rule is as much an answer as an edge.
 */
function effectsOf(graph: ParsedCampaignGraph): GraphEffect[] {
  return [...effectSites(graph).keys()];
}

/**
 * Every effect the graph can apply, with where it is written — an edge's, a
 * node's completion rule's (#198), or a rift action's own (#197). Keyed by
 * the effect object itself: the runtime's readers (`completionEffects`, an
 * edge's `effects`, a rule's `effects`) hand back the declaration's own
 * objects, so the search can say *which* effect it just applied.
 */
function effectSites(graph: ParsedCampaignGraph): Map<GraphEffect, string> {
  const sites = new Map<GraphEffect, string>();
  const add = (effects: readonly GraphEffect[] | undefined, at: string) =>
    (effects ?? []).forEach((effect, i) => sites.set(effect, `${at}/${i}`));
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    add(edge.effects, `${edgePath(id)}/effects`);
    for (const kind of RIFT_ACTION_KINDS) {
      add(edge.rift?.actions?.[kind]?.effects, `${edgePath(id)}/rift/actions/${kind}/effects`);
    }
  }
  for (const id of graph.nodeOrder) {
    (graph.nodes[id]!.onComplete ?? []).forEach((rule, i) => add(rule.effects, `${nodePath(id)}/onComplete/${i}/effects`));
  }
  return sites;
}

/** Nodes reached from `starts` by `next`, in discovery order, each with its BFS depth. */
function bfs(starts: readonly NodeId[], next: (node: NodeId) => readonly NodeId[]): Map<NodeId, number> {
  const depth = new Map<NodeId, number>();
  const queue: NodeId[] = [];
  for (const start of starts) {
    if (!depth.has(start)) {
      depth.set(start, 0);
      queue.push(start);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    for (const to of next(node)) {
      if (!depth.has(to)) {
        depth.set(to, depth.get(node)! + 1);
        queue.push(to);
      }
    }
  }
  return depth;
}

// ---------------------------------------------------------------------------
// The lint
// ---------------------------------------------------------------------------

export function lintCampaignGraph(graph: ParsedCampaignGraph, options: GraphLintOptions = {}): GraphLintResult {
  const findings: GraphFinding[] = [];
  const add = (finding: GraphFinding): void => void findings.push(finding);
  const error = (code: GraphFindingCode, path: string, message: string, hint: string): void =>
    add({ code, severity: "error", path, message, hint });
  const warn = (code: GraphFindingCode, path: string, message: string, hint: string): void =>
    add({ code, severity: "warning", path, message, hint });

  // A redirectable rift (#197) is a way to each of its declared destinations,
  // so "possibly reachable" counts every one of them.
  const successors = (node: NodeId): NodeId[] =>
    (graph.exits[node] ?? []).flatMap((id) => edgeDestinations(graph.edges[id]!));
  const incoming = new Map<NodeId, NodeId[]>();
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    for (const to of edgeDestinations(edge)) incoming.set(to, [...(incoming.get(to) ?? []), edge.from]);
  }
  const predecessors = (node: NodeId): NodeId[] => incoming.get(node) ?? [];
  /** Nodes already explained by a static finding; the search does not repeat them. */
  const explained = new Set<NodeId>();

  // --- reachability, guards ignored --------------------------------------
  const fromEntry = bfs([graph.entry], successors);
  for (const id of graph.nodeOrder) {
    if (fromEntry.has(id)) continue;
    explained.add(id);
    const incoming = graph.entrances[id] ?? [];
    error(
      "UNREACHABLE_NODE",
      nodePath(id),
      `node "${id}" cannot be reached from the entry "${graph.entry}"${
        incoming.length > 0
          ? `: its only ways in (${quoted(incoming)}) start at nodes the entry cannot reach either`
          : ": no edge leads to it"
      }`,
      `Add an edge from a node the party can reach to "${id}", or delete the node (and its chapter from "chapters").`,
    );
  }

  const reachableEndings = graph.endings.filter((id) => fromEntry.has(id));
  if (reachableEndings.length === 0) {
    error(
      "NO_ENDING_REACHABLE",
      "/graph/nodes",
      `no ending (${quoted(graph.endings)}) can be reached from the entry "${graph.entry}", so no attempt could ever complete`,
      "Connect the story to an ending: add a forward edge from the last place the party can reach to an ending node.",
    );
  }

  // --- dead ends and traps, guards ignored -------------------------------
  const canFinish = bfs(graph.endings, predecessors);
  for (const id of graph.nodeOrder) {
    if (!fromEntry.has(id) || graph.nodes[id]!.ending !== undefined) continue;
    if ((graph.exits[id] ?? []).length === 0) {
      explained.add(id);
      error(
        "DEAD_END",
        nodePath(id),
        `node "${id}" is not an ending and has no exits, so a party that gets here is stuck for good`,
        `Add an edge out of "${id}" (a "return" edge to the hub is usual), or make it an ending by adding "ending": { "title": ... }.`,
      );
    } else if (!canFinish.has(id) && reachableEndings.length > 0) {
      explained.add(id);
      error(
        "CANNOT_FINISH",
        nodePath(id),
        `node "${id}" is reachable but no chain of its exits ever reaches an ending: its routes only lead to ${quoted(
          [...bfs([id], successors).keys()].filter((each) => each !== id),
        )} and back`,
        `Give "${id}" (or a node it leads to) an edge toward an ending, or a "return" edge back into the part of the map that has one.`,
      );
    }
  }

  // --- cycles: only through a return edge --------------------------------
  lintCycles(graph, fromEntry, error);

  // --- locked edges nothing unlocks ---------------------------------------
  const unlocked = new Set<EdgeId>();
  for (const effect of effectsOf(graph)) {
    if (effect.type === "unlock") unlocked.add(effect.edge);
  }
  const knownDead = new Set<EdgeId>();
  for (const id of graph.edgeOrder) {
    if (graph.edges[id]!.locked === true && !unlocked.has(id)) {
      knownDead.add(id);
      error(
        "LOCKED_EDGE_NEVER_UNLOCKED",
        edgePath(id),
        `edge "${id}" is locked and no edge has an "unlock" effect for it, so it can never be taken`,
        `Add { "type": "unlock", "edge": "${id}" } to the effects of the edge that opens it, or remove "locked" from "${id}".`,
      );
    }
  }

  // --- guards that cannot hold ---------------------------------------------
  const guards = guardsOf(graph);
  for (const guard of guards) {
    const why = contradiction(guard.cond, guard.subject, graph.facts);
    if (why === null) continue;
    if (guard.edge !== undefined) knownDead.add(guard.edge);
    error(
      "GUARD_CONTRADICTION",
      guard.path,
      `the guard on ${guard.what} can never hold: ${why}`,
      "Fix the guard: a condition is every field at once, so two fields that disagree can never both be true. Split it into two edges if you meant either.",
    );
  }

  // --- flags nothing can set ------------------------------------------------
  const chapterWrites = (chapter: string): ChapterFlagWrites | undefined => options.chapterFlags?.(chapter);
  const settable = new Set<string>();
  for (const effect of effectsOf(graph)) {
    if (effect.type === "setFlag" && effect.value !== false) settable.add(effect.flag);
  }
  const everyChapter = new Set<string>();
  for (const id of graph.nodeOrder) {
    everyChapter.add(graph.nodes[id]!.chapter);
    for (const variant of graph.nodes[id]!.variants ?? []) everyChapter.add(variant.chapter);
  }
  for (const chapter of everyChapter) {
    const writes = chapterWrites(chapter);
    if (writes === undefined) for (const flag of graph.flags) settable.add(flag);
    else for (const flag of writes.setsTrue) settable.add(flag);
  }
  for (const guard of guards) {
    if (guard.cond.flag !== undefined && !settable.has(guard.cond.flag)) {
      if (guard.edge !== undefined) knownDead.add(guard.edge);
      warn(
        "GUARD_FLAG_NEVER_SET",
        `${guard.path}/flag`,
        `${guard.what} needs flag "${guard.cond.flag}", but no edge effect and no chapter in this graph ever sets it, so it can never apply`,
        `Add a setFlag "${guard.cond.flag}" effect to an edge, or a setFlag choice to one of the chapters the party plays first; or drop the guard.`,
      );
    }
  }

  // --- world facts (#198) -----------------------------------------------------
  lintFacts(graph, guards, warn);

  // --- rift declarations (#196) -------------------------------------------
  lintRifts(graph, error, warn);

  // --- the search -----------------------------------------------------------
  const search = explore(graph, options, chapterWrites);
  lintSearch(graph, search, { explained, knownDead, fromEntry, error, warn });

  return { findings, search: { states: search.states.length, complete: search.complete } };
}

// ---------------------------------------------------------------------------
// Guards that contradict themselves
// ---------------------------------------------------------------------------

function contradiction(
  cond: GraphCondition,
  subject: NodeId,
  facts: Readonly<Record<FactId, WorldFact>>,
): string | null {
  if (cond.flag !== undefined && cond.flag === cond.notFlag) {
    return `it needs flag "${cond.flag}" both set and not set`;
  }
  // A world fact's domain is bounded (#198), so "can this test ever pass" is a
  // question with a finite answer: no value of the fact passes it.
  for (const [id, test] of Object.entries(cond.facts ?? {})) {
    const fact = facts[id];
    if (fact && factTestValues(fact, test).length === 0) {
      return `no value of fact "${id}" passes its test ${JSON.stringify(test)}`;
    }
  }
  if (cond.visit?.min !== undefined && cond.visit.max !== undefined && cond.visit.min > cond.visit.max) {
    return `it needs visit ${cond.visit.min} or later and also visit ${cond.visit.max} or earlier`;
  }
  const overlap = (a: string[], b: string[]) => a.find((each) => b.includes(each));
  const visitedAndNot = overlap(ids(cond.visited), ids(cond.notVisited));
  if (visitedAndNot) return `it needs "${visitedAndNot}" both visited and not visited`;
  const doneAndNot = overlap(ids(cond.completed), ids(cond.notCompleted));
  if (doneAndNot) return `it needs "${doneAndNot}" both completed and not completed`;
  const doneNeverVisited = overlap(ids(cond.completed), ids(cond.notVisited));
  if (doneNeverVisited) return `it needs "${doneNeverVisited}" completed but never visited`;
  const takenAndNot = overlap(ids(cond.traversed), ids(cond.notTraversed));
  if (takenAndNot) return `it needs edge "${takenAndNot}" both taken and not taken`;
  if (cond.outcome !== undefined) {
    if (ids(cond.notCompleted).includes(subject) || ids(cond.notVisited).includes(subject)) {
      return `it needs an outcome from "${subject}" and also that "${subject}" was never ${
        ids(cond.notCompleted).includes(subject) ? "completed" : "visited"
      }`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// World facts (#198)
// ---------------------------------------------------------------------------

/**
 * A declared fact the graph never uses as declared: a state nothing can put
 * it in (the guard reading it — or the variant it would choose — is dead), a
 * counter nothing moves, a fact nobody reads or sees. Warnings: none of them
 * strands a party, and a guard that depends on one is caught by the search as
 * an edge never available or a variant never chosen.
 */
function lintFacts(graph: ParsedCampaignGraph, guards: readonly Guard[], warn: Report): void {
  const written = new Map<FactId, FactValue[]>();
  const moved = new Set<FactId>();
  for (const effect of effectsOf(graph)) {
    if (effect.type === "setFact") written.set(effect.fact, [...(written.get(effect.fact) ?? []), effect.value]);
    if (effect.type === "adjustFact") moved.add(effect.fact);
  }
  const read = new Set<FactId>();
  for (const guard of guards) for (const id of Object.keys(guard.cond.facts ?? {})) read.add(id);

  for (const id of graph.factOrder) {
    const fact = graph.facts[id]!;
    const path = `/graph/facts/${seg(id)}`;
    if (!read.has(id) && fact.visible !== true) {
      warn(
        "FACT_UNUSED",
        path,
        `world fact "${id}" is never read by a guard, a variant or a completion rule, and the players are not shown it`,
        `Read it in a "when" ({ "facts": { "${id}": ... } }), mark it "visible": true, or delete it.`,
      );
    }
    const sets = written.get(id) ?? [];
    if (fact.type === "counter") {
      if (!moved.has(id) && sets.every((value) => value === fact.initial)) {
        warn(
          "FACT_VALUE_NEVER_SET",
          path,
          `counter "${id}" never changes: no adjustFact moves it and no setFact sets it away from ${fact.initial}`,
          `Add an { "type": "adjustFact", "fact": "${id}", "by": 1 } effect where the story moves it, or delete the fact.`,
        );
      }
      continue;
    }
    const initial = initialFact(fact);
    const states: FactValue[] = fact.type === "enum" ? fact.values : [false, true];
    states.forEach((value, i) => {
      if (value === initial || sets.includes(value)) return;
      warn(
        "FACT_VALUE_NEVER_SET",
        fact.type === "enum" ? `${path}/values/${i}` : path,
        `world fact "${id}" can never be ${JSON.stringify(value)}: it starts ${JSON.stringify(initial)} and no setFact writes ${JSON.stringify(value)}`,
        `Add { "type": "setFact", "fact": "${id}", "value": ${JSON.stringify(value)} } to the edge or completion rule that changes it, or drop the state.`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Rift declarations (#196)
// ---------------------------------------------------------------------------

/**
 * What `parseCampaignGraph` leaves to the lint about rifts: claims checked
 * against the rest of the graph, and properties that say nothing. Whether a
 * rift can strand anybody (used up, expired, collapsed, never opening) is the
 * search's — it tracks rift state like any other journey fact.
 */
function lintRifts(graph: ParsedCampaignGraph, error: Report, warn: Report): void {
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    const rift = edge.rift;
    if (!rift) continue;
    if (rift.oneWay === true) {
      // Wherever it can be turned to lead (#197), no rift may lead straight back.
      const ends = edgeDestinations(edge);
      const back = graph.edgeOrder.find((other) => {
        const each = graph.edges[other]!;
        return other !== id && each.rift !== undefined && ends.includes(each.from) && edgeDestinations(each).includes(edge.from);
      });
      if (back !== undefined) {
        error(
          "RIFT_ONE_WAY_HAS_WAY_BACK",
          `${edgePath(id)}/rift/oneWay`,
          `rift "${id}" is one-way, but rift "${back}" leads straight back from "${graph.edges[back]!.from}" to "${edge.from}"`,
          `Drop "oneWay" from "${id}" (and link the two with "linkedTo" if they are one two-way rift), or make "${back}" an ordinary edge.`,
        );
      }
    }
    if (edge.once === true && rift.uses !== undefined) {
      warn(
        "RIFT_ONCE_AND_USES",
        `${edgePath(id)}/once`,
        `edge "${id}" is "once" and its rift has "uses": both count the same crossings, and "once" wins at 1`,
        `Remove "once" from "${id}" and say it with "rift": { "uses": 1 }.`,
      );
    }
    if (rift.reveal === "when-open" && rift.opensWhen === undefined) {
      warn(
        "RIFT_REVEAL_MOOT",
        `${edgePath(id)}/rift/reveal`,
        `rift "${id}" hides its destination until it opens, but it has no "opensWhen" and is open from the start, so nothing is ever hidden`,
        `Use "reveal": "when-crossed" to keep the destination a surprise, or give the rift an "opensWhen".`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

type Report = (code: GraphFindingCode, path: string, message: string, hint: string) => void;

/**
 * A cycle is intentional only through a `return` edge (the doc's rule), so
 * the graph with its return edges removed must be acyclic. Its strongly
 * connected components with more than one node, or one node with a self-loop,
 * are the offenders. One finding per component, naming a real cycle through it
 * and the edge most likely to be the back edge (the one that points at a node
 * no deeper than where it starts, counting from the entry).
 */
function lintCycles(graph: ParsedCampaignGraph, depthFromEntry: Map<NodeId, number>, error: Report): void {
  // An arc per edge and destination: a redirectable rift (#197) is a way to
  // each of its declared destinations, and a loop through any of them counts.
  interface Arc {
    id: EdgeId;
    from: NodeId;
    to: NodeId;
  }
  const arcs: Arc[] = graph.edgeOrder
    .filter((id) => graph.edges[id]!.kind !== "return")
    .flatMap((id) => edgeDestinations(graph.edges[id]!).map((to) => ({ id, from: graph.edges[id]!.from, to })));
  const forward = (node: NodeId): Arc[] => arcs.filter((arc) => arc.from === node);

  // Tarjan's strongly connected components over the non-return edges.
  const index = new Map<NodeId, number>();
  const low = new Map<NodeId, number>();
  const onStack = new Set<NodeId>();
  const stack: NodeId[] = [];
  const components: NodeId[][] = [];
  let counter = 0;
  const visit = (node: NodeId): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const { to } of forward(node)) {
      if (!index.has(to)) {
        visit(to);
        low.set(node, Math.min(low.get(node)!, low.get(to)!));
      } else if (onStack.has(to)) {
        low.set(node, Math.min(low.get(node)!, index.get(to)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: NodeId[] = [];
      for (;;) {
        const top = stack.pop()!;
        onStack.delete(top);
        component.push(top);
        if (top === node) break;
      }
      components.push(component);
    }
  };
  for (const node of graph.nodeOrder) if (!index.has(node)) visit(node);

  for (const component of components) {
    const members = new Set(component);
    const arcsInside = arcs.filter((arc) => members.has(arc.from) && members.has(arc.to));
    if (component.length === 1 && !arcsInside.some((arc) => arc.from === arc.to)) continue;

    const depth = (node: NodeId): number => depthFromEntry.get(node) ?? Number.POSITIVE_INFINITY;
    const back = arcsInside.find((arc) => depth(arc.to) <= depth(arc.from)) ?? arcsInside[0]!;

    // The rest of the cycle: the shortest way from where `back` lands to where it started.
    const via = new Map<NodeId, Arc>();
    const queue = [back.to];
    const seen = new Set(queue);
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head]!;
      for (const arc of arcsInside) {
        if (arc.from !== node || seen.has(arc.to)) continue;
        seen.add(arc.to);
        via.set(arc.to, arc);
        queue.push(arc.to);
      }
    }
    const cycle: Arc[] = [];
    for (let at = back.from; at !== back.to; ) {
      const arc = via.get(at);
      if (arc === undefined) break;
      cycle.unshift(arc);
      at = arc.from;
    }
    cycle.push(back);
    const walk = [back.to, ...cycle.map((arc) => arc.to)].map((each) => `"${each}"`).join(" -> ");

    error(
      "UNINTENTIONAL_CYCLE",
      edgePath(back.id),
      `the party can loop ${walk} using only forward and sideways edges (${quoted(cycle.map((arc) => arc.id))}); a loop is only intentional through a "return" edge`,
      `If going back is meant, set "kind": "return" on "${back.id}" (the edge that closes the loop); otherwise remove or redirect it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

interface Step {
  edge: EdgeId | null;
  label: string;
  /**
   * A rift action taken where the party stands (#197), instead of an edge:
   * what `takeRiftAction` would be asked, so a replay can ask it.
   */
  action?: { action: RiftActionKind; edge: EdgeId; to?: NodeId };
}

/** `stabilize "storm-stair"`, `redirect "ferry-rift" toward "cove"` — a rift action in words. */
export function describeRiftAction(step: { action: RiftActionKind; edge: EdgeId; to?: NodeId }): string {
  return `${step.action} "${step.edge}"${step.to !== undefined ? ` toward "${step.to}"` : ""}`;
}

interface SearchState {
  node: NodeId;
  /** The attempt completed here: an ending was entered. */
  ended: boolean;
  facts: JourneyFacts;
  parent: number;
  step: Step;
}

interface Search {
  states: SearchState[];
  /** succ[i] = the states reachable from state i by one exit (and its completion). */
  succ: { to: number; edge: EdgeId }[][];
  /** Non-ending states whose every exit is unavailable, with why. */
  stranded: { state: number; blocks: { edge: EdgeId; reason: ExitBlock }[] }[];
  everAvailable: Set<EdgeId>;
  entered: Set<NodeId>;
  /** `node#index` of every variant a played entry chose (`#-1`: the node's own chapter). */
  variantsChosen: Set<string>;
  /** `edge/kind` of every rift action ever offered (#197). */
  actionsOffered: Set<string>;
  /**
   * Every rift effect the search applied (#197), by where it is written:
   * whether it ever met a rift it could act on (`riftEffectCanApply`).
   */
  riftEffects: Map<string, boolean>;
  complete: boolean;
}

function explore(
  graph: ParsedCampaignGraph,
  options: GraphLintOptions,
  chapterWrites: (chapter: string) => ChapterFlagWrites | undefined,
): Search {
  const max = options.maxStates ?? DEFAULT_MAX_STATES;
  const routeSets = Object.values(options.routeSets ?? {});

  // --- what to track (see the file comment) ------------------------------
  const flags = new Set<string>();
  const visited = new Set<NodeId>();
  const completed = new Set<NodeId>();
  const outcomes = new Set<NodeId>();
  const traversed = new Set<EdgeId>();
  const overrides = new Set<EdgeId>();
  const facts = new Set<FactId>();
  /** Node → the count past which every `visit` test about it reads the same. */
  const visitCaps = new Map<NodeId, number>();
  for (const { cond, subject } of guardsOf(graph)) {
    if (cond.flag !== undefined) flags.add(cond.flag);
    if (cond.notFlag !== undefined) flags.add(cond.notFlag);
    for (const node of [...ids(cond.visited), ...ids(cond.notVisited)]) visited.add(node);
    for (const node of [...ids(cond.completed), ...ids(cond.notCompleted)]) completed.add(node);
    for (const edge of [...ids(cond.traversed), ...ids(cond.notTraversed)]) traversed.add(edge);
    if (cond.outcome !== undefined) outcomes.add(subject);
    for (const id of Object.keys(cond.facts ?? {})) if (graph.facts[id]) facts.add(id);
    if (cond.visit !== undefined) {
      const cap = Math.max(cond.visit.min ?? 1, (cond.visit.max ?? 0) + 1);
      visitCaps.set(subject, Math.max(visitCaps.get(subject) ?? 1, cap));
    }
  }
  // A fork couples its members: setting one clears the rest, so a tracked
  // flag's siblings can change it even though no guard reads them.
  for (const members of routeSets) {
    if (members.some((member) => flags.has(member))) for (const member of members) flags.add(member);
  }
  for (const id of graph.nodeOrder) {
    const node = graph.nodes[id]!;
    // A variant's own `revisit` (#198) makes completion matter as much as the
    // node's does: `arrivalAt` reads it either way.
    if (node.revisit !== "replay" || (node.variants ?? []).some((variant) => variant.revisit !== undefined)) {
      completed.add(id);
    }
  }
  for (const id of graph.edgeOrder) {
    if (graph.edges[id]!.once === true) traversed.add(id);
  }
  for (const effect of effectsOf(graph)) {
    if (effect.type === "unlock" || effect.type === "lock") overrides.add(effect.edge);
  }
  // `outcome` guards read `completed` implicitly (never completed matches
  // neither outcome); the outcome is recorded with the completion.
  for (const id of outcomes) completed.add(id);

  // Rifts (#196): every rift's state is a fact (once per linked pair), its
  // crossings counted only as far as a threshold reads them; and a flickering
  // rift reads the visit count of its `from` modulo its rhythm (every flicker
  // out of that node shares one period, their lcm), which shares the node's
  // tracked count with any `visit` test (see the file comment).
  const rifts = graph.edgeOrder.filter((id) => graph.edges[id]!.rift !== undefined && riftOwner(graph, id) === id);
  const crossingCap = new Map<EdgeId, number>();
  for (const id of rifts) {
    const rift = graph.edges[id]!.rift!;
    crossingCap.set(id, Math.max(rift.uses ?? 0, rift.unstable?.collapsesAfter ?? 0));
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const visitPeriods = new Map<NodeId, number>();
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    const flicker = edge.rift?.unstable?.flicker;
    if (!flicker) continue;
    const length = flicker.open + flicker.shut;
    const before = visitPeriods.get(edge.from) ?? 1;
    visitPeriods.set(edge.from, (before * length) / gcd(before, length));
    if (!visitCaps.has(edge.from)) visitCaps.set(edge.from, 1);
  }

  const tracked = {
    flags: [...flags].sort(),
    visited: [...visited].sort(),
    completed: [...completed].sort(),
    outcomes: [...outcomes].sort(),
    traversed: [...traversed].sort(),
    overrides: [...overrides].sort(),
    facts: graph.factOrder.filter((id) => facts.has(id)),
    visitCounts: [...visitCaps.keys()].sort(),
    rifts,
  };

  /** The next tracked visit count: exact below `cap + period`, then stepping back by `period`. */
  const nextVisitCount = (node: NodeId, count: number): number => {
    const period = visitPeriods.get(node) ?? 1;
    const next = count + 1;
    return next >= visitCaps.get(node)! + period ? next - period : next;
  };

  const riftKey = (f: JourneyFacts): string =>
    tracked.rifts
      .map((id) => {
        const state = riftState(graph, id, f)!;
        const crossings = Math.min(state.crossings ?? 0, crossingCap.get(id)!);
        // What an action changes (#197) is state too: steadied, found,
        // revealed (a redirect is offered only once it is), and turned.
        const acted = `${state.stable ? "S" : ""}${state.discovered ? "D" : ""}${state.revealed ? "R" : ""}${state.to ?? ""}`;
        return `${state.status}${crossings}.${state.age ?? 0}${state.latched ? "L" : ""}${acted}`;
      })
      .join(",");

  // An ending is where the attempt stops: what the journey held on the way is
  // no longer a distinction worth a state of its own.
  const keyOf = (node: NodeId, ended: boolean, f: JourneyFacts): string =>
    ended ? `${node}!` : [
      node,
      tracked.flags.map((id) => (f.flags?.[id] === true ? 1 : 0)).join(""),
      tracked.visited.map((id) => (f.visits?.[id] ? 1 : 0)).join(""),
      tracked.completed.map((id) => (f.completions?.[id] ? 1 : 0)).join(""),
      tracked.outcomes.map((id) => (f.outcomes?.[id] === "success" ? "s" : f.outcomes?.[id] === "setback" ? "f" : "-")).join(""),
      tracked.traversed.map((id) => (f.traversed?.[id] ? 1 : 0)).join(""),
      tracked.overrides.map((id) => (f.edges?.[id] === "open" ? "o" : f.edges?.[id] === "locked" ? "l" : "-")).join(""),
      tracked.facts.map((id) => JSON.stringify(readFact(graph.facts[id]!, f.facts?.[id]))).join(","),
      tracked.visitCounts.map((id) => f.visits?.[id] ?? 0).join(","),
      riftKey(f),
    ].join("|");

  const clone = (f: JourneyFacts): JourneyFacts => ({
    visits: { ...f.visits },
    completions: { ...f.completions },
    outcomes: { ...f.outcomes },
    traversed: { ...f.traversed },
    edges: { ...f.edges },
    flags: { ...f.flags },
    facts: { ...storedFacts(f) } as Record<FactId, FactValue>,
    // Rift records are replaced, never mutated (`rifts.ts`), so a shallow
    // copy of the map is a copy.
    rifts: { ...f.rifts },
  });

  /**
   * Effects, as the runtime applies them (`journey.ts` `applyEffects`), to the
   * tracked parts of the journey only: an untracked flag, override or fact is
   * read by no guard, so writing it could only split states nothing tells
   * apart.
   */
  const applyTracked = (f: JourneyFacts, effects: readonly GraphEffect[]): void => {
    for (const effect of effects) {
      if (isRiftEffect(effect)) {
        // A rift action (#197), as `applyEffects` applies it: in order, on the
        // journey the effects before it left — and noted, so an effect that
        // only ever meets a used-up rift can be told apart from one that acts.
        const site = sites.get(effect);
        if (site !== undefined) {
          search.riftEffects.set(site, (search.riftEffects.get(site) ?? false) || riftEffectCanApply(graph, f, effect));
        }
        f.rifts = applyRiftEffect(graph, f, effect).rifts;
        continue;
      }
      if (effect.type === "setFlag") {
        if (tracked.flags.includes(effect.flag)) setFlag(f, effect.flag, effect.value !== false);
      } else if (effect.type === "unlock" || effect.type === "lock") {
        if (tracked.overrides.includes(effect.edge)) f.edges![effect.edge] = effect.type === "unlock" ? "open" : "locked";
      } else if (tracked.facts.includes(effect.fact)) {
        const fact = graph.facts[effect.fact]!;
        f.facts![effect.fact] = writeFact(fact, readFact(fact, f.facts![effect.fact]), effect);
      }
    }
  };

  /** Setting a route-set member clears its siblings, as in play. */
  const setFlag = (f: JourneyFacts, flag: string, value: boolean, keep: ReadonlySet<string> = new Set()): void => {
    f.flags![flag] = value;
    if (!value) return;
    for (const members of routeSets) {
      if (!members.includes(flag)) continue;
      for (const other of members) if (other !== flag && !keep.has(other)) f.flags![other] = false;
    }
  };

  // --- transitions ----------------------------------------------------------
  interface Arrival {
    facts: JourneyFacts;
    ended: boolean;
    label: string;
  }

  /**
   * Entering `node`: a new visit, then the chapter runs (unless the node is an
   * ending, or a `pass` revisit that begins done) and settles — every way it
   * can settle is a separate arrival.
   */
  const arrive = (before: JourneyFacts, node: NodeId): Arrival[] => {
    // Read the place as the runtime does (`enter`): on the journey as it
    // stands on arrival, before the new visit is counted.
    const how = arrivalAt(graph, node, before);
    const variant = variantAtNode(graph, node, before);
    const entering = clone(before);
    if (tracked.visitCounts.includes(node)) {
      entering.visits![node] = nextVisitCount(node, entering.visits![node] ?? 0);
    } else if (tracked.visited.includes(node)) {
      entering.visits![node] = 1;
    }
    if (how !== "pass" && how !== "closed") search.variantsChosen.add(`${node}#${variant?.index ?? -1}`);
    if (graph.nodes[node]!.ending !== undefined) return [{ facts: entering, ended: true, label: "ending" }];
    // Entering may open a rift (`visited` in an `opensWhen`, #196) — settled
    // as `takeExit` settles, after the arrival.
    const facts = settleRifts(graph, entering);
    if (how === "pass" || how === "closed") return [{ facts, ended: false, label: "passed through" }];
    // The chapter about to play is a tick of every open "chapters" rift's
    // clock, counted before its results, as `completeVisit` counts it.
    const aged = tickRifts(graph, facts, "chapters");

    const writes = chapterWrites(variant?.variant.chapter ?? graph.nodes[node]!.chapter);
    const choices = tracked.flags.map((flag): boolean[] => {
      const now = facts.flags![flag] === true;
      if (writes === undefined) return [now, !now];
      const out = [now];
      if (writes.setsTrue.includes(flag) && !now) out.push(true);
      if (writes.setsFalse.includes(flag) && now) out.push(false);
      return out;
    });
    const outcomeChoices: (("success" | "setback") | undefined)[] = tracked.outcomes.includes(node)
      ? ["success", "setback"]
      : [undefined];

    const arrivals: Arrival[] = [];
    const assign = (at: number, picked: boolean[]): void => {
      if (at < tracked.flags.length) {
        for (const value of choices[at]!) assign(at + 1, [...picked, value]);
        return;
      }
      for (const outcome of outcomeChoices) {
        const next = clone(aged);
        const notes: string[] = [];
        const gained = new Set<string>();
        tracked.flags.forEach((flag, i) => {
          if (picked[i]! && !(facts.flags![flag] === true)) gained.add(flag);
        });
        tracked.flags.forEach((flag, i) => {
          if (picked[i]! !== (facts.flags![flag] === true)) {
            if (picked[i]!) setFlag(next, flag, true, gained);
            else next.flags![flag] = false;
            notes.push(`${picked[i]! ? "+" : "-"}${flag}`);
          }
        });
        if (tracked.completed.includes(node)) next.completions![node] = 1;
        if (outcome !== undefined) {
          next.outcomes![node] = outcome;
          notes.unshift(outcome);
        }
        // The node's completion rules (#198), judged on the journey this
        // completion produced — the runtime's own reading of them.
        applyTracked(next, completionEffects(graph, node, next));
        // …and then whatever the completion opened or ended (#196).
        arrivals.push({ facts: settleRifts(graph, next), ended: false, label: notes.join(", ") });
      }
    };
    assign(0, []);
    return arrivals;
  };

  /** The journey after an edge's effects and the crossing itself, before arrival. */
  const cross = (before: JourneyFacts, edgeId: EdgeId): JourneyFacts => {
    // The rift counts the crossing, then every timed "visits" rift ages a
    // move — before the edge's own effects, as `takeExit` orders it (#196).
    const facts = clone(tickRifts(graph, crossRift(graph, before, edgeId), "visits"));
    applyTracked(facts, graph.edges[edgeId]!.effects ?? []);
    if (tracked.traversed.includes(edgeId)) facts.traversed![edgeId] = 1;
    return facts;
  };

  // --- breadth-first -----------------------------------------------------------
  const sites = effectSites(graph);
  const search: Search = {
    states: [],
    succ: [],
    stranded: [],
    everAvailable: new Set(),
    entered: new Set(),
    variantsChosen: new Set(),
    actionsOffered: new Set(),
    riftEffects: new Map(),
    complete: true,
  };
  const index = new Map<string, number>();
  const intern = (node: NodeId, arrival: Arrival, parent: number, step: Step): number | null => {
    const key = keyOf(node, arrival.ended, arrival.facts);
    const known = index.get(key);
    if (known !== undefined) return known;
    if (search.states.length >= max) {
      search.complete = false;
      return null;
    }
    const id = search.states.length;
    index.set(key, id);
    search.states.push({ node, ended: arrival.ended, facts: arrival.facts, parent, step });
    search.succ.push([]);
    search.entered.add(node);
    return id;
  };

  for (const arrival of arrive({}, graph.entry)) {
    intern(graph.entry, arrival, -1, { edge: null, label: arrival.label });
  }
  for (let head = 0; head < search.states.length; head += 1) {
    const state = search.states[head]!;
    if (state.ended) continue;
    const exits = exitsFrom(graph, state.node, state.facts);
    const open = exits.filter((exit) => exit.availability.available);
    // The party's rift actions (#197) are transitions too: the party stays
    // where it is, still choosing, with the rift (and whatever the action's
    // effects wrote) changed — exactly `takeRiftAction`. A place with no way
    // out but an action that opens one is not stranded; the state after the
    // action is judged on its own.
    const offers = riftActionsFrom(graph, state.node, state.facts);
    for (const offer of offers) {
      search.actionsOffered.add(`${offer.edge}/${offer.action}`);
      const change = riftActionChange(graph, state.facts, offer.action, offer.edge, offer.to);
      if (!change.ok) continue;
      const acted = clone(change.journey);
      applyTracked(acted, offer.rule.effects ?? []);
      const to = intern(state.node, { facts: settleRifts(graph, acted), ended: false, label: "" }, head, {
        edge: null,
        label: "",
        action: { action: offer.action, edge: offer.edge, ...(offer.to !== undefined ? { to: offer.to } : {}) },
      });
      if (to !== null && to !== head) search.succ[head]!.push({ to, edge: `~${offer.action}:${offer.edge}` });
    }
    if (open.length === 0 && offers.length === 0) {
      search.stranded.push({
        state: head,
        blocks: exits.map((exit) => ({
          edge: exit.edge,
          reason: exit.availability.available ? "guard" : exit.availability.reason,
        })),
      });
      continue;
    }
    for (const exit of open) {
      search.everAvailable.add(exit.edge);
      const crossed = cross(state.facts, exit.edge);
      for (const arrival of arrive(crossed, exit.to)) {
        const to = intern(exit.to, arrival, head, { edge: exit.edge, label: arrival.label });
        if (to !== null) search.succ[head]!.push({ to, edge: exit.edge });
      }
    }
    if (!search.complete) break;
  }
  return search;
}

/** Every `ExitBlock`, as a STRANDED message explains it. */
const BLOCKED_BECAUSE: Record<ExitBlock, string> = {
  locked: "locked",
  spent: "already used (once)",
  closed: "closed (its target is a completed revisit: closed node)",
  guard: "guarded and its condition does not hold",
  "rift-dormant": "a rift that has not opened (its opensWhen does not hold)",
  "rift-faded": "a rift flickered shut on this visit",
  "rift-closed": "a closed rift",
  "rift-consumed": "a rift already used up (uses)",
  "rift-expired": "a rift whose time ran out (lasts)",
  "rift-collapsed": "a rift that collapsed (unstable)",
  fallback: "a fallback, and another way is open",
};

/** `a -[e1]-> b (setback) -[e2]-> c`, the shortest way to state `at`. */
function describePath(search: Search, at: number): string {
  const steps: string[] = [];
  for (let i = at; i !== -1; i = search.states[i]!.parent) {
    const state = search.states[i]!;
    const note = state.step.label !== "" && state.step.label !== "passed through" && state.step.label !== "ending" ? ` (${state.step.label})` : "";
    steps.unshift(
      state.step.action !== undefined
        ? `~(${describeRiftAction(state.step.action)})~>`
        : state.step.edge === null
          ? `start at "${state.node}"${note}`
          : `-[${state.step.edge}]-> "${state.node}"${note}`,
    );
  }
  return steps.join(" ");
}

function lintSearch(
  graph: ParsedCampaignGraph,
  search: Search,
  ctx: {
    explained: Set<NodeId>;
    knownDead: Set<EdgeId>;
    fromEntry: Map<NodeId, number>;
    error: Report;
    warn: Report;
  },
): void {
  const { explained, knownDead, fromEntry, error, warn } = ctx;
  const { states, succ } = search;
  const actionsDeclared = graph.edgeOrder.some((id) => graph.edges[id]!.rift?.actions !== undefined);

  if (!search.complete) {
    warn(
      "SEARCH_TRUNCATED",
      "/graph",
      `the softlock search stopped after ${states.length} states, so "never reachable", "cannot finish" and trap checks were skipped`,
      "Simplify the graph's guards (fewer flags, fewer outcome-dependent exits), or raise the state cap for this check.",
    );
  }

  // --- stranded: no exit at all ------------------------------------------
  const strandedNodes = new Set<NodeId>();
  const strandedStates = new Set<number>();
  for (const { state, blocks } of search.stranded) {
    strandedStates.add(state);
    const node = states[state]!.node;
    if (explained.has(node) || strandedNodes.has(node)) continue;
    strandedNodes.add(node);
    const why = blocks
      .map(({ edge, reason }) => `"${edge}" is ${BLOCKED_BECAUSE[reason]}`)
      .join("; ");
    error(
      "STRANDED",
      nodePath(node),
      `a party can be stranded at "${node}": after ${describePath(search, state)}, every exit is unavailable (${why})${
        actionsDeclared ? " and no rift action is offered" : ""
      }`,
      `Give "${node}" an exit that is always open (usually an unguarded "return" edge to the hub), or make whatever it waits on (an unlock, a flag, a different outcome) reachable before the party gets here.`,
    );
  }

  if (!search.complete) return;

  // --- an ending, ever? ----------------------------------------------------
  const endedStates = states.map((state, i) => (state.ended ? i : -1)).filter((i) => i >= 0);
  if (endedStates.length === 0) {
    if (graph.endings.some((id) => fromEntry.has(id))) {
      error(
        "NO_ENDING_WINNABLE",
        "/graph/nodes",
        `an ending is connected to the entry, but no play-through can enter one: every route to ${quoted(graph.endings)} is closed by a lock, a guard, a spent "once" edge or a closed place`,
        "Check the edges into the endings: a guard that can never hold, a lock nothing opens, or a once/closed rule that uses up the only way.",
      );
    }
    return;
  }

  // --- trapped: exits remain, but no ending is left to reach ---------------
  const reverse: number[][] = states.map(() => []);
  succ.forEach((list, from) => list.forEach(({ to }) => reverse[to]!.push(from)));
  const winnable = new Set<number>(endedStates);
  const queue = [...endedStates];
  for (let head = 0; head < queue.length; head += 1) {
    for (const before of reverse[queue[head]!]!) {
      if (!winnable.has(before)) {
        winnable.add(before);
        queue.push(before);
      }
    }
  }
  const trappedNodes = new Set<NodeId>();
  states.forEach((state, i) => {
    if (winnable.has(i) || state.ended || strandedStates.has(i)) return;
    const entering = state.parent === -1 || winnable.has(state.parent);
    if (!entering) return;
    if (explained.has(state.node) || strandedNodes.has(state.node) || trappedNodes.has(state.node)) return;
    trappedNodes.add(state.node);
    error(
      "TRAPPED",
      nodePath(state.node),
      `a party can reach a point of no return at "${state.node}": after ${describePath(search, i)}, exits remain but none can lead to an ending any more`,
      `Something on that path used up the way forward (a "once" edge, a completed "closed" place, a "lock" effect, a flag set the wrong way). Keep a way to an ending open: drop "once"/"closed", or add an unguarded edge that always leads on.`,
    );
  });

  // --- places and doors nothing ever uses ---------------------------------
  for (const id of graph.nodeOrder) {
    if (!fromEntry.has(id) || search.entered.has(id) || explained.has(id)) continue;
    const isEnding = graph.nodes[id]!.ending !== undefined;
    error(
      isEnding ? "ENDING_NEVER_REACHED" : "NODE_NEVER_ENTERED",
      nodePath(id),
      `${isEnding ? "ending" : "node"} "${id}" is connected by edges (${quoted(graph.entrances[id] ?? [])}) but no play-through can ever enter it: each of them is locked, guarded, spent, closed or a shut rift whenever the party stands at its start`,
      `Look at those edges' "locked", "when", "once" and "rift": one of them needs to be satisfiable on a path the party can walk.`,
    );
  }
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    if (search.everAvailable.has(id) || knownDead.has(id) || !search.entered.has(edge.from)) continue;
    warn(
      "EDGE_NEVER_AVAILABLE",
      edgePath(id),
      `edge "${id}" is never available: in every play-through that reaches "${edge.from}" it is locked, guarded off, spent, closed or a shut rift${
        edge.fallback === true ? ", or a fallback another way always makes unneeded" : ""
      }`,
      `Check "${id}"'s "locked", "when", "once", "rift" and "fallback"; if it is meant to be unreachable, delete it.`,
    );
  }

  // Rift actions (#197) the party is never offered, and rift effects that
  // only ever meet a rift they cannot act on: both say something the
  // play-through never does. Warnings — neither strands anybody (the search
  // has already said so if a missing action does).
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    if (!search.entered.has(edge.from)) continue;
    for (const kind of RIFT_ACTION_KINDS) {
      if (!edge.rift?.actions?.[kind] || search.actionsOffered.has(`${id}/${kind}`)) continue;
      warn(
        "RIFT_ACTION_NEVER_OFFERED",
        `${edgePath(id)}/rift/actions/${kind}`,
        `the "${kind}" action on rift "${id}" is never offered: whenever the party stands at "${edge.from}", its "when" does not hold or it would change nothing (the rift is already so, used up, or persistent)`,
        `Check the rule's "when" and the rift's lifecycle; if the party is never meant to ${kind} it, delete the rule.`,
      );
    }
  }
  for (const [site, applies] of search.riftEffects) {
    if (applies) continue;
    warn(
      "RIFT_EFFECT_ON_FINAL",
      site,
      `this rift effect never does anything: every time it runs, its rift is already used up, expired or collapsed (or, closing it, open and persistent)`,
      "Final rifts stay final. Move the effect to before the rift ends (an earlier edge or completion rule), or drop it.",
    );
  }

  // A variant is how a place changes on a revisit (#198): one no play-through
  // ever plays is a changed encounter nobody will meet.
  for (const id of graph.nodeOrder) {
    if (!search.entered.has(id) || explained.has(id)) continue;
    (graph.nodes[id]!.variants ?? []).forEach((variant, i) => {
      if (search.variantsChosen.has(`${id}#${i}`)) return;
      warn(
        "VARIANT_NEVER_CHOSEN",
        `${nodePath(id)}/variants/${i}`,
        `variant ${i} of "${id}" ("${variant.chapter}") is never played: whenever the party enters "${id}" to play it, its "when" does not hold or an earlier variant's does`,
        `Check the variant's "when" against what the party can have done by then (and the variants before it — the first that holds wins); if it is meant to be unreachable, delete it.`,
      );
    });
  }

  // --- irreversible: a claim about the way back -----------------------------
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    if (edge.irreversible !== true) continue;
    const seeds = new Set<number>();
    succ.forEach((list) => list.forEach((each) => each.edge === id && seeds.add(each.to)));
    const from = new Map<number, number>();
    const walk = [...seeds];
    walk.forEach((seed) => from.set(seed, -1));
    let back = -1;
    for (let head = 0; head < walk.length && back === -1; head += 1) {
      const at = walk[head]!;
      if (states[at]!.node === edge.from) {
        back = at;
        break;
      }
      for (const { to } of succ[at]!) {
        if (!from.has(to)) {
          from.set(to, at);
          walk.push(to);
        }
      }
    }
    if (back === -1) continue;
    const route: string[] = [];
    for (let at = back; at !== -1; at = from.get(at)!) {
      const via = states[at]!;
      route.unshift(`"${via.node}"`);
    }
    error(
      "IRREVERSIBLE_NOT",
      edgePath(id),
      `edge "${id}" is marked irreversible, but after taking it the party can get back to "${edge.from}" (${route.join(" -> ")})`,
      `Either the claim is wrong (remove "irreversible" from "${id}") or the way back is: remove it, or guard/lock/once it so it is closed after "${id}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// The explored state graph, for tools (#202)
// ---------------------------------------------------------------------------

/**
 * The search `lintCampaignGraph` runs, handed back as it is: every abstract
 * state in breadth-first order (so the first state at a node is a shortest
 * way there, and following `parent` links spells that way), the successor
 * edges between them, and the states with no way out.
 *
 * Exported so the inspection and playtest tooling (`tools/content/journey-*.ts`,
 * #202) reads the explorer the lint reads and cannot drift from it. A second
 * breadth-first search over the same rules would be exactly the kind of
 * approximation this file's header warns about. Read-only by convention: the
 * states' `facts` are the explorer's own.
 */
export type GraphSearch = Search;
export type GraphSearchState = SearchState;

export function exploreCampaignGraph(graph: ParsedCampaignGraph, options: GraphLintOptions = {}): GraphSearch {
  return explore(graph, options, (chapter) => options.chapterFlags?.(chapter));
}
