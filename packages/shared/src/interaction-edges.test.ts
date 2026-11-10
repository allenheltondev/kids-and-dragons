/**
 * Mini-game edges (#567, docs/matchups.md "Mini-games"): a hero whose species or
 * class has a matchup edge on a game's tags plays it one step easier (a knack) or
 * harder (a snag). Only the acting hero, at most one of each, fixed for the
 * attempt, and nothing about outcomes, branches, rewards, assist or retry moves.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, enterScene, type EngineContext } from "./engine.js";
import { resolveCharacter } from "./character.js";
import { makeRng } from "./dice.js";
import { makeChapter, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import { interactionEdge } from "./matchups.js";
import { aimWidth, edgePace, edgeScale, playbackMs, playbackOver, relayEdgeScale, type InteractionAction, type InteractionPrompt, type InteractionSpec } from "./interactions.js";
import { relayTarget } from "./relay.js";
import type { ClassId, InteractionScene, MatchupRules, RunState, SpeciesId } from "./index.js";

const now = "2026-11-10T19:00:00.000Z";

/** A small table: dragonlings are strong (+1 force) and smoky (-1 sneak); thornguards are strong too (+2 force). */
const MATCHUPS: MatchupRules = {
  traits: {},
  checkTags: { force: { name: "Force", text: "" }, sneak: { name: "Sneak", text: "" }, search: { name: "Search", text: "" } },
  edges: [
    { id: "dragonling_strong_force", hero: { species: "dragonling" }, on: "check", tag: "force", roll: 1, text: "A dragonling is small but mighty." },
    { id: "dragonling_smoky_sneak", hero: { species: "dragonling" }, on: "check", tag: "sneak", roll: -1, text: "A dragonling puffs smoke." },
    { id: "thornguard_heave", hero: { class: "thornguard" }, on: "check", tag: "force", roll: 2, text: "A Thornguard heaves hard." },
    { id: "unicorn_gentle_force", hero: { species: "unicorn" }, on: "check", tag: "force", roll: -1, text: "Unicorns are gentle, not strong." },
    { id: "unicorn_shy_force", hero: { species: "unicorn" }, on: "check", tag: "force", roll: -2, text: "Unicorns hate heaving." },
    { id: "kitsune_eyes", hero: { species: "kitsune" }, on: "check", tag: "search", roll: 1, text: "A kitsune spots things." },
    { id: "dragonling_flier", hero: { species: "dragonling" }, on: "attack", foe: "flier", roll: 1, text: "Not a check edge." },
  ],
  opinion: { likedCheckRoll: 1, dislikedCheckRoll: -1, likedSwingRoll: -1, dislikedSwingRoll: 1 },
  exemptCampaigns: ["gemfall"],
} as unknown as MatchupRules;

const precision: InteractionSpec = { kind: "precision", cue: "Heave", actionLabel: "Heave", target: 0.5, width: 0.2, periodMs: 4000 };
const tracking: InteractionSpec = { kind: "tracking", cue: "Watch", actionLabel: "Choose", covers: ["Left", "Middle", "Right"], start: 0, swaps: [[0, 1], [1, 2]], stepMs: 1000 };

interface Seat { species: SpeciesId; class?: ClassId }

function setup(spec: InteractionSpec, seats: Seat[], tags: string[] | undefined = ["force"], withMatchups = true) {
  const chapter = makeChapter();
  const scene: InteractionScene = {
    type: "interaction", narration: "A heavy log.", interaction: spec, ...(tags ? { tags } : {}),
    onSuccess: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "won" }] },
    onFailure: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "missed" }] },
    onAssisted: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "helped" }] },
  };
  chapter.scenes["edge_test"] = scene;
  const rules = makeRules(withMatchups ? { matchups: MATCHUPS } : {});
  // `ctx.matchups` is deliberately absent: Gemfall's runs never get it, and its games still read edges.
  const ctx: EngineContext = { chapter, rules, items: makeItems(), rng: makeRng("edges"), now, householdId: "h_1" };
  let state = createRunState({ runId: "edges", roomCode: "EDGE", mode: "party", now });
  state.party = seats.map((seat, index) => ({
    playerId: `p${index}`,
    character: resolveCharacter(makeCharacter({ id: `c${index}`, ownerPlayerId: `p${index}`, species: seat.species, ...(seat.class ? { class: seat.class } : {}) }), ctx.rules, ctx.items),
    connected: true, ready: true, hp: 10, down: false,
  }));
  state.chapterId = chapter.id;
  state = enterScene(state, "edge_test", ctx).state;
  return { state, ctx };
}
function prompt(state: RunState): InteractionPrompt {
  if (state.prompt?.kind !== "interaction") throw Error("Expected interaction");
  return state.prompt;
}
function step(state: RunState, ctx: EngineContext, action: InteractionAction, playerId = "p0", at = now) {
  const current = prompt(state);
  const result = applyIntent(state, { playerId, intent: { type: "INTERACT", openedSeq: current.openedSeq, attempt: current.attempt, ...action } }, { ...ctx, now: at });
  expect(result.error).toBeUndefined();
  return result.state;
}
/** Start an attempt with v1 controls and tap at `position`: the outcome. */
function tap(seats: Seat[], position: number, tags?: string[], relaxed = false) {
  const { state, ctx } = setup(precision, seats, tags);
  const started = step(state, ctx, { action: "start", relaxed });
  return { outcome: prompt(step(started, ctx, { action: "stop", position })).outcome, edge: prompt(started).edge };
}

describe("interactionEdge", () => {
  const hero = (species: SpeciesId, cls: ClassId = "songkeeper") => ({ id: "p0", species, class: cls });

  it("is nothing without tags, without a table, or without a matching check edge", () => {
    expect(interactionEdge(MATCHUPS, hero("dragonling"), undefined)).toBeUndefined();
    expect(interactionEdge(MATCHUPS, hero("dragonling"), [])).toBeUndefined();
    expect(interactionEdge(undefined, hero("dragonling"), ["force"])).toBeUndefined();
    expect(interactionEdge(MATCHUPS, hero("griffin"), ["force"])).toBeUndefined();
  });

  it("gives one knack however many plus edges match, the strongest, from species or class", () => {
    const edge = interactionEdge(MATCHUPS, hero("dragonling", "thornguard"), ["force"]);
    expect(edge).toEqual({ heroId: "p0", step: 1, knack: { id: "thornguard_heave", text: "A Thornguard heaves hard." } });
    expect(interactionEdge(MATCHUPS, hero("griffin", "thornguard"), ["force"])?.knack?.id).toBe("thornguard_heave");
  });

  it("gives one snag however many minus edges match, the strongest", () => {
    expect(interactionEdge(MATCHUPS, hero("unicorn"), ["force"])).toEqual({ heroId: "p0", step: -1, snag: { id: "unicorn_shy_force", text: "Unicorns hate heaving." } });
  });

  it("cancels a knack and a snag to no change, and keeps both sentences", () => {
    const edge = interactionEdge(MATCHUPS, hero("dragonling"), ["force", "sneak"]);
    expect(edge?.step).toBe(0);
    expect(edge?.knack?.id).toBe("dragonling_strong_force");
    expect(edge?.snag?.id).toBe("dragonling_smoky_sneak");
    expect(interactionEdge(MATCHUPS, hero("unicorn", "thornguard"), ["force"])?.step).toBe(0);
  });

  it("reads only check edges: attack edges and opinions are not games", () => {
    expect(interactionEdge(MATCHUPS, hero("dragonling"), ["flier"])).toBeUndefined();
  });
});

describe("the tolerance an edge gives", () => {
  it("widens a knack 1.5x, narrows a snag 0.75x, and stacks on relaxed play", () => {
    expect(edgeScale({})).toBe(1);
    expect(edgeScale({ edge: { heroId: "p0", step: 1 } })).toBe(1.5);
    expect(edgeScale({ edge: { heroId: "p0", step: -1 } })).toBe(0.75);
    expect(edgeScale({ edge: { heroId: "p0", step: 0 } })).toBe(1);
    expect(aimWidth({ width: 0.2 }, { relaxed: true, edge: { heroId: "p0", step: 1 } })).toBeCloseTo(0.6);
    expect(aimWidth({ width: 0.8 }, { relaxed: true, edge: { heroId: "p0", step: 1 } })).toBe(1);
  });

  it("slows a knack's playback and quickens a snag's", () => {
    expect(edgePace({ edge: { heroId: "p0", step: 1 } })).toBe(1.3);
    expect(edgePace({ edge: { heroId: "p0", step: -1 } })).toBe(0.8);
    expect(playbackMs(tracking, false, 1.3)).toBe(3 * 1300);
  });

  it("only changes a relay for the hero the edge belongs to", () => {
    const edged = { edge: { heroId: "p0", step: 1 as const } };
    expect(relayEdgeScale(edged, "p0")).toBe(1.5);
    expect(relayEdgeScale(edged, "p1")).toBe(1);
    expect(relayEdgeScale({}, "p0")).toBe(1);
  });
});

describe("edges in play (#567)", () => {
  // Target 0.5, width 0.2: plain play hits within 0.1, a knack within 0.15, a snag within 0.075.
  it("lets a knack land a tap that would miss, and makes a snag miss one that would land", () => {
    expect(tap([{ species: "griffin" }], 0.63).outcome).toBe("failure");
    expect(tap([{ species: "dragonling" }], 0.63).outcome).toBe("success");
    expect(tap([{ species: "griffin" }], 0.59).outcome).toBe("success");
    expect(tap([{ species: "unicorn" }], 0.59).outcome).toBe("failure");
  });

  it("plays an untagged game exactly as before, edge or not", () => {
    const plain = tap([{ species: "dragonling" }], 0.63, []);
    expect(plain.edge).toBeUndefined();
    expect(plain.outcome).toBe("failure");
  });

  it("gives the knack to the acting hero only, at one, two and four seats", () => {
    for (const seats of [1, 2, 4]) {
      const table: Seat[] = Array.from({ length: seats }, (_, i) => ({ species: i === 0 ? "dragonling" : "unicorn" }));
      const { edge, outcome } = tap(table, 0.63);
      expect(edge).toEqual({ heroId: "p0", step: 1, knack: { id: "dragonling_strong_force", text: "A dragonling is small but mighty." } });
      expect(outcome).toBe("success");
    }
    // A unicorn acting, a dragonling watching: the snag is the actor's, the knack nobody's.
    const { edge } = tap([{ species: "unicorn" }, { species: "dragonling" }], 0.5);
    expect(edge?.step).toBe(-1);
    expect(edge?.heroId).toBe("p0");
  });

  it("stacks a knack on relaxed play, and a snag never undoes relaxed play's help", () => {
    expect(tap([{ species: "dragonling" }], 0.79, ["force"], true).outcome).toBe("success");
    expect(tap([{ species: "unicorn" }], 0.64, ["force"], true).outcome).toBe("success");
  });

  it("works with Gemfall's matchups off: the game reads the rules, not the dice's context", () => {
    const { state, ctx } = setup(precision, [{ species: "dragonling" }]);
    expect(ctx.matchups).toBeUndefined();
    expect(prompt(step(state, ctx, { action: "start", relaxed: false })).edge?.step).toBe(1);
  });

  it("does nothing on play, sequence or cooperate games", () => {
    const play: InteractionSpec = { kind: "play", cue: "Pet", actionLabel: "Pet", options: [{ id: "a", label: "A", icon: "star", reaction: "Purr" }], participation: "any" };
    const { state, ctx } = setup(play, [{ species: "dragonling" }]);
    expect(prompt(step(state, ctx, { action: "start", relaxed: false })).edge).toBeUndefined();
  });

  it("keeps assist, and its branch, whatever the edge", () => {
    const { state, ctx } = setup(precision, [{ species: "unicorn" }]);
    const helped = step(step(state, ctx, { action: "start", relaxed: false }), ctx, { action: "assist" });
    expect(prompt(helped).outcome).toBe("assisted");
    const on = step(helped, ctx, { action: "continue" });
    expect(on.flags["helped"]).toBe(true);
  });

  it("clears the edge on retry and fixes it again for whoever starts the next attempt", () => {
    const { state, ctx } = setup(precision, [{ species: "dragonling" }, { species: "unicorn" }]);
    const missed = step(step(state, ctx, { action: "start", relaxed: false }), ctx, { action: "stop", position: 0.9 });
    expect(prompt(missed).outcome).toBe("failure");
    const again = step(missed, ctx, { action: "retry" });
    expect(prompt(again).edge).toBeUndefined();
    expect(prompt(step(again, ctx, { action: "start", relaxed: false })).edge?.step).toBe(1);
  });

  it("survives a save and a reconnect: the edge is part of the saved prompt", () => {
    const { state, ctx } = setup(precision, [{ species: "dragonling" }, { species: "griffin" }]);
    const started = step(state, ctx, { action: "start", relaxed: false });
    const saved = JSON.parse(JSON.stringify(started)) as RunState;
    saved.party[0]!.connected = false;
    saved.party[0]!.connected = true;
    expect(prompt(saved).edge?.step).toBe(1);
    expect(prompt(step(saved, ctx, { action: "stop", position: 0.63 })).outcome).toBe("success");
  });

  it("holds a tracking answer back until a knack's slower playback is over", () => {
    const { state, ctx } = setup(tracking, [{ species: "kitsune" }], ["search"]);
    const started = step(state, ctx, { action: "start", relaxed: false });
    const p = prompt(started);
    expect(p.edge?.step).toBe(1);
    const plainEnd = new Date(Date.parse(now) + playbackMs(tracking, false)).toISOString();
    expect(playbackOver(p, plainEnd)).toBe(false);
    const slowEnd = new Date(Date.parse(now) + playbackMs(tracking, false, 1.3)).toISOString();
    expect(playbackOver(p, slowEnd)).toBe(true);
  });

  it("widens a relay catch for the edged hero's own hands only", () => {
    const relay: InteractionSpec = { kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "log" };
    const { state, ctx } = setup(relay, [{ species: "dragonling" }, { species: "griffin" }]);
    let next = step(state, ctx, { action: "start", relaxed: false });
    const landing = prompt(next).relay!.flight.landing;
    // 0.3 off the landing: outside the plain 0.22 radius, inside the knack's 0.33.
    const reach = landing > 0.5 ? landing - 0.3 : landing + 0.3;
    next = step(next, ctx, { action: "catch", flightId: prompt(next).relay!.flight.id, position: 0.82, reach });
    expect(prompt(next).caughtBy).toBe("p0");
    next = step(next, ctx, { action: "pass", flightId: prompt(next).relay!.flight.id, ...relayTarget(0) });
    const flight = prompt(next).relay!.flight;
    const far = flight.landing > 0.5 ? flight.landing - 0.3 : flight.landing + 0.3;
    next = step(next, ctx, { action: "catch", flightId: flight.id, position: 0.82, reach: far }, "p1");
    expect(prompt(next).caughtBy).toBeUndefined();
    expect(prompt(next).relay!.last).toBe("missed");
  });
});
