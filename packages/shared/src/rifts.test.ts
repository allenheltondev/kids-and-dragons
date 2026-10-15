/**
 * Rift lifecycles (#196): the declaration, the read side (`riftState`,
 * `exitAvailability`), the moves (`rifts.ts` inside `journey.ts`'s
 * transitions), the view, and the lint search that has to walk rifts the way
 * the runtime does.
 *
 * Most cases use a three-place map built here — a hub the party passes
 * through, a far place, and an ending — with the rift under test on the
 * hub's way out, so each property can be seen alone and in combination. The
 * Rift Lifecycle fixture (fixtures/rift-lifecycle.campaign.json) is the
 * whole picture, and is held to the parser and the lint at the end.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  exitAvailability,
  parseCampaignGraph,
  riftBlock,
  riftState,
  type ParsedCampaignGraph,
} from "./campaign-graph.js";
import { lintCampaignGraph } from "./campaign-graph-lint.js";
import {
  completeVisit,
  HIDDEN_RIFT_LABEL,
  journeyView,
  readJourney,
  resumeJourney,
  startJourney,
  takeExit,
} from "./journey.js";
import { closeRift, crossRift, openRift, revealRift, riftView, settleRifts, tickRifts } from "./rifts.js";
import type { Campaign, ChapterOutcome } from "./types/chapter.js";
import type { GraphEdge, GraphRift, JourneyState } from "./types/campaign-graph.js";

// ---------------------------------------------------------------------------
// A small map
// ---------------------------------------------------------------------------

/**
 * hub (pass, entry) ──shimmer──▶ far ──far-to-end──▶ end (ending)
 *   ▲                             │
 *   └──────── far-to-hub ─────────┘ (return)
 *
 * `shimmer` is the rift under test; `edges` adds or replaces edges.
 */
function campaign(rift: GraphRift | undefined, edges: Record<string, Partial<GraphEdge> | null> = {}): Campaign {
  const all: Record<string, GraphEdge> = {
    shimmer: {
      from: "hub",
      to: "far",
      kind: "forward",
      blocked: "shown",
      ...(rift ? { rift } : {}),
    },
    "far-to-hub": { from: "far", to: "hub", kind: "return" },
    "far-to-end": { from: "far", to: "end", kind: "forward" },
  };
  for (const [id, edge] of Object.entries(edges)) {
    if (edge === null) delete all[id];
    else all[id] = { ...(all[id] ?? {}), ...edge } as GraphEdge;
  }
  return {
    id: "rift-test",
    title: "Rift Test",
    blurb: "",
    chapters: ["c-hub", "c-far", "c-end"],
    graph: {
      version: 1,
      entry: "hub",
      flags: ["moon_up", "key"],
      nodes: {
        hub: { chapter: "c-hub", title: "The Hub", revisit: "pass" },
        far: { chapter: "c-far", title: "The Far Shore" },
        end: { chapter: "c-end", ending: { title: "The End" } },
      },
      edges: all,
    },
  } as Campaign;
}

function parsed(c: Campaign): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(c);
  expect(problems).toEqual([]);
  return graph!;
}

const graphWith = (rift: GraphRift | undefined, edges?: Record<string, Partial<GraphEdge> | null>) =>
  parsed(campaign(rift, edges));

/** Plays the visit under way to its end, as a settled run reports it. */
function play(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  flags: Record<string, boolean> = {},
  outcome: ChapterOutcome = "success",
): JourneyState {
  const result = completeVisit(graph, journey, {
    node: journey.node,
    visit: journey.visit,
    chapterId: journey.chapter,
    outcome,
    flags: { ...(journey.flags ?? {}), ...flags },
  });
  if (!result.ok || result.duplicate) throw new Error(`completion: ${JSON.stringify(result)}`);
  return result.journey;
}

function go(graph: ParsedCampaignGraph, journey: JourneyState, edge: string): JourneyState {
  const result = takeExit(graph, journey, { edge, visit: journey.visit });
  if (!result.ok || result.duplicate) throw new Error(`exit ${edge}: ${JSON.stringify(result)}`);
  return result.journey;
}

/** Start, play the hub: standing at the hub's exit choice. */
const atHub = (graph: ParsedCampaignGraph, flags: Record<string, boolean> = {}) =>
  play(graph, startJourney(graph), flags);

/** Through the rift, play the far place, and back to the hub (a pass-through). */
const roundTrip = (graph: ParsedCampaignGraph, journey: JourneyState, flags: Record<string, boolean> = {}) =>
  go(graph, play(graph, go(graph, journey, "shimmer"), flags), "far-to-hub");

/** Out and back by the far place's return without using the rift: `hub-to-far` is a plain twin. */
const plainTwin = { "hub-to-far": { from: "hub", to: "far", kind: "forward" } } as const;

// ---------------------------------------------------------------------------
// Declaration
// ---------------------------------------------------------------------------

describe("declaring a rift", () => {
  it("is optional: an edge without one is an ordinary edge, and a journey grows no rift state", () => {
    const graph = graphWith(undefined);
    expect(riftState(graph, "shimmer", {})).toBeNull();
    const journey = roundTrip(graph, atHub(graph));
    expect(journey).not.toHaveProperty("rifts");
    expect(journeyView(graph, journey).exits[0]).not.toHaveProperty("rift");
  });

  it("an empty rift is open from the start, for good, and is drawn as a rift", () => {
    const graph = graphWith({});
    const journey = roundTrip(graph, atHub(graph));
    expect(exitAvailability(graph, "shimmer", journey)).toEqual({ available: true });
    expect(journeyView(graph, journey).exits[0]).toMatchObject({ edge: "shimmer", to: "far", rift: { status: "open" } });
    expect(journey.rifts).toEqual({ shimmer: { status: "open", crossings: 1 } });
  });

  const problems = (rift: unknown, edges: Record<string, Partial<GraphEdge> | null> = {}) =>
    parseCampaignGraph(campaign(rift as GraphRift, edges)).problems.map((p) => `${p.path}: ${p.problem}`);

  it("refuses counts that are not counts, clocks it does not know, and an empty instability", () => {
    expect(problems({ uses: 0 })).toEqual(["/graph/edges/shimmer/rift/uses: uses must be a whole number of crossings, at least 1"]);
    expect(problems({ lasts: { unit: "turns", count: 2 } })).toEqual([
      '/graph/edges/shimmer/rift/lasts/unit: unit "turns" is not "visits" or "chapters" (turn timing is #201\'s)',
    ]);
    expect(problems({ lasts: { unit: "visits", count: 1.5 } })).toHaveLength(1);
    expect(problems({ unstable: {} })).toEqual([
      "/graph/edges/shimmer/rift/unstable: an unstable rift needs a flicker, a collapsesAfter, or both",
    ]);
    expect(problems({ unstable: { flicker: { open: 1 } } })).toHaveLength(1);
    expect(problems({ reveal: "sometimes" })).toHaveLength(1);
    expect(problems("rift")).toEqual(["/graph/edges/shimmer/rift: a rift must be an object"]);
  });

  it("checks opensWhen like any guard", () => {
    expect(problems({ opensWhen: { flag: "nope", visited: "nowhere" } })).toEqual([
      '/graph/edges/shimmer/rift/opensWhen/flag: "nope" is not a journey flag (declare it in graph.flags or a routeSets entry)',
      '/graph/edges/shimmer/rift/opensWhen/visited: no node "nowhere"',
    ]);
  });

  it("refuses a persistent rift that could still end", () => {
    expect(problems({ persistent: true, uses: 1, lasts: { unit: "visits", count: 2 } })).toEqual([
      '/graph/edges/shimmer/rift/uses: a persistent rift stays open for good once open, so it cannot also have "uses"',
      '/graph/edges/shimmer/rift/lasts: a persistent rift stays open for good once open, so it cannot also have "lasts"',
    ]);
    expect(problems({ persistent: true, unstable: { collapsesAfter: 1 } })).toHaveLength(1);
  });

  it("holds a linked pair to naming each other, being rifts, and sharing one lifecycle", () => {
    expect(problems({ linkedTo: "nowhere" })).toEqual(['/graph/edges/shimmer/rift/linkedTo: no edge "nowhere"']);
    expect(problems({ linkedTo: "shimmer" })).toEqual(["/graph/edges/shimmer/rift/linkedTo: a rift cannot be linked to itself"]);
    expect(problems({ linkedTo: "far-to-hub" })).toEqual([
      '/graph/edges/shimmer/rift/linkedTo: "far-to-hub" is not a rift, so it cannot share this one\'s state',
    ]);
    expect(problems({ linkedTo: "far-to-hub" }, { "far-to-hub": { rift: {} } })).toEqual([
      '/graph/edges/shimmer/rift/linkedTo: "far-to-hub" does not link back to "shimmer"; a linked pair names each other',
    ]);
    expect(problems({ linkedTo: "far-to-hub", uses: 2 }, { "far-to-hub": { rift: { linkedTo: "shimmer" } } })).toEqual([
      '/graph/edges/shimmer/rift/linkedTo: "shimmer" and "far-to-hub" are one rift, so they must declare the same opensWhen, persistent, uses, lasts and unstable',
      '/graph/edges/far-to-hub/rift/linkedTo: "far-to-hub" and "shimmer" are one rift, so they must declare the same opensWhen, persistent, uses, lasts and unstable',
    ]);
  });

  it("refuses a one-way rift linked to its own way back", () => {
    expect(
      problems({ linkedTo: "far-to-hub", oneWay: true }, { "far-to-hub": { rift: { linkedTo: "shimmer" } } }),
    ).toEqual(['/graph/edges/shimmer/rift/oneWay: "shimmer" is one-way, but its partner "far-to-hub" is the same rift leading back']);
  });
});

// ---------------------------------------------------------------------------
// Each property alone
// ---------------------------------------------------------------------------

describe("single-use", () => {
  it("is consumed by one party crossing, and stays consumed", () => {
    const graph = graphWith({ uses: 1 });
    const crossed = go(graph, atHub(graph), "shimmer");
    expect(crossed.rifts).toEqual({ shimmer: { status: "consumed", crossings: 1 } });
    const back = go(graph, play(graph, crossed), "far-to-hub");
    expect(exitAvailability(graph, "shimmer", back)).toEqual({ available: false, reason: "rift-consumed" });
    expect(takeExit(graph, back, { edge: "shimmer", visit: back.visit })).toMatchObject({
      ok: false,
      code: "unavailable",
      reason: "rift-consumed",
    });
  });

  it("with uses: n, counts down in the view", () => {
    const graph = graphWith({ uses: 2 });
    const first = roundTrip(graph, atHub(graph));
    expect(journeyView(graph, first).exits[0]?.rift).toEqual({ status: "open", usesLeft: 1 });
    const second = roundTrip(graph, first);
    expect(journeyView(graph, second).exits[0]).toMatchObject({
      available: false,
      reason: "rift-consumed",
      rift: { status: "consumed" },
    });
  });
});

describe("timed", () => {
  it("on the visits clock: open for `count` moves from when it opened, crossable on its last", () => {
    const graph = graphWith({ lasts: { unit: "visits", count: 3 } }, plainTwin);
    const hub = atHub(graph);
    expect(journeyView(graph, hub).exits[0]?.rift?.expiresIn).toEqual({ unit: "visits", count: 3 });
    // Out and back by the plain twin: two moves.
    const twice = go(graph, play(graph, go(graph, hub, "hub-to-far")), "far-to-hub");
    expect(twice.rifts?.shimmer).toEqual({ status: "open", age: 2 });
    expect(journeyView(graph, twice).exits[0]?.rift?.expiresIn).toEqual({ unit: "visits", count: 1 });
    // The third move may be the rift itself; it expires as the party lands.
    const through = go(graph, twice, "shimmer");
    expect(through.rifts?.shimmer).toEqual({ status: "expired", crossings: 1, age: 3 });
  });

  it("expires when its time is up, whichever way the party went", () => {
    const graph = graphWith({ lasts: { unit: "visits", count: 2 } }, plainTwin);
    const twice = go(graph, play(graph, go(graph, atHub(graph), "hub-to-far")), "far-to-hub");
    expect(riftBlock(graph, "shimmer", twice)).toBe("rift-expired");
    expect(twice.rifts?.shimmer).toEqual({ status: "expired", age: 2 });
  });

  it("on the chapters clock: each chapter played while it is open is a tick", () => {
    const graph = graphWith({ lasts: { unit: "chapters", count: 2 } }, plainTwin);
    const hub = atHub(graph); // the hub's chapter: one tick
    expect(hub.rifts?.shimmer).toEqual({ status: "open", age: 1 });
    // A pass-through plays no chapter, so moving alone does not age it…
    const far = go(graph, hub, "hub-to-far");
    expect(far.rifts?.shimmer).toEqual({ status: "open", age: 1 });
    // …but the far place's chapter does.
    expect(play(graph, far).rifts?.shimmer).toEqual({ status: "expired", age: 2 });
  });
});

describe("triggered", () => {
  const graph = graphWith({ opensWhen: { flag: "moon_up" } });

  it("is dormant until its condition holds, then opens", () => {
    const dark = atHub(graph);
    expect(riftState(graph, "shimmer", dark)).toEqual({ status: "dormant" });
    expect(exitAvailability(graph, "shimmer", dark)).toEqual({ available: false, reason: "rift-dormant" });
    expect(dark).not.toHaveProperty("rifts");
    const lit = atHub(graph, { moon_up: true });
    expect(lit.rifts).toEqual({ shimmer: { status: "open" } });
    expect(exitAvailability(graph, "shimmer", lit)).toEqual({ available: true });
  });

  it("unless persistent, can only be crossed while the condition still holds", () => {
    const lit = roundTrip(graph, atHub(graph, { moon_up: true }), { moon_up: false });
    expect(lit.flags?.moon_up).toBeUndefined();
    expect(riftState(graph, "shimmer", lit)?.status).toBe("open");
    expect(exitAvailability(graph, "shimmer", lit)).toEqual({ available: false, reason: "rift-dormant" });
  });

  it("persistent: once open, open for good", () => {
    const steady = graphWith({ opensWhen: { flag: "moon_up" }, persistent: true });
    const lit = roundTrip(steady, atHub(steady, { moon_up: true }), { moon_up: false });
    expect(exitAvailability(steady, "shimmer", lit)).toEqual({ available: true });
    expect(journeyView(steady, lit).exits[0]?.rift).toEqual({ status: "open", persistent: true });
  });

  it("an ordinary guard is reported before any rift reason", () => {
    const guarded = graphWith({ opensWhen: { flag: "moon_up" } }, { shimmer: { when: { flag: "key" } } });
    expect(exitAvailability(guarded, "shimmer", atHub(guarded))).toEqual({ available: false, reason: "guard" });
  });
});

describe("unstable", () => {
  it("flickers by the visit ordinal of its `from` — the same visit always gives the same answer", () => {
    const graph = graphWith({ unstable: { flicker: { open: 1, shut: 1 } } }, plainTwin);
    const visit1 = atHub(graph);
    const loop = (j: JourneyState) => go(graph, play(graph, go(graph, j, "hub-to-far")), "far-to-hub");
    const visit2 = loop(visit1);
    const visit3 = loop(visit2);
    expect([visit1, visit2, visit3].map((j) => [j.visit, riftBlock(graph, "shimmer", j)])).toEqual([
      [1, null],
      [2, "rift-faded"],
      [3, null],
    ]);
    // Resuming visit 2 (a stored copy) still finds it faded.
    expect(riftBlock(graph, "shimmer", JSON.parse(JSON.stringify(visit2)) as JourneyState)).toBe("rift-faded");
    expect(visit2).not.toHaveProperty("rifts");
  });

  it("collapses after its crossings, behind the party", () => {
    const graph = graphWith({ unstable: { collapsesAfter: 2 } });
    const once = roundTrip(graph, atHub(graph));
    expect(journeyView(graph, once).exits[0]?.rift).toEqual({ status: "open", collapsesIn: 1, unstable: true });
    const twice = roundTrip(graph, once);
    expect(twice.rifts?.shimmer).toEqual({ status: "collapsed", crossings: 2 });
    expect(exitAvailability(graph, "shimmer", twice)).toEqual({ available: false, reason: "rift-collapsed" });
  });
});

describe("linked", () => {
  const twoWay = (rift: GraphRift = {}) =>
    graphWith({ ...rift, linkedTo: "far-to-hub" }, { "far-to-hub": { rift: { ...rift, linkedTo: "shimmer" } } });

  it("one state under both mouths: crossing either counts for both", () => {
    const graph = twoWay({ uses: 2 });
    const there = go(graph, atHub(graph), "shimmer");
    expect(there.rifts).toEqual({
      "far-to-hub": { status: "open", crossings: 1 },
      shimmer: { status: "open", crossings: 1 },
    });
    const back = go(graph, play(graph, there), "far-to-hub");
    expect(back.rifts).toEqual({
      "far-to-hub": { status: "consumed", crossings: 2 },
      shimmer: { status: "consumed", crossings: 2 },
    });
    expect(exitAvailability(graph, "shimmer", back)).toEqual({ available: false, reason: "rift-consumed" });
    expect(journeyView(graph, back).exits[0]?.rift).toMatchObject({ status: "consumed", linked: true });
  });

  it("closing one mouth closes the other", () => {
    const graph = twoWay();
    const closed = closeRift(graph, atHub(graph), "far-to-hub");
    expect(closed.ok && closed.journey.rifts).toEqual({
      "far-to-hub": { status: "closed" },
      shimmer: { status: "closed" },
    });
    expect(closed.ok && exitAvailability(graph, "shimmer", closed.journey)).toEqual({
      available: false,
      reason: "rift-closed",
    });
  });

  it("a pair's trigger is judged once, so the two mouths always agree", () => {
    const graph = twoWay({ opensWhen: { outcome: "setback" } });
    // The owner is the smaller id, "far-to-hub": its subject is "far".
    const hubSetback = play(graph, startJourney(graph), {}, "setback");
    expect(riftBlock(graph, "shimmer", hubSetback)).toBe("rift-dormant");
    expect(riftBlock(graph, "far-to-hub", hubSetback)).toBe("rift-dormant");
  });
});

describe("one-way", () => {
  it("is shown to the players, and checked against a rift leading straight back", () => {
    const graph = graphWith({ oneWay: true });
    expect(journeyView(graph, atHub(graph)).exits[0]?.rift).toEqual({ status: "open", oneWay: true });
    const back = graphWith({ oneWay: true }, { "far-to-hub": { rift: {} } });
    expect(lintCampaignGraph(back).findings.map((f) => [f.code, f.path])).toContainEqual([
      "RIFT_ONE_WAY_HAS_WAY_BACK",
      "/graph/edges/shimmer/rift/oneWay",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

describe("hidden destinations", () => {
  it("until crossed: the view sends nothing that names the place", () => {
    const graph = graphWith({ reveal: "when-crossed" });
    const view = journeyView(graph, atHub(graph), () => "Chapter Title");
    const exit = view.exits[0]!;
    expect(exit).toEqual({
      edge: "shimmer",
      to: "",
      kind: "forward",
      label: HIDDEN_RIFT_LABEL,
      available: true,
      arrival: "new",
      rift: { status: "open" },
      hiddenDestination: true,
    });
    expect(JSON.stringify(exit)).not.toMatch(/far|Far Shore/i);
    // Once through, it is known — the next time the party stands here.
    const back = roundTrip(graph, atHub(graph));
    expect(journeyView(graph, back).exits[0]).toMatchObject({ to: "far", label: "The Far Shore", arrival: "replay" });
    expect(journeyView(graph, back).exits[0]).not.toHaveProperty("hiddenDestination");
  });

  it("an authored label is kept: the author's words, which must not name the place", () => {
    const graph = graphWith({ reveal: "when-crossed" }, { shimmer: { label: "Step into the shimmer" } });
    expect(journeyView(graph, atHub(graph)).exits[0]).toMatchObject({ to: "", label: "Step into the shimmer" });
  });

  it("until open: hidden while dormant, known once it opens — and after it is used up", () => {
    const graph = graphWith({ reveal: "when-open", opensWhen: { flag: "moon_up" }, uses: 1 });
    expect(journeyView(graph, atHub(graph)).exits[0]).toMatchObject({ to: "", hiddenDestination: true, reason: "rift-dormant" });
    const lit = atHub(graph, { moon_up: true });
    expect(lit.rifts?.shimmer).toEqual({ status: "open", revealed: true });
    expect(journeyView(graph, lit).exits[0]).toMatchObject({ to: "far" });
    const spent = go(graph, play(graph, go(graph, lit, "shimmer")), "far-to-hub");
    expect(journeyView(graph, spent).exits[0]).toMatchObject({ to: "far", reason: "rift-consumed" });
  });

  it("an action can reveal it (#197's hook)", () => {
    const graph = graphWith({ reveal: "when-crossed" });
    const revealed = revealRift(graph, atHub(graph), "shimmer");
    expect(revealed.ok && journeyView(graph, revealed.journey).exits[0]).toMatchObject({ to: "far" });
  });
});

// ---------------------------------------------------------------------------
// Combinations
// ---------------------------------------------------------------------------

describe("combinations", () => {
  it("single-use + timed: whichever comes first ends it", () => {
    const graph = graphWith({ uses: 1, lasts: { unit: "visits", count: 5 } });
    expect(go(graph, atHub(graph), "shimmer").rifts?.shimmer).toEqual({ status: "consumed", crossings: 1 });
    const short = graphWith({ uses: 1, lasts: { unit: "visits", count: 1 } }, plainTwin);
    const away = go(short, atHub(short), "hub-to-far");
    expect(riftState(short, "shimmer", away)).toEqual({ status: "expired", age: 1 });
  });

  it("triggered + timed: the clock starts when it opens, not when the attempt does", () => {
    const graph = graphWith({ opensWhen: { visited: "far" }, lasts: { unit: "visits", count: 1 } }, plainTwin);
    const far = go(graph, atHub(graph), "hub-to-far");
    // Opened by the arrival that made `visited: far` true: age 0.
    expect(far.rifts?.shimmer).toEqual({ status: "open" });
    const back = go(graph, play(graph, far), "far-to-hub");
    expect(back.rifts?.shimmer).toEqual({ status: "expired", age: 1 });
  });

  it("triggered + one-way + hidden: dormant, then open with nothing on the way back", () => {
    const graph = graphWith({ opensWhen: { flag: "moon_up" }, oneWay: true, reveal: "when-open" });
    expect(journeyView(graph, atHub(graph)).exits[0]).toMatchObject({ reason: "rift-dormant", hiddenDestination: true });
    expect(journeyView(graph, atHub(graph, { moon_up: true })).exits[0]).toMatchObject({
      available: true,
      to: "far",
      rift: { status: "open", oneWay: true },
    });
  });

  it("linked + single-use: one crossing consumes both mouths", () => {
    const graph = graphWith({ uses: 1, linkedTo: "far-to-hub" }, { "far-to-hub": { rift: { uses: 1, linkedTo: "shimmer" } }, "hub-to-end": { from: "hub", to: "end", kind: "forward" } });
    const there = play(graph, go(graph, atHub(graph), "shimmer"));
    expect(exitAvailability(graph, "far-to-hub", there)).toEqual({ available: false, reason: "rift-consumed" });
  });

  it("unstable flicker + collapse: deterministic on any replay of the same choices", () => {
    const graph = graphWith({ unstable: { flicker: { open: 2, shut: 1 }, collapsesAfter: 2 } });
    const walk = () => roundTrip(graph, roundTrip(graph, atHub(graph)));
    expect(walk()).toEqual(walk());
    expect(walk().rifts?.shimmer).toEqual({ status: "collapsed", crossings: 2 });
  });
});

// ---------------------------------------------------------------------------
// Crossing, duplicates and resumption
// ---------------------------------------------------------------------------

describe("crossing as one party-wide move", () => {
  const graph = graphWith({ uses: 1 });

  it("a repeat of the crossing is a duplicate, not a second crossing", () => {
    const hub = atHub(graph);
    const once = go(graph, hub, "shimmer");
    const again = takeExit(graph, once, { edge: "shimmer", visit: hub.visit });
    expect(again).toEqual({ ok: true, duplicate: true, journey: once });
    expect(once.rifts?.shimmer?.crossings).toBe(1);
    // A second phone that read the journey before the crossing landed meets
    // the stored crossing on retry — the same answer.
    const retry = takeExit(graph, once, { edge: "shimmer", visit: 1 });
    expect(retry.ok && retry.duplicate).toBe(true);
  });

  it("a resumed session after the crossing sees the rift consumed", () => {
    const stored = JSON.parse(JSON.stringify(go(graph, atHub(graph), "shimmer"))) as unknown;
    const resumed = resumeJourney(graph, stored);
    expect(resumed.ok && resumed.fresh).toBe(false);
    if (!resumed.ok) throw new Error("resume");
    expect(resumed.journey.rifts?.shimmer).toEqual({ status: "consumed", crossings: 1 });
    const back = go(graph, play(graph, resumed.journey), "far-to-hub");
    expect(journeyView(graph, back).exits[0]).toMatchObject({ available: false, reason: "rift-consumed" });
  });

  it("a journey saved before the party crossed still offers the rift (the crossing never half-happened)", () => {
    const stored = JSON.parse(JSON.stringify(atHub(graph))) as unknown;
    const read = readJourney(graph, stored);
    expect(read.ok && read.journey && exitAvailability(graph, "shimmer", read.journey)).toEqual({ available: true });
  });
});

// ---------------------------------------------------------------------------
// Nothing reopens by accident
// ---------------------------------------------------------------------------

describe("final means final", () => {
  it("an expired rift stays expired when its condition holds again", () => {
    const graph = graphWith({ opensWhen: { flag: "moon_up" }, lasts: { unit: "chapters", count: 1 } });
    const lit = atHub(graph, { moon_up: true });
    // Crossed, and the far place's chapter is its one chapter: expired, with
    // the moon still up — its condition holds, and it stays expired.
    const expired = play(graph, go(graph, lit, "shimmer"), { moon_up: true });
    expect(expired.rifts?.shimmer?.status).toBe("expired");
    expect(settleRifts(graph, expired)).toBe(expired);
  });

  it("stored as final stays final when content changes under the save", () => {
    const before = graphWith({ uses: 1 });
    const consumed = go(before, atHub(before), "shimmer");
    const loosened = graphWith({});
    expect(riftState(loosened, "shimmer", consumed)).toEqual({ status: "consumed", crossings: 1 });
  });

  it("no explicit open brings back a consumed, expired or collapsed rift", () => {
    const graph = graphWith({ uses: 1 });
    const consumed = go(graph, atHub(graph), "shimmer");
    expect(openRift(graph, consumed, "shimmer")).toMatchObject({ ok: false, code: "final" });
    for (const status of ["expired", "collapsed"] as const) {
      expect(openRift(graph, { rifts: { shimmer: { status } } }, "shimmer")).toMatchObject({ ok: false, code: "final" });
    }
    // Closing a final rift changes nothing — it is never overwritten.
    expect(closeRift(graph, consumed, "shimmer")).toEqual({ ok: true, changed: false, journey: consumed });
  });

  it("a corrupted record reads closed: blocked, and only an explicit open reopens it", () => {
    const graph = graphWith({});
    const garbled = { rifts: { shimmer: { status: "wobbly" } } } as never;
    expect(riftBlock(graph, "shimmer", garbled)).toBe("rift-closed");
    const reopened = openRift(graph, garbled, "shimmer");
    expect(reopened.ok && riftBlock(graph, "shimmer", reopened.journey)).toBeNull();
  });
});

describe("explicit changes (#197's hooks)", () => {
  it("open latches a triggered rift: its condition no longer gates it", () => {
    const graph = graphWith({ opensWhen: { flag: "moon_up" } });
    const opened = openRift(graph, atHub(graph), "shimmer");
    expect(opened.ok && opened.journey.rifts).toEqual({ shimmer: { status: "open", latched: true } });
    expect(opened.ok && riftBlock(graph, "shimmer", opened.journey)).toBeNull();
    expect(opened.ok && openRift(graph, opened.journey, "shimmer")).toMatchObject({ ok: true, changed: false });
  });

  it("close stops it; open brings a closed one back, keeping its count and clock", () => {
    const graph = graphWith({ uses: 3, lasts: { unit: "visits", count: 9 } });
    const used = roundTrip(graph, atHub(graph));
    const closed = closeRift(graph, used, "shimmer");
    if (!closed.ok) throw new Error("close");
    expect(closed.journey.rifts?.shimmer).toEqual({ status: "closed", crossings: 1, age: 2 });
    const reopened = openRift(graph, closed.journey, "shimmer");
    expect(reopened.ok && reopened.journey.rifts?.shimmer).toEqual({ status: "open", crossings: 1, age: 2 });
  });

  it("a closed rift's clock stops: only open rifts age", () => {
    const graph = graphWith({ lasts: { unit: "visits", count: 2 } });
    const closed = closeRift(graph, atHub(graph), "shimmer");
    if (!closed.ok) throw new Error("close");
    expect(tickRifts(graph, closed.journey, "visits")).toBe(closed.journey);
  });

  it("a persistent rift, once open, refuses to close", () => {
    const graph = graphWith({ persistent: true });
    expect(closeRift(graph, atHub(graph), "shimmer")).toMatchObject({ ok: false, code: "persistent" });
    const dormant = graphWith({ persistent: true, opensWhen: { flag: "moon_up" } });
    expect(closeRift(dormant, atHub(dormant), "shimmer")).toMatchObject({ ok: true, changed: true });
  });

  it("refuses an edge that is not a rift", () => {
    const graph = graphWith(undefined);
    for (const change of [openRift, closeRift, revealRift]) {
      expect(change(graph, atHub(graph), "shimmer")).toMatchObject({ ok: false, code: "not-a-rift" });
    }
    expect(crossRift(graph, {}, "shimmer")).toEqual({});
    expect(riftView(graph, "shimmer", {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The lint walks rifts as the runtime does
// ---------------------------------------------------------------------------

describe("the lint search", () => {
  const codes = (graph: ParsedCampaignGraph) => lintCampaignGraph(graph).findings.map((f) => [f.code, f.path]);

  it("a single-use rift as the only way on strands a party that comes back without what it needed", () => {
    // The ending is past `far` behind a key `far`'s chapter may or may not find.
    const graph = graphWith({ uses: 1 }, { "far-to-end": { when: { flag: "key" } } });
    const found = lintCampaignGraph(graph).findings.find((f) => f.code === "STRANDED");
    expect(found?.path).toBe("/graph/nodes/hub");
    expect(found?.message).toContain('"shimmer" is a rift already used up (uses)');
  });

  it("…and traps one that still has somewhere to wander", () => {
    const c = campaign({ uses: 1 }, {
      "far-to-end": { when: { flag: "key" } },
      "hub-to-side": { from: "hub", to: "side", kind: "sideways" },
      "side-to-hub": { from: "side", to: "hub", kind: "return" },
    });
    c.chapters.push("c-side");
    c.graph!.nodes.side = { chapter: "c-side" };
    expect(codes(parsed(c))).toContainEqual(["TRAPPED", "/graph/nodes/hub"]);
  });

  it("a timed rift that can run out behind a detour traps the party", () => {
    const c = campaign({ lasts: { unit: "visits", count: 1 } }, {
      "far-to-hub": null,
      "hub-to-side": { from: "hub", to: "side", kind: "sideways" },
      "side-to-hub": { from: "side", to: "hub", kind: "return" },
    });
    c.chapters.push("c-side");
    c.graph!.nodes.side = { chapter: "c-side" };
    const findings = lintCampaignGraph(parsed(c)).findings;
    expect(findings.map((f) => f.code)).toContain("TRAPPED");
    expect(findings.find((f) => f.code === "TRAPPED")?.message).toContain('-[hub-to-side]-> "side"');
  });

  it("a flicker that is the only way out strands the party on its shut visits", () => {
    const graph = graphWith({ unstable: { flicker: { open: 1, shut: 1 } } }, { "far-to-end": { when: { flag: "key" } } });
    const found = lintCampaignGraph(graph).findings.find((f) => f.code === "STRANDED");
    expect(found?.message).toContain("flickered shut");
  });

  it("a collapsing rift is tracked: once collapsed, the same strand as single-use", () => {
    const graph = graphWith({ unstable: { collapsesAfter: 1 } }, { "far-to-end": { when: { flag: "key" } } });
    expect(lintCampaignGraph(graph).findings.find((f) => f.code === "STRANDED")?.message).toContain("collapsed");
  });

  it("a rift that opens later is not a strand when the party can wait for it", () => {
    // Dormant until the far place has been completed — reachable another way.
    const graph = graphWith({ opensWhen: { completed: "far" } }, plainTwin);
    expect(codes(graph)).toEqual([]);
  });

  it("an opensWhen that contradicts itself is a guard contradiction", () => {
    const graph = graphWith({ opensWhen: { flag: "moon_up", notFlag: "moon_up" } }, plainTwin);
    expect(codes(graph)).toContainEqual(["GUARD_CONTRADICTION", "/graph/edges/shimmer/rift/opensWhen"]);
  });

  it("warns on a once that a rift's uses already say, and on a reveal that can never hide anything", () => {
    expect(codes(graphWith({ uses: 1 }, { shimmer: { once: true }, ...plainTwin }))).toContainEqual([
      "RIFT_ONCE_AND_USES",
      "/graph/edges/shimmer/once",
    ]);
    expect(codes(graphWith({ reveal: "when-open" }))).toContainEqual(["RIFT_REVEAL_MOOT", "/graph/edges/shimmer/rift/reveal"]);
  });
});

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

describe("the Rift Lifecycle fixture", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/rift-lifecycle.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
  const graph = parsed(fixture);

  it("parses, and walks clean: every rift can strand nobody", () => {
    const result = lintCampaignGraph(graph);
    expect(result.findings).toEqual([]);
    expect(result.search.complete).toBe(true);
  });

  it("can be played through every kind of rift to the dawn", () => {
    let j = play(graph, startJourney(graph)); // the camp
    expect(journeyView(graph, j).exits.map((e) => [e.edge, e.to, e.available, e.reason ?? null])).toEqual([
      ["camp-to-shore", "shore", true, null],
      ["camp-to-isle", "", true, null], // hidden until crossed
      ["camp-to-ruins", "ruins", false, "rift-dormant"], // the twin gate sleeps
    ]);
    j = play(graph, go(graph, j, "camp-to-shore"), { tide_out: true });
    j = play(graph, go(graph, j, "shore-to-ruins")); // the tide-rift, one way
    j = go(graph, j, "ruins-to-camp"); // the twin gate woke on arrival: one of its two crossings; the camp is passed through
    expect(j.rifts?.["camp-to-ruins"]).toEqual({ status: "open", crossings: 1 });
    // Three moves made; the shimmer has one left.
    expect(journeyView(graph, j).exits.find((e) => e.edge === "camp-to-isle")?.rift?.expiresIn).toEqual({
      unit: "visits",
      count: 1,
    });
    j = play(graph, go(graph, j, "camp-to-isle"));
    expect(j.rifts?.["camp-to-isle"]).toEqual({ status: "consumed", crossings: 1, age: 3, revealed: true });
    j = play(graph, go(graph, j, "isle-to-spire")); // the lantern bridge, lit by the ruins
    j = go(graph, j, "spire-to-dawn");
    expect(play(graph, j).status).toBe("ended");
  });
});
