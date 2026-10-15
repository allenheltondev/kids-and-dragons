/**
 * Graph campaigns — rift lifecycles (#196).
 *
 * A rift is an edge with a life of its own (`GraphEdge.rift`, `GraphRift`):
 * it may wait to open, be used up, run out of time, flicker, collapse, or
 * hide where it leads, and a linked pair shares one life between two mouths.
 * `campaign-graph.ts` *reads* a rift (`riftState`, `riftBlock`, and through
 * them `exitAvailability`); this file *moves* one. The contract is "Rifts" in
 * docs/campaigns/graph-campaigns.md.
 *
 * ---------------------------------------------------------------------------
 * WHEN A RIFT MOVES
 *
 * Only inside the journey's three transitions (`journey.ts`), in a fixed
 * order, so that every reader — the server, a phone, the lint search — walks
 * a rift through the same states:
 *
 *   - **start**: enter the entry, then `settleRifts`.
 *   - **complete a visit**: `tickRifts(…, "chapters")` against the journey as
 *     it stood while the chapter played, then the completion (counters,
 *     outcome, flags), then `settleRifts`.
 *   - **take an exit**: `crossRift` (if the exit is a rift), then
 *     `tickRifts(…, "visits")`, then the edge's own bookkeeping and effects,
 *     then enter the destination, then `settleRifts`.
 *
 * Ticking *before* the transition's own changes means a rift opened by this
 * move or this chapter starts at age 0 and the move that opened it does not
 * count against it; crossing *before* ticking means a timed rift can still be
 * taken on its last move. `settleRifts` last writes back what the journey now
 * implies: a dormant rift whose `opensWhen` holds opens, an open timed one
 * whose time is up expires.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CROSSING IS
 *
 * The party moves as one: a crossing is the `CHOOSE_EXIT` that commits, for
 * the whole party, exactly once. There is no per-hero crossing and no
 * half-crossed party, because the journey has no such state — the exit, the
 * rift's count and the arrival are one `takeExit`, written in one conditional
 * commit. A repeat of the same report is `takeExit`'s duplicate (its
 * `lastExit` check runs before availability), so a double tap on a
 * single-use rift is the same crossing, not a refused second one; and a
 * session that resumes after the write sees the rift as the crossing left it.
 *
 * ---------------------------------------------------------------------------
 * WHAT NEVER HAPPENS
 *
 * A rift's lifecycle does not go backwards. `"consumed"`, `"expired"` and
 * `"collapsed"` are final: no condition, no clock, and not `openRift` either
 * brings one back. `"closed"` reopens only through `openRift`, an explicit
 * act (#197's actions). Nothing here reads a clock or a random number; an
 * unstable rift's flicker reads the visit ordinal.
 *
 * Type imports only, apart from `./campaign-graph.ts` — spelled with its
 * extension because the lint (`campaign-graph-lint.ts`, loaded straight under
 * Node by tools/content/validate.mjs) walks rifts through these same
 * functions.
 */

import type {
  EdgeId,
  JourneyFacts,
  JourneyRiftView,
  RiftClockUnit,
  RiftState,
} from "./types/campaign-graph.js";
import {
  FINAL_RIFT_STATUSES,
  riftOwner,
  riftState,
  type ParsedCampaignGraph,
} from "./campaign-graph.ts";

// ---------------------------------------------------------------------------
// Writing a rift's record
// ---------------------------------------------------------------------------

/** A record in its stored shape: fixed key order, no zero counters. */
function tidy(state: RiftState): RiftState {
  return {
    status: state.status,
    ...((state.crossings ?? 0) > 0 ? { crossings: state.crossings } : {}),
    ...((state.age ?? 0) > 0 ? { age: state.age } : {}),
    ...(state.revealed === true ? { revealed: true as const } : {}),
    ...(state.latched === true ? { latched: true as const } : {}),
  };
}

const same = (a: RiftState | undefined, b: RiftState): boolean =>
  a !== undefined && JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));

/** The ids a rift's record is kept under: the edge, and a linked partner. */
function mouths(graph: ParsedCampaignGraph, edgeId: EdgeId): EdgeId[] {
  const owner = riftOwner(graph, edgeId);
  const partner = graph.edges[owner]?.rift?.linkedTo;
  return partner !== undefined && graph.edges[partner]?.rift?.linkedTo === owner ? [owner, partner] : [owner];
}

/**
 * Writes `state` for the rift on `edgeId` — under both ids of a linked pair,
 * so either mouth read on its own (say, after content unlinks them) still
 * knows what happened to it. Returns the journey unchanged when nothing
 * differs, so an untouched journey stays the same object and the same JSON.
 */
function write<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J, edgeId: EdgeId, state: RiftState): J {
  const ids = mouths(graph, edgeId);
  if (ids.every((id) => same(journey.rifts?.[id], state))) return journey;
  const rifts = { ...(journey.rifts ?? {}) };
  for (const id of ids) rifts[id] = tidy(state);
  return { ...journey, rifts };
}

/** Each rift once (a linked pair by its owner), in authored edge order. */
function owners(graph: ParsedCampaignGraph): EdgeId[] {
  return graph.edgeOrder.filter((id) => graph.edges[id]!.rift !== undefined && riftOwner(graph, id) === id);
}

// ---------------------------------------------------------------------------
// The lifecycle steps the journey runs
// ---------------------------------------------------------------------------

/**
 * Writes back every rift's settled reading (`riftState`): a dormant rift whose
 * `opensWhen` holds is now open, an open timed rift whose age has reached its
 * `lasts` is now expired. A rift still exactly as declared (open from the
 * start, or dormant) is not written: absent reads as declared, and a journey
 * with no rifts on it stays a journey with no `rifts` key.
 *
 * Idempotent: settling a settled journey returns it unchanged.
 */
export function settleRifts<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J): J {
  let next = journey;
  for (const id of owners(graph)) {
    const reading = riftState(graph, id, next)!;
    const stored = mouths(graph, id).some((each) => journey.rifts?.[each] !== undefined);
    const declared = graph.edges[id]!.rift!.opensWhen ? "dormant" : "open";
    if (!stored && same({ status: declared }, reading)) continue;
    next = write(graph, next, id, reading);
  }
  return next;
}

/**
 * One tick of `unit` for every timed rift on that clock that is open: its age
 * goes up by one, and at its `lasts.count` it expires. The hook a turn clock
 * (#201) would call with a unit of its own.
 */
export function tickRifts<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J, unit: RiftClockUnit): J {
  let next = journey;
  for (const id of owners(graph)) {
    const lasts = graph.edges[id]!.rift!.lasts;
    if (!lasts || lasts.unit !== unit) continue;
    const reading = riftState(graph, id, journey)!;
    if (reading.status !== "open") continue;
    const age = (reading.age ?? 0) + 1;
    next = write(graph, next, id, { ...reading, age, status: age >= lasts.count ? "expired" : "open" });
  }
  return next;
}

/**
 * The party crossed the rift on `edgeId`: one more crossing (for both mouths
 * of a linked pair), and the end that brings — `"consumed"` at `uses`, else
 * `"collapsed"` at `unstable.collapsesAfter` (both at once is consumed: the
 * rift was meant to be used up, and was). A `"when-crossed"` destination is
 * now revealed. An edge that is not a rift is returned unchanged.
 *
 * The caller has already found the exit available (`takeExit` does); this
 * only counts.
 */
export function crossRift<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J, edgeId: EdgeId): J {
  const rift = graph.edges[edgeId]?.rift;
  const reading = riftState(graph, edgeId, journey);
  if (!rift || !reading) return journey;
  const crossings = (reading.crossings ?? 0) + 1;
  const status =
    FINAL_RIFT_STATUSES.includes(reading.status) || reading.status === "closed"
      ? reading.status
      : rift.uses !== undefined && crossings >= rift.uses
        ? "consumed"
        : rift.unstable?.collapsesAfter !== undefined && crossings >= rift.unstable.collapsesAfter
          ? "collapsed"
          : reading.status;
  return write(graph, journey, edgeId, {
    ...reading,
    status,
    crossings,
    ...(rift.reveal === "when-crossed" ? { revealed: true as const } : {}),
  });
}

// ---------------------------------------------------------------------------
// Explicit changes — for #197's actions
// ---------------------------------------------------------------------------

/**
 * Why an explicit change was refused.
 *
 * - `"not-a-rift"` — the edge has no `rift`.
 * - `"final"` — it is consumed, expired or collapsed, and nothing reopens it.
 * - `"persistent"` — a persistent rift that is open cannot be closed.
 */
export type RiftRefusalCode = "not-a-rift" | "final" | "persistent";

export type RiftChange<J extends JourneyFacts> =
  /** `changed: false` — it already was so; the journey is returned as it was. */
  | { ok: true; changed: boolean; journey: J }
  | { ok: false; code: RiftRefusalCode; message: string };

const refuse = (code: RiftRefusalCode, message: string): { ok: false; code: RiftRefusalCode; message: string } => ({
  ok: false,
  code,
  message,
});

const changed = <J extends JourneyFacts>(before: J, after: J): RiftChange<J> => ({
  ok: true,
  changed: after !== before,
  journey: after,
});

/**
 * Opens a dormant or closed rift by an explicit act — the only way back from
 * `"closed"`. The rift is `latched`: its `opensWhen` no longer gates crossing
 * it. A timed rift opened from dormant starts its clock at 0; one reopened
 * from closed keeps the age it had. Final rifts are refused.
 */
export function openRift<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J, edgeId: EdgeId): RiftChange<J> {
  const rift = graph.edges[edgeId]?.rift;
  const reading = riftState(graph, edgeId, journey);
  if (!rift || !reading) return refuse("not-a-rift", `"${edgeId}" is not a rift`);
  if (FINAL_RIFT_STATUSES.includes(reading.status)) {
    return refuse("final", `the rift "${edgeId}" is ${reading.status}, and nothing reopens it`);
  }
  const gated = rift.opensWhen !== undefined && rift.persistent !== true;
  if (reading.status === "open" && (!gated || reading.latched === true)) return changed(journey, journey);
  return changed(
    journey,
    write(graph, journey, edgeId, {
      ...reading,
      status: "open",
      ...(gated ? { latched: true as const } : {}),
      ...(rift.reveal === "when-open" ? { revealed: true as const } : {}),
    }),
  );
}

/**
 * Closes a dormant or open rift by an explicit act. A rift already closed,
 * or already final, is left as it is (`changed: false` — it is shut either
 * way, and a final status is never overwritten). An open persistent rift is
 * refused: it stays open for good.
 */
export function closeRift<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J, edgeId: EdgeId): RiftChange<J> {
  const rift = graph.edges[edgeId]?.rift;
  const reading = riftState(graph, edgeId, journey);
  if (!rift || !reading) return refuse("not-a-rift", `"${edgeId}" is not a rift`);
  if (reading.status === "closed" || FINAL_RIFT_STATUSES.includes(reading.status)) return changed(journey, journey);
  if (rift.persistent === true && reading.status === "open") {
    return refuse("persistent", `the rift "${edgeId}" is persistent: once open, it stays open`);
  }
  const { latched: _latched, ...rest } = reading;
  // A "when-open" destination the party has seen stays known after it shuts.
  const seen = rift.reveal === "when-open" && reading.status === "open";
  return changed(
    journey,
    write(graph, journey, edgeId, { ...rest, status: "closed", ...(seen ? { revealed: true as const } : {}) }),
  );
}

/** Reveals a rift's destination by an explicit act, whatever its `reveal` says. */
export function revealRift<J extends JourneyFacts>(graph: ParsedCampaignGraph, journey: J, edgeId: EdgeId): RiftChange<J> {
  const reading = riftState(graph, edgeId, journey);
  if (!reading) return refuse("not-a-rift", `"${edgeId}" is not a rift`);
  return changed(journey, write(graph, journey, edgeId, { ...reading, revealed: true }));
}

// ---------------------------------------------------------------------------
// Reading, for the screens
// ---------------------------------------------------------------------------

/**
 * Whether the players know where the rift on `edgeId` leads: always for an
 * ordinary edge or `reveal: "always"`; for `"when-open"` once it has opened;
 * for `"when-crossed"` once the party has been through (either mouth of a
 * linked pair); and whenever an action has revealed it.
 */
export function riftDestinationRevealed(graph: ParsedCampaignGraph, edgeId: EdgeId, journey: JourneyFacts): boolean {
  const rift = graph.edges[edgeId]?.rift;
  const reading = riftState(graph, edgeId, journey);
  if (!rift || !reading) return true;
  const reveal = rift.reveal ?? "always";
  if (reveal === "always" || reading.revealed === true) return true;
  // An untriggered "when-open" rift was open from the start: once it is
  // used up or runs out, where it led is still known.
  return reveal === "when-open" && reading.status !== "dormant" && reading.status !== "closed";
}

/** A rift exit's lifecycle as a screen draws it (`JourneyExitView.rift`); `null` for an ordinary edge. */
export function riftView(graph: ParsedCampaignGraph, edgeId: EdgeId, journey: JourneyFacts): JourneyRiftView | null {
  const rift = graph.edges[edgeId]?.rift;
  const reading = riftState(graph, edgeId, journey);
  if (!rift || !reading) return null;
  const live = reading.status === "open" || reading.status === "dormant";
  const crossings = reading.crossings ?? 0;
  return {
    status: reading.status,
    ...(rift.uses !== undefined && live ? { usesLeft: Math.max(rift.uses - crossings, 0) } : {}),
    ...(rift.lasts && reading.status === "open"
      ? { expiresIn: { unit: rift.lasts.unit, count: Math.max(rift.lasts.count - (reading.age ?? 0), 0) } }
      : {}),
    ...(rift.unstable?.collapsesAfter !== undefined && live
      ? { collapsesIn: Math.max(rift.unstable.collapsesAfter - crossings, 0) }
      : {}),
    ...(rift.oneWay === true ? { oneWay: true as const } : {}),
    ...(rift.unstable !== undefined ? { unstable: true as const } : {}),
    ...(rift.persistent === true ? { persistent: true as const } : {}),
    ...(mouths(graph, edgeId).length > 1 ? { linked: true as const } : {}),
  };
}
