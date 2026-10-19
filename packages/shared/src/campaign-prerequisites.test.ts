import { describe, expect, it } from "vitest";
import { prerequisiteProblems, prerequisiteReason, unmetPrerequisites } from "./campaign-prerequisites.js";

const set = (spec: Record<string, string[] | undefined>) =>
  Object.entries(spec).map(([id, requires]) => ({ id, ...(requires ? { requires } : {}) }));

describe("prerequisiteProblems", () => {
  it("accepts a set with no prerequisites, and a plain chain", () => {
    expect(prerequisiteProblems(set({ gemfall: undefined, riftlight: undefined }))).toEqual([]);
    expect(prerequisiteProblems(set({ gemfall: undefined, riftlight: ["gemfall"], third: ["riftlight", "gemfall"] }))).toEqual([]);
  });

  it("rejects a prerequisite naming a campaign that does not exist", () => {
    const problems = prerequisiteProblems(set({ gemfall: undefined, riftlight: ["gemfal"] }));
    expect(problems).toEqual([
      {
        campaignId: "riftlight",
        path: "/requires/0",
        problem: 'requires campaign "gemfal", which does not exist',
      },
    ]);
  });

  it("rejects a campaign that requires itself, and a repeated prerequisite", () => {
    const problems = prerequisiteProblems(set({ a: ["a"], b: undefined, c: ["b", "b"] }));
    expect(problems.map((p) => [p.campaignId, p.path, p.problem])).toEqual([
      ["a", "/requires/0", 'campaign "a" cannot require itself'],
      ["c", "/requires/1", 'requires "b" more than once'],
    ]);
  });

  it("rejects a cycle, naming it once, wherever it starts", () => {
    const two = prerequisiteProblems(set({ a: ["b"], b: ["a"] }));
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ campaignId: "a", problem: "prerequisite cycle: a -> b -> a" });

    // A longer loop with a campaign hanging off it that is not part of it.
    const long = prerequisiteProblems(set({ a: ["b"], b: ["c"], c: ["a"], tail: ["a"] }));
    expect(long.map((p) => p.problem)).toEqual(["prerequisite cycle: a -> b -> c -> a"]);
  });

  it("does not mistake a diamond for a cycle", () => {
    expect(
      prerequisiteProblems(set({ base: undefined, left: ["base"], right: ["base"], top: ["left", "right"] })),
    ).toEqual([]);
  });

  it("rejects a requires that is not a list", () => {
    const problems = prerequisiteProblems([{ id: "a", requires: "b" as unknown as string[] }]);
    expect(problems.map((p) => p.problem)).toEqual(["requires must be a list of campaign ids"]);
  });
});

describe("unmetPrerequisites", () => {
  const attempts = (...rows: [string, "active" | "complete" | "failed"][]) =>
    rows.map(([campaignId, status]) => ({ campaignId, status }));

  it("is empty for a campaign with no prerequisite, whatever the household has done", () => {
    expect(unmetPrerequisites({}, [])).toEqual([]);
    expect(unmetPrerequisites({ requires: [] }, attempts(["gemfall", "failed"]))).toEqual([]);
  });

  it("is met only by a completed attempt", () => {
    const rift = { requires: ["gemfall"] };
    expect(unmetPrerequisites(rift, [])).toEqual(["gemfall"]);
    expect(unmetPrerequisites(rift, attempts(["gemfall", "failed"]))).toEqual(["gemfall"]);
    expect(unmetPrerequisites(rift, attempts(["gemfall", "active"]))).toEqual(["gemfall"]);
    expect(unmetPrerequisites(rift, attempts(["other", "complete"]))).toEqual(["gemfall"]);
    expect(unmetPrerequisites(rift, attempts(["gemfall", "complete"]))).toEqual([]);
  });

  it("is met by a replay of a completed campaign, whatever the replay is doing", () => {
    const rift = { requires: ["gemfall"] };
    for (const status of ["active", "failed"] as const) {
      expect(unmetPrerequisites(rift, [{ campaignId: "gemfall", status, everCompleted: true }]), status).toEqual([]);
    }
  });

  it("is met by any hero at the table who finished it herself, wherever (#283)", () => {
    const rift = { requires: ["gemfall"] };
    expect(unmetPrerequisites(rift, [], ["gemfall"])).toEqual([]);
    // Her record and the table's both count; either alone is enough.
    expect(unmetPrerequisites(rift, attempts(["gemfall", "complete"]), [])).toEqual([]);
    expect(unmetPrerequisites(rift, attempts(["gemfall", "failed"]), ["gemfall"])).toEqual([]);
    expect(unmetPrerequisites(rift, [], ["other"])).toEqual(["gemfall"]);
    expect(unmetPrerequisites({ requires: ["a", "b"] }, attempts(["a", "complete"]), ["b"])).toEqual([]);
  });

  it("lists only what is still unmet, in declaration order", () => {
    expect(
      unmetPrerequisites({ requires: ["a", "b", "c"] }, attempts(["b", "complete"])),
    ).toEqual(["a", "c"]);
  });
});

describe("prerequisiteReason", () => {
  it("says it plainly", () => {
    expect(prerequisiteReason(["Gemfall"])).toBe("Finish Gemfall first");
    expect(prerequisiteReason(["Gemfall", "Ember Road"])).toBe("Finish Gemfall and Ember Road first");
    expect(prerequisiteReason(["A", "B", "C"])).toBe("Finish A, B and C first");
    expect(prerequisiteReason([])).toBe("");
  });
});
