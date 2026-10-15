/**
 * Graph campaigns — the rules that read the declaration (#192).
 *
 * The shape is `types/campaign-graph.ts`; the authoring contract, with
 * examples, is docs/campaigns/graph-campaigns.md. This file is the part of
 * the contract that has to *compute*: which mode a campaign is in, whether a
 * declaration is whole, what a guard means, and whether an exit is open.
 *
 * ---------------------------------------------------------------------------
 * WHY HERE, AND WHY IMPORT-FREE
 *
 * For the reason `routes.ts` is in shared: several things must agree and
 * none of them should own the rule. The server will move a party along an
 * edge (#194), the phones will draw the exits (#195), `content:validate` and
 * the loader refuse a broken declaration, and the inspection tools (#202)
 * draw the whole graph. A rule implemented four times is a rule with four
 * answers.
 *
 * Type imports only, because tools/content/validate.mjs loads this file
 * directly under Node (as it does condition-lint.ts) and Node strips types
 * but resolves no `.js`-for-`.ts` imports.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not move anybody. Entering a node, completing a visit and taking
 * an exit are transitions on persisted attempt state, and their idempotence
 * is a storage question as much as a rules one — #194's, in `journey.ts`.
 * What is here is read-only: everything a transition, a screen or a
 * validator needs to ask, and nothing that writes.
 *
 * Nor does it judge the graph's *shape* — reachability, softlocks, whether a
 * cycle runs through a return edge, whether an `irreversible` claim is true.
 * That is #193, and it builds on `parseCampaignGraph`'s output rather than on
 * the raw JSON. This file answers only "does every name in it point at
 * something", which is what a reader needs before it can ask anything else.
 */

import type { Campaign } from "./types/chapter.js";
import type {
  CampaignGraph,
  EdgeId,
  GraphCondition,
  GraphEdge,
  GraphEffect,
  GraphNode,
  JourneyFacts,
  NodeId,
  RevisitPolicy,
} from "./types/campaign-graph.js";

/** The declaration version this build reads (`CampaignGraph.version`). */
export const CAMPAIGN_GRAPH_VERSION = 1;

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/**
 * How a campaign chooses its next chapter.
 *
 * - `"ordered"` — by `index`: beats 1..n, routed beats chosen by flag
 *   (`routes.ts`). Every campaign without a `graph`.
 * - `"graph"` — by the edges of `Campaign.graph`.
 */
export type CampaignMode = "ordered" | "graph";

/**
 * Which mode a campaign is in. The one question every caller asks first, so
 * that "missing graph means legacy" is written once and nowhere is tempted to
 * sniff for `routeSets` or a node-shaped chapter id instead.
 */
export function campaignMode(campaign: Pick<Campaign, "graph">): CampaignMode {
  return campaign.graph === undefined || campaign.graph === null ? "ordered" : "graph";
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** One thing wrong with a declaration, at a JSON pointer inside the campaign. */
export interface GraphProblem {
  /** e.g. `/graph/edges/to-marsh/to`. */
  path: string;
  problem: string;
}

/** A node with its defaults filled in. */
export interface ParsedGraphNode extends GraphNode {
  revisit: RevisitPolicy;
}

/** An edge with its defaults filled in. */
export interface ParsedGraphEdge extends GraphEdge {
  blocked: "hidden" | "shown";
}

/**
 * A declaration that has been checked and normalized: defaults filled, the
 * adjacency precomputed, and every order fixed, so two readers walking it see
 * the same thing in the same order.
 *
 * Only ever produced for a declaration with **no** problems. A caller holding
 * one may assume every id in it resolves.
 */
export interface ParsedCampaignGraph {
  version: typeof CAMPAIGN_GRAPH_VERSION;
  entry: NodeId;
  nodes: Record<NodeId, ParsedGraphNode>;
  edges: Record<EdgeId, ParsedGraphEdge>;
  /** Node ids in authored order. */
  nodeOrder: NodeId[];
  /** Edge ids in authored order. */
  edgeOrder: EdgeId[];
  /** Every node's outgoing edges, in authored edge order. Every node has a key. */
  exits: Record<NodeId, EdgeId[]>;
  /** Every node's incoming edges, in authored edge order. Every node has a key. */
  entrances: Record<NodeId, EdgeId[]>;
  /** The ending nodes, in authored order. */
  endings: NodeId[];
  /** Every journey flag (`journeyFlags`), sorted. */
  flags: string[];
}

/**
 * The flags a graph campaign's journey carries: its `graph.flags` and every
 * `routeSets` member, sorted and once each. For an ordered campaign this is
 * just the route set members — the flags that already cross the chapter
 * boundary — which is the point: one carry rule, widened, not two.
 */
export function journeyFlags(campaign: Pick<Campaign, "graph" | "routeSets">): string[] {
  const flags = new Set<string>();
  for (const members of Object.values(campaign.routeSets ?? {})) {
    if (Array.isArray(members)) for (const flag of members) flags.add(flag);
  }
  const declared = campaign.graph?.flags;
  if (Array.isArray(declared)) for (const flag of declared) flags.add(flag);
  return [...flags].sort();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON pointer segment (RFC 6901). Ids are kebab/snake case, but be exact. */
const seg = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

const ids = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Reads `campaign.graph` and says what is wrong with it.
 *
 * - No `graph`: `{ graph: null, problems: [] }` — an ordered campaign, which
 *   is not a problem; it is Gemfall.
 * - A version this build does not know: one problem, and nothing else is
 *   read. Its rules might be anything, so judging it by version 1's would
 *   produce confident nonsense.
 * - Otherwise every dangling name, as a list, and the parsed graph only if
 *   the list is empty.
 *
 * "Dangling" is the whole remit: an entry, an edge end, a guard, an effect
 * or a chapter that names something absent; an ending with an exit (an
 * ending is where the attempt stops, so an exit from it could never be
 * offered); a listed chapter no node plays; a graph with no ending at all.
 * Whether the graph can be *walked* to an ending is #193's.
 *
 * Total over malformed input — the loader calls it before any schema has
 * looked at the file — so a wrong type is a problem, never a throw.
 */
export function parseCampaignGraph(
  campaign: Pick<Campaign, "chapters" | "graph" | "routeSets">,
): { graph: ParsedCampaignGraph | null; problems: GraphProblem[] } {
  const raw = campaign.graph as unknown;
  if (raw === undefined || raw === null) return { graph: null, problems: [] };

  const problems: GraphProblem[] = [];
  const fail = (path: string, problem: string) => problems.push({ path: `/graph${path}`, problem });

  if (!isRecord(raw)) {
    fail("", "graph must be an object");
    return { graph: null, problems };
  }
  if (raw.version !== CAMPAIGN_GRAPH_VERSION) {
    fail(
      "/version",
      `graph version ${JSON.stringify(raw.version)} is not one this build reads (it reads ${CAMPAIGN_GRAPH_VERSION})`,
    );
    return { graph: null, problems };
  }
  const declaration = raw as unknown as CampaignGraph;
  const rawNodes: unknown = declaration.nodes;
  const rawEdges: unknown = declaration.edges;
  if (!isRecord(rawNodes) || Object.keys(rawNodes).length === 0) {
    fail("/nodes", "a graph needs at least one node");
    return { graph: null, problems };
  }
  if (!isRecord(rawEdges)) {
    fail("/edges", "edges must be an object keyed by edge id");
    return { graph: null, problems };
  }

  const listed = new Set(Array.isArray(campaign.chapters) ? campaign.chapters : []);
  const flags = journeyFlags(campaign);
  const declaredFlags = new Set(flags);
  const nodeOrder = Object.keys(rawNodes);
  const edgeOrder = Object.keys(rawEdges);
  const nodeSet = new Set(nodeOrder);
  const edgeSet = new Set(edgeOrder);
  const played = new Set<string>();

  const checkCondition = (path: string, raw: unknown) => {
    if (raw === undefined) return;
    if (!isRecord(raw)) {
      fail(path, "a condition must be an object");
      return;
    }
    const cond = raw as GraphCondition;
    for (const key of ["flag", "notFlag"] as const) {
      const flag = cond[key];
      if (flag !== undefined && !declaredFlags.has(flag)) {
        fail(`${path}/${key}`, `"${flag}" is not a journey flag (declare it in graph.flags or a routeSets entry)`);
      }
    }
    for (const key of ["visited", "notVisited", "completed", "notCompleted"] as const) {
      for (const node of ids(cond[key])) {
        if (!nodeSet.has(node)) fail(`${path}/${key}`, `no node "${node}"`);
      }
    }
    for (const key of ["traversed", "notTraversed"] as const) {
      for (const edge of ids(cond[key])) {
        if (!edgeSet.has(edge)) fail(`${path}/${key}`, `no edge "${edge}"`);
      }
    }
  };

  const checkChapter = (path: string, chapter: unknown) => {
    if (typeof chapter !== "string" || !listed.has(chapter)) {
      fail(path, `chapter ${JSON.stringify(chapter)} is not in the campaign's chapters list`);
      return;
    }
    played.add(chapter);
  };

  if (typeof declaration.entry !== "string" || !nodeSet.has(declaration.entry)) {
    fail("/entry", `entry ${JSON.stringify(declaration.entry)} is not a node`);
  }

  const nodes: Record<NodeId, ParsedGraphNode> = {};
  const endings: NodeId[] = [];
  for (const id of nodeOrder) {
    const node = rawNodes[id];
    const at = `/nodes/${seg(id)}`;
    if (!isRecord(node)) {
      fail(at, "a node must be an object");
      continue;
    }
    const typed = node as unknown as GraphNode;
    checkChapter(`${at}/chapter`, typed.chapter);
    (Array.isArray(typed.variants) ? typed.variants : []).forEach((variant, i) => {
      checkChapter(`${at}/variants/${i}/chapter`, variant?.chapter);
      checkCondition(`${at}/variants/${i}/when`, variant?.when);
    });
    if (typed.ending !== undefined) endings.push(id);
    nodes[id] = { ...typed, revisit: typed.revisit ?? "replay" };
  }

  const edges: Record<EdgeId, ParsedGraphEdge> = {};
  const exits: Record<NodeId, EdgeId[]> = Object.fromEntries(nodeOrder.map((id) => [id, []]));
  const entrances: Record<NodeId, EdgeId[]> = Object.fromEntries(nodeOrder.map((id) => [id, []]));
  for (const id of edgeOrder) {
    const edge = rawEdges[id];
    const at = `/edges/${seg(id)}`;
    if (!isRecord(edge)) {
      fail(at, "an edge must be an object");
      continue;
    }
    const typed = edge as unknown as GraphEdge;
    for (const end of ["from", "to"] as const) {
      if (!nodeSet.has(typed[end])) fail(`${at}/${end}`, `no node ${JSON.stringify(typed[end])}`);
    }
    if (nodeSet.has(typed.from)) {
      exits[typed.from]!.push(id);
      if (nodes[typed.from]?.ending !== undefined) {
        fail(`${at}/from`, `"${typed.from}" is an ending, and an ending has no exits`);
      }
    }
    if (nodeSet.has(typed.to)) entrances[typed.to]!.push(id);
    checkCondition(`${at}/when`, typed.when);
    (Array.isArray(typed.effects) ? typed.effects : []).forEach((effect: GraphEffect, i) => {
      const path = `${at}/effects/${i}`;
      if (effect?.type === "setFlag") {
        if (!declaredFlags.has(effect.flag)) {
          fail(`${path}/flag`, `"${effect.flag}" is not a journey flag (declare it in graph.flags or a routeSets entry)`);
        }
      } else if (effect?.type === "unlock" || effect?.type === "lock") {
        if (!edgeSet.has(effect.edge)) fail(`${path}/edge`, `no edge "${effect.edge}"`);
      } else {
        fail(`${path}/type`, `unknown graph effect ${JSON.stringify((effect as { type?: unknown })?.type)}`);
      }
    });
    edges[id] = { ...typed, blocked: typed.blocked ?? "hidden" };
  }

  // The other half of "chapters lists the campaign's files": a listed chapter
  // that no node plays is a file the campaign carries and nobody can reach.
  (Array.isArray(campaign.chapters) ? campaign.chapters : []).forEach((chapter, i) => {
    if (!played.has(chapter)) {
      problems.push({ path: `/chapters/${i}`, problem: `chapter "${chapter}" is listed but no graph node plays it` });
    }
  });

  if (endings.length === 0) {
    fail("/nodes", "no node is an ending, so no attempt could ever complete");
  }

  if (problems.length > 0) return { graph: null, problems };
  return {
    graph: {
      version: CAMPAIGN_GRAPH_VERSION,
      entry: declaration.entry,
      nodes,
      edges,
      nodeOrder,
      edgeOrder,
      exits,
      entrances,
      endings,
      flags,
    },
    problems,
  };
}

// ---------------------------------------------------------------------------
// Reading the journey
// ---------------------------------------------------------------------------

const count = (record: Readonly<Record<string, number>> | undefined, id: string): number => record?.[id] ?? 0;

/**
 * Does `cond` hold for this journey? Every field present must hold; an absent
 * or empty condition holds — `evaluateCondition`'s rule, over the journey
 * instead of the party.
 *
 * `subject` is the node `outcome` reads: an edge's `from`, or a variant's own
 * node. Without one, a condition carrying `outcome` does not hold — there is
 * nothing for it to be about.
 */
export function evaluateGraphCondition(
  cond: GraphCondition | undefined,
  journey: JourneyFacts,
  subject?: NodeId,
): boolean {
  if (!cond) return true;
  const flags = journey.flags ?? {};
  if (cond.flag !== undefined && flags[cond.flag] !== true) return false;
  if (cond.notFlag !== undefined && flags[cond.notFlag] === true) return false;
  if (!ids(cond.visited).every((node) => count(journey.visits, node) > 0)) return false;
  if (!ids(cond.notVisited).every((node) => count(journey.visits, node) === 0)) return false;
  if (!ids(cond.completed).every((node) => count(journey.completions, node) > 0)) return false;
  if (!ids(cond.notCompleted).every((node) => count(journey.completions, node) === 0)) return false;
  if (!ids(cond.traversed).every((edge) => count(journey.traversed, edge) > 0)) return false;
  if (!ids(cond.notTraversed).every((edge) => count(journey.traversed, edge) === 0)) return false;
  if (cond.outcome !== undefined) {
    if (subject === undefined || journey.outcomes?.[subject] !== cond.outcome) return false;
  }
  return true;
}

/**
 * Why an exit cannot be taken, in the order it is decided: the first that
 * applies is the one reported, so a screen explaining it says one true thing.
 *
 * - `"locked"` — authored `locked` and never unlocked, or closed by a `lock`.
 * - `"spent"` — a `once` edge already taken.
 * - `"closed"` — it leads into a `revisit: "closed"` node already completed.
 * - `"guard"` — its `when` does not hold.
 */
export type ExitBlock = "locked" | "spent" | "closed" | "guard";

export type ExitAvailability = { available: true } | { available: false; reason: ExitBlock };

/** Is this edge one the party could take right now (from its `from` node)? */
export function exitAvailability(
  graph: ParsedCampaignGraph,
  edgeId: EdgeId,
  journey: JourneyFacts,
): ExitAvailability {
  const edge = graph.edges[edgeId];
  if (!edge) return { available: false, reason: "locked" };
  const state = journey.edges?.[edgeId];
  if (state === "locked" || (edge.locked === true && state !== "open")) {
    return { available: false, reason: "locked" };
  }
  if (edge.once === true && count(journey.traversed, edgeId) > 0) return { available: false, reason: "spent" };
  if (graph.nodes[edge.to]?.revisit === "closed" && count(journey.completions, edge.to) > 0) {
    return { available: false, reason: "closed" };
  }
  if (!evaluateGraphCondition(edge.when, journey, edge.from)) return { available: false, reason: "guard" };
  return { available: true };
}

/** One of a node's exits, as a screen or a transition asks about it. */
export interface GraphExit {
  edge: EdgeId;
  to: NodeId;
  kind: GraphEdge["kind"];
  availability: ExitAvailability;
  /** Whether a screen draws it: available, or blocked and authored `"shown"`. */
  visible: boolean;
}

/**
 * Every exit from `node`, in authored order, each with whether it is open and
 * whether it is drawn. A transition takes only an available one; a screen
 * draws the visible ones and greys the blocked among them.
 */
export function exitsFrom(graph: ParsedCampaignGraph, node: NodeId, journey: JourneyFacts): GraphExit[] {
  return (graph.exits[node] ?? []).map((id) => {
    const edge = graph.edges[id]!;
    const availability = exitAvailability(graph, id, journey);
    return {
      edge: id,
      to: edge.to,
      kind: edge.kind,
      availability,
      visible: availability.available || edge.blocked === "shown",
    };
  });
}

/**
 * What entering `node` would be, before the party enters it.
 *
 * - `"new"` — never completed this attempt: played, whatever `revisit` says.
 * - `"replay"` — completed before, `revisit: "replay"`: a new visit, played
 *   again (variants consulted).
 * - `"pass"` — completed before, `revisit: "pass"`: a new visit that begins
 *   done, at the exit choice.
 * - `"closed"` — completed before, `revisit: "closed"`: cannot be entered
 *   (no available edge leads here; `exitAvailability` reports `"closed"`).
 *
 * Every case but `"closed"` is a **new visit**: entering always counts.
 * Resuming a visit already under way is not entering, and never comes here.
 */
export type Arrival = "new" | "replay" | "pass" | "closed";

export function arrivalAt(graph: ParsedCampaignGraph, node: NodeId, journey: JourneyFacts): Arrival {
  if (count(journey.completions, node) === 0) return "new";
  return graph.nodes[node]?.revisit ?? "replay";
}

/**
 * The chapter entering `node` plays: the first variant whose `when` holds, in
 * authored order, else the node's own chapter. Read against the journey as it
 * stands on arrival — after the incoming edge's effects. A `"pass"` arrival
 * plays nothing, but this still names the chapter the place currently is.
 */
export function chapterAtNode(graph: ParsedCampaignGraph, node: NodeId, journey: JourneyFacts): string | null {
  const declared = graph.nodes[node];
  if (!declared) return null;
  const variant = (declared.variants ?? []).find((each) => evaluateGraphCondition(each.when, journey, node));
  return variant?.chapter ?? declared.chapter;
}
