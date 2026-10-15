/**
 * The journey runtime (#194): enter, complete, take an exit — and nothing
 * else — over the Rift Sampler (fixtures/rift-sampler.campaign.json), the
 * graph docs/campaigns/graph-campaigns.md walks through.
 *
 * Every case is a walk a real table can take: the orchard–mill loop and back,
 * the hub that is passed through, the quarry road that washes out, the exits
 * a chapter's own choices open, both endings, the double tap, the retry after
 * a lost response, the screen that is out of date, and Thursday's session
 * resuming Monday's.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exitsFrom, parseCampaignGraph, type ParsedCampaignGraph } from "./campaign-graph.js";
import {
  completeVisit,
  currentPlayable,
  JOURNEY_VERSION,
  journeyView,
  readJourney,
  resumeJourney,
  startJourney,
  takeExit,
  type ExitCrossing,
  type JourneyRefusal,
  type VisitCompletion,
} from "./journey.js";
import type { Campaign, ChapterOutcome } from "./types/chapter.js";
import type { JourneyState } from "./types/campaign-graph.js";

function sampler(): Campaign {
  return JSON.parse(
    readFileSync(new URL("./fixtures/rift-sampler.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
}

function parsed(campaign: Campaign = sampler()): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(campaign);
  expect(problems).toEqual([]);
  return graph!;
}

const GRAPH = parsed();

function completed(result: VisitCompletion | JourneyRefusal): JourneyState {
  if (!result.ok) throw new Error(`refused: ${result.code} ${result.message}`);
  expect(result.duplicate).toBe(false);
  return result.journey;
}

function crossed(result: ExitCrossing | JourneyRefusal): JourneyState {
  if (!result.ok) throw new Error(`refused: ${result.code} ${result.message}`);
  expect(result.duplicate).toBe(false);
  return result.journey;
}

/** Plays the current visit to its end, as a settled chapter run would report it. */
function play(
  journey: JourneyState,
  outcome: ChapterOutcome = "success",
  flags: Record<string, boolean> = {},
  graph: ParsedCampaignGraph = GRAPH,
): JourneyState {
  return completed(
    completeVisit(graph, journey, {
      node: journey.node,
      visit: journey.visit,
      chapterId: journey.chapter,
      outcome,
      // A run is seeded with the journey's flags (§5), so it hands them back
      // unless the chapter changed them.
      flags: { ...(journey.flags ?? {}), ...flags },
    }),
  );
}

function go(journey: JourneyState, edge: string, graph: ParsedCampaignGraph = GRAPH): JourneyState {
  return crossed(takeExit(graph, journey, { edge, visit: journey.visit }));
}

describe("starting", () => {
  it("begins the first visit at the entry, playing its chapter", () => {
    const journey = startJourney(GRAPH);
    expect(journey).toEqual({
      version: JOURNEY_VERSION,
      node: "waystone",
      visit: 1,
      visits: { waystone: 1 },
      status: "playing",
      chapter: "sampler-waystone",
    });
    expect(currentPlayable(GRAPH, journey)).toEqual({
      kind: "play",
      node: "waystone",
      visit: 1,
      chapter: "sampler-waystone",
    });
  });

  it("is deterministic: every reader of an unwritten journey sees the same one", () => {
    expect(startJourney(GRAPH)).toEqual(startJourney(parsed()));
  });

  it("resolves a variant at the entry too — a place can change before anyone gets there", () => {
    const campaign = sampler();
    campaign.graph!.nodes.waystone!.variants = [{ chapter: "sampler-tower", when: { notVisited: "tower" } }];
    expect(startJourney(parsed(campaign)).chapter).toBe("sampler-tower");
  });
});

describe("completing a visit", () => {
  it("counts the completion, records the outcome, and turns to the exit choice", () => {
    const done = play(startJourney(GRAPH));
    expect(done).toMatchObject({
      node: "waystone",
      visit: 1,
      status: "choosing",
      completions: { waystone: 1 },
      outcomes: { waystone: "success" },
      chaptersCompleted: ["sampler-waystone"],
    });
    const next = currentPlayable(GRAPH, done);
    expect(next.kind).toBe("choose");
    expect(next.kind === "choose" ? next.exits.map((e) => e.edge) : []).toEqual(["to-orchard", "to-quarry"]);
  });

  it("reads declared journey flags back from the run, and drops everything else", () => {
    const journey = go(play(startJourney(GRAPH)), "to-quarry");
    const done = play(journey, "success", { found_the_lens: true, opened_the_crate: true });
    expect(done.flags).toEqual({ found_the_lens: true });
  });

  it("a flag the chapter cleared comes back cleared", () => {
    const journey = go(play(startJourney(GRAPH)), "to-quarry");
    const withLens = { ...journey, flags: { found_the_lens: true } };
    const done = play(withLens, "success", { found_the_lens: false });
    expect(done.flags).toEqual({});
  });

  it("keeps the fork rule for route set members: the newly taken road wins", () => {
    const campaign = sampler();
    campaign.routeSets = { weather: ["sunny", "stormy"] };
    const graph = parsed(campaign);
    const routes = { routeSets: campaign.routeSets };
    const start = { ...startJourney(graph), flags: { sunny: true } };
    const result = completeVisit(
      graph,
      start,
      { node: "waystone", visit: 1, chapterId: "sampler-waystone", outcome: "success", flags: { sunny: true, stormy: true } },
      routes,
    );
    expect(completed(result).flags).toEqual({ stormy: true });
  });

  it("refuses a completion for a chapter the visit does not play", () => {
    const result = completeVisit(GRAPH, startJourney(GRAPH), {
      node: "waystone",
      visit: 1,
      chapterId: "sampler-orchard",
      outcome: "success",
      flags: {},
    });
    expect(result).toMatchObject({ ok: false, code: "wrong-chapter" });
  });
});

describe("loops: the orchard, the mill, and back", () => {
  const toMill = () => go(play(go(play(startJourney(GRAPH)), "to-orchard")), "orchard-to-mill");

  it("goes sideways and returns through a changed place, as a new visit", () => {
    const mill = play(toMill());
    const back = go(mill, "mill-to-orchard");
    // The return edge's effects landed before arrival, so the orchard the
    // party walks back into is the flooded one.
    expect(back).toMatchObject({
      node: "orchard",
      visit: 2,
      status: "playing",
      chapter: "sampler-orchard-flooded",
      visits: { waystone: 1, orchard: 2, mill: 1 },
      traversed: { "to-orchard": 1, "orchard-to-mill": 1, "mill-to-orchard": 1 },
      flags: { mill_wheel_turning: true },
      edges: { "orchard-to-tower": "open" },
    });
  });

  it("closes the mill behind them and opens the tower door", () => {
    const orchard = play(go(play(toMill()), "mill-to-orchard"));
    const exits = Object.fromEntries(exitsFrom(GRAPH, "orchard", orchard).map((e) => [e.edge, e.availability]));
    expect(exits["orchard-to-mill"]).toEqual({ available: false, reason: "closed" });
    expect(exits["orchard-to-tower"]).toEqual({ available: true });
    expect(takeExit(GRAPH, orchard, { edge: "orchard-to-mill", visit: orchard.visit })).toMatchObject({
      ok: false,
      code: "unavailable",
      reason: "closed",
    });
  });

  it("pays a changed place once more, and a replay of the same chapter not at all", () => {
    const flooded = play(go(play(toMill()), "mill-to-orchard"));
    expect(flooded.chaptersCompleted).toEqual([
      "sampler-waystone",
      "sampler-orchard",
      "sampler-mill",
      "sampler-orchard-flooded",
    ]);
    // Out to the hub and back down: the flooded orchard again.
    const again = go(go(flooded, "orchard-to-waystone"), "to-orchard");
    expect(again).toMatchObject({ node: "orchard", visit: 3, chapter: "sampler-orchard-flooded" });
    const result = completeVisit(GRAPH, again, {
      node: "orchard",
      visit: 3,
      chapterId: "sampler-orchard-flooded",
      outcome: "success",
      flags: again.flags ?? {},
    });
    expect(result).toMatchObject({ ok: true, duplicate: false, firstCompletion: false });
    expect(completed(result).completions).toMatchObject({ orchard: 3 });
  });

  it("walks through the hub on a pass revisit: a new visit, already done, no completion", () => {
    const orchard = play(go(play(startJourney(GRAPH)), "to-orchard"));
    const crossing = takeExit(GRAPH, orchard, { edge: "orchard-to-waystone", visit: 1 });
    expect(crossing).toMatchObject({ ok: true, duplicate: false, arrival: "pass" });
    const hub = crossed(crossing);
    expect(hub).toMatchObject({
      node: "waystone",
      visit: 2,
      status: "choosing",
      visits: { waystone: 2 },
      completions: { waystone: 1 },
    });
    expect(currentPlayable(GRAPH, hub).kind).toBe("choose");
  });
});

describe("choice-specific exits", () => {
  const atQuarry = () => go(play(startJourney(GRAPH)), "to-quarry");
  const open = (journey: JourneyState) =>
    exitsFrom(GRAPH, "quarry", journey)
      .filter((e) => e.availability.available)
      .map((e) => e.edge);

  it("opens the climb only for a party whose chapter found the lens", () => {
    expect(open(play(atQuarry(), "success", { found_the_lens: true }))).toEqual([
      "quarry-to-tower",
      "quarry-to-waystone",
    ]);
    expect(open(play(atQuarry(), "success"))).toEqual(["quarry-to-waystone"]);
  });

  it("opens the long road home only after a setback here", () => {
    expect(open(play(atQuarry(), "setback"))).toEqual(["quarry-to-home", "quarry-to-waystone"]);
  });

  it("refuses a guarded exit with its reason", () => {
    const quarry = play(atQuarry());
    expect(takeExit(GRAPH, quarry, { edge: "quarry-to-tower", visit: quarry.visit })).toMatchObject({
      ok: false,
      code: "unavailable",
      reason: "guard",
    });
  });

  it("spends a once edge: the quarry road is crossed once per attempt", () => {
    const hub = go(play(atQuarry()), "quarry-to-waystone");
    expect(hub).toMatchObject({ node: "waystone", visit: 2, status: "choosing" });
    expect(takeExit(GRAPH, hub, { edge: "to-quarry", visit: 2 })).toMatchObject({
      ok: false,
      code: "unavailable",
      reason: "spent",
    });
  });

  it("refuses the locked door until something opens it", () => {
    const orchard = play(go(play(startJourney(GRAPH)), "to-orchard"));
    expect(takeExit(GRAPH, orchard, { edge: "orchard-to-tower", visit: 1 })).toMatchObject({
      ok: false,
      reason: "locked",
    });
  });
});

describe("endings", () => {
  const throughTheTower = () => {
    const quarry = play(go(play(startJourney(GRAPH)), "to-quarry"), "success", { found_the_lens: true });
    return go(play(go(quarry, "quarry-to-tower")), "tower-to-dawn");
  };

  it("completing an ending ends the journey and names the ending", () => {
    const gate = throughTheTower();
    expect(gate).toMatchObject({ node: "dawn-gate", status: "playing" });
    const result = completeVisit(GRAPH, gate, {
      node: "dawn-gate",
      visit: 1,
      chapterId: "sampler-dawn-gate",
      outcome: "success",
      flags: gate.flags ?? {},
    });
    expect(result).toMatchObject({ ok: true, ended: true, firstCompletion: true });
    const ended = completed(result);
    expect(ended).toMatchObject({ status: "ended", ending: "dawn-gate" });
    expect(currentPlayable(GRAPH, ended)).toEqual({ kind: "ended", node: "dawn-gate", visit: 1, ending: "dawn-gate" });
    expect(journeyView(GRAPH, ended).reachedEnding).toEqual({ node: "dawn-gate", title: "The Dawn Gate" });
  });

  it("an ended journey goes nowhere", () => {
    const ended = play(throughTheTower());
    expect(takeExit(GRAPH, ended, { edge: "to-orchard", visit: 1 })).toMatchObject({ ok: false, code: "ended" });
  });

  it("a setback ending ends it too", () => {
    const quarry = play(go(play(startJourney(GRAPH)), "to-quarry"), "setback");
    const home = play(go(quarry, "quarry-to-home"));
    expect(home).toMatchObject({ status: "ended", ending: "long-road-home" });
  });
});

describe("idempotence and stale reports", () => {
  it("a second completion of the same visit is a duplicate, and counts nothing", () => {
    const start = startJourney(GRAPH);
    const report = { node: "waystone", visit: 1, chapterId: "sampler-waystone", outcome: "success" as const, flags: {} };
    const once = completed(completeVisit(GRAPH, start, report));
    const twice = completeVisit(GRAPH, once, report);
    expect(twice).toEqual({ ok: true, duplicate: true, journey: once });
  });

  it("a completion for a visit the journey has since left is a duplicate", () => {
    const left = go(play(startJourney(GRAPH)), "to-orchard");
    const late = completeVisit(GRAPH, left, {
      node: "waystone",
      visit: 1,
      chapterId: "sampler-waystone",
      outcome: "setback",
      flags: {},
    });
    expect(late).toEqual({ ok: true, duplicate: true, journey: left });
  });

  it("a completion for a visit the journey never had is refused as stale", () => {
    const start = startJourney(GRAPH);
    for (const [node, visit] of [["waystone", 2], ["orchard", 1], ["waystone", 0]] as const) {
      expect(
        completeVisit(GRAPH, start, { node, visit, chapterId: "sampler-waystone", outcome: "success", flags: {} }),
      ).toMatchObject({ ok: false, code: "stale-visit" });
    }
  });

  it("the double tap on an exit crosses once", () => {
    const hub = play(startJourney(GRAPH));
    const once = crossed(takeExit(GRAPH, hub, { edge: "to-orchard", visit: 1 }));
    const twice = takeExit(GRAPH, once, { edge: "to-orchard", visit: 1 });
    expect(twice).toEqual({ ok: true, duplicate: true, journey: once });
    expect(once.traversed).toEqual({ "to-orchard": 1 });
  });

  it("a crossing repeated after the party has played on is still recognized", () => {
    const hub = play(startJourney(GRAPH));
    const orchard = play(go(hub, "to-orchard"));
    // The retry of the first crossing arrives late; it was the last exit taken.
    expect(takeExit(GRAPH, orchard, { edge: "to-orchard", visit: 1 })).toMatchObject({ ok: true, duplicate: true });
  });

  it("refuses a crossing from a visit the journey is no longer at", () => {
    const orchard = play(go(play(startJourney(GRAPH)), "to-orchard"));
    const hub = go(orchard, "orchard-to-waystone");
    const backDown = play(go(hub, "to-orchard"));
    // A screen still showing the orchard's first visit offers its exits.
    expect(takeExit(GRAPH, backDown, { edge: "orchard-to-mill", visit: 1 })).toMatchObject({
      ok: false,
      code: "stale-visit",
    });
  });

  it("refuses an exit while the visit is still playing", () => {
    expect(takeExit(GRAPH, startJourney(GRAPH), { edge: "to-orchard", visit: 1 })).toMatchObject({
      ok: false,
      code: "still-playing",
    });
  });

  it("refuses an exit that does not leave this node, or does not exist", () => {
    const hub = play(startJourney(GRAPH));
    expect(takeExit(GRAPH, hub, { edge: "orchard-to-mill", visit: 1 })).toMatchObject({ ok: false, code: "not-here" });
    expect(takeExit(GRAPH, hub, { edge: "to-the-moon", visit: 1 })).toMatchObject({ ok: false, code: "unknown-edge" });
  });

  it("never mutates the journey it was handed", () => {
    const hub = play(startJourney(GRAPH));
    const frozen = structuredClone(hub);
    go(hub, "to-orchard");
    completeVisit(GRAPH, startJourney(GRAPH), {
      node: "waystone",
      visit: 1,
      chapterId: "sampler-waystone",
      outcome: "success",
      flags: { found_the_lens: true },
    });
    expect(hub).toEqual(frozen);
  });
});

describe("resuming and saving", () => {
  it("resumes a playing visit as the same visit and the same chapter — variants are not re-read", () => {
    const orchard = go(play(startJourney(GRAPH)), "to-orchard");
    // Something sets the flag the orchard's variant reads while the party is
    // mid-visit (a later issue's world state, say). Resuming does not re-roll
    // the place under them.
    const saved = JSON.parse(JSON.stringify({ ...orchard, flags: { mill_wheel_turning: true } })) as unknown;
    const resumed = resumeJourney(GRAPH, saved);
    expect(resumed).toMatchObject({ ok: true, fresh: false });
    expect(resumed.ok && currentPlayable(GRAPH, resumed.journey)).toEqual({
      kind: "play",
      node: "orchard",
      visit: 1,
      chapter: "sampler-orchard",
    });
  });

  it("resumes a finished visit at the exit choice, never a replay", () => {
    const saved = JSON.parse(JSON.stringify(play(startJourney(GRAPH)))) as unknown;
    const resumed = resumeJourney(GRAPH, saved);
    expect(resumed.ok && currentPlayable(GRAPH, resumed.journey).kind).toBe("choose");
    expect(resumed.ok && resumed.journey.visits).toEqual({ waystone: 1 });
  });

  it("an attempt with no journey written yet resumes as a fresh start", () => {
    expect(resumeJourney(GRAPH, undefined)).toEqual({ ok: true, journey: startJourney(GRAPH), fresh: true });
    expect(readJourney(GRAPH, null)).toEqual({ ok: true, journey: null });
  });

  it("survives a save/load round trip unchanged, whole walks included", () => {
    let journey = startJourney(GRAPH);
    const script: [string | null, ChapterOutcome, Record<string, boolean>][] = [
      [null, "success", {}],
      ["to-orchard", "success", {}],
      ["orchard-to-mill", "setback", {}],
      ["mill-to-orchard", "success", {}],
      ["orchard-to-tower", "success", {}],
    ];
    for (const [edge, outcome, flags] of script) {
      if (edge) journey = go(journey, edge);
      journey = play(journey, outcome, flags);
      const loaded = readJourney(GRAPH, JSON.parse(JSON.stringify(journey)));
      expect(loaded).toEqual({ ok: true, journey });
    }
    expect(journey).toMatchObject({ node: "tower", status: "choosing", outcomes: { mill: "setback" } });
  });

  it("refuses a journey saved by a newer build rather than guessing", () => {
    const future = { ...startJourney(GRAPH), version: 2 };
    expect(readJourney(GRAPH, future)).toMatchObject({ ok: false, code: "version" });
    expect(resumeJourney(GRAPH, future)).toMatchObject({ ok: false, code: "version" });
  });

  it("refuses a journey standing at a node the content no longer has", () => {
    const moved = { ...startJourney(GRAPH), node: "old-waystone" };
    expect(readJourney(GRAPH, moved)).toMatchObject({ ok: false, code: "unknown-node" });
  });

  it("refuses something that is not a journey at all", () => {
    expect(readJourney(GRAPH, "waystone")).toMatchObject({ ok: false, code: "unreadable" });
    expect(readJourney(GRAPH, { version: 1 })).toMatchObject({ ok: false, code: "unreadable" });
  });

  it("ignores counters for ids the declaration no longer has", () => {
    const stale = { ...play(startJourney(GRAPH)), visits: { waystone: 1, "old-mill": 4 }, edges: { "old-road": "open" as const } };
    const loaded = readJourney(GRAPH, stale);
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && go(loaded.journey!, "to-orchard").node).toBe("orchard");
  });

  it("walks the same script to the same journey every time", () => {
    const walk = () =>
      play(go(go(play(go(play(startJourney(GRAPH)), "to-quarry"), "setback"), "quarry-to-waystone"), "to-orchard"));
    expect(walk()).toEqual(walk());
  });
});

describe("journeyView", () => {
  it("draws the visible exits with their labels, availability and arrival", () => {
    const orchard = play(go(play(startJourney(GRAPH)), "to-orchard"));
    const view = journeyView(GRAPH, orchard, (id) => (id === "sampler-orchard" ? "Apple Rows" : undefined));
    expect(view).toEqual({
      node: "orchard",
      title: "The Orchard",
      visit: 1,
      status: "choosing",
      chapter: "sampler-orchard",
      exits: [
        {
          edge: "orchard-to-mill",
          to: "mill",
          kind: "sideways",
          label: "Along the stream to the mill",
          available: true,
          arrival: "new",
        },
        {
          edge: "orchard-to-waystone",
          to: "waystone",
          kind: "return",
          label: "Back to the waystone",
          available: true,
          arrival: "pass",
        },
        // Locked, and drawn because it is authored `blocked: "shown"`.
        {
          edge: "orchard-to-tower",
          to: "tower",
          kind: "forward",
          label: "Through the tower door",
          available: false,
          reason: "locked",
          arrival: "new",
        },
      ],
    });
  });

  it("hides a guarded exit, and draws none while the visit is playing", () => {
    const quarry = play(go(play(startJourney(GRAPH)), "to-quarry"));
    expect(journeyView(GRAPH, quarry).exits.map((e) => e.edge)).toEqual(["quarry-to-waystone"]);
    expect(journeyView(GRAPH, startJourney(GRAPH)).exits).toEqual([]);
  });

  it("marks an irreversible crossing", () => {
    const quarry = play(go(play(startJourney(GRAPH)), "to-quarry"), "setback");
    const home = journeyView(GRAPH, quarry).exits.find((e) => e.edge === "quarry-to-home");
    expect(home).toMatchObject({ irreversible: true, label: "Take the long road home" });
  });
});
