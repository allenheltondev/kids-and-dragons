/**
 * The path walker agrees with the runtime about cleared flags.
 *
 * `routesTaken` (progression.ts) reads a chapter's *final* flags, and a route
 * member set back to `false` is revoked, not held. A walker that only ever
 * added flags would call a legal clear-then-replace a conflict, and would let
 * a must-set check believe a cleared road survived to the ending.
 */

import { describe, expect, it } from "vitest";

import { routeOutcomes, routeSetConflicts } from "./route-paths.mjs";

const SETS = { road: ["route_river", "route_wild"] };
const set = (flag, value = true) => ({ type: "setFlag", flag, value });

/** start → middle → end, with these effects on the two edges. */
function chapter(first, second) {
  return {
    entry: "start",
    scenes: {
      start: { type: "story", narration: "", choices: [{ id: "a", label: "", icon: "arrow", goto: "middle", effects: first }] },
      middle: { type: "story", narration: "", choices: [{ id: "b", label: "", icon: "arrow", goto: "end", effects: second }] },
      end: { type: "rest", narration: "", choices: [] },
    },
  };
}

describe("route-set flags along a path", () => {
  it("treats clear-then-replace as one road, not two", () => {
    const c = chapter([set("route_river")], [set("route_river", false), set("route_wild")]);
    expect(routeSetConflicts(c, SETS).conflicts).toEqual([]);
    const [only] = routeOutcomes(c, SETS).endings;
    expect(only.flags).toEqual(["route_wild"]);
    expect(only.cleared).toEqual(["route_river"]);
  });

  it("still catches two roads left standing", () => {
    const c = chapter([set("route_river")], [set("route_wild")]);
    expect(routeSetConflicts(c, SETS).conflicts).toEqual([{ ending: "end", set: "road", flags: ["route_river", "route_wild"] }]);
  });

  it("does not report a road that was set and then cleared as standing", () => {
    const c = chapter([set("route_river")], [set("route_river", false)]);
    const [only] = routeOutcomes(c, SETS).endings;
    expect(only.flags).toEqual([]);
  });
});
