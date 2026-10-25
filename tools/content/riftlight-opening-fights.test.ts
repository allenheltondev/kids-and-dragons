import { expect, it } from "vitest";
import { allPaths, chapters, rules } from "./riftlight-test-support.ts";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";

// One fight each in the shore and the pass: on every success path, a won fight pays an
// item (coins drop automatically under rules.loot), a lost one reroutes to the spine.
const cases = [
  { id: "riftlight-frostfang-shore", fight: "bar_crab", creature: "glassback_crab", item: "luckstone", win: "bar_carry", flag: "crab_won_the_bar" },
  { id: "riftlight-cairnstep-pass", fight: "cache_fight", creature: "cinder_wolf", item: "hearthstone_bead", win: "neck", flag: "wolves_took_hay" },
] as const;

it("Riftlight pays coins for a won fight", () => {
  expect(rules.loot?.campaigns).toContain("riftlight");
});

it.each(cases)("$id: the fight is on the spine, pays an item, and a loss rejoins the story", ({ id, fight, creature, item, win, flag }) => {
  const chapter = chapters.get(id)!;
  const scene = chapter.scenes[fight]!;
  if (scene.type !== "encounter") throw new Error("Expected an encounter");
  expect(scene.enemies[0]).toMatchObject({ creature });
  expect(scene.onVictory.goto).toBe(win);
  expect(scene.onDefeat.goto).toBe(win);
  expect(scene.onVictory.effects).toContainEqual(expect.objectContaining({ type: "grantItem", itemId: item }));
  expect(JSON.stringify(scene.onVictory.effects)).not.toContain("grantCoins");
  expect(scene.onDefeat.effects).toContainEqual(expect.objectContaining({ type: "setFlag", flag }));
  for (const [species, cls] of [["manticore", "duskrunner"], ["kitsune", "starweaver"], ["bigfoot", "thornguard"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls);
    expect(visited.has(fight)).toBe(true);
    expect(ends.length).toBeGreaterThan(0);
    for (const end of ends) {
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string], step.flag as string).toBe(true);
      expect(end.chapterOutcome).toBe("success");
    }
    expect(ends.some((end) => end.flags[flag])).toBe(true);
    expect(ends.some((end) => !end.flags[flag])).toBe(true);
  }
  for (const { shortest } of pacingReport(chapter).scenarios) {
    expect(shortest!.encounters).toBe(1);
    expect(shortest!.scenes).toBeGreaterThanOrEqual(30);
    expect(shortest!.decisions + shortest!.checks).toBeGreaterThanOrEqual(14);
  }
});
