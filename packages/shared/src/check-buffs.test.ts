/**
 * Story-check buffs (#222): a `"roll"` buff that opts in to a chapter `Check`
 * instead of attacks, is counted in uses, may be offered to the roller first,
 * ends with the next chapter played, and may be granted on an edge's first
 * crossing only.
 *
 * Most cases play The Glowing Falls (fixtures/rift-spark.campaign.json), which
 * declares the Riftspark the Continental Rift design agreed. The last block is
 * the other half of the contract: a check with no check buff — every ordered
 * campaign's, and every graph one's holding only attack buffs — rolls exactly
 * what it always did, and an attack buff still never touches a check.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCampaignGraph, type ParsedCampaignGraph } from "./campaign-graph.js";
import { lintCampaignGraph } from "./campaign-graph-lint.js";
import {
  buffViews,
  checkBuffOffer,
  combatBuffsFor,
  grantBuff,
  readBackBuffs,
  seedRunBuffs,
  spendCheckBuff,
  spendRunBuffs,
  storedBuffs,
} from "./buffs.js";
import { completeVisit, startJourney, takeExit, type ExitCrossing, type JourneyRefusal, type VisitCompletion } from "./journey.js";
import { applyIntent, createRunState, type EngineContext } from "./engine.js";
import { makeRng, resolveCheck } from "./dice.js";
import { APPEARANCE, makeChapter, makeItems, makeMap, makeRules } from "./test-fixtures.js";
import type { BuffDef, RunBuff } from "./types/buffs.js";
import type { Campaign, Chapter, ChapterOutcome } from "./types/chapter.js";
import type { JourneyState } from "./types/campaign-graph.js";
import type { ClientIntent } from "./types/protocol.js";
import type { DiceRoll, RunState } from "./types/state.js";

const read = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));

/** A fresh copy each time, so a test that bends it bends only its own. */
function falls(): Campaign {
  return read(new URL("./fixtures/rift-spark.campaign.json", import.meta.url)) as Campaign;
}

function parsed(campaign: Campaign = falls()): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(campaign);
  expect(problems).toEqual([]);
  return graph!;
}

function problemsAfter(bend: (campaign: Campaign) => void): string[] {
  const campaign = falls();
  bend(campaign);
  const { graph, problems } = parseCampaignGraph(campaign);
  if (problems.length > 0) expect(graph).toBeNull();
  return problems.map(({ path, problem }) => `${path}: ${problem}`);
}

const GRAPH = parsed();
const DEFS = GRAPH.buffs;
const SPARK = (bend: (def: BuffDef) => void = () => undefined) => (campaign: Campaign) => bend(campaign.graph!.buffs!["riftspark"]!);

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

/** Takes an exit, finishing the visit first when there is one to finish (a pass revisit has none). */
function go(journey: JourneyState, edge: string): JourneyState {
  const ready = journey.status === "playing" ? finish(journey) : journey;
  return crossed(takeExit(GRAPH, ready, { edge, visit: ready.visit }));
}

const ids = (buffs: readonly { id: string }[] | undefined): string[] => (buffs ?? []).map((b) => b.id);

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

describe("declaring a story-check buff", () => {
  it("parses the Riftspark, resolves it for the run, and the lint has nothing to say", () => {
    expect(DEFS["riftspark"]).toMatchObject({ kind: "roll", appliesTo: "check", spend: "choose", duration: { scope: "uses", count: 1 } });
    expect(seedRunBuffs(DEFS, [{ id: "riftspark", stacks: 1, encountersLeft: 1, usesLeft: 1 }])).toEqual([
      {
        id: "riftspark",
        stacks: 1,
        encountersLeft: 1,
        usesLeft: 1,
        label: "Riftspark",
        kind: "roll",
        amount: 2,
        target: "party",
        expiresOn: ["chapter"],
        appliesTo: "check",
        spend: "choose",
      },
    ]);
    expect(lintCampaignGraph(GRAPH).findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("is opt-in per buff: appliesTo attack is today's roll buff, and spend defaults to auto", () => {
    expect(problemsAfter(SPARK((d) => delete d.spend))).toEqual([]);
    const auto = parsed((() => {
      const c = falls();
      delete c.graph!.buffs!["riftspark"]!.spend;
      return c;
    })());
    expect(seedRunBuffs(auto.buffs, [{ id: "riftspark", stacks: 1, encountersLeft: 1, usesLeft: 1 }])[0]!.spend).toBe("auto");
    expect(
      problemsAfter(
        SPARK((d) => {
          d.appliesTo = "attack";
          delete d.spend;
          d.duration = { scope: "encounter" };
        }),
      ),
    ).toEqual([]);
  });

  it("refuses what a check buff cannot be", () => {
    expect(problemsAfter(SPARK((d) => (d.kind = "guard")))).toEqual([
      '/graph/buffs/riftspark/appliesTo: appliesTo means something only on a "roll" buff',
    ]);
    expect(problemsAfter(SPARK((d) => ((d as { appliesTo: string }).appliesTo = "both")))).toEqual([
      '/graph/buffs/riftspark/appliesTo: appliesTo "both" is not "attack" or "check"',
      '/graph/buffs/riftspark/spend: spend means something only with "appliesTo": "check"',
      '/graph/buffs/riftspark/duration/scope: "uses" counts story checks, so it needs "appliesTo": "check"',
    ]);
    expect(problemsAfter(SPARK((d) => (d.duration = { scope: "encounters", count: 2 })))).toEqual([
      '/graph/buffs/riftspark/duration/scope: a "check" buff lasts a number of checks: its duration is { "scope": "uses", "count": n }',
    ]);
    expect(problemsAfter(SPARK((d) => (d.duration = { scope: "uses", count: 9 })))).toEqual([
      "/graph/buffs/riftspark/duration/count: count must be a whole number from 1 to 5",
    ]);
    expect(problemsAfter(SPARK((d) => (d.target = "one")))).toEqual([
      '/graph/buffs/riftspark/target: a "check" buff is the party\'s: whoever is about to roll may spend it, so it takes no "one" target',
    ]);
    expect(problemsAfter(SPARK((d) => (d.amount = -1)))).toEqual([
      '/graph/buffs/riftspark/spend: a burden is never chosen: a "check" buff with a negative amount is spent "auto"',
    ]);
    expect(problemsAfter(SPARK((d) => ((d as { spend: string }).spend = "later")))).toEqual([
      '/graph/buffs/riftspark/spend: spend "later" is not "auto" or "choose"',
    ]);
  });

  it("refuses uses and spend on an attack buff", () => {
    expect(
      problemsAfter(
        SPARK((d) => {
          delete d.appliesTo;
        }),
      ),
    ).toEqual([
      '/graph/buffs/riftspark/spend: spend means something only with "appliesTo": "check"',
      '/graph/buffs/riftspark/duration/scope: "uses" counts story checks, so it needs "appliesTo": "check"',
    ]);
  });

  it("refuses firstCrossing anywhere but an edge's own effects, and as anything but true", () => {
    expect(
      problemsAfter((c) => {
        c.graph!.nodes["grove"]!.onComplete = [{ effects: [{ type: "grantBuff", buff: "riftspark", firstCrossing: true }] }];
      }),
    ).toEqual([
      "/graph/nodes/grove/onComplete/0/effects/0/firstCrossing: firstCrossing means something only in an edge's own effects: nothing is being crossed here",
    ]);
    expect(
      problemsAfter((c) => {
        (c.graph!.edges["camp-to-grove"]!.effects![0] as { firstCrossing: unknown }).firstCrossing = false;
      }),
    ).toEqual(["/graph/edges/camp-to-grove/effects/0/firstCrossing: firstCrossing is true, or left out"]);
  });
});

// ---------------------------------------------------------------------------
// The journey: first crossing only, at most one, gone with the next chapter
// ---------------------------------------------------------------------------

describe("the Riftspark on the journey", () => {
  const SPARKED = { id: "riftspark", stacks: 1, encountersLeft: 1, usesLeft: 1 };

  it("crossing the rift for the first time grants it", () => {
    const journey = go(startJourney(GRAPH), "camp-to-falls");
    expect(journey.buffs).toEqual([{ ...SPARKED, grantedAt: { node: "camp", visit: 1 } }]);
    expect(buffViews(DEFS, journey.buffs)).toEqual([
      {
        id: "riftspark",
        label: "Riftspark",
        kind: "roll",
        amount: 2,
        stacks: 1,
        target: "party",
        remaining: { encounters: 1, uses: 1 },
        expiresOn: ["chapter"],
        appliesTo: "check",
        spend: "choose",
      },
    ]);
  });

  it("re-crossing the rift grants nothing — by the other mouth or the same one", () => {
    // Spark spent during the falls' chapter, then back through the other mouth.
    let journey = go(startJourney(GRAPH), "camp-to-falls");
    journey = finish(journey, "success", []);
    expect(journey).not.toHaveProperty("buffs");
    journey = go(journey, "falls-to-camp");
    expect(journey).not.toHaveProperty("buffs");
    // And through the first mouth again: still nothing.
    journey = go(journey, "camp-to-falls");
    expect(journey).not.toHaveProperty("buffs");
  });

  it("a plain edge's first crossing grants, and its second does not", () => {
    let journey = go(startJourney(GRAPH), "camp-to-grove");
    expect(ids(journey.buffs)).toEqual(["riftspark"]);
    journey = finish(journey, "success", []);
    journey = go(go(journey, "grove-to-camp"), "camp-to-grove");
    expect(journey).not.toHaveProperty("buffs");
  });

  it("holds at most one: a new crossing while holding one grants nothing", () => {
    let journey = go(startJourney(GRAPH), "camp-to-grove");
    const held = journey.buffs;
    // Back to camp (a pass revisit, no chapter played) and through the rift:
    // its first crossing, but the party already holds a spark.
    journey = go(go(journey, "grove-to-camp"), "camp-to-falls");
    expect(journey.buffs).toEqual(held);
    expect(grantBuff(storedBuffs(held), "riftspark", DEFS["riftspark"]!)).toEqual(held);
  });

  it("is gone at the end of the next chapter played, spent or not", () => {
    const journey = go(startJourney(GRAPH), "camp-to-falls");
    // The run the falls' chapter plays ends it (`expiresOn: ["chapter"]`,
    // through the engine below); the journey reads that back.
    const after = finish(journey, "success", []);
    expect(after).not.toHaveProperty("buffs");
    // A run started before #222 (no buffs) leaves it be — never invents an expiry.
    expect(readBackBuffs(DEFS, journey.buffs, undefined)).toEqual(storedBuffs(journey.buffs));
  });

  it("a visit that plays no chapter keeps it: it waits for the next chapter played", () => {
    // The way back to camp sparks too, here, and the camp is a pass revisit.
    const campaign = falls();
    campaign.graph!.edges["grove-to-camp"]!.effects = [{ type: "grantBuff", buff: "riftspark", firstCrossing: true }];
    const graph = parsed(campaign);
    const step = (journey: JourneyState, edge: string): JourneyState => {
      const ready =
        journey.status === "playing"
          ? completed(completeVisit(graph, journey, { node: journey.node, visit: journey.visit, chapterId: journey.chapter, outcome: "success", flags: {}, buffs: [] }))
          : journey;
      return crossed(takeExit(graph, ready, { edge, visit: ready.visit }));
    };
    let journey = step(startJourney(graph), "camp-to-grove");
    journey = step(journey, "grove-to-camp"); // the grove's run spent its spark; the way back grants one
    expect(journey).toMatchObject({ node: "camp", status: "choosing" });
    expect(ids(journey.buffs)).toEqual(["riftspark"]);
    // Through the rift: its first crossing, but one is held — and the one
    // held is still there as the falls' chapter begins.
    journey = step(journey, "camp-to-falls");
    expect(journey).toMatchObject({ node: "falls", status: "playing" });
    expect(journey.buffs).toEqual([{ id: "riftspark", stacks: 1, encountersLeft: 1, usesLeft: 1, grantedAt: { node: "grove", visit: 1 } }]);
  });

  it("a stored use that is spent is never read back as unspent", () => {
    expect(storedBuffs([{ ...SPARKED, usesLeft: 0 }])).toEqual([]);
    expect(storedBuffs([{ ...SPARKED, usesLeft: 1.5 }])).toEqual([]);
    expect(seedRunBuffs(DEFS, [{ ...SPARKED, usesLeft: 4 }])[0]!.usesLeft).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The run: offered, spent, never in a fight
// ---------------------------------------------------------------------------

describe("the run's story-check buffs", () => {
  const spark = (): RunBuff[] => seedRunBuffs(DEFS, [{ id: "riftspark", stacks: 1, encountersLeft: 1, usesLeft: 1 }]);

  it("offers one per roll, automatic first, and spends one use", () => {
    expect(checkBuffOffer(spark())).toEqual({ id: "riftspark", label: "Riftspark", amount: 2, spend: "choose" });
    const both: RunBuff[] = [
      ...spark(),
      { ...spark()[0]!, id: "steady", label: "Steady", amount: 1, spend: "auto", usesLeft: 2 },
    ];
    expect(checkBuffOffer(both)?.id).toBe("steady");
    expect(spendCheckBuff(both, "steady").map((b) => [b.id, b.usesLeft])).toEqual([
      ["riftspark", 1],
      ["steady", 1],
    ]);
    expect(spendCheckBuff(both, "riftspark").map((b) => b.id)).toEqual(["steady"]);
    expect(checkBuffOffer(undefined)).toBeNull();
    expect(checkBuffOffer([])).toBeNull();
  });

  it("never enters a fight, and a fight never spends it — unless it ends on defeat", () => {
    expect(combatBuffsFor(spark(), ["c_a", "c_b"], "c_a")).toEqual([]);
    expect(spendRunBuffs(spark(), "victory")).toEqual(spark());
    expect(spendRunBuffs([{ ...spark()[0]!, expiresOn: ["defeat"] }], "defeat")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through the engine
// ---------------------------------------------------------------------------

const MAP = makeMap();

function engineCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    rules: makeRules(),
    items: makeItems(),
    chapter: makeChapter(),
    map: (id) => (id === MAP.id ? MAP : null),
    abilities: {},
    rng: makeRng("check-buffs"),
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

function attempt(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext) {
  return applyIntent(state, { playerId, intent }, ctx);
}

function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext): RunState {
  const result = attempt(state, playerId, intent, ctx);
  if (result.error) throw new Error(`${intent.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Two heroes, a chapter started with `campaignBuffs`, and the squeeze check open. */
function atTheCheck(ctx: EngineContext): RunState {
  let state = createRunState({ runId: "r_1", roomCode: "ABCD", mode: "travel", now: "2026-07-28T11:00:00.000Z" });
  state = must(state, "p_1", CREATE("Pip"), ctx);
  state = must(state, "p_2", CREATE("Wren"), ctx);
  state = must(state, "p_1", { type: "READY", ready: true }, ctx);
  state = must(state, "p_2", { type: "READY", ready: true }, ctx);
  state = must(state, "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx);
  return must(state, "p_1", { type: "PLAYTEST_GOTO", sceneId: "check_squeeze" }, ctx);
}

function rollerOf(state: RunState): string {
  const prompt = state.prompt;
  if (prompt?.kind !== "roll") throw new Error("no roll prompt");
  return state.party.find((m) => m.character.id === prompt.characterId)!.playerId;
}

function rolled(state: RunState, ctx: EngineContext, spendBuff?: string): { state: RunState; roll: DiceRoll } {
  const result = attempt(state, rollerOf(state), { type: "ROLL", ...(spendBuff === undefined ? {} : { spendBuff }) }, ctx);
  if (result.error) throw new Error(`ROLL: ${result.error.code} ${result.error.message}`);
  return { state: result.state, roll: result.state.lastRoll! };
}

describe("the Riftspark through the engine", () => {
  const spark = (): RunBuff[] => seedRunBuffs(DEFS, [{ id: "riftspark", stacks: 1, encountersLeft: 1, usesLeft: 1 }]);
  const sparkCtx = () => engineCtx({ campaignBuffs: spark(), rng: makeRng("spark") });

  it("the roller's prompt offers it before the check", () => {
    const state = atTheCheck(sparkCtx());
    expect(state.prompt).toMatchObject({ kind: "roll", buff: { id: "riftspark", label: "Riftspark", amount: 2, spend: "choose" } });
  });

  it("spending adds +2 to the check and uses it up; the die is the one it would have been", () => {
    const spent = rolled(atTheCheck(sparkCtx()), sparkCtx(), "riftspark");
    const saved = rolled(atTheCheck(sparkCtx()), sparkCtx());
    expect(spent.roll.die).toBe(saved.roll.die);
    expect(spent.roll.total).toBe(saved.roll.total + 2);
    expect(spent.roll.buff).toEqual({ id: "riftspark", label: "Riftspark", amount: 2 });
    expect(spent.state.buffs).toEqual([]);
    // Declining keeps it, untouched, for a harder check.
    expect(saved.roll).not.toHaveProperty("buff");
    expect(saved.state.buffs).toEqual(spark());
  });

  it("refuses a spend of something the prompt does not offer, before a die is thrown", () => {
    const state = atTheCheck(sparkCtx());
    const wrong = attempt(state, rollerOf(state), { type: "ROLL", spendBuff: "rift-wings" }, sparkCtx());
    expect(wrong.error?.code).toBe("ILLEGAL");
    expect(wrong.state).toEqual(state);
    const none = atTheCheck(engineCtx());
    const stale = attempt(none, rollerOf(none), { type: "ROLL", spendBuff: "riftspark" }, engineCtx());
    expect(stale.error?.code).toBe("ILLEGAL");
  });

  it('an "auto" buff is spent on the next check without asking', () => {
    const auto = spark().map((b) => ({ ...b, spend: "auto" as const }));
    const ctx = () => engineCtx({ campaignBuffs: auto, rng: makeRng("spark") });
    const state = atTheCheck(ctx());
    expect(state.prompt).toMatchObject({ buff: { spend: "auto" } });
    const { roll, state: after } = rolled(state, ctx());
    expect(roll.buff?.amount).toBe(2);
    expect(after.buffs).toEqual([]);
  });

  it("in a whole-party check, the first roller to spend it has it and the next is offered nothing", () => {
    const chapter: Chapter = makeChapter();
    chapter.scenes["check_squeeze"] = { ...chapter.scenes["check_squeeze"]!, roller: "all" } as Chapter["scenes"][string];
    const ctx = () => engineCtx({ chapter, campaignBuffs: spark(), rng: makeRng("spark") });
    const state = atTheCheck(ctx());
    expect(state.prompt).toMatchObject({ group: { pending: expect.any(Array) }, buff: { id: "riftspark" } });
    const first = rolled(state, ctx(), "riftspark");
    expect(first.roll.buff?.id).toBe("riftspark");
    expect(first.state.prompt?.kind).toBe("roll");
    expect(first.state.prompt).not.toHaveProperty("buff");
    expect(first.state.buffs).toEqual([]);
  });

  it("ends with the chapter, unspent", () => {
    const ctx = sparkCtx();
    const state = atTheCheck(ctx);
    const ended = must(state, "p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ending" }, ctx);
    expect(ended.phase).toBe("chapter_complete");
    expect(ended.buffs).toEqual([]);
  });

  it("is not in the fight, and the fight does not spend it", () => {
    const ctx = sparkCtx();
    let state = atTheCheck(ctx);
    state = must(state, "p_1", { type: "PLAYTEST_GOTO", sceneId: "encounter_wisps" }, ctx);
    state = must(state, "p_1", { type: "READY", ready: true }, ctx);
    state = must(state, "p_2", { type: "READY", ready: true }, ctx);
    expect(state.encounter).not.toBeNull();
    expect(state.encounter).not.toHaveProperty("buffs");
    const out = must(state, "p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ridge" }, ctx);
    expect(out.buffs).toEqual(spark());
  });
});

// ---------------------------------------------------------------------------
// Legacy: a check without a check buff rolls exactly what it always did
// ---------------------------------------------------------------------------

describe("checks without a story-check buff", () => {
  it("an ordered campaign's check prompt and roll keep their shape", () => {
    const state = atTheCheck(engineCtx());
    expect(state.prompt).not.toHaveProperty("buff");
    const { roll, state: after } = rolled(state, engineCtx());
    expect(roll).not.toHaveProperty("buff");
    expect(after).not.toHaveProperty("buffs");
  });

  it("an attack roll buff is not offered on a check, and a check rolls as though it were not held", () => {
    const fury: RunBuff[] = [
      { id: "rift-fury", stacks: 1, encountersLeft: 1, label: "Rift Fury", kind: "roll", amount: 2, target: "party" },
    ];
    const withFury = () => engineCtx({ campaignBuffs: fury, rng: makeRng("legacy") });
    const without = () => engineCtx({ rng: makeRng("legacy") });
    const a = atTheCheck(withFury());
    expect(a.prompt).not.toHaveProperty("buff");
    const buffed = rolled(a, withFury());
    const plain = rolled(atTheCheck(without()), without());
    expect(buffed.roll).toEqual(plain.roll);
    // And it is still the attack buff it was: the fight gets it.
    expect(combatBuffsFor(fury, ["c_a"], "c_a")).toEqual([{ id: "rift-fury", label: "Rift Fury", kind: "roll", heroId: "c_a", amount: 2 }]);
    expect(buffed.state.buffs).toEqual(fury);
  });

  it("a check roll's arithmetic is unchanged when no buff is spent", () => {
    const input = { characterId: "c_a", stat: "quick" as const, mod: 1, tn: 12 };
    const plain = resolveCheck(makeRng("same"), input);
    expect(plain).not.toHaveProperty("buff");
    expect(plain.total).toBe(plain.die + 1);
    const lifted = resolveCheck(makeRng("same"), { ...input, buff: { id: "s", label: "S", amount: 2 } });
    expect(lifted.die).toBe(plain.die);
    expect(lifted.total).toBe(plain.total + 2);
  });
});
