/**
 * Temporary buffs (#200): declared by a graph campaign, granted by graph
 * effects, held on the journey, carried by the chapter run, applied inside a
 * fight, spent deterministically, and never written to a character.
 *
 * Most cases play The Humming Spring (fixtures/rift-buffs.campaign.json),
 * which declares one buff of each kind and duration, every stacking mode,
 * both targets, every expiry, and a tradeoff. The last blocks are the other
 * half of the contract: a fight without buffs computes exactly what it always
 * did, a journey that never held one keeps its shape, and the character
 * behind a buffed hero is untouched.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCampaignGraph, type ParsedCampaignGraph } from "./campaign-graph.js";
import { lintCampaignGraph } from "./campaign-graph-lint.js";
import {
  BUFF_LIMITS,
  buffBonus,
  buffContribution,
  buffed,
  buffViews,
  combatBuffsFor,
  expireBuffs,
  expireRunBuffs,
  grantBuff,
  oneHeroSeat,
  readBackBuffs,
  seedRunBuffs,
  spendRunBuffs,
  storedBuffs,
  tickCombatBuffs,
} from "./buffs.js";
import { completeVisit, journeyView, startJourney, takeExit, takeRiftAction, type ExitCrossing, type JourneyRefusal, type VisitCompletion } from "./journey.js";
import {
  beginEncounter,
  combatantById,
  currentActorId,
  endTurn,
  performAction,
  type AbilityCatalog,
  type EncounterSetup,
  type EncounterState,
} from "./encounter.js";
import { applyIntent, createRunState, type EngineContext } from "./engine.js";
import { parseBoard } from "./grid.js";
import { makeRng, type Rng } from "./dice.js";
import { resolveCharacter } from "./character.js";
import { APPEARANCE, makeChapter, makeCharacter, makeItems, makeMap, makeRules } from "./test-fixtures.js";
import type { ActiveBuff, BuffDef, CombatBuff, RunBuff } from "./types/buffs.js";
import type { Campaign, Chapter, ChapterOutcome } from "./types/chapter.js";
import type { JourneyState } from "./types/campaign-graph.js";
import type { ClientIntent } from "./types/protocol.js";
import type { RunState } from "./types/state.js";

const read = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));

/** A fresh copy each time, so a test that bends it bends only its own. */
function spring(): Campaign {
  return read(new URL("./fixtures/rift-buffs.campaign.json", import.meta.url)) as Campaign;
}

function parsed(campaign: Campaign = spring()): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(campaign);
  expect(problems).toEqual([]);
  return graph!;
}

function problemsAfter(bend: (campaign: Campaign) => void): string[] {
  const campaign = spring();
  bend(campaign);
  const { graph, problems } = parseCampaignGraph(campaign);
  if (problems.length > 0) expect(graph).toBeNull();
  return problems.map(({ path, problem }) => `${path}: ${problem}`);
}

const GRAPH = parsed();
const DEFS = GRAPH.buffs;

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

/** Completes the visit under way, as a run that held `buffs` would report it. */
function finish(journey: JourneyState, outcome: ChapterOutcome = "success", buffs?: RunBuff[]): JourneyState {
  return completed(
    completeVisit(GRAPH, journey, {
      node: journey.node,
      visit: journey.visit,
      chapterId: journey.chapter,
      outcome,
      flags: {},
      ...(buffs === undefined ? {} : { buffs }),
    }),
  );
}

function go(journey: JourneyState, edge: string): JourneyState {
  return crossed(takeExit(GRAPH, journey, { edge, visit: journey.visit }));
}

const ids = (buffs: readonly { id: string }[] | undefined): string[] => (buffs ?? []).map((b) => b.id);

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

describe("declaring buffs", () => {
  it("parses the fixture: every buff, in authored order", () => {
    expect(GRAPH.buffOrder).toEqual(["rift-shield", "rift-surge", "rift-fury", "rift-fray", "fleet-step"]);
    expect(GRAPH.buffs["rift-surge"]).toMatchObject({ kind: "damage", target: "one", stack: "add", maxStacks: 2 });
  });

  it("a graph without buffs parses to an empty declaration", () => {
    const sampler = read(new URL("./fixtures/rift-sampler.campaign.json", import.meta.url)) as Campaign;
    const graph = parsed(sampler);
    expect(graph.buffs).toEqual({});
    expect(graph.buffOrder).toEqual([]);
  });

  it("refuses amounts that are zero or past the kind's limit, and caps that make no sense", () => {
    expect(problemsAfter((c) => (c.graph!.buffs!["rift-shield"]!.amount = 0))).toEqual([
      "/graph/buffs/rift-shield/amount: amount must be a whole number from -3 to 3, not 0 (the guard limit)",
    ]);
    expect(problemsAfter((c) => (c.graph!.buffs!["rift-surge"]!.amount = 3))[0]).toContain("from -2 to 2");
    expect(problemsAfter((c) => (c.graph!.buffs!["fleet-step"]!.amount = 1.5))[0]).toContain("/fleet-step/amount");
    expect(problemsAfter((c) => (c.graph!.buffs!["rift-fury"]!.cap = 1))).toEqual([
      "/graph/buffs/rift-fury/cap: cap 1 is less than one stack (2), so the buff could never be what it says",
    ]);
    expect(problemsAfter((c) => (c.graph!.buffs!["rift-shield"]!.cap = 4))[0]).toContain("cap must be a whole number from 1 to 3");
  });

  it("refuses durations that are unbounded, unknown, or counted where they cannot be", () => {
    expect(problemsAfter((c) => (c.graph!.buffs!["rift-shield"]!.duration = { scope: "encounters", count: 6 })))
      .toEqual(["/graph/buffs/rift-shield/duration/count: count must be a whole number from 1 to 5"]);
    expect(
      problemsAfter((c) => (c.graph!.buffs!["rift-shield"]!.duration = { scope: "campaign" } as unknown as BuffDef["duration"]))[0],
    ).toContain('scope "campaign" is not');
    expect(
      problemsAfter((c) => (c.graph!.buffs!["rift-fury"]!.duration = { scope: "encounter", count: 2 } as unknown as BuffDef["duration"])),
    ).toEqual(['/graph/buffs/rift-fury/duration/count: an "encounter" buff lasts one fight; it takes no count']);
  });

  it("refuses unknown kinds, targets, stacking and expiries, and maxStacks without stacking", () => {
    const bad = problemsAfter((c) => {
      const buff = c.graph!.buffs!["rift-shield"]! as unknown as Record<string, unknown>;
      buff.kind = "speed";
      buff.target = "all";
      buff.stack = "merge";
      buff.maxStacks = 3;
      buff.expiresOn = ["defeat", "dawn"];
    });
    expect(bad.map((line) => line.split(":")[0])).toEqual([
      "/graph/buffs/rift-shield/kind",
      "/graph/buffs/rift-shield/target",
      "/graph/buffs/rift-shield/stack",
      "/graph/buffs/rift-shield/maxStacks",
      "/graph/buffs/rift-shield/expiresOn/1",
    ]);
    expect(problemsAfter((c) => (c.graph!.buffs!["rift-surge"]!.maxStacks = 6))[0]).toContain("from 2 to 5");
  });

  it("refuses a grantBuff of a buff nobody declared — once, even when the declaration is broken", () => {
    expect(
      problemsAfter((c) => c.graph!.edges["camp-to-den"]!.effects = [{ type: "grantBuff", buff: "rift-wings" }]),
    ).toEqual(['/graph/edges/camp-to-den/effects/0/buff: "rift-wings" is not a buff (declare it in graph.buffs)']);
    // A broken declaration is reported where it is, not again at every grant.
    expect(problemsAfter((c) => (c.graph!.buffs!["fleet-step"]!.amount = 0))).toHaveLength(1);
  });

  it("lints clean, and warns about a buff nothing grants", () => {
    const errors = lintCampaignGraph(GRAPH).findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
    const campaign = spring();
    campaign.graph!.edges["camp-to-spring"]!.effects = [];
    const findings = lintCampaignGraph(parsed(campaign)).findings.filter((f) => f.code === "BUFF_NEVER_GRANTED");
    expect(findings.map((f) => [f.severity, f.path])).toEqual([["warning", "/graph/buffs/fleet-step"]]);
  });

  it("does not change where the party can go: the lint's search ignores buffs", () => {
    const campaign = spring();
    delete campaign.graph!.buffs;
    for (const edge of Object.values(campaign.graph!.edges)) delete edge.effects;
    delete campaign.graph!.nodes["spring"]!.onComplete;
    const without = lintCampaignGraph(parsed(campaign));
    const withBuffs = lintCampaignGraph(GRAPH);
    expect(withBuffs.search).toEqual(without.search);
  });
});

// ---------------------------------------------------------------------------
// Stacking and caps
// ---------------------------------------------------------------------------

describe("granting, stacking and caps", () => {
  const shield = DEFS["rift-shield"]!;
  const surge = DEFS["rift-surge"]!;
  const fury = DEFS["rift-fury"]!;

  it("a new buff joins the end, one stack, its full duration, stamped with the visit", () => {
    const one = grantBuff([], "rift-shield", shield, { node: "spring", visit: 1 });
    expect(one).toEqual([{ id: "rift-shield", stacks: 1, encountersLeft: 2, grantedAt: { node: "spring", visit: 1 } }]);
    const two = grantBuff(one, "rift-surge", surge);
    expect(ids(two)).toEqual(["rift-shield", "rift-surge"]);
    expect(two[1]).toEqual({ id: "rift-surge", stacks: 1, encountersLeft: 1 });
  });

  it("refresh: full duration again, no stronger, same place in the list", () => {
    const spent: ActiveBuff[] = [
      { id: "rift-shield", stacks: 1, encountersLeft: 1 },
      { id: "rift-surge", stacks: 1, encountersLeft: 1 },
    ];
    const again = grantBuff(spent, "rift-shield", shield, { node: "spring", visit: 2 });
    expect(again[0]).toEqual({ id: "rift-shield", stacks: 1, encountersLeft: 2, grantedAt: { node: "spring", visit: 2 } });
    expect(ids(again)).toEqual(["rift-shield", "rift-surge"]);
  });

  it("add: one more stack, never past maxStacks, and its cap holds the total", () => {
    let held: ActiveBuff[] = [];
    for (let i = 0; i < 4; i++) held = grantBuff(held, "rift-surge", surge);
    expect(held).toEqual([{ id: "rift-surge", stacks: 2, encountersLeft: 1 }]);
    expect(buffContribution(surge, 2)).toBe(2);
    // A wider stack than the cap is held to the cap, and to the kind's limit.
    expect(buffContribution({ kind: "damage", amount: 1, cap: 1 }, 5)).toBe(1);
    expect(buffContribution({ kind: "guard", amount: 2 }, 5)).toBe(BUFF_LIMITS.guard);
    expect(buffContribution({ kind: "move", amount: -2 }, 3)).toBe(-BUFF_LIMITS.move);
  });

  it("ignore: the first one runs its course", () => {
    const held = grantBuff([], "rift-fury", fury);
    const spentOnce = [{ ...held[0]!, encountersLeft: 1 }];
    expect(grantBuff(spentOnce, "rift-fury", fury)).toEqual(spentOnce);
  });

  it("a hero's buffs of one kind add up, and stop at the kind's limit", () => {
    const fight: CombatBuff[] = [
      { id: "a", label: "A", kind: "guard", heroId: "h1", amount: 2 },
      { id: "b", label: "B", kind: "guard", heroId: "h1", amount: 2 },
      { id: "c", label: "C", kind: "guard", heroId: "h2", amount: -1 },
      { id: "d", label: "D", kind: "roll", heroId: "h1", amount: 1 },
    ];
    expect(buffBonus(fight, "h1", "guard")).toBe(3);
    expect(buffBonus(fight, "h2", "guard")).toBe(-1);
    expect(buffBonus(fight, "h1", "roll")).toBe(1);
    expect(buffBonus(fight, "h1", "move")).toBe(0);
    expect(buffBonus(undefined, "h1", "guard")).toBe(0);
    expect(buffed(11, 0, 1)).toBe(11);
    expect(buffed(2, -3, 1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The journey: granted, travelled, read back
// ---------------------------------------------------------------------------

describe("buffs on the journey", () => {
  it("an edge grants as it is crossed, a completion rule as the visit completes", () => {
    let journey = startJourney(GRAPH);
    expect(journey).not.toHaveProperty("buffs");
    journey = go(finish(journey), "camp-to-spring");
    expect(journey.buffs).toEqual([{ id: "fleet-step", stacks: 1, encountersLeft: 1, grantedAt: { node: "camp", visit: 1 } }]);
    journey = finish(journey);
    expect(ids(journey.buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge"]);
    expect(journey.buffs![1]!.grantedAt).toEqual({ node: "spring", visit: 1 });
  });

  it("a rift action's own effects (#197) grant too — on the visit the party acts at, without moving it", () => {
    const campaign = spring();
    campaign.graph!.edges["camp-to-den"]!.rift = {
      opensWhen: { visited: "den" },
      actions: { open: { label: "Touch the humming stone", effects: [{ type: "grantBuff", buff: "rift-surge" }] } },
    };
    const graph = parsed(campaign);
    const atCamp = completed(
      completeVisit(graph, startJourney(graph), { node: "camp", visit: 1, chapterId: "rb-camp", outcome: "success", flags: {} }),
    );
    expect(journeyView(graph, atCamp).riftActions?.map((a) => a.action)).toEqual(["open"]);
    const acted = takeRiftAction(graph, atCamp, { action: "open", edge: "camp-to-den", visit: atCamp.visit });
    if (!acted.ok || acted.duplicate) throw new Error("the action was refused");
    expect(acted.journey.buffs).toEqual([{ id: "rift-surge", stacks: 1, encountersLeft: 1, grantedAt: { node: "camp", visit: 1 } }]);
    expect(acted.journey).toMatchObject({ node: "camp", visit: 1, status: "choosing" });
    // The same action reported again is the same action: nothing granted twice.
    const again = takeRiftAction(graph, acted.journey, { action: "open", edge: "camp-to-den", visit: atCamp.visit });
    expect(again).toEqual({ ok: true, duplicate: true, journey: acted.journey });
    // And an action naming a buff nobody declared is refused at load, like any effect.
    campaign.graph!.edges["camp-to-den"]!.rift!.actions!.open!.effects = [{ type: "grantBuff", buff: "rift-wings" }];
    expect(parseCampaignGraph(campaign).problems.map((p) => p.path)).toEqual([
      "/graph/edges/camp-to-den/rift/actions/open/effects/0/buff",
    ]);
  });

  it("travel ends travel buffs before the edge's own effects — so a crossing's grant survives it", () => {
    let journey = go(finish(startJourney(GRAPH)), "camp-to-spring");
    journey = go(finish(journey), "spring-to-den");
    expect(ids(journey.buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge", "rift-fury", "rift-fray"]);
    // The next crossing is travel: fury and frayed nerves end, the rest stay.
    journey = go(finish(journey), "den-to-camp");
    expect(ids(journey.buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge"]);
  });

  it("completion reads back what the run's fights left — the flags' carry rule", () => {
    let journey = go(finish(startJourney(GRAPH)), "camp-to-spring");
    journey = finish(journey);
    journey = go(journey, "spring-to-den");
    const run = seedRunBuffs(DEFS, journey.buffs);
    // The den's fight spent one fight of everything.
    const after = finish(journey, "success", spendRunBuffs(run, "victory"));
    expect(after.buffs).toEqual([{ id: "rift-shield", stacks: 1, encountersLeft: 1, grantedAt: { node: "spring", visit: 1 } }]);
    // Spent to nothing: the key goes, and the journey is the shape it was.
    const empty = finish(go(go(after, "den-to-camp"), "camp-to-den"), "success", []);
    expect(empty).not.toHaveProperty("buffs");
  });

  it("a run without buffs (a build before #200) leaves the journey's as they were", () => {
    const journey = finish(go(finish(startJourney(GRAPH)), "camp-to-spring"));
    const replay = go(go(journey, "spring-to-camp"), "camp-to-spring");
    const again = finish(replay);
    expect(ids(again.buffs)).toEqual(ids(journey.buffs));
  });

  it("a second report of the same completion grants and spends nothing", () => {
    const journey = go(finish(startJourney(GRAPH)), "camp-to-spring");
    const report = {
      node: journey.node,
      visit: journey.visit,
      chapterId: journey.chapter,
      outcome: "success" as const,
      flags: {},
      buffs: seedRunBuffs(DEFS, journey.buffs),
    };
    const first = completed(completeVisit(GRAPH, journey, report));
    const second = completeVisit(GRAPH, first, { ...report, buffs: [] });
    expect(second).toEqual({ ok: true, duplicate: true, journey: first });
    expect(ids(first.buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge"]);
  });

  it("re-granting on a replay stacks surge (to its max) and refreshes the shield", () => {
    let journey = finish(go(finish(startJourney(GRAPH)), "camp-to-spring"));
    // Replays with no fight in them: nothing spent, so each grant lands on
    // the buff still held.
    for (let i = 0; i < 3; i++) {
      journey = go(go(journey, "spring-to-camp"), "camp-to-spring");
      journey = finish(journey, "success", seedRunBuffs(DEFS, journey.buffs));
    }
    const held = (j: JourneyState, id: string) => j.buffs!.find((b) => b.id === id)!;
    expect(held(journey, "rift-shield")).toMatchObject({ stacks: 1, encountersLeft: 2 });
    expect(held(journey, "rift-surge")).toMatchObject({ stacks: 2, encountersLeft: 1 });
    // A replay whose fight spent the surge grants a fresh one: one stack again.
    journey = go(go(journey, "spring-to-camp"), "camp-to-spring");
    journey = finish(journey, "success", spendRunBuffs(seedRunBuffs(DEFS, journey.buffs), "victory"));
    expect(held(journey, "rift-surge")).toMatchObject({ stacks: 1, encountersLeft: 1 });
    expect(held(journey, "rift-shield")).toMatchObject({ stacks: 1, encountersLeft: 2 });
  });

  it("the view shows what each adds and for how long, negative for a burden", () => {
    let journey = go(finish(startJourney(GRAPH)), "camp-to-spring");
    journey = go(finish(journey), "spring-to-den");
    const view = journeyView(GRAPH, journey);
    expect(view.buffs).toEqual([
      { id: "fleet-step", label: "Fleet Step", kind: "move", amount: 1, stacks: 1, target: "party", remaining: { encounters: 1 }, expiresOn: ["rest"] },
      { id: "rift-shield", label: "Rift Shield", kind: "guard", amount: 1, stacks: 1, target: "party", remaining: { encounters: 2 }, expiresOn: ["defeat"] },
      { id: "rift-surge", label: "Rift Surge", kind: "damage", amount: 1, stacks: 1, target: "one", remaining: { encounters: 1, turns: 2 } },
      { id: "rift-fury", label: "Rift Fury", kind: "roll", amount: 2, stacks: 1, target: "party", remaining: { encounters: 1 }, expiresOn: ["travel", "setback"] },
      { id: "rift-fray", label: "Frayed Nerves", kind: "guard", amount: -1, stacks: 1, target: "party", remaining: { encounters: 1 }, expiresOn: ["travel", "setback"] },
    ]);
    expect(journeyView(GRAPH, startJourney(GRAPH))).not.toHaveProperty("buffs");
  });

  it("reads a stored list through the declaration: junk dropped, unknown ids carried untouched", () => {
    const stored = [
      { id: "rift-shield", stacks: 1, encountersLeft: 2 },
      { id: "rift-surge", stacks: 9, encountersLeft: 1 },
      { id: "old-boon", stacks: 1, encountersLeft: 3 },
      { id: "rift-fury", stacks: 0, encountersLeft: 1 },
      { stacks: 1, encountersLeft: 1 },
      "nonsense",
    ];
    expect(ids(storedBuffs(stored))).toEqual(["rift-shield", "rift-surge", "old-boon"]);
    expect(storedBuffs("not a list")).toEqual([]);
    const seeded = seedRunBuffs(DEFS, stored);
    expect(ids(seeded)).toEqual(["rift-shield", "rift-surge"]);
    expect(seeded[1]!.stacks).toBe(2); // held to maxStacks
    const back = readBackBuffs(DEFS, stored, spendRunBuffs(seeded, "victory"));
    expect(back).toEqual([
      { id: "rift-shield", stacks: 1, encountersLeft: 1 },
      { id: "old-boon", stacks: 1, encountersLeft: 3 },
    ]);
    expect(expireBuffs(DEFS, back, "travel")).toEqual(back);
  });

  it("never writes the declaration or the parsed graph", () => {
    const campaign = spring();
    const graph = parsed(campaign);
    const before = JSON.stringify([campaign, graph]);
    let journey = go(finish(startJourney(graph)), "camp-to-spring");
    journey = finish(journey);
    seedRunBuffs(graph.buffs, journey.buffs)[0]!.label = "scribbled";
    journeyView(graph, journey).buffs![0]!.label = "scribbled";
    expect(JSON.stringify([campaign, graph])).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The run: spent by fights, ended by rest, setback, defeat
// ---------------------------------------------------------------------------

describe("the run's buffs", () => {
  const all = (): RunBuff[] =>
    seedRunBuffs(DEFS, ["rift-shield", "rift-surge", "rift-fury", "rift-fray", "fleet-step"].map((id) => ({
      id,
      stacks: 1,
      encountersLeft: id === "rift-shield" ? 2 : 1,
    })));

  it("a won fight spends one fight of each: the one-fight buffs go, the shield has one left", () => {
    const after = spendRunBuffs(all(), "victory");
    expect(after.map((b) => [b.id, b.encountersLeft])).toEqual([["rift-shield", 1]]);
    expect(ids(spendRunBuffs(after, "victory"))).toEqual([]);
  });

  it("a lost fight also ends what ends on defeat", () => {
    const shieldOnly = all().filter((b) => b.id === "rift-shield");
    expect(spendRunBuffs(shieldOnly, "defeat")).toEqual([]);
    expect(spendRunBuffs(shieldOnly, "ongoing")).toHaveLength(1);
  });

  it("rest and setback end only what says so", () => {
    expect(ids(expireRunBuffs(all(), "rest"))).toEqual(["rift-shield", "rift-surge", "rift-fury", "rift-fray"]);
    expect(ids(expireRunBuffs(all(), "setback"))).toEqual(["rift-shield", "rift-surge", "fleet-step"]);
  });

  it("a fight's buffs: party ones on every hero, a 'one' buff on the story-turn seat", () => {
    const heroes = ["c_a", "c_b", "c_c"];
    expect(oneHeroSeat(4, 3)).toBe(1);
    expect(oneHeroSeat(undefined, 3)).toBe(0);
    expect(oneHeroSeat(-1, 3)).toBe(2);
    const fight = combatBuffsFor(all(), heroes, heroes[oneHeroSeat(4, 3)]!);
    const on = (id: string) => fight.filter((b) => b.id === id).map((b) => b.heroId);
    expect(on("rift-shield")).toEqual(heroes);
    expect(on("rift-surge")).toEqual(["c_b"]);
    expect(fight.find((b) => b.id === "rift-surge")).toMatchObject({ amount: 1, turnsLeft: 2 });
    expect(fight.find((b) => b.id === "rift-fray")).toMatchObject({ amount: -1 });
    expect(combatBuffsFor(all(), heroes, "nobody").some((b) => b.id === "rift-surge")).toBe(false);
  });

  it("a turn-limited buff loses a turn as its holder's turn ends, and comes off after its last", () => {
    const fight: CombatBuff[] = [
      { id: "s", label: "S", kind: "damage", heroId: "a", amount: 1, turnsLeft: 2 },
      { id: "g", label: "G", kind: "guard", heroId: "a", amount: 1 },
      { id: "s", label: "S", kind: "damage", heroId: "b", amount: 1, turnsLeft: 2 },
    ];
    const once = tickCombatBuffs(fight, "a");
    expect(once.map((b) => [b.heroId, b.id, b.turnsLeft])).toEqual([["a", "s", 1], ["a", "g", undefined], ["b", "s", 2]]);
    const twice = tickCombatBuffs(once, "a");
    expect(twice.map((b) => [b.heroId, b.id])).toEqual([["a", "g"], ["b", "s"]]);
    expect(tickCombatBuffs(twice, "enemy#1")).toBe(twice);
  });
});

// ---------------------------------------------------------------------------
// Inside a fight
// ---------------------------------------------------------------------------

const RULES = makeRules();
const ITEMS = makeItems();
const ALWAYS: (die: number) => Rng = (die) => ({ next: () => (die - 1) / 20 + 0.001 });

function hero(id: string, stats = { might: 1, quick: 1, clever: 1, heart: 1 }) {
  return resolveCharacter(makeCharacter({ id, name: id, species: "unicorn", class: "thornguard", stats }), RULES, ITEMS);
}

function setup(buffs?: CombatBuff[]): EncounterSetup {
  return {
    board: parseBoard(Array.from({ length: 5 }, () => ".".repeat(8))),
    party: [{ character: hero("c_a", { might: 3, quick: 3, clever: 0, heart: 0 }), at: { x: 0, y: 2 } }],
    enemies: [
      { spec: { id: "wisp", count: 1, hp: 30, guard: 12, quick: 0, steps: 4, attack: 2 }, at: { x: 1, y: 2 } },
    ],
    ...(buffs ? { buffs } : {}),
  };
}

const ctxOf = (rng: Rng) => ({ rules: RULES, abilities: {} as AbilityCatalog, rng });

function swing(state: EncounterState, rng: Rng) {
  const result = performAction(state, ctxOf(rng), { abilityId: "attack", targetId: "wisp#1" });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("buffs in a fight", () => {
  it("a fight without buffs has no buffs key, and the same seed plays the same fight with an empty list", () => {
    const plain = beginEncounter(setup(), ctxOf(makeRng("same")));
    const empty = beginEncounter(setup([]), ctxOf(makeRng("same")));
    expect(plain).not.toHaveProperty("buffs");
    expect(empty).toEqual(plain);
  });

  it("roll: the attack roll's modifier; damage: what a hit takes off", () => {
    const buffs: CombatBuff[] = [
      { id: "fury", label: "Fury", kind: "roll", heroId: "c_a", amount: 2 },
      { id: "surge", label: "Surge", kind: "damage", heroId: "c_a", amount: 1 },
    ];
    const plain = swing(beginEncounter(setup(), ctxOf(ALWAYS(10))), ALWAYS(10));
    const buffed = swing(beginEncounter(setup(buffs), ctxOf(ALWAYS(10))), ALWAYS(10));
    const roll = (r: typeof plain) => r.events.find((e) => e.type === "roll")!;
    const dealt = (r: typeof plain) => r.events.find((e) => e.type === "damage");
    expect(roll(plain)).toMatchObject({ roll: { die: 10, mod: 3, total: 13, result: "hit" } });
    expect(roll(buffed)).toMatchObject({ roll: { die: 10, mod: 5, total: 15, result: "hit" } });
    expect(dealt(plain)).toMatchObject({ amount: 3 });
    expect(dealt(buffed)).toMatchObject({ amount: 4 });
  });

  it("a burden never makes a hit do nothing", () => {
    const fray: CombatBuff[] = [{ id: "fray", label: "Fray", kind: "damage", heroId: "c_a", amount: -2 }];
    const result = swing(beginEncounter(setup(fray), ctxOf(ALWAYS(20))), ALWAYS(20));
    expect(result.events.find((e) => e.type === "damage")).toMatchObject({ amount: 1 });
  });

  it("guard: the number an attack on the hero has to reach", () => {
    const shield: CombatBuff[] = [{ id: "shield", label: "Shield", kind: "guard", heroId: "c_a", amount: 2 }];
    // Hand the clock to the wisp and let it swing at the hero.
    const wispTurn = (state: EncounterState) => {
      let s = state;
      while (currentActorId(s) !== "wisp#1") s = endTurn(s);
      return performAction(s, ctxOf(ALWAYS(10)), { abilityId: "attack", targetId: "c_a" });
    };
    const plain = wispTurn(beginEncounter(setup(), ctxOf(ALWAYS(10))));
    const shielded = wispTurn(beginEncounter(setup(shield), ctxOf(ALWAYS(10))));
    if (!plain.ok || !shielded.ok) throw new Error("refused");
    const tn = (r: typeof plain) => (r.events.find((e) => e.type === "roll") as { roll: { tn: number } }).roll.tn;
    expect(tn(shielded)).toBe(tn(plain) + 2);
    // The combatant itself is what it would have been: the buff is an overlay.
    expect(combatantById(shielded.state, "c_a")!.guard).toBe(combatantById(plain.state, "c_a")!.guard);
  });

  it("move: steps at the start of the hero's turn, never below one", () => {
    const fleet = beginEncounter(setup([{ id: "f", label: "F", kind: "move", heroId: "c_a", amount: 2 }]), ctxOf(ALWAYS(20)));
    const plain = beginEncounter(setup(), ctxOf(ALWAYS(20)));
    expect(currentActorId(plain)).toBe("c_a");
    expect(fleet.stepsLeft).toBe(plain.stepsLeft + 2);
    const slow = beginEncounter(setup([{ id: "m", label: "M", kind: "move", heroId: "c_a", amount: -2 }, { id: "n", label: "N", kind: "move", heroId: "c_a", amount: -2 }]), ctxOf(ALWAYS(20)));
    expect(slow.stepsLeft).toBe(Math.max(1, plain.stepsLeft - 2));
  });

  it("turns: the buff covers the holder's first N turns, then comes off — and a monster's turn does not count", () => {
    const surge: CombatBuff[] = [{ id: "surge", label: "Surge", kind: "damage", heroId: "c_a", amount: 1, turnsLeft: 2 }];
    let state = beginEncounter(setup(surge), ctxOf(ALWAYS(20)));
    expect(currentActorId(state)).toBe("c_a");
    state = endTurn(state); // the hero's first turn ends
    expect(state.buffs).toEqual([{ ...surge[0]!, turnsLeft: 1 }]);
    state = endTurn(state); // the wisp's turn ends: nothing changes
    expect(state.buffs).toEqual([{ ...surge[0]!, turnsLeft: 1 }]);
    expect(currentActorId(state)).toBe("c_a");
    state = endTurn(state); // the hero's second turn ends
    expect(state.buffs).toEqual([]);
    expect(buffBonus(state.buffs, "c_a", "damage")).toBe(0);
  });

  it("survives a save mid-fight: the fight resumes with its own buffs as they were", () => {
    const surge: CombatBuff[] = [{ id: "surge", label: "Surge", kind: "damage", heroId: "c_a", amount: 1, turnsLeft: 2 }];
    const midway = endTurn(beginEncounter(setup(surge), ctxOf(ALWAYS(20))));
    const resumed = JSON.parse(JSON.stringify(midway)) as EncounterState;
    expect(resumed).toEqual(midway);
    expect(endTurn(resumed)).toEqual(endTurn(midway));
  });
});

// ---------------------------------------------------------------------------
// Through the engine: seeded, spent, ended, never written to a character
// ---------------------------------------------------------------------------

const MAP = makeMap();

function engineCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    rules: RULES,
    items: ITEMS,
    chapter: makeChapter(),
    map: (id) => (id === MAP.id ? MAP : null),
    abilities: {},
    rng: makeRng("buffs"),
    now: "2026-07-28T12:00:00.000Z",
    householdId: "h_1",
    playtest: true,
    ...overrides,
  };
}

const CREATE = (name: string): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: APPEARANCE,
});

function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext): RunState {
  const result = applyIntent(state, { playerId, intent }, ctx);
  if (result.error) throw new Error(`${intent.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function readyParty(ctx: EngineContext): RunState {
  let state = createRunState({ runId: "r_1", roomCode: "ABCD", mode: "travel", now: "2026-07-28T11:00:00.000Z" });
  state = must(state, "p_1", CREATE("Pip"), ctx);
  state = must(state, "p_2", CREATE("Wren"), ctx);
  state = must(state, "p_1", { type: "READY", ready: true }, ctx);
  return must(state, "p_2", { type: "READY", ready: true }, ctx);
}

/** Warps to the fixture chapter's fight and readies everybody so it begins. */
function intoTheFight(state: RunState, ctx: EngineContext): RunState {
  let s = must(state, "p_1", { type: "PLAYTEST_GOTO", sceneId: "encounter_wisps" }, ctx);
  s = must(s, "p_1", { type: "READY", ready: true }, ctx);
  return must(s, "p_2", { type: "READY", ready: true }, ctx);
}

describe("buffs through the engine", () => {
  const seed = (): RunBuff[] =>
    seedRunBuffs(DEFS, [
      { id: "rift-shield", stacks: 1, encountersLeft: 2 },
      { id: "rift-surge", stacks: 2, encountersLeft: 1 },
      { id: "fleet-step", stacks: 1, encountersLeft: 1 },
    ]);

  it("a chapter start seeds the run — replacing, never appending — and a start without them clears it", () => {
    const ctx = engineCtx({ campaignBuffs: seed() });
    const started = must(readyParty(ctx), "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx);
    expect(started.buffs).toEqual(seed());
    const ordered = must(readyParty(engineCtx()), "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, engineCtx());
    expect(ordered).not.toHaveProperty("buffs");
    // A room that played a graph chapter and then starts another without buffs carries none.
    const lobby = { ...started, phase: "lobby" as const, party: started.party.map((m) => ({ ...m, ready: true })) };
    expect(must(lobby, "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, engineCtx())).not.toHaveProperty("buffs");
    // And re-seeding the same journey's buffs gives the same list, not two of each.
    expect(must(lobby, "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx).buffs).toEqual(seed());
  });

  it("a fight gets the run's buffs on the heroes they target; leaving it spends one fight of each", () => {
    const ctx = engineCtx({ campaignBuffs: seed() });
    const started = must(readyParty(ctx), "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx);
    const fighting = intoTheFight(started, ctx);
    const heroes = fighting.party.map((m) => m.character.id);
    const buffs = fighting.encounter!.buffs!;
    expect(buffs.filter((b) => b.id === "rift-shield").map((b) => b.heroId)).toEqual(heroes);
    expect(buffs.filter((b) => b.id === "rift-surge").map((b) => [b.heroId, b.amount, b.turnsLeft])).toEqual([
      [heroes[oneHeroSeat(fighting.storyTurn, heroes.length)], 2, 2],
    ]);
    // The run's list does not move while the fight is on.
    expect(fighting.buffs).toEqual(started.buffs);
    const out = must(fighting, "p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ridge" }, ctx);
    expect(out.encounter).toBeNull();
    expect(out.buffs!.map((b) => [b.id, b.encountersLeft])).toEqual([["rift-shield", 1]]);
  });

  it("a rest scene ends rest buffs; a setback ends setback buffs", () => {
    const ctx = engineCtx({
      campaignBuffs: seedRunBuffs(DEFS, [
        { id: "fleet-step", stacks: 1, encountersLeft: 1 },
        { id: "rift-fury", stacks: 1, encountersLeft: 1 },
        { id: "rift-shield", stacks: 1, encountersLeft: 2 },
      ]),
    });
    const started = must(readyParty(ctx), "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx);
    const rested = must(started, "p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_camp" }, ctx);
    expect(ids(rested.buffs)).toEqual(["rift-fury", "rift-shield"]);

    const chapter: Chapter = makeChapter();
    chapter.scenes["scene_ending"] = { type: "story", narration: "It went badly.", choices: [], outcome: "setback" };
    const setbackCtx = { ...ctx, chapter };
    const ended = must(rested, "p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ending" }, setbackCtx);
    expect(ended.chapterOutcome).toBe("setback");
    expect(ids(ended.buffs)).toEqual(["rift-shield"]);
  });

  it("a lost fight ends what ends on defeat, and spends the rest", () => {
    const ctx = engineCtx({ campaignBuffs: seed() });
    let state = intoTheFight(must(readyParty(ctx), "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx), ctx);
    // Make the wisps unbeatable and the party pass every turn until it falls.
    for (let guard = 0; guard < 200 && state.encounter; guard++) {
      const actor = state.encounter.combatants.find((c) => c.id === currentActorId(state.encounter!));
      const member = state.party.find((m) => m.character.id === actor?.id);
      if (!member) break;
      state = must(state, member.playerId, { type: "END_TURN" }, ctx);
    }
    expect(state.encounter).toBeNull();
    expect(state.buffs).toEqual([]);
  });

  it("never writes a buff to a character: the party after a buffed fight resolves exactly as before", () => {
    const ctx = engineCtx({ campaignBuffs: seed() });
    const started = must(readyParty(ctx), "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx);
    const before = structuredClone(started.party.map((m) => m.character));
    const fighting = intoTheFight(started, ctx);
    for (const member of fighting.party) {
      const combatant = combatantById(fighting.encounter!, member.character.id)!;
      expect(combatant.guard).toBe(member.character.guard);
      expect(combatant.steps).toBe(member.character.steps);
    }
    const out = must(fighting, "p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ending" }, ctx);
    expect(out.phase).toBe("chapter_complete");
    expect(out.party.map((m) => m.character)).toEqual(before);
  });
});
