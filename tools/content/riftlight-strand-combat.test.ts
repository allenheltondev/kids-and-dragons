import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyIntent, combatantById, currentActorId, enterScene, legalActions, legalMoves, positionOf, resolveEnemy, stepsBetween } from "@kad/shared";
import { buffBonus } from "../../packages/shared/src/buffs.ts";
import type { Bestiary, ClientIntent, EncounterMap, EngineContext, RunState } from "@kad/shared";
import { chapters, context, start } from "./riftlight-test-support.ts";
const root = path.resolve(import.meta.dirname, "../..");
const bestiary = JSON.parse(fs.readFileSync(path.join(root, "content/bestiary.json"), "utf8")) as Bestiary;
const configs = [
  ...["fight", "fight_soft"].map(sceneId => ({ chapterId: "riftlight-wyrm-nest", sceneId })),
  ...["push", "shelter"].flatMap(plan => ["", "_rope", "_cover"].map(prep => ({ chapterId: "riftlight-squall-temple", sceneId: `fight_${plan}${prep}` }))),
];
function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext) {
  const next = applyIntent(state, { playerId, intent }, ctx);
  expect(next.error, `${state.sceneId}/${intent.type}`).toBeUndefined();
  return next.state;
}
function setup(chapterId: string, sceneId: string, face: number, flags: Record<string, boolean> = {}) {
  const chapter = structuredClone(chapters.get(chapterId)!);
  for (const scene of Object.values(chapter.scenes)) if (scene.type === "encounter") scene.enemies = scene.enemies.map(e => {
    const loaded = resolveEnemy(e, bestiary); expect(loaded.problems).toEqual([]); return loaded.spec!;
  });
  const scene = chapter.scenes[sceneId]!;
  if (scene.type !== "encounter") throw Error("Expected encounter");
  const board = JSON.parse(fs.readFileSync(path.join(root, "content/maps", scene.map + ".json"), "utf8")) as EncounterMap;
  const ctx: EngineContext = { ...context(chapter, face), map: id => id === board.id ? board : null };
  let state = enterScene(start(chapter, "manticore", "duskrunner", flags, 3), sceneId, ctx).state;
  for (const p of state.party) state = must(state, p.playerId, { type: "READY", ready: true }, ctx);
  return { state, ctx };
}
it.each(configs)("$chapterId/$sceneId wins by its actual objective through board turns", ({ chapterId, sceneId }) => {
  let { state, ctx } = setup(chapterId, sceneId, 1, { nest_slab_unused: true });
  let turns = 0, work = 0;
  const close = sceneId.startsWith("fight_push");
  while (state.encounter) {
    expect(++turns).toBeLessThan(120);
    const actor = currentActorId(state.encounter)!;
    const index = state.party.findIndex(p => p.character.id === actor);
    expect(index).toBeGreaterThanOrEqual(0);
    const target = close ? { x: 6, y: 3 } : index === 1 ? { x: 6, y: 4 } : index === 0 ? { x: 6, y: 3 } : { x: 5, y: 3 };
    const distance = (p: { x: number; y: number }) => stepsBetween(p, target);
    if (distance(positionOf(state.encounter, actor)!) > (close ? 1 : 0)) {
      const move = [...legalMoves(state.encounter)].filter(p => !(p.x === 5 && p.y === 2) && !(p.x === 4 && p.y === 5)).sort((a, b) => distance(a) - distance(b))[0];
      if (move && distance(move) < distance(positionOf(state.encounter, actor)!)) state = must(state, state.party[index]!.playerId, { type: "MOVE", to: { x: move.x, y: move.y } }, ctx);
    }
    if (close && distance(positionOf(state.encounter!, actor)!) <= 1) work++;
    state = must(state, state.party[index]!.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.fightEndings?.[0]?.byObjective).toBeTruthy();
  if (chapterId.endsWith("wyrm-nest")) {
    expect(state.sceneId).toBe("room_clear");
    expect(state.flags.wyrm_ally).toBe(true);
    expect(state.flags.nest_slab_unused).toBe(false);
  } else {
    expect(state.sceneId).toBe(close ? "pushed" : "settled");
    if (close) expect(work).toBe(sceneId.endsWith("_rope") ? 2 : 3);
  }
});
it.each(configs)("$chapterId/$sceneId retains an actual defeat recovery", ({ chapterId, sceneId }) => {
  let { state, ctx } = setup(chapterId, sceneId, 20);
  let turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(200);
    const actor = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === actor)!;
    state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe(chapterId.endsWith("wyrm-nest") ? "room_moved" : "damaged");
  expect(state.flags[chapterId.endsWith("wyrm-nest") ? "wyrm_nest_kept" : "temple_damaged"]).toBe(true);
  expect(state.flags.wyrm_ally).not.toBe(true);
  expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
});
it.each(["push", "shelter"])("%s wind cover removes only the party's actual Guard penalty", plan => {
  for (const prep of ["", "_rope", "_cover"]) {
    const { state } = setup("riftlight-squall-temple", `fight_${plan}${prep}`, 1);
    const fight = state.encounter!;
    expect(buffBonus(fight.buffs, state.party[0]!.character.id, "guard")).toBe(prep === "_cover" ? 0 : -1);
    const enemy = fight.combatants.find(c => c.side === "enemy")!;
    expect(buffBonus(fight.buffs, enemy.id, "guard")).toBe(-1);
    expect(fight.environment!.spec.hazards![0]!.push).toEqual({ direction: "west", tiles: 1 });
  }
});
it("soft bedding changes actual held rounds without changing the enemies or slick ice", () => {
  const rounds: number[] = [];
  for (const sceneId of ["fight", "fight_soft"]) {
    let { state, ctx } = setup("riftlight-wyrm-nest", sceneId, 1);
    let turns = 0, firstHoldingRound: number | undefined, finalRound = 0;
    while (state.encounter) {
      expect(++turns).toBeLessThan(120);
      const actor = currentActorId(state.encounter)!;
      const index = state.party.findIndex(p => p.character.id === actor);
      const target = index === 1 ? { x: 6, y: 4 } : index === 0 ? { x: 6, y: 3 } : { x: 5, y: 3 };
      const distance = (p: { x: number; y: number }) => stepsBetween(p, target);
      const move = [...legalMoves(state.encounter)].filter(p => !(p.x === 5 && p.y === 2) && !(p.x === 4 && p.y === 5)).sort((a, b) => distance(a) - distance(b))[0];
      if (move && distance(move) < distance(positionOf(state.encounter, actor)!)) state = must(state, state.party[index]!.playerId, { type: "MOVE", to: { x: move.x, y: move.y } }, ctx);
      if (firstHoldingRound === undefined && state.encounter!.combatants.some(c => c.side === "party" && [{ x: 6, y: 3 }, { x: 6, y: 4 }].some(p => { const at = positionOf(state.encounter!, c.id)!; return at.x === p.x && at.y === p.y; }))) firstHoldingRound = state.encounter!.round;
      finalRound = state.encounter!.round;
      state = must(state, state.party[index]!.playerId, { type: "END_TURN" }, ctx);
    }
    expect(state.flags.wyrm_ally).toBe(true);
    rounds.push(finalRound - firstHoldingRound! + 1);
  }
  expect(rounds).toEqual([2, 1]);
});
it.each(["fight", "fight_soft"])("driving creatures off in %s does not grant the hollow ally or take its unused slab", sceneId => {
  let { state, ctx } = setup("riftlight-wyrm-nest", sceneId, 1, { nest_slab_unused: true });
  let turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(180);
    const actor = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === actor)!;
    const standing = state.encounter.combatants.filter(c => c.side === "enemy" && !c.down);
    const distance = (p: { x: number; y: number }) => Math.min(...standing.map(e => stepsBetween(p, positionOf(state.encounter!, e.id)!)));
    // Stay out of the held-ground tiles: this route deliberately wins by attack.
    const move = [...legalMoves(state.encounter)].filter(p => !((p.x === 6 && [3, 4].includes(p.y)) || (p.x === 5 && p.y === 2) || (p.x === 4 && p.y === 5))).sort((a, b) => distance(a) - distance(b))[0];
    if (move && distance(move) < distance(positionOf(state.encounter, actor)!)) state = must(state, member.playerId, { type: "MOVE", to: { x: move.x, y: move.y } }, ctx);
    const attack = legalActions(state.encounter!, { rules: ctx.rules, abilities: {}, rng: ctx.rng }).find(a => a.abilityId === "attack");
    if (attack?.targets[0]) {
      let first = true;
      const attackContext = { ...ctx, rng: { next: () => { if (first) { first = false; return .975; } return .025; } } };
      state = must(state, member.playerId, { type: "COMBAT_ACTION", abilityId: "attack", targetId: attack.targets[0] }, attackContext);
    }
    if (state.encounter && currentActorId(state.encounter) === actor) state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe("room_clear");
  expect(state.fightEndings?.[0]?.byObjective).toBeUndefined();
  expect(state.flags.wyrm_ally).not.toBe(true);
  expect(state.flags.nest_slab_unused).toBe(true);
});
