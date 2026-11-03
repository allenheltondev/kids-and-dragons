/**
 * The Temple in the Squall's fights, played turn by turn on the real board
 * (riftlight-squall-temple.test.ts walks the story around them). The bell
 * tower is two crawlers and a bell to ring; the landing is the push poles or
 * the cushioned corner, against two dizzy crawlers when the bell rang and the
 * whole swarm when it did not.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyIntent, currentActorId, enterScene, legalMoves, positionOf, resolveEnemy, stepsBetween } from "@kad/shared";
import { buffBonus } from "../../packages/shared/src/buffs.ts";
import type { Bestiary, ClientIntent, EncounterMap, EngineContext, RunState } from "@kad/shared";
import { chapters, context, start } from "./riftlight-test-support.ts";
const root = path.resolve(import.meta.dirname, "../..");
const bestiary = JSON.parse(fs.readFileSync(path.join(root, "content/bestiary.json"), "utf8")) as Bestiary;
const map = JSON.parse(fs.readFileSync(path.join(root, "content/maps/riftlight_squall_temple.json"), "utf8")) as EncounterMap;
const GUSTS = [{ x: 5, y: 2 }, { x: 4, y: 5 }];
const FIGHTS = {
  fight_bell: { crawlers: 2, kind: "close", work: 2, win: "bell_rung", lose: "clapper_gone", storm: false },
  fight_push: { crawlers: 2, kind: "close", work: 3, win: "pushed", lose: "damaged", storm: true },
  fight_push_swarm: { crawlers: 3, kind: "close", work: 3, win: "pushed", lose: "damaged", storm: true },
  fight_shelter: { crawlers: 3, kind: "hold", work: 2, win: "settled", lose: "damaged", storm: true },
  fight_shelter_swarm: { crawlers: 3, kind: "hold", work: 3, win: "settled", lose: "damaged", storm: true },
} as const;

function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext) {
  const result = applyIntent(state, { playerId, intent }, ctx);
  expect(result.error, `${state.sceneId}/${intent.type}`).toBeUndefined();
  return result.state;
}
function setup(sceneId: string, face: number, size = 3) {
  const chapter = structuredClone(chapters.get("riftlight-squall-temple")!);
  for (const scene of Object.values(chapter.scenes)) if (scene.type === "encounter") scene.enemies = scene.enemies.map(e => {
    const loaded = resolveEnemy(e, bestiary); expect(loaded.problems).toEqual([]); return loaded.spec!;
  });
  const ctx: EngineContext = { ...context(chapter, face), map: id => id === map.id ? map : null };
  let state = start(chapter, "manticore", "duskrunner", {}, size);
  const entered = enterScene(state, sceneId, ctx); expect(entered.error).toBeUndefined(); state = entered.state;
  for (const p of state.party) state = must(state, p.playerId, { type: "READY", ready: true }, ctx);
  expect(state.encounter).not.toBeNull();
  return { state, ctx };
}

it.each(Object.entries(FIGHTS))("%s brings the crawlers its story promised, in the weather it promised", (sceneId, spec) => {
  const { state } = setup(sceneId, 1);
  const fight = state.encounter!;
  expect(fight.combatants.filter(c => c.side === "enemy")).toHaveLength(spec.crawlers);
  const scene = chapters.get("riftlight-squall-temple")!.scenes[sceneId]!;
  if (scene.type !== "encounter") throw new Error("Expected a fight");
  const objective = scene.environment!.objectives![0]!;
  expect(objective.kind).toBe(spec.kind);
  expect(objective.kind === "close" ? objective.turns : objective.rounds).toBe(spec.work);
  // The squall knocks everyone's Guard down and the crosswind shoves; the bell tower is only wet.
  expect(buffBonus(fight.buffs, state.party[0]!.character.id, "guard")).toBe(spec.storm ? -1 : 0);
  expect(buffBonus(fight.buffs, fight.combatants.find(c => c.side === "enemy")!.id, "guard")).toBe(spec.storm ? -1 : 0);
  expect(fight.environment?.spec.hazards?.[0]?.push ?? null).toEqual(spec.storm ? { direction: "west", tiles: 1 } : null);
});

it.each(Object.entries(FIGHTS))("%s can be won by its objective through real board turns", (sceneId, spec) => {
  let { state, ctx } = setup(sceneId, 1);
  let turns = 0, working = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(150);
    const actor = currentActorId(state.encounter)!;
    const index = state.party.findIndex(p => p.character.id === actor);
    const target = spec.kind === "close" ? { x: 6, y: 3 } : index === 1 ? { x: 6, y: 4 } : index === 0 ? { x: 6, y: 3 } : { x: 5, y: 3 };
    const reach = spec.kind === "close" ? 1 : 0;
    const distance = (p: { x: number; y: number }) => stepsBetween(p, target);
    if (distance(positionOf(state.encounter, actor)!) > reach) {
      const move = [...legalMoves(state.encounter)].filter(p => !GUSTS.some(g => g.x === p.x && g.y === p.y)).sort((a, b) => distance(a) - distance(b))[0];
      if (move && distance(move) < distance(positionOf(state.encounter, actor)!)) state = must(state, state.party[index]!.playerId, { type: "MOVE", to: { x: move.x, y: move.y } }, ctx);
    }
    if (spec.kind === "close" && distance(positionOf(state.encounter!, actor)!) <= 1) working++;
    state = must(state, state.party[index]!.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe(spec.win);
  expect(state.fightEndings?.[0]?.byObjective).toBeTruthy();
  expect(state.flags[sceneId === "fight_bell" ? "temple_rang_in_fight" : "temple_plan_won"]).toBe(true);
  if (spec.kind === "close") expect(working).toBe(spec.work);
  expect(state.flags.temple_island_settled === true).toBe(spec.win === "settled");
  expect(state.flags.temple_damaged).not.toBe(true);
});

it.each(Object.entries(FIGHTS))("%s: a lost fight robs the bell or breaks the landing, and the story goes on", (sceneId, spec) => {
  let { state, ctx } = setup(sceneId, 20);
  let turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(200);
    const actor = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === actor)!;
    state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe(spec.lose);
  expect(state.party.every(p => p.hp > 0 && !p.down)).toBe(true);
  expect(state.flags.temple_island_settled).not.toBe(true);
  if (sceneId === "fight_bell") {
    expect(state.flags.temple_damaged).not.toBe(true);
    expect(state.narration).toContain("its clapper is gone");
  } else {
    expect(state.flags.temple_damaged).toBe(true);
    expect(state.narration).toContain("the landing breaks in two");
  }
  expect(state.prompt?.kind).toBe("choice");
});
