/**
 * Rift actions (#197): what the story and the party can do to a rift on
 * purpose — discover, open, close, steady, turn — and the traversal
 * guarantees around them: every change commits with the journey that caused
 * it, a repeat is a duplicate and never a second effect, and no crossing can
 * leave a party with nowhere to go.
 *
 * Most cases walk the Ferry Rift fixture (fixtures/rift-actions.campaign.json):
 *
 *   harbor (pass, entry) ── harbor-to-lighthouse ──▶ lighthouse (closed)
 *     │  ▲                                             │ completes: beacon lit;
 *     │  └──────────── lighthouse-to-harbor ◀──────────┘ a setback turns the ferry
 *     ├── ferry-rift (uses 1, wakes when the beacon is lit, redirect → cove) ──▶ isle
 *     ├── harbor-row (fallback) ──▶ isle
 *     │                           isle ── storm-stair (flicker, steady it) ──▶ dawn
 *     │                           isle ── isle-to-harbor ──▶ harbor
 *     └ (only by the turned ferry) cove ── cove-door (hidden, sing it open) ──▶ dawn
 *                                  cove ── cove-to-harbor ──▶ harbor
 *
 * The rift moves themselves on a small map are at the end, beside the lint.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exitAvailability, exitsFrom, parseCampaignGraph, riftDestination, riftState, type ParsedCampaignGraph } from "./campaign-graph.js";
import { lintCampaignGraph } from "./campaign-graph-lint.js";
import { completeVisit, journeyView, startJourney, takeExit, takeRiftAction, type RiftActionReport } from "./journey.js";
import { applyRiftEffect, riftActionsFrom } from "./rift-actions.js";
import { closeRift, discoverRift, openRift, redirectRift, riftView, stabilizeRift } from "./rifts.js";
import type { Campaign, ChapterOutcome } from "./types/chapter.js";
import type { GraphEdge, GraphRift, JourneyState } from "./types/campaign-graph.js";

const fixture = (): Campaign =>
  JSON.parse(readFileSync(new URL("./fixtures/rift-actions.campaign.json", import.meta.url), "utf8")) as Campaign;

function parsed(c: Campaign): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(c);
  expect(problems).toEqual([]);
  return graph!;
}

/** The fixture, bent. */
function bent(mutate: (graph: NonNullable<Campaign["graph"]>) => void): Campaign {
  const c = fixture();
  mutate(c.graph!);
  return c;
}

function play(
  graph: ParsedCampaignGraph,
  journey: JourneyState,
  outcome: ChapterOutcome = "success",
  flags: Record<string, boolean> = {},
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

function act(graph: ParsedCampaignGraph, journey: JourneyState, report: Omit<RiftActionReport, "visit">): JourneyState {
  const result = takeRiftAction(graph, journey, { ...report, visit: journey.visit });
  if (!result.ok || result.duplicate) throw new Error(`action ${report.action}: ${JSON.stringify(result)}`);
  return result.journey;
}

const TITLES: Record<string, string> = {
  "actions-dawn": "The Dragon at Dawn",
  "actions-cove": "The Song in the Rock",
};
const titleOf = (chapter: string) => TITLES[chapter];

/** Harbor played (the chart read or not), lighthouse played, and back at the harbor's choice. */
function backFromLighthouse(graph: ParsedCampaignGraph, outcome: ChapterOutcome = "success", chart = true): JourneyState {
  const harbor = play(graph, startJourney(graph), "success", chart ? { read_the_chart: true } : {});
  return go(graph, play(graph, go(graph, harbor, "harbor-to-lighthouse"), outcome), "lighthouse-to-harbor");
}

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

describe("declaring rift actions", () => {
  const problems = (c: Campaign) => parseCampaignGraph(c).problems.map((p) => `${p.path}: ${p.problem}`);

  it("reads the fixture: one-use, triggered, redirectable, steadied, discovered, and a fallback", () => {
    const graph = parsed(fixture());
    expect(graph.edges["ferry-rift"]!.rift).toMatchObject({ uses: 1, redirects: ["cove"] });
    expect(graph.edges["harbor-row"]!.fallback).toBe(true);
    // The cove has no edge into it at all: only the turned ferry leads there.
    expect(graph.entrances.cove).toEqual([]);
  });

  it("refuses a redirect to somewhere the rift does not declare — the invalid destination, at load", () => {
    const c = bent((g) => {
      g.nodes.lighthouse!.onComplete![1]!.effects = [{ type: "redirectRift", edge: "ferry-rift", to: "dawn" }];
    });
    expect(problems(c)).toEqual([
      '/graph/nodes/lighthouse/onComplete/1/effects/0/to: "dawn" is not a destination the rift "ferry-rift" declares (its "to" or one of its "redirects")',
    ]);
    const nowhere = bent((g) => {
      g.edges["isle-to-harbor"]!.effects = [{ type: "redirectRift", edge: "ferry-rift", to: "atlantis" }];
    });
    expect(problems(nowhere)).toEqual(['/graph/edges/isle-to-harbor/effects/0/to: no node "atlantis"']);
  });

  it("refuses a rift effect on something that is not a rift", () => {
    const c = bent((g) => {
      g.edges["isle-to-harbor"]!.effects = [
        { type: "openRift", edge: "harbor-row" },
        { type: "closeRift", edge: "no-such-edge" },
      ];
    });
    expect(problems(c)).toEqual([
      '/graph/edges/isle-to-harbor/effects/0/edge: "harbor-row" is not a rift, so openRift has nothing to act on',
      '/graph/edges/isle-to-harbor/effects/1/edge: no edge "no-such-edge"',
    ]);
  });

  it("holds redirects to real, new places, and never on a linked rift", () => {
    const redirect = (redirects: string[], extra: Partial<GraphRift> = {}) =>
      problems(
        bent((g) => {
          g.edges["ferry-rift"]!.rift = { ...g.edges["ferry-rift"]!.rift!, redirects, ...extra };
        }),
      );
    expect(redirect(["cove", "isle"])).toEqual(['/graph/edges/ferry-rift/rift/redirects/1: "isle" is already where the rift leads']);
    expect(redirect(["cove", "harbor"])).toEqual([
      '/graph/edges/ferry-rift/rift/redirects/1: a rift cannot be turned to lead back to where it starts ("harbor")',
    ]);
    expect(redirect(["cove", "cove"])).toEqual(['/graph/edges/ferry-rift/rift/redirects/1: "cove" is listed twice']);
    expect(redirect(["cove", "atlantis"])).toEqual(['/graph/edges/ferry-rift/rift/redirects/1: no node "atlantis"']);
    expect(redirect(["cove"], { linkedTo: "isle-to-harbor" })).toContain(
      "/graph/edges/ferry-rift/rift/redirects: a linked rift cannot be redirected: its two mouths share one state, and a destination is one mouth's",
    );
  });

  it("checks action rules like guards and effects, and knows its five actions", () => {
    const c = bent((g) => {
      g.edges["storm-stair"]!.rift!.actions = {
        stabilize: { when: { flag: "nope" }, effects: [{ type: "unlock", edge: "nowhere" }] },
        redirect: {},
        ...({ teleport: {} } as object),
      };
    });
    expect(problems(c)).toEqual([
      '/graph/edges/storm-stair/rift/actions/stabilize/when/flag: "nope" is not a journey flag (declare it in graph.flags or a routeSets entry)',
      '/graph/edges/storm-stair/rift/actions/stabilize/effects/0/edge: no edge "nowhere"',
      '/graph/edges/storm-stair/rift/actions/redirect: "storm-stair" declares no redirects, so there is nowhere to turn it',
      '/graph/edges/storm-stair/rift/actions/teleport: unknown rift action "teleport" (one of discover, open, stabilize, redirect, close)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Authored effects — the story acting on a rift
// ---------------------------------------------------------------------------

describe("the story acts on a rift", () => {
  it("a chapter's completion rule wakes the ferry: triggered by a world fact the encounter set", () => {
    const graph = parsed(fixture());
    const harbor = play(graph, startJourney(graph));
    expect(exitAvailability(graph, "ferry-rift", harbor)).toEqual({ available: false, reason: "rift-dormant" });
    const lit = play(graph, go(graph, harbor, "harbor-to-lighthouse"));
    expect(lit.facts).toEqual({ beacon: "lit" });
    expect(riftState(graph, "ferry-rift", lit)).toMatchObject({ status: "open" });
    expect(riftDestination(graph, "ferry-rift", lit)).toBe("isle");
  });

  it("a setback there turns the ferry toward the cove, and the crossing goes where it now leads", () => {
    const graph = parsed(fixture());
    const back = backFromLighthouse(graph, "setback");
    expect(back.rifts?.["ferry-rift"]).toEqual({ status: "open", to: "cove" });
    expect(exitsFrom(graph, "harbor", back).find((exit) => exit.edge === "ferry-rift")).toMatchObject({ to: "cove" });
    const crossed = go(graph, back, "ferry-rift");
    expect(crossed).toMatchObject({ node: "cove", chapter: "actions-cove", visit: 1 });
    expect(crossed.rifts?.["ferry-rift"]).toEqual({ status: "consumed", crossings: 1, to: "cove" });
  });

  it("an effect never refuses: on a final rift it does nothing, and closing an open persistent rift does nothing", () => {
    const graph = parsed(fixture());
    const crossed = go(graph, backFromLighthouse(graph), "ferry-rift");
    for (const type of ["openRift", "closeRift", "stabilizeRift"] as const) {
      expect(applyRiftEffect(graph, crossed, { type, edge: "ferry-rift" })).toBe(crossed);
    }
    expect(applyRiftEffect(graph, crossed, { type: "redirectRift", edge: "ferry-rift", to: "cove" })).toBe(crossed);
    // Finding a used-up rift is still finding it.
    expect(applyRiftEffect(graph, crossed, { type: "discoverRift", edge: "ferry-rift" }).rifts?.["ferry-rift"]).toMatchObject({
      status: "consumed",
      discovered: true,
    });

    const lantern = parsed(
      bent((g) => {
        g.edges["harbor-to-lighthouse"]!.rift = { persistent: true };
      }),
    );
    const open = play(lantern, startJourney(lantern));
    expect(applyRiftEffect(lantern, open, { type: "closeRift", edge: "harbor-to-lighthouse" })).toBe(open);
  });

  it("applies in order with the effects around it: a flag set first can wake the rift the next effect steadies", () => {
    const graph = parsed(
      bent((g) => {
        g.edges["storm-stair"]!.rift = { opensWhen: { flag: "tide_song" }, lasts: { unit: "visits", count: 1 } };
        g.edges["harbor-row"]!.effects = [
          { type: "setFlag", flag: "tide_song" },
          { type: "stabilizeRift", edge: "storm-stair" },
        ];
      }),
    );
    const back = go(graph, play(graph, go(graph, backFromLighthouse(graph), "ferry-rift")), "isle-to-harbor");
    // Back at the harbor with the ferry used up: rowing is the fallback.
    const isle = go(graph, back, "harbor-row");
    expect(isle.rifts?.["storm-stair"]).toMatchObject({ status: "open", stable: true });
  });
});

// ---------------------------------------------------------------------------
// One-use crossings, consumed exits and the fallback
// ---------------------------------------------------------------------------

describe("a one-use crossing", () => {
  it("is used up by the crossing, and drawn afterwards as a consumed exit", () => {
    const graph = parsed(fixture());
    const isle = go(graph, backFromLighthouse(graph), "ferry-rift");
    expect(isle.rifts?.["ferry-rift"]).toEqual({ status: "consumed", crossings: 1 });
    const back = go(graph, play(graph, isle), "isle-to-harbor");
    const view = journeyView(graph, back, titleOf);
    expect(view.exits.find((exit) => exit.edge === "ferry-rift")).toMatchObject({
      available: false,
      reason: "rift-consumed",
      rift: { status: "consumed" },
    });
  });

  it("a double tap is the same crossing: answered as done, never refused as used up, never crossed twice", () => {
    const graph = parsed(fixture());
    const before = backFromLighthouse(graph);
    const crossed = go(graph, before, "ferry-rift");
    const again = takeExit(graph, crossed, { edge: "ferry-rift", visit: before.visit });
    expect(again).toEqual({ ok: true, duplicate: true, journey: crossed });
    // A retry of the stale screen after the party has moved on is still the duplicate.
    const later = play(graph, crossed);
    expect(takeExit(graph, later, { edge: "ferry-rift", visit: before.visit })).toMatchObject({ ok: true, duplicate: true });
  });

  it("is never a softlock: once the ferry is gone and the lighthouse is done, the harbor offers the long way round", () => {
    const graph = parsed(fixture());
    const before = backFromLighthouse(graph);
    // While the ferry is there, rowing is not offered.
    expect(exitAvailability(graph, "harbor-row", before)).toEqual({ available: false, reason: "fallback" });
    expect(journeyView(graph, before).exits.map((exit) => exit.edge)).toEqual(["ferry-rift"]);

    const back = go(graph, play(graph, go(graph, before, "ferry-rift")), "isle-to-harbor");
    expect(exitAvailability(graph, "harbor-row", back)).toEqual({ available: true });
    const view = journeyView(graph, back);
    expect(view.exits.filter((exit) => exit.available).map((exit) => exit.edge)).toEqual(["harbor-row"]);
    expect(view).not.toHaveProperty("stuck");
    expect(go(graph, back, "harbor-row")).toMatchObject({ node: "isle", visit: 2 });
  });

  it("without the fallback, the view says plainly the party is stuck — and the lint refuses the map", () => {
    const c = bent((g) => {
      delete g.edges["harbor-row"];
    });
    const graph = parsed(c);
    const back = go(graph, play(graph, go(graph, backFromLighthouse(graph), "ferry-rift")), "isle-to-harbor");
    expect(journeyView(graph, back).stuck).toBe(true);

    const { findings } = lintCampaignGraph(graph);
    const stranded = findings.find((f) => f.code === "STRANDED");
    expect(stranded).toMatchObject({ severity: "error", path: "/graph/nodes/harbor" });
    expect(stranded?.message).toContain('"ferry-rift" is a rift already used up (uses)');
    expect(stranded?.message).toContain("no rift action is offered");
  });
});

// ---------------------------------------------------------------------------
// Party actions
// ---------------------------------------------------------------------------

describe("the party acts on a rift", () => {
  it("is offered only what its rules allow and what would change something", () => {
    const graph = parsed(fixture());
    // No chart read: no redirect.
    expect(riftActionsFrom(graph, "harbor", backFromLighthouse(graph, "success", false))).toEqual([]);
    const chart = backFromLighthouse(graph);
    expect(riftActionsFrom(graph, "harbor", chart).map(({ action, edge, to }) => ({ action, edge, to }))).toEqual([
      { action: "redirect", edge: "ferry-rift", to: "cove" },
    ]);
    expect(journeyView(graph, chart).riftActions).toEqual([
      { action: "redirect", edge: "ferry-rift", label: "Turn the rift toward The Hidden Cove", to: "cove" },
    ]);
    // Turned, it offers the way back — and nothing on a used-up rift.
    const turned = act(graph, chart, { action: "redirect", edge: "ferry-rift", to: "cove" });
    expect(journeyView(graph, turned).riftActions?.map((a) => a.to)).toEqual(["isle"]);
    const gone = go(graph, play(graph, go(graph, turned, "ferry-rift")), "cove-to-harbor");
    expect(journeyView(graph, gone)).not.toHaveProperty("riftActions");
  });

  it("a redirect commits with the journey and the next crossing follows it", () => {
    const graph = parsed(fixture());
    const turned = act(graph, backFromLighthouse(graph), { action: "redirect", edge: "ferry-rift", to: "cove" });
    expect(turned).toMatchObject({
      node: "harbor",
      status: "choosing",
      rifts: { "ferry-rift": { status: "open", to: "cove" } },
      lastAction: { node: "harbor", action: "redirect", edge: "ferry-rift", to: "cove" },
    });
    expect(go(graph, turned, "ferry-rift").node).toBe("cove");
  });

  it("a double tap, or a retry after a lost response, is a duplicate — never a second effect", () => {
    const graph = parsed(fixture());
    const before = backFromLighthouse(graph);
    const report = { action: "redirect" as const, edge: "ferry-rift", to: "cove", visit: before.visit };
    const first = takeRiftAction(graph, before, report);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    const turned = (first as { journey: JourneyState }).journey;
    expect(takeRiftAction(graph, turned, report)).toEqual({ ok: true, duplicate: true, journey: turned });
    // Even after the party has crossed: the report is the same action, not a new one.
    const crossed = go(graph, turned, "ferry-rift");
    expect(takeRiftAction(graph, crossed, report)).toEqual({ ok: true, duplicate: true, journey: crossed });
  });

  it("refuses what a stale or wrong screen asks for, and moves nothing", () => {
    const graph = parsed(fixture());
    const at = backFromLighthouse(graph);
    const refuse = (report: Partial<RiftActionReport>, journey = at) =>
      takeRiftAction(graph, journey, { action: "redirect", edge: "ferry-rift", to: "cove", visit: journey.visit, ...report });
    expect(refuse({ edge: "to-the-moon" })).toMatchObject({ ok: false, code: "unknown-edge" });
    expect(refuse({ edge: "harbor-row" })).toMatchObject({ ok: false, code: "not-a-rift" });
    expect(refuse({ to: "dawn" })).toMatchObject({ ok: false, code: "bad-destination" });
    expect(refuse({ to: undefined })).toMatchObject({ ok: false, code: "bad-destination" });
    expect(refuse({ to: "isle" })).toMatchObject({ ok: false, code: "no-change" });
    expect(refuse({ action: "close" })).toMatchObject({ ok: false, code: "not-offered" });
    expect(refuse({ action: "teleport" as never })).toMatchObject({ ok: false, code: "not-offered" });
    expect(refuse({ visit: at.visit - 1 })).toMatchObject({ ok: false, code: "stale-visit" });
    expect(refuse({ edge: "storm-stair", action: "stabilize" })).toMatchObject({ ok: false, code: "not-here" });
    const playing = go(graph, at, "ferry-rift");
    expect(refuse({ edge: "storm-stair", action: "stabilize" }, playing)).toMatchObject({ ok: false, code: "still-playing" });
    // No chart: the rule's guard does not hold.
    expect(refuse({}, backFromLighthouse(graph, "success", false))).toMatchObject({ ok: false, code: "not-offered" });
  });

  it("steadies the flickering stair: there on every visit afterwards", () => {
    const graph = parsed(fixture());
    const back = go(graph, play(graph, go(graph, backFromLighthouse(graph), "ferry-rift")), "isle-to-harbor");
    const second = play(graph, go(graph, back, "harbor-row"));
    expect(second.visit).toBe(2);
    expect(exitAvailability(graph, "storm-stair", second)).toEqual({ available: false, reason: "rift-faded" });
    expect(journeyView(graph, second).riftActions).toEqual([
      { action: "stabilize", edge: "storm-stair", label: "Steady the flickering stair" },
    ]);
    const steady = act(graph, second, { action: "stabilize", edge: "storm-stair" });
    expect(exitAvailability(graph, "storm-stair", steady)).toEqual({ available: true });
    expect(journeyView(graph, steady).exits.find((e) => e.edge === "storm-stair")?.rift).toEqual({
      status: "open",
      stable: true,
    });
    const ended = play(graph, go(graph, steady, "storm-stair"));
    expect(ended).toMatchObject({ status: "ended", ending: "dawn" });
  });

  it("finds the hidden door and sings it open — without the view ever naming where it goes first", () => {
    const graph = parsed(fixture());
    const cove = play(graph, go(graph, backFromLighthouse(graph, "setback"), "ferry-rift"));
    const view = journeyView(graph, cove, titleOf);
    expect(view.exits.map((exit) => exit.edge)).toEqual(["cove-to-harbor"]);
    expect(view.riftActions).toEqual([
      { action: "discover", edge: "cove-door", label: "Search the cove walls" },
      { action: "open", edge: "cove-door", label: "Sing the tide song" },
    ]);
    expect(JSON.stringify(view)).not.toMatch(/dawn|Dragon/i);

    const found = act(graph, cove, { action: "discover", edge: "cove-door" });
    expect(journeyView(graph, found, titleOf).exits.find((exit) => exit.edge === "cove-door")).toMatchObject({
      to: "dawn",
      available: false,
      reason: "rift-dormant",
    });
    const opened = act(graph, found, { action: "open", edge: "cove-door" });
    expect(opened.rifts?.["cove-door"]).toMatchObject({ status: "open", latched: true, discovered: true });
    expect(exitAvailability(graph, "cove-door", opened)).toEqual({ available: true });
    expect(play(graph, go(graph, opened, "cove-door"))).toMatchObject({ status: "ended", ending: "dawn" });
  });

  it("runs the rule's effects with the action, and asks first before a close nothing can undo", () => {
    const graph = parsed(
      bent((g) => {
        g.edges["ferry-rift"]!.rift!.actions = {
          close: { label: "Seal the ferry", effects: [{ type: "setFlag", flag: "tide_song" }] },
        };
      }),
    );
    const at = backFromLighthouse(graph);
    expect(journeyView(graph, at).riftActions).toEqual([
      { action: "close", edge: "ferry-rift", label: "Seal the ferry", irreversible: true },
    ]);
    const sealed = act(graph, at, { action: "close", edge: "ferry-rift" });
    expect(sealed.flags).toMatchObject({ tide_song: true });
    expect(sealed.rifts?.["ferry-rift"]).toMatchObject({ status: "closed" });
    // Closed, the fallback is the way on.
    expect(journeyView(graph, sealed).exits.filter((e) => e.available).map((e) => e.edge)).toEqual(["harbor-row"]);
  });
});

// ---------------------------------------------------------------------------
// The rift moves, on their own
// ---------------------------------------------------------------------------

/** hub (pass) ──gate──▶ far ──▶ end, with `far-to-hub` back; `gate` is the rift under test. */
function small(rift: GraphRift, edges: Record<string, Partial<GraphEdge>> = {}): ParsedCampaignGraph {
  return parsed({
    id: "small",
    title: "Small",
    blurb: "",
    chapters: ["c-hub", "c-far", "c-end", "c-side"],
    graph: {
      version: 1,
      entry: "hub",
      flags: ["moon_up"],
      nodes: {
        hub: { chapter: "c-hub", revisit: "pass" },
        far: { chapter: "c-far" },
        side: { chapter: "c-side" },
        end: { chapter: "c-end", ending: { title: "The End" } },
      },
      edges: {
        gate: { from: "hub", to: "far", kind: "forward", blocked: "shown", rift },
        "hub-to-side": { from: "hub", to: "side", kind: "forward" },
        "side-to-hub": { from: "side", to: "hub", kind: "return" },
        "far-to-hub": { from: "far", to: "hub", kind: "return" },
        "far-to-end": { from: "far", to: "end", kind: "forward" },
        ...edges,
      } as Record<string, GraphEdge>,
    },
  } as Campaign);
}

describe("the rift moves", () => {
  it("stabilize stops the flicker, the collapse and the clock — but not the uses", () => {
    const graph = small({ unstable: { flicker: { open: 1, shut: 1 }, collapsesAfter: 1 }, lasts: { unit: "visits", count: 1 }, uses: 2 });
    const start = completeOk(graph);
    const steady = ok(stabilizeRift(graph, start, "gate"));
    expect(steady.rifts?.gate).toEqual({ status: "open", stable: true });
    // Two visits on, the flicker would be shut and the clock run out.
    const later = { ...steady, visits: { ...steady.visits, hub: 2 }, rifts: { gate: { status: "open" as const, age: 5, stable: true as const } } };
    expect(exitAvailability(graph, "gate", later)).toEqual({ available: true });
    const once = go(graph, steady, "gate");
    expect(once.rifts?.gate).toMatchObject({ status: "open", crossings: 1, stable: true });
    expect(riftView(graph, "gate", once)).toEqual({ status: "open", usesLeft: 1, stable: true });
    const back = go(graph, play(graph, once), "far-to-hub");
    expect(go(graph, back, "gate").rifts?.gate).toMatchObject({ status: "consumed", crossings: 2 });
    // Steady twice is no change; steadying a used-up rift is refused.
    expect(stabilizeRift(graph, steady, "gate")).toMatchObject({ ok: true, changed: false });
    expect(stabilizeRift(graph, go(graph, back, "gate"), "gate")).toMatchObject({ ok: false, code: "final" });
  });

  it("stabilize lets a triggered rift outlast its trigger once open", () => {
    const graph = small({ opensWhen: { flag: "moon_up" } });
    const up = completeOk(graph, { moon_up: true });
    const steady = ok(stabilizeRift(graph, up, "gate"));
    const down = { ...steady, flags: {} };
    expect(exitAvailability(graph, "gate", { ...up, flags: {} })).toEqual({ available: false, reason: "rift-dormant" });
    expect(exitAvailability(graph, "gate", down)).toEqual({ available: true });
  });

  it("redirect is bounded to the declared destinations, and does not reveal a hidden one", () => {
    const graph = small({ redirects: ["side"], reveal: "when-crossed" }, { "hub-to-side": { from: "hub", to: "side", kind: "forward" } });
    const at = completeOk(graph);
    expect(redirectRift(graph, at, "gate", "end")).toMatchObject({ ok: false, code: "bad-destination" });
    const turned = ok(redirectRift(graph, at, "gate", "side"));
    expect(riftDestination(graph, "gate", turned)).toBe("side");
    expect(journeyView(graph, turned).exits.find((e) => e.edge === "gate")).toMatchObject({ to: "", hiddenDestination: true });
    // Hidden destination: the party cannot steer what it cannot see.
    expect(riftActionsFrom(graph, "hub", turned)).toEqual([]);
    // Turning it back home stores nothing.
    expect(ok(redirectRift(graph, turned, "gate", "far")).rifts?.gate).toEqual({ status: "open" });
  });

  it("open, close and discover keep each other's marks", () => {
    const graph = small({ opensWhen: { flag: "moon_up" } });
    const at = completeOk(graph);
    const found = ok(discoverRift(graph, at, "gate"));
    const opened = ok(openRift(graph, found, "gate"));
    const shut = ok(closeRift(graph, opened, "gate"));
    expect(shut.rifts?.gate).toEqual({ status: "closed", revealed: true, discovered: true });
    expect(exitsFrom(graph, "hub", shut).find((e) => e.edge === "gate")?.visible).toBe(true);
  });
});

function ok(change: ReturnType<typeof openRift<JourneyState>>): JourneyState {
  if (!change.ok) throw new Error(change.message);
  return change.journey;
}

/** Start the small map and finish the hub's chapter. */
function completeOk(graph: ParsedCampaignGraph, flags: Record<string, boolean> = {}): JourneyState {
  return play(graph, startJourney(graph), "success", flags);
}

// ---------------------------------------------------------------------------
// The lint
// ---------------------------------------------------------------------------

describe("the lint walks rift actions", () => {
  it("passes the fixture clean, every action offered somewhere and every effect doing something", () => {
    const { findings, search } = lintCampaignGraph(parsed(fixture()));
    expect(findings).toEqual([]);
    expect(search.complete).toBe(true);
  });

  it("counts a party action as a way on: an action that opens the only door is not a strand", () => {
    const nothing = () => ({ setsTrue: [], setsFalse: [] });
    const shut = small({ opensWhen: { flag: "moon_up" } }, { "hub-to-side": { from: "hub", to: "side", kind: "forward", once: true } });
    // The hub's chapter never raises the moon, so after the side trip the gate is the only way and it never opens.
    expect(lintCampaignGraph(shut, { chapterFlags: nothing }).findings.map((f) => f.code)).toContain("STRANDED");
    const sung = small(
      { opensWhen: { flag: "moon_up" }, actions: { open: {} } },
      { "hub-to-side": { from: "hub", to: "side", kind: "forward", once: true } },
    );
    expect(lintCampaignGraph(sung, { chapterFlags: nothing }).findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("warns about an action never offered, and an effect that only ever meets a used-up rift", () => {
    const graph = parsed(
      bent((g) => {
        g.edges["ferry-rift"]!.rift!.actions!.close = { when: { visited: "dawn" } };
        g.edges["isle-to-harbor"]!.effects = [{ type: "openRift", edge: "ferry-rift" }];
      }),
    );
    const findings = lintCampaignGraph(graph).findings.map(({ code, severity, path }) => ({ code, severity, path }));
    expect(findings).toEqual([
      { code: "RIFT_ACTION_NEVER_OFFERED", severity: "warning", path: "/graph/edges/ferry-rift/rift/actions/close" },
      { code: "RIFT_EFFECT_ON_FINAL", severity: "warning", path: "/graph/edges/isle-to-harbor/effects/0" },
    ]);
  });

  it("reads a redirect as a way to its destination: reachability and cycles both see it", () => {
    // The cove is reached only by the turned ferry; take the turn away and it is unreachable.
    const unturned = parsed(
      bent((g) => {
        delete g.edges["ferry-rift"]!.rift!.redirects;
        delete g.edges["ferry-rift"]!.rift!.actions;
        g.nodes.lighthouse!.onComplete = [g.nodes.lighthouse!.onComplete![0]!];
      }),
    );
    expect(lintCampaignGraph(unturned).findings.map((f) => `${f.code} ${f.path}`)).toContain("UNREACHABLE_NODE /graph/nodes/cove");

    const loop = small({ redirects: ["side"] }, { "side-to-hub": { from: "side", to: "hub", kind: "forward" } });
    expect(lintCampaignGraph(loop).findings.map((f) => f.code)).toContain("UNINTENTIONAL_CYCLE");
  });
});
