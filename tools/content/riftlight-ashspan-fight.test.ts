import { expect, it } from "vitest";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { allPaths, chapters, rules } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-ashspan-bridge")!;
const fight = chapter.scenes.mimic_fight!;

function exitsOf(id: string): string[] {
  const scene = chapter.scenes[id]!;
  if (scene.type === "check") return [scene.onSuccess.goto, scene.onFailure.goto];
  if (scene.type === "interaction") return [scene.onSuccess.goto, scene.onFailure.goto, ...(scene.onAssisted ? [scene.onAssisted.goto] : [])];
  if (scene.type === "encounter") return [scene.onVictory.goto, scene.onDefeat.goto];
  return (scene.choices ?? []).map((choice) => choice.goto);
}

it("the mimic fight is on every road to the ending, not a detour", () => {
  if (fight.type !== "encounter") throw new Error("Expected an encounter");
  const seen = new Set<string>([chapter.entry]);
  const queue = [chapter.entry];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === "mimic_fight") continue;
    for (const to of exitsOf(id)) if (!seen.has(to)) { seen.add(to); queue.push(to); }
  }
  // Without passing through the fight, no scene that ends the chapter can be reached.
  const endings = Object.entries(chapter.scenes).filter(([, s]) => "outcome" in s && s.outcome).map(([id]) => id);
  expect(endings.length).toBeGreaterThan(0);
  for (const id of endings) expect(seen.has(id), id).toBe(false);
  for (const { shortest } of pacingReport(chapter).scenarios) {
    expect(shortest!.encounters).toBe(1);
  }
});

it("victory hands over a bootlace and Riftlight's loot pays the coins; defeat rescues onto the spine", () => {
  if (fight.type !== "encounter") throw new Error("Expected an encounter");
  expect(rules.loot!.campaigns).toContain("riftlight");
  expect(fight.onVictory.effects).toEqual([{ type: "grantItem", itemId: "quickfoot_lace", to: "party" }]);
  expect(fight.onVictory.effects!.some((e) => e.type === "grantCoins")).toBe(false);
  expect(fight.onVictory.goto).not.toBe(fight.onDefeat.goto);
  expect(fight.onDefeat.effects).toEqual([{ type: "heal", amount: 3, to: "party" }]);
  // Both outcomes rejoin the same next scene, and neither is a setback.
  expect(exitsOf("mimic_won")).toEqual(exitsOf("mimic_shooed"));
  const { visited, ends } = allPaths(chapter, "manticore", "duskrunner");
  expect(visited.has("mimic_won")).toBe(true);
  expect(visited.has("mimic_shooed")).toBe(true);
  for (const end of ends) expect(end.chapterOutcome).toBe("success");
});
