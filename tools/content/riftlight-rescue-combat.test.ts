import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyIntent, combatantById, currentActorId, enterScene, legalMoves, positionOf, resolveEnemy, stepsBetween } from "@kad/shared";
import type { Bestiary, ClientIntent, EncounterMap, EngineContext, RunState } from "@kad/shared";
import { chapters, context, start } from "./riftlight-test-support.ts";
const root = path.resolve(import.meta.dirname, "../..");
const bestiary = JSON.parse(fs.readFileSync(path.join(root, "content/bestiary.json"), "utf8")) as Bestiary;
const map = JSON.parse(fs.readFileSync(path.join(root, "content/maps/riftlight_bone_yard.json"), "utf8")) as EncounterMap;
function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext) {
  const result = applyIntent(state, { playerId, intent }, ctx);
  expect(result.error, `${state.sceneId}/${intent.type}`).toBeUndefined();
  return result.state;
}
function setup(sceneId: string, face: number, size = 3, atNorthernPatch = false) {
  const chapter = structuredClone(chapters.get("riftlight-bone-yard")!);
  for (const scene of Object.values(chapter.scenes)) if (scene.type === "encounter") scene.enemies = scene.enemies.map(e => {
    const loaded = resolveEnemy(e, bestiary); expect(loaded.problems).toEqual([]); return loaded.spec!;
  });
  const board = structuredClone(map);
  // Isolate end-of-turn terrain damage at the same legal tile on both variants.
  // Objective routes below use the unchanged authored map and spawns.
  if (atNorthernPatch) board.partySpawns = [{ x: 5, y: 2 }];
  const ctx: EngineContext = { ...context(chapter, face), map: id => id === board.id ? board : null };
  let state = start(chapter, "manticore", "duskrunner", {}, size);
  const entered = enterScene(state, sceneId, ctx); expect(entered.error).toBeUndefined(); state = entered.state;
  for (const p of state.party) state = must(state, p.playerId, { type: "READY", ready: true }, ctx);
  expect(state.encounter).not.toBeNull();
  return { state, ctx };
}
it.each(["fight", "fight_seam", "fight_mats", "fight_seam_mats"])("%s can close its objective through real board turns", sceneId => {
  let { state, ctx } = setup(sceneId, 1);
  let turns = 0, workingTurns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(100);
    const actor = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === actor)!;
    expect(member).toBeDefined();
    const target = { x: 6, y: 3 };
    const distance = (p: { x: number; y: number }) => stepsBetween(p, target);
    if (distance(positionOf(state.encounter, actor)!) > 1) {
      const move = [...legalMoves(state.encounter)].filter(p => !(p.x === 5 && p.y === 2) && !(p.x === 4 && p.y === 5)).sort((a, b) => distance(a) - distance(b))[0];
      if (move && distance(move) < distance(positionOf(state.encounter, actor)!)) state = must(state, member.playerId, { type: "MOVE", to: { x: move.x, y: move.y } }, ctx);
    }
    if (distance(positionOf(state.encounter!, actor)!) <= 1) workingTurns++;
    state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe("cleared");
  expect(state.flags.bone_rift_closed).toBe(true);
  expect(workingTurns).toBe(sceneId.includes("seam") ? 2 : 3);
  expect(state.fightEndings?.[0]?.byObjective).toBe("Close the fresh tear");
});
it.each(["fight", "fight_seam", "fight_mats", "fight_seam_mats"])("%s retains a real defeat and outer-route recovery", sceneId => {
  let { state, ctx } = setup(sceneId, 20);
  let turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(200);
    const actor = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === actor)!;
    state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe("rescued");
  expect(state.flags.bone_retreat).toBe(true);
  expect(state.flags.bones_passage_done).not.toBe(true);
  expect(state.flags.bone_mats_recoverable).toBe(false);
  expect(state.flags.bone_plank_recoverable).toBe(false);
  expect(state.party.every(p => p.hp > 0 && !p.down)).toBe(true);
});
it("carried mats remove damage on the covered tile without changing the other hazard", () => {
  const damage = [];
  for (const sceneId of ["fight", "fight_mats"]) {
    let { state, ctx } = setup(sceneId, 1, 1, true);
    const actorId = state.party[0]!.character.id;
    const before = combatantById(state.encounter!, actorId)!.hp;
    state = must(state, state.party[0]!.playerId, { type: "END_TURN" }, ctx);
    damage.push(before - combatantById(state.encounter!, actorId)!.hp);
  }
  expect(damage).toEqual([1, 0]);
});
