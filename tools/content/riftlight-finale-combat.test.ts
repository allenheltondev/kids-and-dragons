import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyIntent, currentActorId, enterScene, legalMoves, positionOf, resolveEnemy, stepsBetween } from "@kad/shared";
import type { Bestiary, ClientIntent, EncounterMap, EngineContext, RunState } from "@kad/shared";
import { chapters, context, start } from "./riftlight-test-support.ts";
const root = path.resolve(import.meta.dirname, "../..");
const bestiary = JSON.parse(fs.readFileSync(path.join(root, "content/bestiary.json"), "utf8")) as Bestiary;
const map = JSON.parse(fs.readFileSync(path.join(root, "content/drafts/riftlight/maps/riftlight_finale.json"), "utf8")) as EncounterMap;
function setup(sceneId: string, face: number) {
  const chapter = structuredClone(chapters.get("riftlight-finale")!);
  for (const scene of Object.values(chapter.scenes)) if (scene.type === "encounter") scene.enemies = scene.enemies.map(e => {
    const loaded = resolveEnemy(e, bestiary);
    expect(loaded.problems).toEqual([]);
    return loaded.spec!;
  });
  const ctx: EngineContext = { ...context(chapter, face), map: id => id === map.id ? map : null };
  let state = start(chapter, "manticore", "duskrunner", {}, 3);
  state = enterScene(state, sceneId, ctx).state;
  for (const member of state.party) state = must(state, member.playerId, { type: "READY", ready: true }, ctx);
  expect(state.encounter).not.toBeNull();
  return { state, ctx };
}
function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext) {
  const next = applyIntent(state, { playerId, intent }, ctx);
  expect(next.error, `${state.sceneId}/${intent.type}`).toBeUndefined();
  return next.state;
}
it.each(["fight_standard", "fight_weakened"])("%s can close the actual seam objective through board turns", sceneId => {
  let { state, ctx } = setup(sceneId, 1); // Missed enemy attacks isolate the board objective.
  let turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(100);
    const id = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === id)!;
    expect(member).toBeDefined();
    const at = positionOf(state.encounter, id)!;
    const target = { x: 6, y: 3 };
    const distance = (p: { x: number; y: number }) => stepsBetween(p, target);
    if (distance(at) > 1) {
      const move = [...legalMoves(state.encounter)].filter(p => !(p.x === 5 && p.y === 2) && !(p.x === 4 && p.y === 5)).sort((a, b) => distance(a) - distance(b))[0];
      if (move && distance(move) < distance(at)) state = must(state, member.playerId, { type: "MOVE", to: { x: move.x, y: move.y } }, ctx);
    }
    state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe("spent");
  expect(state.flags.final_condition_closed).toBe(true);
  expect(state.fightEndings?.[0]?.byObjective).toBe("Hold the ridge and close the last seam");
});
it.each(["fight_standard", "fight_weakened"])("a whole-party loss in %s reaches rescue through the real engine", sceneId => {
  let { state, ctx } = setup(sceneId, 20);
  let turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(200);
    const id = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === id)!;
    state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe("loss_recover");
  expect(state.flags.final_battle_lost).toBe(true);
  expect(state.party.every(p => p.hp > 0 && !p.down)).toBe(true);
});
