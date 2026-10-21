/**
 * Riftlight (#229), the pure half: who may see the colours, and what each
 * rift shows them. The DOM half (who actually draws them) is
 * rift-sight.test.tsx.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JourneyExitView, JourneyRiftView, JourneyView } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import {
  NEUTRAL_RIFT_LINE,
  RIFT_COLLAPSE_EFFECT,
  RIFT_NEUTRAL_EFFECT,
  RIFT_OPEN_EFFECT,
  RIFT_SHEET,
  RIFTLIGHT_INDICATOR_LABEL,
  riftEffect,
  riftLayers,
  riftMoments,
  riftSheetUrl,
  riftlightOf,
  riftlightWords,
  seesRiftlight,
  visibleRifts,
} from "./riftlight";

describe("who sees Riftlight", () => {
  it("is a seated Starweaver, and nobody else", () => {
    expect(seesRiftlight({ class: "starweaver" })).toBe(true);
    for (const other of ["thornguard", "duskrunner", "songkeeper"] as const) {
      expect(seesRiftlight({ class: other })).toBe(false);
    }
  });

  it("is never a screen with no seat (the TV)", () => {
    expect(seesRiftlight(null)).toBe(false);
    expect(seesRiftlight(undefined)).toBe(false);
  });
});

describe("a rift's layers", () => {
  const cases: [string, JourneyRiftView, string[], string[]][] = [
    ["dormant (opensWhen unmet)", { status: "dormant", usesLeft: 1, oneWay: true }, ["green", "amber", "violet"], []],
    ["single-use", { status: "open", usesLeft: 1 }, ["amber"], []],
    ["persistent", { status: "open", persistent: true }, ["blue"], []],
    ["one-way", { status: "open", usesLeft: 1, oneWay: true }, ["amber", "violet"], []],
    ["timed, clock running", { status: "open", usesLeft: 1, expiresIn: { unit: "visits", count: 2 } }, ["amber"], ["shrink"]],
    ["unstable", { status: "open", usesLeft: 1, unstable: true, collapsesIn: 1 }, ["amber"], ["stutter"]],
    ["linked", { status: "open", persistent: true, linked: true }, ["blue"], ["sync"]],
  ];
  for (const [name, rift, colors, motions] of cases) {
    it(`${name}: ${[...colors, ...motions].join(" + ")}`, () => {
      expect(riftlightOf(rift)).toEqual({ colors, motions });
    });
  }

  it("drops green the moment the rift opens; the other colours stay", () => {
    expect(riftlightOf({ status: "dormant", persistent: true })?.colors).toEqual(["green", "blue"]);
    expect(riftlightOf({ status: "open", persistent: true })?.colors).toEqual(["blue"]);
  });

  it("stops stuttering and shrinking once steadied (#197), as the engine's view already says", () => {
    expect(riftlightOf({ status: "open", usesLeft: 1, stable: true })).toEqual({ colors: ["amber"], motions: [] });
  });

  it("gives off no light once used up, shut or gone", () => {
    for (const status of ["closed", "consumed", "expired", "collapsed"] as const) {
      expect(riftlightOf({ status, oneWay: true, persistent: true })).toBeNull();
    }
  });
});

describe("the rifts the world view draws", () => {
  const exit = (edge: string, rift?: JourneyRiftView): JourneyExitView => ({
    edge,
    to: "",
    kind: "forward",
    label: "Into the rift",
    available: true,
    arrival: "new",
    ...(rift ? { rift } : {}),
  });
  const journey = (exits: JourneyExitView[], status: JourneyView["status"] = "choosing"): JourneyView => ({
    node: "hub",
    title: "The Hub",
    visit: 1,
    status,
    chapter: "c-hub",
    exits,
  });

  it("are the drawn exits that are lit rifts, in authored order", () => {
    const rifts = visibleRifts(
      journey([
        exit("road"),
        exit("b", { status: "open", persistent: true }),
        exit("gone", { status: "consumed" }),
        exit("a", { status: "dormant", usesLeft: 1 }),
      ]),
    );
    expect(rifts.map((rift) => rift.edge)).toEqual(["b", "a"]);
  });

  it("are none for an ordered campaign, a journey without rifts, or a party not choosing", () => {
    expect(visibleRifts(undefined)).toEqual([]);
    expect(visibleRifts(journey([exit("road")]))).toEqual([]);
    expect(visibleRifts(journey([], "playing"))).toEqual([]);
  });
});

describe("the words", () => {
  const RULES = /once|one[- ]way|single|use|stay|open|persist|back|return|linked|partner|mouth|timed|time|unstable|need|require|condition/i;
  const COLORS = /green|amber|blue|violet|purple|gold|red|white|silver/i;

  it("on a Starweaver's phone, name each colour with its pattern and each motion, never a rule", () => {
    const words = riftlightWords({ colors: ["green", "amber", "blue", "violet"], motions: ["shrink", "stutter", "sync"] });
    expect(words).toEqual([
      "Green, breathing slowly",
      "Amber, one flicker",
      "Blue, rippling steadily",
      "Violet, spiraling inward",
      "It is shrinking",
      "It stutters",
      "It pulses to a steady beat",
    ]);
    for (const line of words) expect(line).not.toMatch(RULES);
  });

  it("everywhere else, and on the indicator, name neither a colour nor a rule", () => {
    for (const line of [NEUTRAL_RIFT_LINE, RIFTLIGHT_INDICATOR_LABEL]) {
      expect(line).not.toMatch(COLORS);
      expect(line).not.toMatch(RULES);
    }
  });

  it("call a lit rift with no layer a shimmer, rather than saying nothing", () => {
    expect(riftlightWords({ colors: [], motions: [] })).toEqual([NEUTRAL_RIFT_LINE]);
  });
});

describe("the sheets each rift stacks", () => {
  it("puts the tear first, the colours over it and the linked beat on top", () => {
    expect(riftLayers({ colors: ["green", "amber", "violet"], motions: [] })).toEqual([
      "rift_base",
      "rift_green",
      "rift_amber",
      "rift_violet",
    ]);
    expect(riftLayers({ colors: ["blue"], motions: ["sync"] })).toEqual(["rift_base", "rift_blue", "rift_sync"]);
  });

  it("draws a shrinking or stuttering rift with that tear instead of the still one, never two outlines", () => {
    expect(riftLayers({ colors: ["amber"], motions: ["shrink"] })).toEqual(["rift_shrink", "rift_amber"]);
    expect(riftLayers({ colors: ["amber"], motions: ["stutter"] })).toEqual(["rift_stutter", "rift_amber"]);
    expect(riftLayers({ colors: ["amber"], motions: ["shrink", "stutter", "sync"] })).toEqual([
      "rift_stutter",
      "rift_amber",
      "rift_sync",
    ]);
  });

  it("asks only for sheets the manifest declares, in the shape the CSS steps through", () => {
    const effects = new Map(manifest.effects.map((effect) => [effect.id, effect]));
    const ids = [
      RIFT_NEUTRAL_EFFECT,
      "rift_base",
      ...(["green", "amber", "blue", "violet", "shrink", "stutter", "sync"] as const).map(riftEffect),
      RIFT_OPEN_EFFECT,
      RIFT_COLLAPSE_EFFECT,
    ];
    for (const id of ids) {
      const declared = effects.get(id);
      expect(declared, id).toBeDefined();
      expect({ frames: declared!.frames, fps: declared!.fps, size: declared!.size }, id).toEqual(RIFT_SHEET);
      const file = fileURLToPath(new URL(`../../../..${riftSheetUrl(id)}`, import.meta.url));
      expect(existsSync(file), file).toBe(true);
    }
  });
});

describe("a rift opening or collapsing", () => {
  const rift = (edge: string, status: JourneyRiftView["status"]): JourneyExitView => ({
    edge,
    to: "",
    kind: "forward",
    label: "Into the rift",
    available: status === "open",
    arrival: "new",
    rift: { status, usesLeft: 1 },
  });
  const at = (node: string, exits: JourneyExitView[], status: JourneyView["status"] = "choosing"): JourneyView => ({
    node,
    title: node,
    visit: 1,
    status,
    chapter: `c-${node}`,
    exits,
  });
  const seen = (node: string, exits: JourneyExitView[]) => riftMoments(null, "rl", at(node, exits)).sighting;

  it("opens a rift that was dormant at the same place", () => {
    const { moments } = riftMoments(seen("hub", [rift("a", "dormant")]), "rl", at("hub", [rift("a", "open")]));
    expect(moments).toEqual({ opened: ["a"], collapsed: [] });
  });

  it("collapses a rift that was lit at the same place and is dark now, as it was last seen", () => {
    const before = seen("hub", [rift("a", "open"), rift("b", "open")]);
    const { moments } = riftMoments(before, "rl", at("hub", [rift("a", "open"), rift("b", "expired")]));
    expect(moments.opened).toEqual([]);
    expect(moments.collapsed.map((exit) => [exit.edge, exit.rift.status])).toEqual([["b", "open"]]);
  });

  it("is nothing on arriving somewhere new: its rifts are shown as they are", () => {
    const { moments, sighting } = riftMoments(seen("hub", [rift("a", "dormant")]), "rl", at("far", [rift("a", "open")]));
    expect(moments).toEqual({ opened: [], collapsed: [] });
    expect(sighting?.place).toBe("rl/far");
  });

  it("is nothing in another campaign at a node of the same name", () => {
    const { moments } = riftMoments(seen("hub", [rift("a", "dormant")]), "other", at("hub", [rift("a", "open")]));
    expect(moments).toEqual({ opened: [], collapsed: [] });
  });

  it("keeps the last sighting through a chapter, so the return compares across it", () => {
    const before = seen("hub", [rift("a", "dormant")]);
    const playing = riftMoments(before, "rl", at("hub", [], "playing"));
    expect(playing.sighting).toBe(before);
    expect(playing.moments).toEqual({ opened: [], collapsed: [] });
    expect(riftMoments(playing.sighting, "rl", at("hub", [rift("a", "open")])).moments.opened).toEqual(["a"]);
  });

  it("is nothing when nothing changed", () => {
    const exits = [rift("a", "open"), rift("b", "dormant")];
    expect(riftMoments(seen("hub", exits), "rl", at("hub", exits)).moments).toEqual({ opened: [], collapsed: [] });
  });
});
