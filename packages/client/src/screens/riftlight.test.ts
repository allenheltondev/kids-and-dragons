/**
 * Riftlight (#229), the pure half: who may see the colours, and what each
 * rift shows them. The DOM half (who actually draws them) is
 * rift-sight.test.tsx.
 */

import { describe, expect, it } from "vitest";
import type { JourneyExitView, JourneyRiftView, JourneyView } from "@kad/shared";
import {
  NEUTRAL_RIFT_LINE,
  RIFTLIGHT_INDICATOR_LABEL,
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
      "Violet, spiralling inward",
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
