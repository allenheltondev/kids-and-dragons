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
 * but resolves no `.js`-for-`.ts` imports. The one exception is
 * `./world-state.ts` (#198), itself import-free, spelled with its extension
 * the way the lint spells this file, so the chain stays loadable.
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
  GraphRift,
  FactId,
  FactValue,
  JourneyFacts,
  NodeId,
  NodeVariant,
  RevisitPolicy,
  RiftActionKind,
  RiftState,
  RiftStatus,
  WorldFact,
} from "./types/campaign-graph.js";
import {
  factDeclarationProblems,
  factEffectProblems,
  factTestHolds,
  factTestProblems,
  readFact,
  storedFacts,
} from "./world-state.ts";
import type { BuffDef, BuffId } from "./types/buffs.js";
import { buffDeclarationProblems } from "./buffs.ts";

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
  /**
   * The world facts (#198), keyed by id in authored order — `{}` for a graph
   * that declares none, so a reader never has to ask whether there are any.
   */
  facts: Record<FactId, WorldFact>;
  /** Fact ids in authored order. */
  factOrder: FactId[];
  /**
   * The temporary buffs (#200), keyed by id in authored order — `{}` for a
   * graph that declares none.
   */
  buffs: Record<BuffId, BuffDef>;
  /** Buff ids in authored order. */
  buffOrder: BuffId[];
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

  // World facts (#198) first: guards and effects below are checked against
  // them, and only a well-declared fact can be — a test of a fact whose
  // domain is itself broken would be judged against nonsense. A badly
  // declared fact is reported once, here, and names of it elsewhere are
  // skipped rather than reported again as dangling.
  const rawFacts: unknown = declaration.facts;
  const facts: Record<FactId, WorldFact> = {};
  const brokenFacts = new Set<FactId>();
  if (rawFacts !== undefined && !isRecord(rawFacts)) {
    fail("/facts", "facts must be an object keyed by fact id");
  } else if (rawFacts !== undefined) {
    for (const [id, fact] of Object.entries(rawFacts)) {
      const found = factDeclarationProblems(fact);
      for (const { path, problem } of found) fail(`/facts/${seg(id)}${path}`, problem);
      if (found.length === 0) facts[id] = fact as WorldFact;
      else brokenFacts.add(id);
    }
  }
  const factOrder = Object.keys(facts);

  // Temporary buffs (#200), the same way: a broken declaration is reported
  // once, and a grantBuff naming it is not reported again as dangling.
  const rawBuffs: unknown = declaration.buffs;
  const buffs: Record<BuffId, BuffDef> = {};
  const brokenBuffs = new Set<BuffId>();
  if (rawBuffs !== undefined && !isRecord(rawBuffs)) {
    fail("/buffs", "buffs must be an object keyed by buff id");
  } else if (rawBuffs !== undefined) {
    for (const [id, buff] of Object.entries(rawBuffs)) {
      const found = buffDeclarationProblems(buff);
      for (const { path, problem } of found) fail(`/buffs/${seg(id)}${path}`, problem);
      if (found.length === 0) buffs[id] = buff as BuffDef;
      else brokenBuffs.add(id);
    }
  }
  const buffOrder = Object.keys(buffs);

  const checkFactName = (path: string, id: string): WorldFact | null => {
    const fact = facts[id];
    if (fact) return fact;
    if (!brokenFacts.has(id)) fail(path, `"${id}" is not a world fact (declare it in graph.facts)`);
    return null;
  };

  const checkCondition = (path: string, raw: unknown) => {
    if (raw === undefined) return;
    if (!isRecord(raw)) {
      fail(path, "a condition must be an object");
      return;
    }
    const cond = raw as GraphCondition;
    if (cond.visit !== undefined) {
      const visit: unknown = cond.visit;
      const bound = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 1);
      if (!isRecord(visit) || (visit.min === undefined && visit.max === undefined)) {
        fail(`${path}/visit`, "visit is { min?, max? } with at least one of them");
      } else if (!bound(visit.min) || !bound(visit.max) || Object.keys(visit).some((key) => key !== "min" && key !== "max")) {
        fail(`${path}/visit`, "visit's min and max are positive integers (a visit ordinal starts at 1)");
      }
    }
    if (cond.facts !== undefined) {
      if (!isRecord(cond.facts)) {
        fail(`${path}/facts`, "facts is an object of fact id to test");
      } else {
        for (const [id, test] of Object.entries(cond.facts)) {
          const fact = checkFactName(`${path}/facts/${seg(id)}`, id);
          if (!fact) continue;
          for (const found of factTestProblems(fact, test)) {
            fail(`${path}/facts/${seg(id)}${found.path}`, found.problem);
          }
        }
      }
    }
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

  /** An edge's or a completion rule's effects: every name resolves, every fact write fits its fact. */
  const checkEffects = (at: string, raw: unknown) => {
    (Array.isArray(raw) ? (raw as GraphEffect[]) : []).forEach((effect, i) => {
      const path = `${at}/${i}`;
      if (effect?.type === "setFlag") {
        if (!declaredFlags.has(effect.flag)) {
          fail(`${path}/flag`, `"${effect.flag}" is not a journey flag (declare it in graph.flags or a routeSets entry)`);
        }
      } else if (effect?.type === "unlock" || effect?.type === "lock") {
        if (!edgeSet.has(effect.edge)) fail(`${path}/edge`, `no edge "${effect.edge}"`);
      } else if (effect?.type === "setFact" || effect?.type === "adjustFact") {
        const fact = checkFactName(`${path}/fact`, effect.fact);
        if (fact) for (const found of factEffectProblems(fact, effect)) fail(`${path}${found.path}`, found.problem);
      } else if (isRiftEffectType(effect?.type)) {
        checkRiftEffect(path, effect as RiftEffect, rawEdges, nodeSet, fail);
      } else if (effect?.type === "grantBuff") {
        if (typeof effect.buff !== "string" || (!buffs[effect.buff] && !brokenBuffs.has(effect.buff))) {
          fail(`${path}/buff`, `${JSON.stringify(effect.buff)} is not a buff (declare it in graph.buffs)`);
        }
      } else {
        fail(`${path}/type`, `unknown graph effect ${JSON.stringify((effect as { type?: unknown })?.type)}`);
      }
    });
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
      // A closed node is never re-entered, so a variant saying how to
      // re-enter it says something that can never happen (#198).
      if (variant?.revisit !== undefined && typed.revisit === "closed") {
        fail(`${at}/variants/${i}/revisit`, `"${id}" is closed once completed, so it is never revisited and a variant's revisit cannot apply`);
      }
    });
    (Array.isArray(typed.onComplete) ? typed.onComplete : []).forEach((rule, i) => {
      if (!isRecord(rule)) {
        fail(`${at}/onComplete/${i}`, "a completion rule must be an object");
        return;
      }
      checkCondition(`${at}/onComplete/${i}/when`, rule.when);
      checkEffects(`${at}/onComplete/${i}/effects`, rule.effects);
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
    checkEffects(`${at}/effects`, typed.effects);
    if (typed.rift !== undefined) checkRift(id, typed, rawEdges, fail, checkCondition, checkEffects, nodeSet);
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
      facts,
      factOrder,
      buffs,
      buffOrder,
    },
    problems,
  };
}

const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 1;

/** The lifecycle half of a rift — what a linked pair must declare alike. */
const lifecycleOf = (rift: GraphRift): string =>
  JSON.stringify([rift.opensWhen ?? null, rift.persistent ?? null, rift.uses ?? null, rift.lasts ?? null, rift.unstable ?? null]);

/**
 * A rift declaration (#196), in `parseCampaignGraph`'s terms: the names it
 * uses resolve, its numbers are counts, and its properties do not contradict
 * each other. Whether a party can get *stuck* on one is the lint's (#193's
 * search, which tracks rift state).
 */
function checkRift(
  id: EdgeId,
  edge: GraphEdge,
  rawEdges: Record<string, unknown>,
  fail: (path: string, problem: string) => void,
  checkCondition: (path: string, raw: unknown) => void,
  checkEffects: (path: string, raw: unknown) => void,
  nodeSet: ReadonlySet<NodeId>,
): void {
  const at = `/edges/${seg(id)}/rift`;
  if (!isRecord(edge.rift)) {
    fail(at, "a rift must be an object");
    return;
  }
  const rift = edge.rift as GraphRift;
  if (rift.uses !== undefined && !isCount(rift.uses)) fail(`${at}/uses`, "uses must be a whole number of crossings, at least 1");
  if (rift.lasts !== undefined) {
    if (!isRecord(rift.lasts)) fail(`${at}/lasts`, "lasts must be { unit, count }");
    else {
      if (rift.lasts.unit !== "visits" && rift.lasts.unit !== "chapters") {
        fail(`${at}/lasts/unit`, `unit ${JSON.stringify(rift.lasts.unit)} is not "visits" or "chapters" (turn timing is #201's)`);
      }
      if (!isCount(rift.lasts.count)) fail(`${at}/lasts/count`, "count must be a whole number, at least 1");
    }
  }
  if (rift.unstable !== undefined) {
    if (!isRecord(rift.unstable)) fail(`${at}/unstable`, "unstable must be an object");
    else {
      const { flicker, collapsesAfter } = rift.unstable;
      if (flicker === undefined && collapsesAfter === undefined) {
        fail(`${at}/unstable`, "an unstable rift needs a flicker, a collapsesAfter, or both");
      }
      if (flicker !== undefined && (!isRecord(flicker) || !isCount(flicker.open) || !isCount(flicker.shut))) {
        fail(`${at}/unstable/flicker`, "flicker must be { open, shut }, each a whole number of visits, at least 1");
      }
      if (collapsesAfter !== undefined && !isCount(collapsesAfter)) {
        fail(`${at}/unstable/collapsesAfter`, "collapsesAfter must be a whole number of crossings, at least 1");
      }
    }
  }
  if (rift.reveal !== undefined && !(["always", "when-open", "when-crossed"] as unknown[]).includes(rift.reveal)) {
    fail(`${at}/reveal`, `reveal ${JSON.stringify(rift.reveal)} is not "always", "when-open" or "when-crossed"`);
  }
  checkCondition(`${at}/opensWhen`, rift.opensWhen);
  if (rift.persistent === true) {
    for (const key of ["uses", "lasts", "unstable"] as const) {
      if (rift[key] !== undefined) {
        fail(`${at}/${key}`, `a persistent rift stays open for good once open, so it cannot also have "${key}"`);
      }
    }
  }
  if (rift.linkedTo !== undefined) {
    const partner = typeof rift.linkedTo === "string" ? rawEdges[rift.linkedTo] : undefined;
    const partnerRift = isRecord(partner) ? (partner as unknown as GraphEdge).rift : undefined;
    if (rift.linkedTo === id) fail(`${at}/linkedTo`, "a rift cannot be linked to itself");
    else if (!isRecord(partner)) fail(`${at}/linkedTo`, `no edge "${rift.linkedTo}"`);
    else if (!isRecord(partnerRift)) fail(`${at}/linkedTo`, `"${rift.linkedTo}" is not a rift, so it cannot share this one's state`);
    else if (partnerRift.linkedTo !== id) {
      fail(`${at}/linkedTo`, `"${rift.linkedTo}" does not link back to "${id}"; a linked pair names each other`);
    } else {
      if (lifecycleOf(rift) !== lifecycleOf(partnerRift)) {
        fail(
          `${at}/linkedTo`,
          `"${id}" and "${rift.linkedTo}" are one rift, so they must declare the same opensWhen, persistent, uses, lasts and unstable`,
        );
      }
      const other = partner as unknown as GraphEdge;
      if (rift.oneWay === true && other.from === edge.to && other.to === edge.from) {
        fail(`${at}/oneWay`, `"${id}" is one-way, but its partner "${rift.linkedTo}" is the same rift leading back`);
      }
    }
  }
  checkRiftActions(id, edge, rift, fail, checkCondition, checkEffects, nodeSet);
}

// ---------------------------------------------------------------------------
// Rift actions (#197) — the declaration's half
// ---------------------------------------------------------------------------

/** Every `RiftActionKind`, in the order a screen offers them. */
export const RIFT_ACTION_KINDS: readonly RiftActionKind[] = ["discover", "open", "stabilize", "redirect", "close"];

/** The `GraphEffect` that takes each rift action (#197). */
export const RIFT_EFFECT_OF: Readonly<Record<RiftActionKind, RiftEffect["type"]>> = {
  discover: "discoverRift",
  open: "openRift",
  close: "closeRift",
  stabilize: "stabilizeRift",
  redirect: "redirectRift",
};

/** The effects that act on a rift (#197). */
export type RiftEffect = Extract<
  GraphEffect,
  { type: "discoverRift" | "openRift" | "closeRift" | "stabilizeRift" | "redirectRift" }
>;

const RIFT_EFFECT_TYPES: readonly string[] = Object.values(RIFT_EFFECT_OF);

/** Is this effect type one of the rift actions? */
export function isRiftEffectType(type: unknown): type is RiftEffect["type"] {
  return typeof type === "string" && RIFT_EFFECT_TYPES.includes(type);
}

/**
 * Every destination a rift can lead to: its `to`, then its declared
 * `redirects` (#197). For an ordinary edge, just `to`. The static checks walk
 * all of them, because a redirect is a way the party can go.
 */
export function edgeDestinations(edge: Pick<GraphEdge, "to" | "rift">): NodeId[] {
  return [edge.to, ...(edge.rift?.redirects ?? []).filter((each) => each !== edge.to)];
}

/**
 * A rift effect (#197): it names a rift, and a redirect names one of that
 * rift's declared destinations — "invalid destination" is refused here, at
 * load, rather than discovered by a party mid-journey.
 */
function checkRiftEffect(
  path: string,
  effect: RiftEffect,
  rawEdges: Record<string, unknown>,
  nodeSet: ReadonlySet<NodeId>,
  fail: (path: string, problem: string) => void,
): void {
  const target = typeof effect.edge === "string" ? rawEdges[effect.edge] : undefined;
  if (!isRecord(target)) {
    fail(`${path}/edge`, `no edge ${JSON.stringify(effect.edge)}`);
    return;
  }
  const typed = target as unknown as GraphEdge;
  if (!isRecord(typed.rift)) {
    fail(`${path}/edge`, `"${effect.edge}" is not a rift, so ${effect.type} has nothing to act on`);
    return;
  }
  if (effect.type !== "redirectRift") return;
  const to: unknown = effect.to;
  if (typeof to !== "string" || !nodeSet.has(to)) {
    fail(`${path}/to`, `no node ${JSON.stringify(to)}`);
  } else if (!edgeDestinations(typed).includes(to)) {
    fail(
      `${path}/to`,
      `"${to}" is not a destination the rift "${effect.edge}" declares (its "to" or one of its "redirects")`,
    );
  }
}

/** `GraphRift.redirects` and `GraphRift.actions` (#197). */
function checkRiftActions(
  id: EdgeId,
  edge: GraphEdge,
  rift: GraphRift,
  fail: (path: string, problem: string) => void,
  checkCondition: (path: string, raw: unknown) => void,
  checkEffects: (path: string, raw: unknown) => void,
  nodeSet: ReadonlySet<NodeId>,
): void {
  const at = `/edges/${seg(id)}/rift`;
  if (rift.redirects !== undefined) {
    if (!Array.isArray(rift.redirects) || rift.redirects.length === 0) {
      fail(`${at}/redirects`, "redirects must be a non-empty list of node ids");
    } else {
      if (rift.linkedTo !== undefined) {
        fail(`${at}/redirects`, "a linked rift cannot be redirected: its two mouths share one state, and a destination is one mouth's");
      }
      const seen = new Set<string>();
      rift.redirects.forEach((to, i) => {
        if (typeof to !== "string" || !nodeSet.has(to)) fail(`${at}/redirects/${i}`, `no node ${JSON.stringify(to)}`);
        else if (to === edge.to) fail(`${at}/redirects/${i}`, `"${to}" is already where the rift leads`);
        else if (to === edge.from) fail(`${at}/redirects/${i}`, `a rift cannot be turned to lead back to where it starts ("${to}")`);
        else if (seen.has(to)) fail(`${at}/redirects/${i}`, `"${to}" is listed twice`);
        seen.add(String(to));
      });
    }
  }
  if (rift.actions === undefined) return;
  if (!isRecord(rift.actions)) {
    fail(`${at}/actions`, "actions must be an object of action to rule");
    return;
  }
  for (const [kind, rule] of Object.entries(rift.actions)) {
    const path = `${at}/actions/${seg(kind)}`;
    if (!(RIFT_ACTION_KINDS as readonly string[]).includes(kind)) {
      fail(path, `unknown rift action ${JSON.stringify(kind)} (one of ${RIFT_ACTION_KINDS.join(", ")})`);
      continue;
    }
    if (!isRecord(rule)) {
      fail(path, "a rift action's rule must be an object");
      continue;
    }
    checkCondition(`${path}/when`, rule.when);
    checkEffects(`${path}/effects`, rule.effects);
    if (rule.label !== undefined && (typeof rule.label !== "string" || rule.label.trim() === "")) {
      fail(`${path}/label`, "a label is the words on the button");
    }
    if (kind === "redirect" && rift.redirects === undefined) {
      fail(path, `"${id}" declares no redirects, so there is nowhere to turn it`);
    }
  }
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
 * `subject` is the node `outcome` and `visit` read: an edge's `from`, or a
 * variant's (or completion rule's) own node. Without one, a condition carrying
 * either does not hold — there is nothing for it to be about.
 *
 * `context` (#198) carries what the journey alone cannot say:
 *
 * - `facts` — the graph's world fact declarations, so a fact never written
 *   reads as its `initial` and a stored value is read through its
 *   declaration (`readFact`). Without them a `facts` test reads the stored
 *   value raw, and a fact never written passes no test: a reader that has not
 *   said what the world starts as cannot know. Every caller in this file
 *   passes them.
 * - `visit` — the subject's visit ordinal, when it is not `visits[subject]`:
 *   a variant is read on arrival, *before* the visit it chooses for is
 *   counted, so `chapterAtNode` says which visit that will be.
 */
export function evaluateGraphCondition(
  cond: GraphCondition | undefined,
  journey: JourneyFacts,
  subject?: NodeId,
  context: GraphConditionContext = {},
): boolean {
  if (!cond) return true;
  if (cond.visit !== undefined) {
    if (subject === undefined) return false;
    const ordinal = context.visit ?? count(journey.visits, subject);
    if (cond.visit.min !== undefined && ordinal < cond.visit.min) return false;
    if (cond.visit.max !== undefined && ordinal > cond.visit.max) return false;
  }
  if (cond.facts !== undefined) {
    const stored = storedFacts(journey);
    for (const [id, test] of Object.entries(cond.facts)) {
      const declared = context.facts?.[id];
      const value = declared ? readFact(declared, stored[id]) : (stored[id] as FactValue | undefined);
      if (!factTestHolds(test, value)) return false;
    }
  }
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

/** What `evaluateGraphCondition` needs beyond the journey (#198). */
export interface GraphConditionContext {
  /** The world fact declarations (`ParsedCampaignGraph.facts`). */
  facts?: Readonly<Record<FactId, WorldFact>>;
  /** The subject's visit ordinal, when it is not `visits[subject]`. */
  visit?: number;
}

/**
 * Why an exit cannot be taken, in the order it is decided: the first that
 * applies is the one reported, so a screen explaining it says one true thing.
 *
 * - `"locked"` — authored `locked` and never unlocked, or closed by a `lock`.
 * - `"spent"` — a `once` edge already taken.
 * - `"closed"` — it leads into a `revisit: "closed"` node already completed.
 * - `"guard"` — its `when` does not hold.
 * - then, for a rift (#196), `RiftBlock`: why the rift cannot be crossed.
 * - `"fallback"` — a `fallback` edge (#197) while another exit from its node
 *   is available: the long way round is offered only when it is needed.
 */
export type ExitBlock = "locked" | "spent" | "closed" | "guard" | RiftBlock | "fallback";

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
  // Where the edge leads *now*: a redirected rift (#197) is closed by its
  // current destination, not the one it was authored with.
  const to = riftDestination(graph, edgeId, journey);
  if (graph.nodes[to]?.revisit === "closed" && count(journey.completions, to) > 0) {
    return { available: false, reason: "closed" };
  }
  if (!evaluateGraphCondition(edge.when, journey, edge.from, { facts: graph.facts })) {
    return { available: false, reason: "guard" };
  }
  const rift = riftBlock(graph, edgeId, journey);
  if (rift !== null) return { available: false, reason: rift };
  // A fallback (#197) is the way the party takes when there is no other: it
  // asks about its siblings last, and only about ordinary ones, so two
  // fallbacks never wait on each other.
  if (edge.fallback === true) {
    const another = (graph.exits[edge.from] ?? []).some(
      (other) => other !== edgeId && graph.edges[other]?.fallback !== true && exitAvailability(graph, other, journey).available,
    );
    if (another) return { available: false, reason: "fallback" };
  }
  return { available: true };
}

/** One of a node's exits, as a screen or a transition asks about it. */
export interface GraphExit {
  edge: EdgeId;
  /** Where it leads now — a redirected rift's current destination (#197). */
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
      to: riftDestination(graph, id, journey),
      kind: edge.kind,
      availability,
      // A discovered rift (#197) is drawn while blocked, whatever `blocked` says.
      visible:
        availability.available || edge.blocked === "shown" || (edge.rift !== undefined && riftState(graph, id, journey)?.discovered === true),
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
 *
 * The policy is the node's `revisit`, unless the place currently is a variant
 * that says otherwise (#198, `NodeVariant.revisit`): the restored village is
 * walked through, the raging lair is played again. Read like the variant
 * itself, against the journey as it stands on arrival — so a screen asking
 * *before* an edge's effects apply (`JourneyExitView.arrival`) is told what
 * the place is now, which the edge may yet change.
 */
export type Arrival = "new" | "replay" | "pass" | "closed";

export function arrivalAt(graph: ParsedCampaignGraph, node: NodeId, journey: JourneyFacts): Arrival {
  if (count(journey.completions, node) === 0) return "new";
  const declared = graph.nodes[node];
  if (!declared) return "replay";
  if (declared.revisit === "closed") return "closed";
  return variantAtNode(graph, node, journey)?.variant.revisit ?? declared.revisit;
}

/**
 * The variant the place is on arrival — the first whose `when` holds, in
 * authored order — with its index, or null for the node's own chapter.
 *
 * Read for the visit about to begin: `visit` tests (#198) see the ordinal the
 * entry will get (`visits[node] + 1`), because entering is what counts it.
 */
export function variantAtNode(
  graph: ParsedCampaignGraph,
  node: NodeId,
  journey: JourneyFacts,
): { index: number; variant: NodeVariant } | null {
  const declared = graph.nodes[node];
  if (!declared) return null;
  const context = { facts: graph.facts, visit: count(journey.visits, node) + 1 };
  const index = (declared.variants ?? []).findIndex((each) => evaluateGraphCondition(each.when, journey, node, context));
  return index === -1 ? null : { index, variant: declared.variants![index]! };
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
  return variantAtNode(graph, node, journey)?.variant.chapter ?? declared.chapter;
}

/**
 * The effects completing `node`'s visit owes (#198, `GraphNode.onComplete`):
 * every rule whose `when` holds, judged all against the same journey — the
 * one the completion has just produced (outcome recorded, flags read back) —
 * with their effects concatenated in authored order. The runtime applies
 * them (`completeVisit`); the lint applies them the same way.
 */
export function completionEffects(graph: ParsedCampaignGraph, node: NodeId, journey: JourneyFacts): GraphEffect[] {
  const context = { facts: graph.facts };
  return (graph.nodes[node]?.onComplete ?? [])
    .filter((rule) => evaluateGraphCondition(rule.when, journey, node, context))
    .flatMap((rule) => rule.effects);
}

// ---------------------------------------------------------------------------
// Rifts (#196) — the read side
// ---------------------------------------------------------------------------
//
// A rift is an edge with a lifecycle (`GraphRift`, `RiftStatus`). What is
// here only *reads* one: its state as it stands, and whether it can be crossed
// right now. What moves one — crossing, ticking its clock, settling, the
// actions #197 will offer — is `rifts.ts`, which builds on these, so that
// `exitAvailability` (and through it the runtime, the screens and the lint
// search) has a single answer to "is the rift there".

const RIFT_STATUSES: readonly RiftStatus[] = ["dormant", "open", "closed", "consumed", "expired", "collapsed"];

/** The statuses nothing leaves — not a condition, not a clock, not an explicit open. */
export const FINAL_RIFT_STATUSES: readonly RiftStatus[] = ["consumed", "expired", "collapsed"];

/**
 * Why a rift cannot be crossed, after the four ordinary reasons. One per
 * status that blocks, plus the two momentary ones:
 *
 * - `"rift-dormant"` — not yet open (its `opensWhen` has never held), or a
 *   non-persistent triggered rift whose condition does not hold right now.
 * - `"rift-faded"` — unstable, and this visit to `from` is in a shut
 *   stretch of its flicker. A later visit may find it again.
 * - `"rift-closed"` — closed by an action (#197); only an explicit open
 *   brings it back.
 * - `"rift-consumed"` / `"rift-expired"` / `"rift-collapsed"` — final.
 */
export type RiftBlock =
  | "rift-dormant"
  | "rift-faded"
  | "rift-closed"
  | "rift-consumed"
  | "rift-expired"
  | "rift-collapsed";

/**
 * The edge a linked pair keeps its state *for*: the smaller of the two ids.
 * Both records are written alike (`rifts.ts`), but reading one fixed side
 * means two mouths can never disagree, and its `from` is the subject the
 * pair's `opensWhen` is judged against. An unlinked rift is its own owner.
 */
export function riftOwner(graph: ParsedCampaignGraph, edgeId: EdgeId): EdgeId {
  const partner = graph.edges[edgeId]?.rift?.linkedTo;
  return partner !== undefined && graph.edges[partner]?.rift !== undefined && partner < edgeId ? partner : edgeId;
}

/**
 * A stored record, read totally. A record that is not one — a corrupted
 * row, a status from some later build — reads `"closed"`: blocked, and
 * reopened only by an explicit action, because the one thing a misread rift
 * must never do is open by accident.
 */
function storedRift(raw: unknown): RiftState | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || !RIFT_STATUSES.includes(raw.status as RiftStatus)) return { status: "closed" };
  return raw as unknown as RiftState;
}

/**
 * A rift's state as it stands — the stored record (or, absent, the declared
 * start: `"open"`, or `"dormant"` with `opensWhen`) **settled**: a dormant
 * rift whose `opensWhen` now holds is open (age 0), and an open timed rift
 * whose age has reached its `lasts` is expired. `rifts.ts` writes exactly
 * this back after every journey transition, so a stored record and its
 * reading only differ on a journey that has not been settled yet — and then
 * every reader still agrees. `null` for an edge that is not a rift.
 */
export function riftState(graph: ParsedCampaignGraph, edgeId: EdgeId, journey: JourneyFacts): RiftState | null {
  const rift = graph.edges[edgeId]?.rift;
  if (!rift) return null;
  const owner = riftOwner(graph, edgeId);
  const stored = storedRift(journey.rifts?.[owner]) ?? storedRift(journey.rifts?.[edgeId]);
  let state: RiftState = stored ?? { status: rift.opensWhen ? "dormant" : "open" };
  if (state.status === "dormant" && rift.opensWhen) {
    if (evaluateGraphCondition(rift.opensWhen, journey, graph.edges[owner]!.from, { facts: graph.facts })) {
      state = {
        ...state,
        status: "open",
        ...(rift.lasts ? { age: 0 } : {}),
        ...(rift.reveal === "when-open" ? { revealed: true as const } : {}),
      };
    }
  }
  if (state.status === "open" && rift.lasts && state.stable !== true && (state.age ?? 0) >= rift.lasts.count) {
    state = { ...state, status: "expired" };
  }
  return state;
}

/**
 * Whether the rift on `edgeId` can be crossed now, and if not why — `null`
 * for a crossable rift or an edge that is not one. `exitAvailability` asks
 * this after its four ordinary checks.
 */
export function riftBlock(graph: ParsedCampaignGraph, edgeId: EdgeId, journey: JourneyFacts): RiftBlock | null {
  const state = riftState(graph, edgeId, journey);
  if (!state) return null;
  if (state.status !== "open") return `rift-${state.status}`;
  const edge = graph.edges[edgeId]!;
  const rift = edge.rift!;
  // A steadied rift (#197) is past flickering and past its trigger.
  if (rift.opensWhen && rift.persistent !== true && state.latched !== true && state.stable !== true) {
    if (!evaluateGraphCondition(rift.opensWhen, journey, graph.edges[riftOwner(graph, edgeId)]!.from, { facts: graph.facts })) {
      return "rift-dormant";
    }
  }
  const flicker = rift.unstable?.flicker;
  if (flicker && state.stable !== true && !flickerOpen(flicker, count(journey.visits, edge.from))) return "rift-faded";
  return null;
}

/**
 * Where `edgeId` leads now (#197): a redirected rift's stored destination
 * when the declaration still lists it among the rift's `redirects`, else the
 * edge's own `to`. A stored destination the content no longer declares reads
 * as `to` — content can change under a save, and "where it was authored to
 * go" is the one answer that is certainly a place. `""` for no such edge.
 */
export function riftDestination(graph: ParsedCampaignGraph, edgeId: EdgeId, journey: JourneyFacts): NodeId {
  const edge = graph.edges[edgeId];
  if (!edge) return "";
  if (!edge.rift?.redirects) return edge.to;
  const to = riftState(graph, edgeId, journey)?.to;
  return to !== undefined && edge.rift.redirects.includes(to) ? to : edge.to;
}

/**
 * The flicker rhythm: visit ordinal `visit` to the rift's `from` is open when
 * `(visit - 1) mod (open + shut) < open`. A node never visited reads as its
 * first visit, which is the one the party would make.
 */
export function flickerOpen(flicker: { open: number; shut: number }, visit: number): boolean {
  return (Math.max(visit, 1) - 1) % (flicker.open + flicker.shut) < flicker.open;
}
