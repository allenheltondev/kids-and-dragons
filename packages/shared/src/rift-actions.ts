/**
 * Graph campaigns — rift actions (#197).
 *
 * A rift (#196) moves by itself — it opens when its condition holds, ages,
 * flickers, is used up. This file is the other half: what the *story* and the
 * *party* can do to one on purpose. Discover it, open it, close it, steady it,
 * turn it toward somewhere else. The contract is "Rift actions" in
 * docs/campaigns/graph-campaigns.md; the moves themselves are `rifts.ts`'s
 * (`discoverRift`, `openRift`, `closeRift`, `stabilizeRift`, `redirectRift`),
 * and this file only decides *when* each may happen and reads it two ways:
 *
 *   - as an **authored effect** (`{ "type": "stabilizeRift", "edge": … }`) —
 *     on an edge, in a node's `onComplete` rules (#198; that is how an
 *     encounter or a story scene acts on a rift: the chapter reports its
 *     outcome or sets a journey flag, and the node's completion rule does the
 *     rest, with no change to the chapter schema), or in a party action's own
 *     effects. `applyRiftEffect`.
 *   - as a **party action** (`RIFT_ACTION`), offered while the party is
 *     choosing a way on, by the rift's `actions` rules. `riftActionsFrom`
 *     lists what is offered; `journey.ts`'s `takeRiftAction` takes one.
 *
 * ---------------------------------------------------------------------------
 * ONE RULE FOR "CANNOT"
 *
 * Final statuses stay final (`FINAL_RIFT_STATUSES`). The two readings answer
 * "cannot" differently, on purpose:
 *
 *   - An **effect never refuses**. It is one step of a move that is happening
 *     anyway — a crossing, a completed chapter — and a refusal would have to
 *     undo the move or strand it half-done. An effect that cannot apply (a
 *     final rift; closing an open persistent one) does nothing, and the lint
 *     warns when it can only ever do nothing (`RIFT_EFFECT_ON_FINAL`).
 *   - A **party action is only offered when it would change something**: its
 *     rule's `when` holds and the move would not be refused or a no-op. So a
 *     button never does nothing, and a retry that arrives after the rift has
 *     moved on is refused instead of applying the action's effects twice.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LINT CAN WALK IT
 *
 * Everything here reads the journey and the declaration and nothing else —
 * no party, no clock, no randomness — so the softlock search (#193) treats a
 * party action as one more transition out of a choosing state, by calling
 * `riftActionsFrom` itself.
 *
 * The one thing that reads the party is a rule's `requires` (#199) — whose
 * class, whose item — and it is kept out of everything above on purpose:
 * `riftActionsFrom` offers by the journey alone, and the party is judged
 * after, by `partyMeets`, where the action is taken (the server, with the
 * seated party) and where it is drawn (`riftActionsForParty`). The lint
 * explores with every requirement met, and then proves the campaign can
 * still be won with none of them (`CLASS_GATED_ONLY_PATH`), because it
 * cannot know who will be at the table.
 *
 * Type imports only, apart from the two modules it builds on, spelled with
 * their extensions for the reason `rifts.ts` gives: tools/content/validate.mjs
 * loads the lint (and so this) straight under Node.
 */

import type {
  EdgeId,
  GraphEffect,
  JourneyFacts,
  JourneyRiftActionView,
  NodeId,
  PartyRequirement,
  RiftActionKind,
  RiftActionRule,
  RiftParty,
} from "./types/campaign-graph.js";
import type { ResolvedCharacter } from "./types/domain.js";
import {
  FINAL_RIFT_STATUSES,
  RIFT_ACTION_KINDS,
  edgeDestinations,
  evaluateGraphCondition,
  isRiftEffectType,
  riftActionRules,
  riftActionWays,
  riftDestination,
  riftState,
  type ParsedCampaignGraph,
  type RiftEffect,
} from "./campaign-graph.ts";
import {
  closeRift,
  discoverRift,
  openRift,
  redirectRift,
  riftDestinationRevealed,
  stabilizeRift,
  type RiftChange,
} from "./rifts.ts";

/** Is this effect a rift action (#197)? */
export function isRiftEffect(effect: GraphEffect): effect is RiftEffect {
  return isRiftEffectType(effect.type);
}

/** One rift action, as `rifts.ts` takes it — the change, or why not. */
export function riftActionChange<J extends JourneyFacts>(
  graph: ParsedCampaignGraph,
  journey: J,
  action: RiftActionKind,
  edgeId: EdgeId,
  to?: NodeId,
): RiftChange<J> {
  switch (action) {
    case "discover":
      return discoverRift(graph, journey, edgeId);
    case "open":
      return openRift(graph, journey, edgeId);
    case "close":
      return closeRift(graph, journey, edgeId);
    case "stabilize":
      return stabilizeRift(graph, journey, edgeId);
    case "redirect":
      return to === undefined
        ? { ok: false, code: "bad-destination", message: `turning the rift "${edgeId}" needs a destination` }
        : redirectRift(graph, journey, edgeId, to);
  }
}

const ACTION_OF: Readonly<Record<RiftEffect["type"], RiftActionKind>> = {
  discoverRift: "discover",
  openRift: "open",
  closeRift: "close",
  stabilizeRift: "stabilize",
  redirectRift: "redirect",
};

/** The action an effect takes (`stabilizeRift` → `"stabilize"`). */
export function riftEffectAction(effect: RiftEffect): RiftActionKind {
  return ACTION_OF[effect.type];
}

/**
 * An authored rift effect, applied: the journey after it, or the same
 * journey when it cannot apply (see the file comment — an effect never
 * refuses). `journey.ts` calls this inside `applyEffects`, in order with the
 * effects around it, and the lint calls it the same way.
 */
export function applyRiftEffect<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J, effect: RiftEffect): J {
  const change = riftActionChange(
    graph,
    journey,
    riftEffectAction(effect),
    effect.edge,
    effect.type === "redirectRift" ? effect.to : undefined,
  );
  return change.ok ? change.journey : journey;
}

/**
 * Whether a rift effect can do anything to the rift as it stands — false for
 * a final rift, and for closing one that is open and persistent. What the
 * lint asks to find an effect that is only ever wasted.
 */
export function riftEffectCanApply(graph: ParsedCampaignGraph, journey: JourneyFacts, effect: RiftEffect): boolean {
  const state = riftState(graph, effect.edge, journey);
  if (!state) return false;
  if (FINAL_RIFT_STATUSES.includes(state.status)) return effect.type === "discoverRift";
  if (effect.type === "closeRift" && state.status === "open" && graph.edges[effect.edge]!.rift!.persistent === true) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Party actions
// ---------------------------------------------------------------------------

/** One action the party may take now (`riftActionsFrom`). */
export interface RiftActionOffer {
  action: RiftActionKind;
  /** The rift it acts on: one of the node's exits. */
  edge: EdgeId;
  /** For `"redirect"`: where it would turn the rift. */
  to?: NodeId;
  /** Which way (#199): the rule's `id`, absent for a kind's lone unnamed rule. */
  way?: string;
  rule: RiftActionRule;
}

/**
 * Every rift action offered at `node` on this journey, in exit order and
 * then `RIFT_ACTION_KINDS` order (a redirect once per destination it could
 * turn to, in declared order): those whose rule exists, whose `when` holds
 * (subject: the rift's `from`), and which would change something.
 *
 * A redirect is offered only for a rift whose destination the party already
 * knows (`riftDestinationRevealed`): offering "turn it toward the Orchard"
 * on a rift that might already lead there would be a spoiler by elimination.
 * Discover first, then steer.
 *
 * A kind with several ways (#199) is offered once per way whose `when`
 * holds, in authored order. **The party is not asked**: this is the journey's
 * half of the rule, the same for every table, so the lint can walk it. Who is
 * seated is judged by the caller — `takeRiftAction` (given the party) and
 * `riftActionsForParty` — against each offer's `rule.requires`.
 *
 * Asked of the party at a choice — the caller checks that (`takeRiftAction`,
 * `journeyView`); the lint asks it of every choosing state it explores.
 */
export function riftActionsFrom(graph: ParsedCampaignGraph, node: NodeId, journey: JourneyFacts): RiftActionOffer[] {
  const offers: RiftActionOffer[] = [];
  for (const edgeId of graph.exits[node] ?? []) {
    const edge = graph.edges[edgeId]!;
    if (!edge.rift?.actions) continue;
    for (const action of RIFT_ACTION_KINDS) {
      for (const { rule, way } of riftActionWays(edge.rift, action)) {
        if (!evaluateGraphCondition(rule.when, journey, edge.from, { facts: graph.facts })) continue;
        const named = way !== undefined ? { way } : {};
        if (action === "redirect") {
          if (!riftDestinationRevealed(graph, edgeId, journey)) continue;
          const current = riftDestination(graph, edgeId, journey);
          for (const to of edgeDestinations(edge)) {
            if (to === current) continue;
            const change = riftActionChange(graph, journey, action, edgeId, to);
            if (change.ok && change.changed) offers.push({ action, edge: edgeId, to, ...named, rule });
          }
          continue;
        }
        const change = riftActionChange(graph, journey, action, edgeId);
        if (change.ok && change.changed) offers.push({ action, edge: edgeId, ...named, rule });
      }
    }
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Who can (#199)
// ---------------------------------------------------------------------------

/**
 * The seated party as a `PartyRequirement` reads it: every class at the
 * table, and every item carried — inventory and quest items alike, the way a
 * chapter choice's `requiresItem` reads them (`partyItemIds`). Sorted and
 * without repeats, so two phones building it from the same party agree.
 */
export function riftPartyOf(
  members: readonly Pick<ResolvedCharacter, "class" | "inventory" | "questItems">[],
): RiftParty {
  const classes = new Set(members.map((member) => member.class));
  const items = new Set<string>();
  for (const member of members) {
    for (const entry of member.inventory) items.add(entry.itemId);
    for (const id of member.questItems) items.add(id);
  }
  return { classes: [...classes].sort(), items: [...items].sort() };
}

/**
 * Does the seated party meet a requirement? Absent asks nothing. Every field
 * present must hold; within a list, any one will do.
 */
export function partyMeets(requires: PartyRequirement | undefined, party: RiftParty): boolean {
  if (!requires) return true;
  if (requires.anyClass && !requires.anyClass.some((each) => party.classes.includes(each))) return false;
  if (requires.anyItem && !requires.anyItem.some((each) => party.items.includes(each))) return false;
  return true;
}

/**
 * The view's rift actions as one table may take them (#199) — the one rule
 * every screen draws by and the server enforces by (`partyMeets`): a way the
 * party can take stays; a way it cannot is kept, marked `unmet`, only when
 * its author wrote a `hint` to show instead, and otherwise dropped — like a
 * chapter choice nobody seated could make.
 */
export function riftActionsForParty(
  actions: readonly JourneyRiftActionView[],
  party: RiftParty,
): JourneyRiftActionView[] {
  const out: JourneyRiftActionView[] = [];
  for (const action of actions) {
    if (partyMeets(action.needs, party)) {
      const { unmet: _unmet, ...rest } = action;
      out.push(rest);
    } else if (action.hint !== undefined) out.push({ ...action, unmet: true });
  }
  return out;
}

/** A requirement in words, for refusals and lint messages: `needs a starweaver or songkeeper`. */
export function describeRequirement(requires: PartyRequirement | undefined): string {
  if (!requires) return "anyone";
  const parts: string[] = [];
  if (requires.anyClass) parts.push(`a ${requires.anyClass.join(" or ")}`);
  if (requires.anyItem) parts.push(`someone carrying ${requires.anyItem.join(" or ")}`);
  return `needs ${parts.join(" and ")}`;
}

/** Is any rift action gated on the party (#199)? What the lint's second pass looks for. */
export function riftActionGated(rule: RiftActionRule): boolean {
  return rule.requires !== undefined;
}

/**
 * Whether anything in the campaign can open the rift on `edgeId` again once
 * it is closed: an `openRift` effect anywhere, or an `open` action on either
 * mouth. A close nothing can undo is the one rift action the screens ask
 * about first (`JourneyRiftActionView.irreversible`).
 */
export function riftCanReopen(graph: ParsedCampaignGraph, edgeId: EdgeId): boolean {
  const mouths = new Set([edgeId]);
  const partner = graph.edges[edgeId]?.rift?.linkedTo;
  if (partner !== undefined) mouths.add(partner);
  const opens = (effects: readonly GraphEffect[] | undefined) =>
    (effects ?? []).some((effect) => effect.type === "openRift" && mouths.has(effect.edge));
  for (const id of graph.edgeOrder) {
    const edge = graph.edges[id]!;
    if (opens(edge.effects)) return true;
    if (mouths.has(id) && edge.rift?.actions?.open) return true;
    for (const rule of riftActionRules(edge.rift)) if (opens(rule.effects)) return true;
  }
  for (const id of graph.nodeOrder) {
    for (const rule of graph.nodes[id]!.onComplete ?? []) if (opens(rule.effects)) return true;
  }
  return false;
}
