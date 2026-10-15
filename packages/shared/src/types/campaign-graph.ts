/**
 * Graph campaigns — the declaration (#192). docs/campaigns/graph-campaigns.md
 * is the authoring contract; this file is the shape it describes.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND SHAPE AT ALL
 *
 * An ordered campaign (`Campaign` without `graph`) is a road: beats 1..n, one
 * chapter per beat, a routed beat choosing between files that share an index.
 * Gemfall is built that way and stays that way. What it cannot say is
 * *geography that loops*: go to the shrine, go sideways to the marsh, come
 * back to the shrine and find it changed, leave by a door that only opened
 * because of something done in the marsh. There is no "beat 4" in that story —
 * the party might reach the same place third or fifth — so the index, which
 * is the spine of every ordered rule (`lastIndex`, `chapterFor`, "Chapter 3
 * of 6"), has nothing to mean.
 *
 * So a graph campaign names *places-in-the-story* (nodes) and the ways
 * between them (edges), each with a stable id, and plays a chapter at each
 * node. The chapter is still the playable unit — one file, one biome, one
 * evening's worth — and still authored exactly as before. What changes is who
 * decides which chapter comes next: the edges, not the index.
 *
 * ---------------------------------------------------------------------------
 * WHY OPT-IN AND VERSIONED
 *
 * `Campaign.graph` absent means an ordered campaign, read and played exactly
 * as it always was — that is the whole of Gemfall's compatibility story, and
 * it is why nothing here is required. `version` is the declaration's, not the
 * campaign's: a reader that meets a version it does not know refuses the
 * campaign (`parseCampaignGraph`) rather than playing it under the wrong
 * rules. Bumping it is how a later issue changes a meaning below instead of
 * quietly reinterpreting a shipped file.
 *
 * Everything in this file is types. The rules that read them — which mode a
 * campaign is in, what is wrong with a declaration, whether an exit is open —
 * are in `campaign-graph.ts`, pure and import-free so the content validator
 * can load them directly under Node.
 */

import type { Arrival, ExitBlock } from "../campaign-graph.js";
import type { ChapterOutcome } from "./chapter.js";

/** A node's key in `CampaignGraph.nodes`. Stable: saves name it. */
export type NodeId = string;

/** An edge's key in `CampaignGraph.edges`. Stable: saves name it. */
export type EdgeId = string;

/** The only declaration version this build understands. */
export type CampaignGraphVersion = 1;

/**
 * `Campaign.graph`. Present means the campaign is played by these edges; its
 * absence is an ordered campaign (`campaignMode`).
 *
 * `Campaign.chapters` keeps its meaning — every chapter file in the campaign —
 * and gains one rule: every listed chapter is played by some node (as its
 * `chapter` or a variant's), and every chapter a node plays is listed. The
 * loader and `content:validate` already read `chapters` to know which files
 * belong to which campaign, and a second list would be a second answer.
 *
 * Chapters of a graph campaign still carry `index` (the chapter schema
 * requires it), but **nothing routes on it**: no beat sequence is checked and
 * no `route` may be declared — choosing the next chapter is the edges' job.
 * Use it as a rough act number for the authoring tools, nothing more.
 */
export interface CampaignGraph {
  version: CampaignGraphVersion;
  /**
   * Where a fresh attempt starts. One entry, deliberately: an attempt has to
   * begin somewhere determinate, and "choose where to start" is a forward
   * fork out of a prologue node, which every tool already understands.
   */
  entry: NodeId;
  /**
   * The places, keyed by stable id. Key order is authored order, and the
   * tools present nodes in it.
   */
  nodes: Record<NodeId, GraphNode>;
  /**
   * The ways between places, keyed by stable id. Key order is authored order,
   * and a node's exits are offered in it (`ParsedCampaignGraph.exits`).
   *
   * Edges live beside the nodes rather than inside them so an id is unique
   * across the whole graph — an unlock effect, a guard and a save can all
   * name an edge without saying which node owns it.
   */
  edges: Record<EdgeId, GraphEdge>;
  /**
   * Flags the journey remembers between chapters, beyond `routeSets`.
   *
   * The same carry rule as an ordered campaign, widened: a declared flag is
   * seeded into every chapter run of the attempt and read back from the run
   * when its chapter completes; anything undeclared dies at the chapter
   * boundary as it always has. `routeSets` members are journey flags too (and
   * keep their fork semantics), so a set does not need repeating here.
   *
   * Declared rather than inferred for the routeSets reason: only a declared
   * list can notice a guard reading a flag nothing will ever carry.
   */
  flags?: string[];
}

/**
 * What happens when the party enters a node it has already **completed**.
 *
 * - `"replay"` (default) — the node's chapter is played again, from its
 *   entry scene, as a new visit. Variants are consulted, so "again" may well
 *   be a changed place.
 * - `"pass"` — the party walks through without playing: the visit begins
 *   already done and goes straight to choosing an exit. For a hub or a
 *   crossroads a return edge leads back to, where replaying the hub's
 *   chapter every time would be a chore.
 * - `"closed"` — once completed, never entered again: every edge into it is
 *   unavailable (`ExitBlock` `"closed"`). The burnt bridge, the collapsed
 *   cave.
 *
 * A node not yet completed is always entered and played, whatever this says.
 */
export type RevisitPolicy = "replay" | "pass" | "closed";

export interface GraphNode {
  /** The chapter played here: a `Campaign.chapters` member. */
  chapter: string;
  /** The map label. Absent means the chapter's own title. */
  title?: string;
  /** See `RevisitPolicy`. Absent means `"replay"`. */
  revisit?: RevisitPolicy;
  /**
   * A different chapter for this place when something holds — the marsh
   * after the flood, the village after the rift took its well.
   *
   * Consulted on **every** entry that plays the node (a first visit too: a
   * place can change before the party ever gets there), in authored order;
   * the first whose `when` holds is played, and none holding plays `chapter`.
   * `when` is read against the journey as it stands on arrival, after the
   * edge that brought the party has applied its effects.
   *
   * A variant is a whole chapter, not a narration patch, for the reason a
   * routed beat is: biome — backdrop, palette, music — belongs to the file.
   * Narration-level change inside one chapter is the chapter's own
   * `variants` and needs nothing from here. #198 widens `when` with world
   * state; the selection rule stays this one.
   */
  variants?: NodeVariant[];
  /**
   * Makes this node an ending of the campaign. Completing its chapter
   * completes the attempt (commitment, spec §8.3) and records which ending
   * the party reached. An ending node has no exits.
   *
   * Only ending nodes end a graph campaign. A chapter ending's
   * `endsCampaign` is the ordered campaigns' early exit and has no meaning
   * here; an ending that is a different place is a different node.
   */
  ending?: GraphEnding;
}

export interface NodeVariant {
  /** A `Campaign.chapters` member. */
  chapter: string;
  when: GraphCondition;
}

export interface GraphEnding {
  /** Shown when the campaign completes here, so it reads to an 8-year-old. */
  title: string;
}

/**
 * The author's statement of what an edge *is*, which the tools hold the graph
 * to (#193) and the screens present (#195). Movement is the same for all
 * three; what differs is what a cycle is allowed to be made of.
 *
 * - `"forward"` — onward in the story. A cycle of only forward edges is a
 *   mistake: the story would arrive where it had already been without anybody
 *   having meant it to.
 * - `"sideways"` — to a neighboring place at the same point in the story: an
 *   optional side trip, a parallel lead.
 * - `"return"` — back to somewhere the story has been. This is what makes a
 *   cycle intentional: a loop through a return edge is a revisit by design.
 */
export type GraphEdgeKind = "forward" | "sideways" | "return";

/**
 * A way from one node to another, taken by the party choosing it once the
 * node's visit is done.
 *
 * An edge is **available** from a node whose visit is done when it is not
 * locked, not spent, does not lead into a closed node, and its `when` holds
 * (`exitAvailability`, which also says which of those failed). Exits are
 * only ever chosen between visits: there is no leaving a node mid-chapter.
 */
export interface GraphEdge {
  from: NodeId;
  to: NodeId;
  kind: GraphEdgeKind;
  /** What the choice says on the screen. Absent means the destination's title. */
  label?: string;
  /**
   * Available only while this holds. Named `when` because it is the graph's
   * `Choice.when`: same word, same "every field present must hold".
   */
  when?: GraphCondition;
  /**
   * Applied, in order, when the party takes this edge — before they arrive,
   * so the destination's variants see them.
   */
  effects?: GraphEffect[];
  /**
   * Starts locked: unavailable until an `unlock` effect opens it. The door
   * the marsh opens, the path that only exists once the bridge is mended.
   */
  locked?: true;
  /**
   * May be taken once per attempt. After that it is spent, whatever its
   * `when` says. (A rift's single coordinated crossing, #196, is this plus
   * more; this is the part that is only about counting.)
   */
  once?: true;
  /**
   * The author's claim that taking this edge commits the party: there is no
   * way back to `from` afterwards. Nothing *enforces* it at runtime — it is
   * a claim about the graph, which #193 checks and #195 turns into a warning
   * before the crossing.
   */
  irreversible?: true;
  /**
   * How an unavailable exit is shown. `"hidden"` (default) is the house rule
   * for choices — unmet requirements hide, never disable (architecture §5).
   * `"shown"` draws it as a way the party can see and not yet take: the
   * locked door is part of the place, and knowing it is there is the point.
   */
  blocked?: "hidden" | "shown";
}

/**
 * A test against the journey (#192). Every field is optional and every field
 * present must hold: they are ANDed, and an empty condition always holds —
 * the same rule as the chapters' `Condition`, so authors learn it once.
 *
 * It reads only the journey (`JourneyFacts`), never the party seated at the
 * table: a graph decision has to come out the same on any evening, for any
 * phones, or a party resuming on Thursday would see different doors than the
 * one that stopped on Monday. "Only if somebody holds the key" belongs in the
 * chapter, as a choice that sets a journey flag.
 *
 * A field naming nodes or edges takes one id or a list; a list means every
 * listed id must hold (`visited: ["a", "b"]` — both visited).
 */
export interface GraphCondition {
  /** This journey flag is set. */
  flag?: string;
  /** This journey flag is not set. */
  notFlag?: string;
  /** Entered at least once this attempt (a visit, finished or not). */
  visited?: NodeId | NodeId[];
  /** Never entered this attempt. */
  notVisited?: NodeId | NodeId[];
  /** Its chapter completed at least once this attempt. */
  completed?: NodeId | NodeId[];
  /** Its chapter never completed this attempt. */
  notCompleted?: NodeId | NodeId[];
  /** Taken at least once this attempt. */
  traversed?: EdgeId | EdgeId[];
  /** Never taken this attempt. */
  notTraversed?: EdgeId | EdgeId[];
  /**
   * How the **subject** node's most recent completion ended. On an edge the
   * subject is the edge's `from` — "if the chapter you just finished was a
   * setback, this way is open". On a node variant it is the node itself —
   * "if it went badly here last time". A subject never completed matches
   * neither outcome.
   */
  outcome?: ChapterOutcome;
}

/**
 * What taking an edge does to the journey. The first is the chapters'
 * `setFlag`, same shape, so a flag reads the same written either place.
 */
export type GraphEffect =
  /**
   * Sets a journey flag (`CampaignGraph.flags` or a `routeSets` member).
   * Setting a route set member is a fork, as in a chapter: the set's other
   * members are cleared.
   */
  | { type: "setFlag"; flag: string; value?: boolean }
  /** Opens an edge: a `locked` one becomes available (subject to `when`). */
  | { type: "unlock"; edge: EdgeId }
  /** Closes an edge for the rest of the attempt. */
  | { type: "lock"; edge: EdgeId };

/**
 * What the journey remembers, as guards and exit availability read it.
 *
 * This is the read model the contract is written against. The attempt-scoped
 * state that persists it — `JourneyState`, stored on the campaign attempt —
 * is #194's to wire, and may grow; these fields may not change meaning.
 *
 * Counters are per attempt and start absent (read as 0). A key for a node or
 * edge the declaration no longer has is ignored, never an error: content can
 * change under a save.
 */
export interface JourneyFacts {
  /** Visits begun, per node — see "Visits" in graph-campaigns.md. */
  visits?: Record<NodeId, number>;
  /** Visits whose chapter completed, per node. Never more than `visits`. */
  completions?: Record<NodeId, number>;
  /** How each node's most recent completion ended. */
  outcomes?: Record<NodeId, ChapterOutcome>;
  /** Times taken, per edge. */
  traversed?: Record<EdgeId, number>;
  /**
   * Edges whose lock state an effect has changed: `"open"` overrides an
   * authored `locked`, `"locked"` closes an edge that was open. Absent means
   * as authored.
   */
  edges?: Record<EdgeId, "open" | "locked">;
  /** Journey flags: `CampaignGraph.flags` and `routeSets` members. */
  flags?: Record<string, boolean>;
}

/**
 * Where a visit stands.
 *
 * - `"playing"` — the node's chapter has not completed for this visit. A
 *   session that ends here resumes **the same visit**: no counter moves.
 * - `"choosing"` — the visit is done (its chapter completed, or a `"pass"`
 *   revisit began done) and the party has not yet taken an exit. A session
 *   that ends here resumes at the exit choice, never at a replay.
 * - `"ended"` — the visit completed an ending node; the attempt is over.
 */
export type VisitStatus = "playing" | "choosing" | "ended";

/**
 * The attempt's whole journey: the facts, plus where the party is.
 *
 * Defined here so #194 (persistence, transitions), #195 (navigation) and
 * #202 (inspection) share one meaning; stored by #194 on
 * `CampaignProgressRecord.journey`. **Absent on an attempt of an ordered
 * campaign is the only reading there is** — every row written before graphs
 * existed, and every Gemfall row forever — and nothing about such an attempt
 * changes. Absent on an attempt of a graph campaign means the journey has not
 * been written yet, and reads as a fresh start at the entry (`startJourney`,
 * which is deterministic, so every reader agrees on what that is).
 *
 * Only `journey.ts` moves it: `startJourney`, `completeVisit`, `takeExit`.
 * `version` is this record's own (`JOURNEY_VERSION`), checked on every read
 * (`readJourney`) — a row written by a newer build is refused, never guessed.
 */
export interface JourneyState extends JourneyFacts {
  version: CampaignGraphVersion;
  /** The node the party is at. */
  node: NodeId;
  /**
   * Which visit to `node` this is, 1-based: `visits[node]` when the visit
   * began. With the attempt id, `(node, visit)` names one visit exactly —
   * what makes a completion or an exit idempotent (#194): a second report of
   * the same visit's completion, or of the same exit from it, is a repeat,
   * not new progress.
   */
  visit: number;
  status: VisitStatus;
  /** The chapter this visit plays (variant already resolved on arrival). */
  chapter: string;
  /** The ending node completed, once `status` is `"ended"`. */
  ending?: NodeId;
  /**
   * Every chapter id completed this attempt, in first-completion order. A
   * chapter's `xpAward` is paid on its first completion in the attempt and
   * not again: a cycle is a story device, not an XP farm, and a variant is a
   * different chapter, so a changed place pays once more.
   */
  chaptersCompleted?: string[];
  /**
   * The exit most recently taken, and the visit it ended (#194). What makes
   * an exit idempotent: a second report of `(node, visit, edge)` — the
   * double-tap, the retry after a dropped response — is recognized as the
   * same crossing and answered with the journey as it stands, rather than
   * refused as stale or, worse, taken again from wherever the party now is.
   * Only the latest is kept: a report older than that is a stale screen, and
   * is refused (`takeExit`). Absent until the first exit is taken.
   */
  lastExit?: { node: NodeId; visit: number; edge: EdgeId };
}

/**
 * Where a graph campaign's journey stands, as the screens need it
 * (`CampaignView.journey`, built by `journeyView`). The navigation screens
 * (#195) draw from this and send `CHOOSE_EXIT` back; nothing here is needed to
 * *decide* anything — the server re-derives every answer from the stored
 * journey.
 */
export interface JourneyView {
  /** The node the journey is at. */
  node: NodeId;
  /** Its map label: the node's `title`, else its chapter's title. */
  title: string;
  /** The visit ordinal — `CHOOSE_EXIT.visit` echoes it back. */
  visit: number;
  status: VisitStatus;
  /** The chapter this visit plays (or, for a `"pass"` visit, the place's chapter). */
  chapter: string;
  /**
   * The exits a screen draws, in authored order, while `status` is
   * `"choosing"`; empty otherwise (there is no leaving mid-chapter, and an
   * ended journey goes nowhere). Only `visible` exits: available ones, and
   * blocked ones authored `blocked: "shown"`, with why they are blocked.
   */
  exits: JourneyExitView[];
  /** The ending this journey reached, once `status` is `"ended"`. */
  reachedEnding?: { node: NodeId; title: string };
}

/** One drawn exit (`JourneyView.exits`). */
export interface JourneyExitView {
  edge: EdgeId;
  to: NodeId;
  kind: GraphEdgeKind;
  /** The edge's `label`, else the destination's title. */
  label: string;
  available: boolean;
  /** Why not, when `available` is false (`ExitBlock`). */
  reason?: ExitBlock;
  /** What crossing would be (`arrivalAt`): a new place, a replay, a pass-through. */
  arrival: Arrival;
  /** Authored `irreversible` — #195 warns before the crossing. */
  irreversible?: true;
}
