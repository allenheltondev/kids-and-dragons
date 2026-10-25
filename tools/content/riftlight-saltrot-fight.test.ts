import { expect, it } from "vitest";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { applyEffects } from "@kad/shared";
import { allPaths, chapters, context, rules, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-saltrot-arrival")!;

it("the glassback crabs are one canon fight on the spine, with a gift for winning and a rescue for losing", () => {
  const fight = chapter.scenes.crab_fight!;
  if (fight.type !== "encounter") throw new Error("Expected an encounter");
  expect(fight.enemies).toHaveLength(1);
  expect(fight.enemies[0]).toMatchObject({ creature: "glassback_crab" });
  // Stats come from canon, and the win's coins come from the loot rule, not from the scene.
  expect(fight.enemies[0]!.hp).toBeUndefined();
  expect(rules.loot!.campaigns).toContain("riftlight");
  expect(JSON.stringify(fight.onVictory)).not.toContain("grantCoins");
  expect(fight.onVictory.effects).toEqual([{ type: "grantItem", itemId: "luckstone", to: "party" }]);
  expect(fight.onVictory.goto).toBe("crab_done");
  expect(fight.onDefeat.goto).toBe("crab_rescued");
  // Both outcomes rejoin the same next scene, so losing never ends the chapter.
  for (const id of ["crab_done", "crab_rescued"]) {
    const scene = chapter.scenes[id]!;
    if (scene.type !== "story") throw new Error("Expected a story scene");
    expect(scene.choices.map((c) => c.goto)).toEqual(["tide"]);
  }
});

it("every success path meets the crabs, and a loss still reaches a success ending", () => {
  for (const { shortest } of pacingReport(chapter).scenarios) expect(shortest!.encounters).toBe(1);
  const { ends, visited } = allPaths(chapter, "manticore", "duskrunner");
  expect(visited.has("crab_fight")).toBe(true);
  expect(visited.has("crab_done")).toBe(true);
  expect(visited.has("crab_rescued")).toBe(true);
  for (const end of ends) {
    expect(end.chapterOutcome).toBe("success");
    expect(end.flags.followed_the_silt).toBe(true);
  }
  // Only a win brings the luckstone home.
  const fight = chapter.scenes.crab_fight!;
  if (fight.type !== "encounter") throw new Error("Expected an encounter");
  const won = applyEffects(start(chapter, "manticore", "duskrunner"), fight.onVictory.effects ?? [], context(chapter));
  expect(won.party[0]!.character.inventory.some((item) => item.itemId === "luckstone")).toBe(true);
  const lost = applyEffects(start(chapter, "manticore", "duskrunner"), fight.onDefeat.effects ?? [], context(chapter));
  expect(lost.party[0]!.character.inventory.some((item) => item.itemId === "luckstone")).toBe(false);
});
