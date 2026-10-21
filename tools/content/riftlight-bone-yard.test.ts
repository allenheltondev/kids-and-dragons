import { expect, it } from "vitest";
import { allPaths, chapters } from "./riftlight-test-support.ts";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";

const chapter = chapters.get("riftlight-bone-yard")!;
it("every declared combat outcome clears a route without taking anything", () => {
  const { ends, visited } = allPaths(chapter, "manticore", "duskrunner");
  expect(visited.has("cleared")).toBe(true);
  expect(visited.has("rescued")).toBe(true);
  for (const end of ends) {
    for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
    expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
  }
  expect(ends.some(s => s.flags.bone_retreat)).toBe(true);
});
it("supports an objective victory and a distinct retreat without a campaign setback", () => {
  const fight = chapter.scenes.fight!;
  if (fight.type !== "encounter") throw new Error("Expected an encounter");
  expect(fight.autoResolve).toBeUndefined();
  expect(fight.environment!.objectives![0]).toMatchObject({ kind: "close", endsFight: true, turns: 3 });
  expect(fight.onVictory.goto).not.toBe(fight.onDefeat.goto);
  for (const { shortest } of pacingReport(chapter).scenarios) {
    expect(shortest!.scenes).toBeGreaterThanOrEqual(30);
    expect(shortest!.decisions).toBeGreaterThanOrEqual(14);
    expect(shortest!.encounters).toBe(1);
  }
});

it("preparing the closing stones shortens the objective without removing combat risk", () => {
  const prepared = chapter.scenes.fight_seam;
  if (prepared?.type !== "encounter") throw new Error("Expected prepared encounter");
  expect(prepared.environment!.objectives![0]!.turns).toBe(2);
  expect(prepared.onDefeat.goto).toBe("rescued");
  expect(chapter.scenes.exit_strip!.variants).toContainEqual(expect.objectContaining({ when: { flag: "bone_retreat" }, text: expect.stringContaining("longer route") }));
});
