import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyIntent, enterScene, resolveEnemy } from "@kad/shared";
import type { Bestiary } from "@kad/shared";
import type { EncounterMap, EngineContext } from "@kad/shared";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { chapters, context, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-headwaters-washout")!;
const FORD = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../content/maps/ford.json"), "utf8")) as EncounterMap;
const BESTIARY = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../content/bestiary.json"), "utf8")) as Bestiary;
// The loader fills a fight's enemies from canon; do the same here.
const resolved = structuredClone(chapter);
const authored = resolved.scenes.drake_fight!;
if (authored.type === "encounter") authored.enemies = authored.enemies.map((enemy) => resolveEnemy(enemy, BESTIARY).spec!);
const ctx = (): EngineContext => ({ ...context(resolved), chapter: resolved, map: (id: string) => (id === FORD.id ? FORD : null) });

function gotos(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) gotos(item, out);
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (key === "goto" && typeof inner === "string") out.push(inner);
      else gotos(inner, out);
    }
  }
  return out;
}

it("the young river drake stands on every road to every ending", () => {
  const fight = chapter.scenes.drake_fight!;
  expect(fight.type).toBe("encounter");
  const endings = Object.keys(chapter.scenes).filter((id) => gotos(chapter.scenes[id]).length === 0);
  expect(endings.length).toBeGreaterThan(0);
  const seen = new Set<string>([chapter.entry]);
  const queue = [chapter.entry];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of gotos(chapter.scenes[id])) {
      if (next === "drake_fight" || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  for (const ending of endings) expect(seen.has(ending), `${ending} is reachable around the fight`).toBe(false);
  for (const report of pacingReport(chapter).scenarios) expect(report.shortest!.encounters).toBe(1);
});

it("a win grants the river charm and the coins; a loss lands back on the spine, with no setback", () => {
  const fight = chapter.scenes.drake_fight!;
  if (fight.type !== "encounter") throw new Error("Expected an encounter");
  expect(fight.onVictory.effects).toEqual([{ type: "grantItem", itemId: "river_charm", to: "party" }]);
  expect(fight.onDefeat.goto).toBe("drake_rescued");
  expect(chapter.scenes.drake_rescued).toMatchObject({ choices: [expect.objectContaining({ goto: "ledge_ahead" })] });
  expect(fight.onDefeat.goto).not.toBe(fight.onVictory.goto);
  for (const scene of Object.values(chapter.scenes)) if ("outcome" in scene) expect(scene.outcome).not.toBe("setback");

  const opened = enterScene(start(resolved, "manticore", "duskrunner"), "drake_fight", ctx());
  expect(opened.error).toBeUndefined();
  let state = opened.state;
  if (state.prompt?.kind === "ready") state = applyIntent(state, { playerId: "p1", intent: { type: "READY", ready: true } }, ctx()).state;
  expect(state.encounter).toBeTruthy();
  const beaten = { ...state.encounter!, combatants: state.encounter!.combatants.map((m) => (m.side === "enemy" ? { ...m, hp: 0, down: true } : m)) };
  const won = applyIntent({ ...state, encounter: beaten }, { playerId: "p1", intent: { type: "ADVANCE" } }, ctx());
  expect(won.error).toBeUndefined();
  expect(won.state.sceneId).toBe("ledge_ahead");
  expect(won.state.narration).toContain("You find");
  expect(won.state.coins ?? 0).toBeGreaterThan(0);
  expect(won.state.party.some((m) => m.character.inventory.some((item) => item.itemId === "river_charm"))).toBe(true);
});
