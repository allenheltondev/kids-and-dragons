/**
 * World state (#198): typed, bounded, attempt-scoped facts — declared on the
 * graph, written by edges and completion rules, read by guards and variants,
 * stored on the journey, shown to the players when visible, and walked by the
 * lint.
 *
 * Most cases play the Ash Wyrm Sampler (fixtures/world-state.campaign.json),
 * whose mill village is a different place on every kind of revisit — standing,
 * market day, displaced, restored — so "changed encounters on revisit without
 * replaying identical scenes" is checked against the shape the doc teaches.
 * The last blocks are the other half of the contract: a journey saved before
 * #198 reads as the world the author wrote, the campaign's declaration is
 * never written to, and a graph (or an ordered campaign) that declares no
 * facts behaves exactly as it did.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  arrivalAt,
  chapterAtNode,
  evaluateGraphCondition,
  exitAvailability,
  parseCampaignGraph,
  type ParsedCampaignGraph,
} from "./campaign-graph.js";
import { lintCampaignGraph, type GraphFinding } from "./campaign-graph-lint.js";
import {
  completeVisit,
  journeyView,
  readJourney,
  resumeJourney,
  startJourney,
  takeExit,
  type ExitCrossing,
  type JourneyRefusal,
  type VisitCompletion,
} from "./journey.js";
import { factTestValues, MAX_COUNTER_SPAN, readFact, worldFacts, writeFact } from "./world-state.js";
import type { Campaign, ChapterOutcome } from "./types/chapter.js";
import type { JourneyState, WorldFact } from "./types/campaign-graph.js";

const read = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));

/** A fresh copy each time, so a test that bends it bends only its own. */
function wyrm(): Campaign {
  return read(new URL("./fixtures/world-state.campaign.json", import.meta.url)) as Campaign;
}

function riftSampler(): Campaign {
  return read(new URL("./fixtures/rift-sampler.campaign.json", import.meta.url)) as Campaign;
}

function parsed(campaign: Campaign = wyrm()): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(campaign);
  expect(problems).toEqual([]);
  return graph!;
}

/** The problems a bent fixture has, as `path: problem` lines. */
function problemsAfter(bend: (campaign: Campaign) => void): string[] {
  const campaign = wyrm();
  bend(campaign);
  const { graph, problems } = parseCampaignGraph(campaign);
  if (problems.length > 0) expect(graph).toBeNull();
  return problems.map(({ path, problem }) => `${path}: ${problem}`);
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
      flags: { ...(journey.flags ?? {}), ...flags },
    }),
  );
}

function go(journey: JourneyState, edge: string, graph: ParsedCampaignGraph = GRAPH): JourneyState {
  return crossed(takeExit(graph, journey, { edge, visit: journey.visit }));
}

const facts = (journey: JourneyState, graph: ParsedCampaignGraph = GRAPH) => worldFacts(graph.facts, journey);

/** Freezes an object and everything under it, so any write to it throws (ESM is strict). */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const each of Object.values(value)) deepFreeze(each);
  }
  return value;
}

/** Wakes the wyrm: crossroads → lair, falling short there, back at the crossroads. */
function wakeTheWyrm(journey: JourneyState = play(startJourney(GRAPH))): JourneyState {
  return go(play(go(journey, "to-lair"), "setback"), "lair-to-crossroads");
}

// ---------------------------------------------------------------------------

describe("declaring world facts", () => {
  it("parses the Ash Wyrm Sampler, keeping the facts in authored order", () => {
    expect(GRAPH.factOrder).toEqual(["mill-village", "ash-wyrm", "river-folk", "ford-path", "scorched-orchard"]);
    expect(GRAPH.facts["river-folk"]).toMatchObject({ domain: "alliance", type: "counter", min: 0, max: 3, initial: 0 });
  });

  it("gives a graph without facts an empty map, and changes nothing else about it", () => {
    const graph = parsed(riftSampler());
    expect(graph.facts).toEqual({});
    expect(graph.factOrder).toEqual([]);
  });

  it("refuses a malformed declaration, at its pointer", () => {
    expect(
      problemsAfter((c) => {
        const declared = c.graph!.facts!;
        declared["mill-village"] = { ...declared["mill-village"]!, initial: "flooded" } as WorldFact;
        declared["river-folk"] = { domain: "alliance", type: "counter", min: 0, max: MAX_COUNTER_SPAN + 1, initial: 0 };
        declared["ford-path"] = { domain: "road" as never, type: "flag" };
        declared["one-state"] = { domain: "locale", type: "enum", values: ["only"], initial: "only" };
      }),
    ).toEqual(
      expect.arrayContaining([
        `/graph/facts/mill-village/initial: initial "flooded" is not one of the fact's values`,
        `/graph/facts/river-folk/max: a counter spans at most ${MAX_COUNTER_SPAN} (this one spans ${MAX_COUNTER_SPAN + 1})`,
        `/graph/facts/ford-path/domain: domain "road" is not one of locale, threat, alliance, route, consequence`,
        "/graph/facts/one-state/values: an enum fact lists 2 to 12 values",
      ]),
    );
  });

  it("reports a broken fact once, not again at every guard that names it", () => {
    const problems = problemsAfter((c) => {
      (c.graph!.facts!["ash-wyrm"] as { initial: string }).initial = "asleep";
    });
    expect(problems).toEqual([`/graph/facts/ash-wyrm/initial: initial "asleep" is not one of the fact's values`]);
  });

  it("refuses a guard or an effect naming a fact nobody declared", () => {
    expect(
      problemsAfter((c) => {
        c.graph!.edges["to-village"]!.when = { facts: { "the-moon": "full" } };
        c.graph!.edges["to-village"]!.effects = [{ type: "setFact", fact: "the-tide", value: "high" }];
      }),
    ).toEqual([
      `/graph/edges/to-village/when/facts/the-moon: "the-moon" is not a world fact (declare it in graph.facts)`,
      `/graph/edges/to-village/effects/0/fact: "the-tide" is not a world fact (declare it in graph.facts)`,
    ]);
  });

  it("refuses tests and writes outside a fact's domain — a state it can never be in is a typo", () => {
    expect(
      problemsAfter((c) => {
        c.graph!.edges["to-village"]!.when = {
          facts: { "ash-wyrm": "asleep", "river-folk": { min: 4 }, "mill-village": { in: ["standing", "gone"] } },
        };
        c.graph!.edges["to-lair"]!.when = { facts: { "ford-path": { not: true } as never } };
        c.graph!.edges["to-lair"]!.effects = [
          { type: "setFact", fact: "river-folk", value: 9 },
          { type: "adjustFact", fact: "ash-wyrm", by: 1 },
          { type: "adjustFact", fact: "river-folk", by: 0 },
        ];
      }),
    ).toEqual([
      `/graph/edges/to-village/when/facts/ash-wyrm: "asleep" is not a value of this fact (one of "sleeping", "raging", "cleared")`,
      "/graph/edges/to-village/when/facts/river-folk/min: 4 is not a value of this fact (an integer from 0 to 3)",
      `/graph/edges/to-village/when/facts/mill-village/in/1: "gone" is not a value of this fact (one of "standing", "displaced", "restored")`,
      `/graph/edges/to-lair/when/facts/ford-path/not: a flag fact's test does not take "not" (test it with true or false)`,
      "/graph/edges/to-lair/effects/0/value: 9 is not a value of this fact (an integer from 0 to 3)",
      "/graph/edges/to-lair/effects/1/type: adjustFact moves a counter, and this fact is a enum (use setFact)",
      "/graph/edges/to-lair/effects/2/by: by is a non-zero integer",
    ]);
  });

  it("checks completion rules, visit tests and variant revisits like everything else", () => {
    expect(
      problemsAfter((c) => {
        const lair = c.graph!.nodes.lair!;
        lair.onComplete = [{ when: { visit: { min: 0 } }, effects: [{ type: "unlock", edge: "nowhere" }] }];
        lair.revisit = "closed";
        lair.variants![0]!.revisit = "pass";
      }),
    ).toEqual([
      `/graph/nodes/lair/variants/0/revisit: "lair" is closed once completed, so it is never revisited and a variant's revisit cannot apply`,
      "/graph/nodes/lair/onComplete/0/when/visit: visit's min and max are positive integers (a visit ordinal starts at 1)",
      `/graph/nodes/lair/onComplete/0/effects/0/edge: no edge "nowhere"`,
    ]);
  });
});

describe("reading a fact", () => {
  const village = GRAPH.facts["mill-village"]!;
  const favours = GRAPH.facts["river-folk"]!;
  const ford = GRAPH.facts["ford-path"]!;

  it("absent reads as the declared initial", () => {
    expect(readFact(village, undefined)).toBe("standing");
    expect(readFact(favours, undefined)).toBe(0);
    expect(readFact(ford, undefined)).toBe(false);
  });

  it("a value the declaration no longer admits reads as initial; a counter out of narrowed bounds is clamped", () => {
    expect(readFact(village, "flooded")).toBe("standing");
    expect(readFact(village, 3)).toBe("standing");
    expect(readFact(favours, 7)).toBe(3);
    expect(readFact(favours, -2)).toBe(0);
    expect(readFact(favours, 1.5)).toBe(0);
    expect(readFact(favours, "2")).toBe(0);
    expect(readFact(ford, "yes")).toBe(false);
    expect(readFact(ford, true)).toBe(true);
  });

  it("writes clamp a counter and leave anything else to setFact", () => {
    expect(writeFact(favours, 3, { type: "adjustFact", fact: "river-folk", by: 1 })).toBe(3);
    expect(writeFact(favours, 0, { type: "adjustFact", fact: "river-folk", by: -1 })).toBe(0);
    expect(writeFact(village, "standing", { type: "adjustFact", fact: "mill-village", by: 1 })).toBe("standing");
    expect(writeFact(village, "standing", { type: "setFact", fact: "mill-village", value: "displaced" })).toBe("displaced");
  });

  it("a test admits exactly the values it says", () => {
    expect(factTestValues(village, { not: "standing" })).toEqual(["displaced", "restored"]);
    expect(factTestValues(favours, { min: 1, max: 2 })).toEqual([1, 2]);
    expect(factTestValues(favours, { in: [0, 3], not: 3 })).toEqual([0]);
    expect(factTestValues(ford, true)).toEqual([true]);
  });
});

describe("guards on facts and visits", () => {
  it("reads facts through their declarations, so a fact never written is its initial", () => {
    const at = { facts: GRAPH.facts };
    expect(evaluateGraphCondition({ facts: { "mill-village": "standing" } }, {}, undefined, at)).toBe(true);
    expect(evaluateGraphCondition({ facts: { "river-folk": { min: 1 } } }, {}, undefined, at)).toBe(false);
    expect(evaluateGraphCondition({ facts: { "river-folk": { min: 1 } } }, { facts: { "river-folk": 2 } }, undefined, at)).toBe(true);
    expect(evaluateGraphCondition({ facts: { "ash-wyrm": { in: ["raging", "cleared"] } } }, { facts: { "ash-wyrm": "raging" } }, undefined, at)).toBe(true);
    // Without the declarations a reader cannot know what "never written" means.
    expect(evaluateGraphCondition({ facts: { "mill-village": "standing" } }, {})).toBe(false);
    expect(evaluateGraphCondition({ facts: { "mill-village": "displaced" } }, { facts: { "mill-village": "displaced" } })).toBe(true);
  });

  it("every fact listed must pass, and a fact test sits beside the other fields (AND)", () => {
    const at = { facts: GRAPH.facts };
    const journey = { facts: { "ford-path": true }, flags: { befriended_river_folk: true } };
    expect(evaluateGraphCondition({ facts: { "ford-path": true, "river-folk": { min: 1 } } }, journey, undefined, at)).toBe(false);
    expect(evaluateGraphCondition({ facts: { "ford-path": true }, flag: "befriended_river_folk" }, journey, undefined, at)).toBe(true);
  });

  it("a visit test reads the subject's visit ordinal: on an edge the one being finished, on a variant the one being begun", () => {
    expect(evaluateGraphCondition({ visit: { min: 2 } }, { visits: { village: 2 } }, "village")).toBe(true);
    expect(evaluateGraphCondition({ visit: { max: 1 } }, { visits: { village: 2 } }, "village")).toBe(false);
    expect(evaluateGraphCondition({ visit: { min: 1 } }, { visits: { village: 2 } })).toBe(false);
    // On arrival, before the visit is counted: the first visit is visit 1, the next visit 2.
    expect(chapterAtNode(GRAPH, "village", {})).toBe("ws-village");
    expect(chapterAtNode(GRAPH, "village", { visits: { village: 1 } })).toBe("ws-village-market");
  });

  it("an edge guarded on a fact is blocked with reason guard, the way a flag guard is", () => {
    expect(exitAvailability(GRAPH, "to-high-pass", {})).toEqual({ available: false, reason: "guard" });
    expect(exitAvailability(GRAPH, "to-high-pass", { facts: { "ash-wyrm": "cleared" } })).toEqual({ available: true });
    expect(exitAvailability(GRAPH, "to-lair", { facts: { "ash-wyrm": "cleared" } })).toEqual({ available: false, reason: "guard" });
  });

  it("a variant's revisit overrides the node's for a completed node only", () => {
    const restored = { facts: { "mill-village": "restored" } };
    expect(arrivalAt(GRAPH, "village", restored)).toBe("new");
    expect(arrivalAt(GRAPH, "village", { ...restored, completions: { village: 1 } })).toBe("pass");
    expect(arrivalAt(GRAPH, "village", { facts: { "mill-village": "displaced" }, completions: { village: 1 } })).toBe("replay");
  });
});

describe("the mill village on revisit — one place, four faces", () => {
  it("is standing the first time, and a market day the next, while nothing has happened to it", () => {
    let journey = go(play(startJourney(GRAPH)), "to-village");
    expect(journey.chapter).toBe("ws-village");
    journey = go(play(journey), "village-to-crossroads");
    expect(journey).toMatchObject({ node: "crossroads", status: "choosing" }); // the hub is passed through
    journey = go(journey, "to-village");
    expect(journey).toMatchObject({ node: "village", visit: 2, status: "playing", chapter: "ws-village-market" });
  });

  it("is displaced after the wyrm wakes — a different encounter, not the same scene again", () => {
    let journey = go(play(startJourney(GRAPH)), "to-village");
    journey = go(play(journey), "village-to-crossroads");
    journey = wakeTheWyrm(journey);
    expect(facts(journey)).toMatchObject({ "ash-wyrm": "raging", "mill-village": "displaced", "scorched-orchard": true });
    journey = go(journey, "to-village");
    expect(journey).toMatchObject({ node: "village", visit: 2, status: "playing", chapter: "ws-village-displaced" });
  });

  it("is restored once the wyrm is cleared — and walked through, never replayed", () => {
    let journey = go(play(startJourney(GRAPH)), "to-village");
    journey = go(play(journey), "village-to-crossroads");
    journey = wakeTheWyrm(journey);
    journey = go(journey, "to-lair");
    expect(journey.chapter).toBe("ws-lair-raging");
    journey = go(play(journey, "success"), "lair-to-crossroads");
    expect(facts(journey)).toMatchObject({ "ash-wyrm": "cleared", "mill-village": "restored" });

    const arrived = takeExit(GRAPH, journey, { edge: "to-village", visit: journey.visit });
    expect(arrived).toMatchObject({ ok: true, arrival: "pass" });
    journey = crossed(arrived);
    expect(journey).toMatchObject({ node: "village", visit: 2, status: "choosing", chapter: "ws-village-restored" });
    // Passing through completes nothing, so the completion rules do not run either.
    expect(journey.completions?.village).toBe(1);
    // The lair is shut behind a cleared wyrm; the high pass opens.
    journey = go(journey, "village-to-crossroads");
    expect(exitAvailability(GRAPH, "to-lair", journey)).toEqual({ available: false, reason: "guard" });
    journey = go(journey, "to-high-pass");
    expect(play(journey)).toMatchObject({ status: "ended", ending: "high-pass" });
  });

  it("is played restored when the party first arrives after the village was saved", () => {
    let journey = wakeTheWyrm();
    journey = go(play(go(journey, "to-lair"), "success"), "lair-to-crossroads");
    journey = go(journey, "to-village");
    expect(journey).toMatchObject({ visit: 1, status: "playing", chapter: "ws-village-restored" });
  });
});

describe("writing facts", () => {
  it("a chapter reaches the world through a journey flag and a completion rule", () => {
    let journey = go(play(startJourney(GRAPH)), "to-village");
    journey = play(journey, "success", { befriended_river_folk: true });
    expect(facts(journey)["river-folk"]).toBe(1);
    // The rule cleared the flag, so the next completion has to earn it again.
    expect(journey.flags?.befriended_river_folk).toBeUndefined();
    journey = go(go(journey, "village-to-crossroads"), "to-village");
    journey = play(journey);
    expect(facts(journey)["river-folk"]).toBe(1);
  });

  it("clamps a counter at its bound, however many times it is pushed", () => {
    let journey = go(play(startJourney(GRAPH)), "to-village");
    for (let i = 0; i < 5; i += 1) {
      journey = play(journey, "success", { befriended_river_folk: true });
      journey = go(go(journey, "village-to-crossroads"), "to-village");
    }
    expect(facts(journey)["river-folk"]).toBe(3);
  });

  it("judges every completion rule against the journey the chapter produced, not each other's effects", () => {
    // Rule 2 clears the wyrm; rule 3 still sees it raging and restores the village.
    let journey = wakeTheWyrm();
    journey = play(go(journey, "to-lair"), "success");
    expect(facts(journey)).toMatchObject({ "ash-wyrm": "cleared", "mill-village": "restored" });
    // Succeeding against the *sleeping* wyrm writes only the ford path.
    const sneaky = play(go(play(startJourney(GRAPH)), "to-lair"), "success");
    expect(sneaky.facts).toEqual({ "ford-path": true });
  });

  it("an edge's effects write before arrival, and a guard reads them", () => {
    let journey = play(go(play(startJourney(GRAPH)), "to-lair"), "success"); // the ford path
    journey = go(journey, "lair-to-crossroads");
    expect(exitAvailability(GRAPH, "to-ford", journey).available).toBe(false); // no favour yet
    journey = play(go(journey, "to-village"), "success", { befriended_river_folk: true });
    journey = go(go(journey, "village-to-crossroads"), "to-ford");
    expect(facts(journey)["river-folk"]).toBe(0); // the ferry cost the favour
    expect(play(journey)).toMatchObject({ status: "ended", ending: "ford" });
  });

  it("a duplicate completion applies the rules once", () => {
    const at = go(play(startJourney(GRAPH)), "to-village");
    const once = play(at, "success", { befriended_river_folk: true });
    const again = completeVisit(GRAPH, once, {
      node: at.node,
      visit: at.visit,
      chapterId: at.chapter,
      outcome: "success",
      flags: { befriended_river_folk: true },
    });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(facts(again.ok ? again.journey : once)["river-folk"]).toBe(1);
  });
});

describe("persistence", () => {
  it("round-trips through JSON — what a store keeps — and resumes the same world", () => {
    const journey = wakeTheWyrm();
    const stored = JSON.parse(JSON.stringify(journey)) as unknown;
    const resumed = resumeJourney(GRAPH, stored);
    expect(resumed).toMatchObject({ ok: true, fresh: false });
    expect(resumed.ok && resumed.journey).toEqual(journey);
    expect(facts(resumed.ok ? resumed.journey : journey)).toEqual(facts(journey));
  });

  it("stores only what has been written: a fresh journey has no facts key at all", () => {
    expect(startJourney(GRAPH)).not.toHaveProperty("facts");
    expect(facts(startJourney(GRAPH))).toEqual({
      "mill-village": "standing",
      "ash-wyrm": "sleeping",
      "river-folk": 0,
      "ford-path": false,
      "scorched-orchard": false,
    });
  });

  it("reads a journey saved before #198 — no facts at all — as the world the author wrote", () => {
    const legacy = {
      version: 1,
      node: "crossroads",
      visit: 2,
      status: "choosing",
      chapter: "ws-crossroads",
      visits: { crossroads: 2, village: 1 },
      completions: { crossroads: 1, village: 1 },
      traversed: { "to-village": 1, "village-to-crossroads": 1 },
      lastExit: { node: "village", visit: 1, edge: "village-to-crossroads" },
    };
    const read = readJourney(GRAPH, legacy);
    expect(read).toMatchObject({ ok: true });
    const journey = read.ok ? read.journey! : null!;
    expect(facts(journey)["mill-village"]).toBe("standing");
    expect(go(journey, "to-village").chapter).toBe("ws-village-market");
  });

  it("ignores ids it does not know, and reads values it cannot admit as initial — without dropping them", () => {
    const journey = {
      ...wakeTheWyrm(),
      facts: { "ash-wyrm": "furious", "river-folk": 12, "a-later-fact": "kept", "mill-village": "displaced" },
    } as JourneyState;
    expect(facts(journey)).toMatchObject({ "ash-wyrm": "sleeping", "river-folk": 3, "mill-village": "displaced" });
    expect(facts(journey)).not.toHaveProperty("a-later-fact");
    // A write keeps what it does not understand, for the build that does.
    const next = go(journey, "to-lair");
    expect(next.facts).toMatchObject({ "a-later-fact": "kept" });
  });

  it("reads a stored facts value that is not a record as nothing written", () => {
    const journey = { ...startJourney(GRAPH), facts: "garbage" } as unknown as JourneyState;
    expect(facts(journey)["mill-village"]).toBe("standing");
    expect(play(journey).status).toBe("choosing");
  });
});

describe("no global mutation of the world's canon", () => {
  it("never writes the campaign's declaration or the parsed graph — both frozen through a whole walk", () => {
    const campaign = deepFreeze(wyrm());
    const graph = deepFreeze(parsed(campaign));
    let journey = startJourney(graph, campaign);
    journey = play(journey, "success", {}, graph);
    journey = go(journey, "to-lair", graph);
    journey = play(journey, "setback", {}, graph);
    journey = go(journey, "lair-to-crossroads", graph);
    journey = go(journey, "to-village", graph);
    journey = play(journey, "success", { befriended_river_folk: true }, graph);
    expect(worldFacts(graph.facts, journey)).toMatchObject({ "mill-village": "displaced", "river-folk": 1 });
    expect(campaign).toEqual(wyrm());
  });

  it("never writes the journey it was given: a transition returns a new world, and the old one stands", () => {
    const before = deepFreeze(go(play(startJourney(GRAPH)), "to-lair"));
    const after = play(before, "setback");
    expect(before.facts).toBeUndefined();
    expect(facts(after)["ash-wyrm"]).toBe("raging");
  });

  it("a fresh attempt starts from the initial values, whatever another attempt did to its world", () => {
    const other = wakeTheWyrm();
    expect(facts(other)["mill-village"]).toBe("displaced");
    const fresh = startJourney(GRAPH);
    expect(facts(fresh)).toEqual(facts(startJourney(parsed())));
    expect(facts(fresh)["mill-village"]).toBe("standing");
    expect(go(play(fresh), "to-village").chapter).toBe("ws-village");
  });
});

describe("what the players see", () => {
  it("shows the visible facts, in authored order, with their values — and never the hidden ones", () => {
    const view = journeyView(GRAPH, wakeTheWyrm());
    expect(view.facts).toEqual([
      { id: "mill-village", domain: "locale", label: "The mill village", type: "enum", value: "displaced" },
      { id: "ash-wyrm", domain: "threat", label: "The ash wyrm", type: "enum", value: "raging" },
      { id: "river-folk", domain: "alliance", label: "Favours of the river folk", type: "counter", value: 0 },
      { id: "scorched-orchard", domain: "consequence", label: "The orchard burned", type: "flag", value: true },
    ]);
  });

  it("sends no facts key for a graph that declares none visible", () => {
    const graph = parsed(riftSampler());
    expect(journeyView(graph, startJourney(graph))).not.toHaveProperty("facts");
    const hidden = wyrm();
    for (const fact of Object.values(hidden.graph!.facts!)) delete fact.visible;
    const quiet = parsed(hidden);
    expect(journeyView(quiet, startJourney(quiet))).not.toHaveProperty("facts");
  });
});

describe("the lint walks the world", () => {
  const lint = (campaign: Campaign): GraphFinding[] => lintCampaignGraph(parsed(campaign)).findings;
  const codes = (findings: GraphFinding[]) => findings.map((f) => `${f.code} ${f.path}`);

  it("passes the Ash Wyrm Sampler cleanly, every variant played", () => {
    const result = lintCampaignGraph(GRAPH);
    expect(result.findings).toEqual([]);
    expect(result.search.complete).toBe(true);
  });

  it("follows facts written by completion rules: without the rule that clears the wyrm, the high pass is never reached", () => {
    const campaign = wyrm();
    campaign.graph!.nodes.lair!.onComplete!.splice(2, 1);
    const found = codes(lint(campaign));
    expect(found).toContain("ENDING_NEVER_REACHED /graph/nodes/high-pass");
    expect(found).toContain("FACT_VALUE_NEVER_SET /graph/facts/ash-wyrm/values/2");
  });

  it("finds a party stranded by world state, with the path that gets there", () => {
    const campaign = wyrm();
    // The village becomes the only way on, and only while it stands.
    campaign.graph!.edges["to-lair"]!.when = { facts: { "mill-village": "standing" } };
    campaign.graph!.edges["to-village"]!.when = { facts: { "mill-village": "standing" } };
    delete campaign.graph!.edges["to-high-pass"]!.when;
    campaign.graph!.edges["to-high-pass"]!.when = { facts: { "mill-village": "standing" } };
    delete campaign.graph!.edges["to-ford"];
    const stranded = lint(campaign).filter((f) => f.code === "STRANDED");
    expect(stranded[0]?.path).toBe("/graph/nodes/crossroads");
    expect(stranded[0]?.message).toContain("-[to-lair]-> \"lair\" (setback)");
  });

  it("warns about a variant no play-through can choose", () => {
    const campaign = wyrm();
    // The market day is shadowed: a variant before it always holds on a revisit.
    campaign.graph!.nodes.village!.variants!.splice(2, 0, { chapter: "ws-village", when: { visit: { min: 2 } } });
    expect(codes(lint(campaign))).toEqual(["VARIANT_NEVER_CHOSEN /graph/nodes/village/variants/3"]);
  });

  it("calls a fact test no value can pass a contradiction", () => {
    const campaign = wyrm();
    campaign.graph!.edges["to-village"]!.when = { facts: { "ash-wyrm": { in: ["raging"], not: "raging" } } };
    const found = lint(campaign).find((f) => f.code === "GUARD_CONTRADICTION");
    expect(found?.path).toBe("/graph/edges/to-village/when");
  });

  it("warns about a fact nobody reads or sees", () => {
    const campaign = wyrm();
    delete campaign.graph!.facts!["scorched-orchard"]!.visible;
    expect(codes(lint(campaign))).toEqual(["FACT_UNUSED /graph/facts/scorched-orchard"]);
  });

  it("stays small: bounded facts multiply the search, they do not explode it", () => {
    expect(lintCampaignGraph(GRAPH).search.states).toBeLessThan(1_000);
  });
});
