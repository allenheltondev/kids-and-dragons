import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyIntent, enterScene, resolveEnemy } from "@kad/shared";
import type { Bestiary, Chapter, EncounterMap } from "@kad/shared";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { allPaths, chapters, context, items, rules, start } from "./riftlight-test-support.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as T;
const bestiary = read<Bestiary>("content/bestiary.json");
const glade = read<EncounterMap>("content/maps/glade.json");
const chapter = chapters.get("riftlight-sky-islands-arrival")!;

/** The chapter with its wisps resolved from canon, the way the content loader serves it. */
function resolved(): Chapter {
  const copy = structuredClone(chapter);
  const fight = copy.scenes.wisp_fight;
  if (fight?.type !== "encounter") throw new Error("Expected the wisp fight");
  fight.enemies = fight.enemies.map((enemy) => {
    const { spec, problems } = resolveEnemy(enemy, bestiary);
    if (!spec) throw new Error(`the ${enemy.creature ?? "enemy"} does not resolve: ${problems.join("; ")}`);
    return { ...spec, count: enemy.count ?? spec.count };
  });
  return copy;
}

it("the wisp fight is the chapter's one fight and every path to the way out runs through it", () => {
  const fight = chapter.scenes.wisp_fight;
  if (fight?.type !== "encounter") throw new Error("Expected an encounter");
  expect(fight).toMatchObject({ map: "glade", enemies: [{ creature: "will_o_wisp", count: 2 }] });
  expect(Object.values(chapter.scenes).filter((scene) => scene.type === "encounter")).toHaveLength(1);
  // Only the fight's two outcomes lead on to the ferry, and only the intro leads into the fight.
  const into = (target: string) => Object.entries(chapter.scenes).filter(([, scene]) => JSON.stringify(scene).includes(`"goto":"${target}"`)).map(([id]) => id).sort();
  expect(into("dusk_ferry")).toEqual(["wisps_rescued", "wisps_shooed"]);
  expect(into("wisps_shooed")).toEqual(["wisp_fight"]);
  expect(into("wisps_rescued")).toEqual(["wisp_fight"]);
  expect(into("wisp_fight")).toEqual(["wisps"]);
  expect(into("wisps").sort()).toEqual(["basket_lit", "basket_smoky"]);
  for (const { shortest } of pacingReport(chapter).scenarios) {
    expect(shortest!.encounters).toBe(1);
  }
});

it("a lost fight is rescued back onto the spine, never a setback", () => {
  const fight = chapter.scenes.wisp_fight;
  if (fight?.type !== "encounter") throw new Error("Expected an encounter");
  expect(fight.onDefeat.goto).toBe("wisps_rescued");
  expect(fight.onDefeat.effects).toEqual([{ type: "heal", amount: 3, to: "party" }]);
  expect(fight.onVictory.goto).not.toBe(fight.onDefeat.goto);
  expect(Object.values(chapter.scenes).some((scene) => "outcome" in scene && scene.outcome === "setback")).toBe(false);
  const { visited, ends } = allPaths(chapter, "manticore", "duskrunner");
  expect(visited.has("wisps_shooed")).toBe(true);
  expect(visited.has("wisps_rescued")).toBe(true);
  for (const end of ends) {
    expect(end.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
  }
});

it("winning hands over the mosslight jar and the automatic coin line; losing does neither", () => {
  const fight = chapter.scenes.wisp_fight;
  if (fight?.type !== "encounter") throw new Error("Expected an encounter");
  expect(fight.onVictory.effects).toEqual([{ type: "grantItem", itemId: "mosslight_jar", to: "party" }]);
  expect(JSON.stringify(fight.onVictory)).not.toContain("grantCoins");
  expect(items.mosslight_jar).toBeDefined();

  const copy = resolved();
  const ctx = { ...context(copy), map: (id: string) => (id === glade.id ? glade : null) };
  let entered = enterScene(start(copy, "manticore", "duskrunner"), "wisp_fight", ctx);
  expect(entered.error).toBeUndefined();
  if (entered.state.prompt?.kind === "ready") entered = applyIntent(entered.state, { playerId: "p1", intent: { type: "READY", ready: true } }, ctx);
  expect(entered.error).toBeUndefined();
  expect(entered.state.encounter).toBeTruthy();
  const beaten = { ...entered.state.encounter!, combatants: entered.state.encounter!.combatants.map((m) => (m.side === "enemy" ? { ...m, hp: 0, down: true } : m)) };
  const won = applyIntent({ ...entered.state, encounter: beaten }, { playerId: "p1", intent: { type: "ADVANCE" } }, ctx);
  expect(won.error).toBeUndefined();
  expect(won.state.sceneId).toBe("wisps_shooed");
  // Two wisps of 6 hit points each, one coin to every 4.
  const coins = 2 * Math.max(1, Math.round(bestiary.creatures.will_o_wisp!.hp / rules.loot!.hpPerCoin));
  expect(won.state.coins).toBe(coins);
  expect(won.state.narration).toContain(`You find ${String(coins)} coins`);
  expect(won.state.party[0]!.character.inventory.some((item) => item.itemId === "mosslight_jar")).toBe(true);
});
