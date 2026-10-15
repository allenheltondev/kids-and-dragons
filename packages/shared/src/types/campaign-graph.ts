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
  /**
   * The world's state, as this campaign tracks it (#198): which places are
   * displaced, which threats are awake, who the party has won over, which
   * roads are open, what the party's choices cost. Keyed by stable fact id,
   * in authored order. See `WorldFact`.
   *
   * Absent means a graph with no world state — every graph written before
   * #198 — so adding the field bumps nothing.
   */
  facts?: Record<FactId, WorldFact>;
}

/** A world fact's key in `CampaignGraph.facts`. Stable: saves name it. */
export type FactId = string;

/**
 * What a world fact is *about* — for the tools and the screens, never for a
 * rule. Nothing the runtime decides reads it: a "threat" fact guards an edge
 * exactly as a "locale" one does. It is how #202's inspection groups a world
 * panel and how #195/#201 find "the threats" without a naming convention to
 * grep for.
 *
 * - `"locale"` — a place's condition: standing, displaced, flooded, restored.
 * - `"threat"` — a danger's status: sleeping, raging, cleared.
 * - `"alliance"` — where the party stands with someone: favours owed, a pact.
 * - `"route"` — a way that has opened or closed *in the world* (an edge's own
 *   `locked` is the graph's; a route fact is what a guard reads to say why).
 * - `"consequence"` — something the party's choices caused that the story
 *   remembers: the scorched orchard, the broken bell.
 */
export type FactDomain = "locale" | "threat" | "alliance" | "route" | "consequence";

/** What a world fact holds: an enum member, a counter's integer, a flag's boolean. */
export type FactValue = string | number | boolean;

/**
 * One world fact's declaration (#198). **Typed and bounded**, rather than
 * more journey flags, for three reasons:
 *
 * - A place's condition is one of several states, and only one at a time.
 *   Three booleans (`village_displaced`, `village_restored`, ...) can all be
 *   true at once, and every guard that reads them has to rule out the
 *   combinations nobody meant; an enum cannot be two things.
 * - A bounded domain can be *enumerated*: the graph lint (#193) walks every
 *   value a fact can take, so "this road can never open" stays decidable. An
 *   unbounded counter or a free string would make the search infinite, or a
 *   guess.
 * - An initial value is part of the declaration, so "absent in the save"
 *   always has one meaning — the world as the author wrote it — and a fact
 *   added to a campaign after a party started reads correctly with no
 *   migration.
 *
 * Journey flags (`flags`) stay what they are: the booleans chapters set and
 * read. A world fact is the graph's, written by the graph — by an edge's
 * effects, or by a node's `onComplete` rules reading what a chapter reported
 * — and read by guards and variants. Chapters do not see facts (they are not
 * seeded into runs); a chapter that should differ by world state is a
 * different chapter, chosen by a node variant.
 */
export type WorldFact = EnumFact | CounterFact | FlagFact;

interface FactCommon {
  domain: FactDomain;
  /** What the screens call it, for an 8-year-old. Absent means the id. */
  label?: string;
  /**
   * Shown to the players (`JourneyView.facts`). Absent means the world
   * remembers it but the screens do not say so — a surprise the author wants
   * to keep, or bookkeeping nobody needs to see.
   */
  visible?: true;
}

/** One of a fixed set of states. The usual kind: a locale, a threat. */
export interface EnumFact extends FactCommon {
  type: "enum";
  /** Every state, 2–12 of them, ids in the node/edge id pattern. */
  values: string[];
  /** The state before anybody has done anything. One of `values`. */
  initial: string;
}

/** An integer between bounds. Favours owed, how far a flood has risen. */
export interface CounterFact extends FactCommon {
  type: "counter";
  /** Integers, `min ≤ initial ≤ max`, at most `MAX_COUNTER_SPAN` apart. */
  min: number;
  max: number;
  initial: number;
}

/** True or false, with a declared starting value. A road open or closed. */
export interface FlagFact extends FactCommon {
  type: "flag";
  /** Absent means false. */
  initial?: boolean;
}

/**
 * A test of one world fact, inside `GraphCondition.facts`.
 *
 * - a bare value — the fact *is* this: an enum member, a counter's integer,
 *   a flag's boolean;
 * - `{ "in": [...] }` — an enum (or counter) is one of these;
 * - `{ "not": v }` — an enum (or counter) is anything but this;
 * - `{ "min": a, "max": b }` — a counter is within these (inclusive; either
 *   may be absent).
 *
 * Every key present must hold, like the condition around it. Every value
 * named must be in the fact's domain — a test for a state the fact can never
 * be in is a typo, refused by `parseCampaignGraph`.
 */
export type FactTest =
  | FactValue
  | {
      in?: (string | number)[];
      not?: string | number;
      min?: number;
      max?: number;
    };

/**
 * A node's completion rule (#198): when the node's chapter completes and
 * `when` holds, `effects` apply. This is how a chapter's result reaches the
 * world state without the chapter schema learning anything new — the chapter
 * sets a journey flag, or simply succeeds or falls short, and the *graph*
 * says what that does to the world:
 *
 * ```json
 * "onComplete": [
 *   { "when": { "outcome": "setback", "facts": { "ash-wyrm": "sleeping" } },
 *     "effects": [{ "type": "setFact", "fact": "ash-wyrm", "value": "raging" }] }
 * ]
 * ```
 */
export interface CompletionRule {
  /**
   * Read against the journey as the visit completes — the outcome recorded
   * (`outcome` is this completion's), the journey flags read back from the
   * run — and before any rule's effects. Every rule is judged against that
   * same journey, so rules do not see each other's effects, and their order
   * matters only for effects that write the same thing. Absent always holds.
   */
  when?: GraphCondition;
  /** Applied in order, rule after rule, exactly as an edge's effects apply. */
  effects: GraphEffect[];
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
   * What completing this node's chapter does to the journey beyond the
   * completion itself (#198): every rule whose `when` holds applies its
   * effects. See `CompletionRule`. A `"pass"` arrival completes nothing and
   * runs none of them.
   */
  onComplete?: CompletionRule[];
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
  /**
   * What re-entering the node does while this variant is the place (#198),
   * overriding the node's `revisit`: the restored village needs no replaying,
   * the raging lair does. Read only for a node already completed — a first
   * visit always plays — and only `"replay"` or `"pass"`: whether a node is
   * `"closed"` is decided before the party crosses, and a variant is chosen
   * on arrival. Absent means the node's `revisit`.
   */
  revisit?: "replay" | "pass";
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
  /**
   * Makes this edge a **rift** (#196): a stateful link with a lifecycle of
   * its own — it may wait to open, be used up, run out of time, flicker,
   * collapse, or hide where it leads. Absent means an ordinary edge, exactly
   * as before. See `GraphRift`, and "Rifts" in graph-campaigns.md.
   */
  rift?: GraphRift;
}

// ---------------------------------------------------------------------------
// Rifts (#196)
// ---------------------------------------------------------------------------

/**
 * The clocks a timed rift can run on. Both are counted in moments the
 * journey already has (§6) — there is no wall clock anywhere in a journey,
 * because a party resuming on Thursday must find the rift exactly as Monday
 * left it, however long the week was.
 *
 * - `"visits"` — places entered: one tick each time the party takes any
 *   exit and arrives somewhere (a pass-through counts; it is a move).
 * - `"chapters"` — chapters completed: one tick each time a visit's chapter
 *   settles. A chapter is authored to be one sitting, so this is the
 *   *session* clock — "the rift lasts two evenings" — without reading a date.
 *
 * Turn-by-turn time inside an encounter is #201's (environmental combat): a
 * rift that closes "in three rounds" would tick during a chapter, which
 * nothing here does. `tickRifts` is the hook it would call with a new unit.
 */
export type RiftClockUnit = "visits" | "chapters";

/**
 * A rift's declaration: composable properties, every one optional. An empty
 * `rift: {}` is a rift with no rules — open from the start, forever — which
 * is still worth saying, because the screens draw a rift as one.
 *
 * Each property alone, in the words of the lifecycle (`RiftStatus`):
 *
 * - `opensWhen` (**triggered**) — `"dormant"` until this holds, then
 *   `"open"`. Unless `persistent`, an open triggered rift is only *crossable*
 *   while the condition still holds (it reads `"rift-dormant"` otherwise);
 *   its lifecycle does not go backwards.
 * - `persistent` — once open, it stays open for good: its `opensWhen` is no
 *   longer consulted and nothing (no rift action, #197) closes it. It
 *   therefore cannot also be used up, timed or unstable (refused).
 * - `uses: n` (**single-use** at 1) — `"consumed"` after the party has
 *   crossed it n times. One crossing is one coordinated party move: the
 *   whole party crosses with the exit, never one hero.
 * - `lasts` (**timed**) — `"expired"` once `count` ticks of `unit` have
 *   passed since it opened.
 * - `unstable` — `flicker`: there only on some visits to its `from`, by a
 *   fixed rhythm; `collapsesAfter: n`: `"collapsed"` after n crossings.
 *   Deterministic, never random: the rhythm reads the visit ordinal.
 * - `linkedTo` (**linked**) — names its partner rift. The two are one rift
 *   with two mouths: one shared state, so crossing either counts against
 *   both and whatever ends one ends the other. Must be mutual, and the two
 *   must declare the same lifecycle (`opensWhen`, `persistent`, `uses`,
 *   `lasts`, `unstable`). A pair of opposite edges is a two-way rift.
 * - `oneWay` — the promise that there is no rift back: refused with a
 *   partner that is its own way back, and checked against every other rift
 *   edge (`RIFT_ONE_WAY_HAS_WAY_BACK`). Movement on an edge is always one
 *   way; this is the claim the screens (#195) show the players.
 * - `reveal` — when the players learn where it leads: `"always"` (default),
 *   `"when-open"` (hidden while dormant) or `"when-crossed"` (hidden until
 *   the party has been through). A hidden destination is blanked in the
 *   journey view, never sent to a phone.
 */
export interface GraphRift {
  oneWay?: true;
  /** Crossings before it is consumed; `1` is single-use. */
  uses?: number;
  /** How long it stays open once open. */
  lasts?: { unit: RiftClockUnit; count: number };
  /**
   * Dormant until this holds. Read against the journey like an edge guard,
   * with the edge's `from` as the subject (for a linked pair, the `from` of
   * the pair's first id in sort order, so both mouths agree).
   */
  opensWhen?: GraphCondition;
  unstable?: {
    /**
     * Open on `open` visits to `from`, then gone for `shut`, repeating:
     * visit ordinal v is open when `(v - 1) mod (open + shut) < open`. The
     * same visit always gives the same answer, so a resumed session sees
     * the rift exactly as it was left.
     */
    flicker?: { open: number; shut: number };
    /** Crossings before it collapses. */
    collapsesAfter?: number;
  };
  /** Once open, open for good. */
  persistent?: true;
  /** The partner rift: two mouths, one state. Must name this edge back. */
  linkedTo?: EdgeId;
  /** When the destination is shown. Default `"always"`. */
  reveal?: "always" | "when-open" | "when-crossed";
}

/**
 * Where a rift is in its life. The lifecycle only moves forward:
 *
 * ```
 *   dormant ──(opensWhen holds / openRift)──▶ open
 *      │                                      │ ├─(crossings = uses)──────────▶ consumed   ┐
 *      │                                      │ ├─(age = lasts.count)─────────▶ expired    ├ final
 *      │                                      │ ├─(crossings = collapsesAfter)▶ collapsed  ┘
 *      └──────────(closeRift)──────────▶ closed ◀─(closeRift)┘
 *                                         └──(openRift)──▶ open
 * ```
 *
 * - `"consumed"`, `"expired"`, `"collapsed"` are **final**: no transition
 *   leaves them, not even an explicit open (#197) — a used-up rift that
 *   comes back is a different edge.
 * - `"closed"` is a stop, not an end: only an explicit `openRift` (#197's
 *   action) reopens it. Nothing derived — no condition, no clock — does.
 * - `"open"` is the lifecycle, not the moment: a non-persistent triggered
 *   rift whose condition stops holding, or an unstable one in a shut flicker,
 *   is still `"open"` but cannot be crossed right now (`RiftBlock`).
 */
export type RiftStatus = "dormant" | "open" | "closed" | "consumed" | "expired" | "collapsed";

/**
 * A rift's stored state (`JourneyFacts.rifts`), keyed by edge id; a linked
 * pair keeps the same record under both ids. Absent means "as declared": open
 * from the start, or dormant if `opensWhen` — and a reader settles it on the
 * way (`riftState`), so an unwritten record and a written one never disagree.
 */
export interface RiftState {
  status: RiftStatus;
  /** Times crossed (by either mouth of a linked pair). Absent = 0. */
  crossings?: number;
  /** Ticks of its `lasts` clock since it opened. Timed rifts only. */
  age?: number;
  /** Its destination has been revealed by an action (#197), whatever `reveal` says. */
  revealed?: true;
  /**
   * Opened by an explicit action (`openRift`, #197) rather than by its
   * condition: the condition no longer gates crossing it.
   */
  latched?: true;
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
  /**
   * The **subject** node's visit ordinal is within these bounds (inclusive;
   * either may be absent) — #198's "the second time you come here". On an
   * edge it is the visit to `from` the party is finishing; on a variant it is
   * the visit being begun (so `{ "min": 2 }` is every revisit); in a node's
   * `onComplete` it is the visit completing. Positive integers. Without a
   * subject it does not hold.
   */
  visit?: { min?: number; max?: number };
  /**
   * World facts (#198), each tested as `FactTest` says: every listed fact must
   * pass its test. A fact never written reads as its declared `initial`.
   */
  facts?: Record<FactId, FactTest>;
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
  | { type: "lock"; edge: EdgeId }
  /**
   * Sets a world fact (#198): an enum member, a counter's integer (within its
   * bounds), a flag's boolean.
   */
  | { type: "setFact"; fact: FactId; value: FactValue }
  /**
   * Moves a counter fact by `by` (a non-zero integer), clamped to its bounds:
   * a fourth favour owed when the counter stops at three is still three.
   */
  | { type: "adjustFact"; fact: FactId; by: number };

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
  /**
   * Rift lifecycles (#196), by edge id; absent entries read as declared
   * (`RiftState`). Moved only by `rifts.ts`. A record for an edge that is no
   * longer a rift is ignored.
   */
  rifts?: Record<EdgeId, RiftState>;
  /**
   * World facts this attempt has written (#198). **Attempt-scoped**: the
   * world as *this* party left it, on this attempt's row and nowhere else —
   * never the campaign's declaration, never canon, never another household's
   * attempt or this household's next one, which starts from the declared
   * `initial` values again.
   *
   * Absent, or a fact absent from it, reads as the declared `initial` — every
   * journey saved before #198 included. A stored value is read through its
   * declaration (`readFact`): an id the declaration no longer has is ignored;
   * an enum value it no longer lists, or a value of the wrong type, reads as
   * `initial`; a counter outside narrowed bounds is clamped into them.
   */
  facts?: Record<FactId, FactValue>;
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
  /**
   * The places this party has **been** (#195), in authored order: every node
   * with at least one visit, and only those — an unexplored place is never
   * listed, so the list cannot spoil the map. What the navigation screen's
   * "places you've been" draws. Optional so a view built by an older server
   * (or a test) without it still reads; screens treat absence as empty.
   */
  places?: JourneyPlaceView[];
  /**
   * The world facts declared `visible` (#198), in authored order, with their
   * current values — what the screens may tell the players about how the
   * world has changed. Present only when the graph declares a visible fact.
   */
  facts?: JourneyFactView[];
}

/** One place the party has been (`JourneyView.places`). */
export interface JourneyPlaceView {
  node: NodeId;
  /** The place's map label — the same one `JourneyView.title` uses. */
  title: string;
  /** How many visits have begun, finished or not. */
  visits: number;
  /** Its chapter has been finished at least once (it was played, not only reached). */
  completed: boolean;
  /** The party is standing here now. */
  here?: true;
}

/** One player-visible world fact (`JourneyView.facts`). */
export interface JourneyFactView {
  id: FactId;
  domain: FactDomain;
  /** The declaration's `label`, else the id. */
  label: string;
  type: WorldFact["type"];
  value: FactValue;
}

/** One drawn exit (`JourneyView.exits`). */
export interface JourneyExitView {
  edge: EdgeId;
  /** The destination — `""` while `hiddenDestination` (#196). */
  to: NodeId;
  kind: GraphEdgeKind;
  /**
   * The edge's `label`, else the destination's title. While
   * `hiddenDestination`, the authored `label` (the author's words, which must
   * not name the place) or a generic one — never the destination's title.
   */
  label: string;
  available: boolean;
  /** Why not, when `available` is false (`ExitBlock`). */
  reason?: ExitBlock;
  /**
   * What crossing would be (`arrivalAt`): a new place, a replay, a
   * pass-through. For an available exit it is the crossing's own answer,
   * after the edge's effects — an edge that changes a world fact can change a
   * variant's `revisit` (#198). `"new"` is the screens' "unexplored" — the party has never
   * finished a chapter there — and is why such an exit's `label` never falls
   * back to a title the author did not put on the map (`journeyView`).
   * While `hiddenDestination` (#196) it is always `"new"` — all the party
   * knows — rather than a hint about somewhere they have been.
   */
  arrival: Arrival;
  /** Authored `irreversible` — the screen asks before the crossing (#195). */
  irreversible?: true;
  /** Authored `once` — the way can be taken one time only; the screen asks first (#195). */
  once?: true;
  /**
   * Going back would find the place **different** from how the party last
   * played it: the chapter the crossing would resolve there (after the edge's
   * own effects) is one the party has never played. A flag and nothing more —
   * which variant, and what changed, is the story's to tell on arrival.
   * Present only on available exits to places already finished — replayed or,
   * under a variant's `revisit: "pass"` (#198), walked through — and only when
   * true. Never on a `hiddenDestination` exit (#196): it would be a hint.
   */
  changed?: true;
  /** The exit is a rift (#196): its lifecycle as the screen needs it. */
  rift?: JourneyRiftView;
  /**
   * A rift whose destination the players have not learned yet (`reveal`):
   * `to` is blank and `label`/`arrival`/`changed` say nothing about the place.
   */
  hiddenDestination?: true;
}

/** A rift exit's lifecycle, as a screen draws it (`JourneyExitView.rift`). */
export interface JourneyRiftView {
  /** Its lifecycle status (`RiftStatus`); `reason` says why it cannot be crossed now. */
  status: RiftStatus;
  /** With `uses`: crossings left before it is consumed. */
  usesLeft?: number;
  /** A timed rift that is open: ticks left before it expires. */
  expiresIn?: { unit: RiftClockUnit; count: number };
  /** With `unstable.collapsesAfter`: crossings left before it collapses. */
  collapsesIn?: number;
  oneWay?: true;
  unstable?: true;
  persistent?: true;
  /** One of a linked pair: crossing it counts for its partner too. */
  linked?: true;
}
