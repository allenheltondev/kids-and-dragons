/**
 * The Borrowed Ruins' fights at the fresh tear, played turn by turn on the real
 * board (riftlight-bone-yard.test.ts walks the story around them). Shoving the
 * arch leads to the quick fight (two crawlers, a two-turn tear); helping it
 * along leads to the grown one (three crawlers, a three-turn tear). Letting
 * Pip keep the chip adds him to the swarm as someone to pull out.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyIntent, currentActorId, enterScene, legalMoves, positionOf, resolveEnemy, stepsBetween } from "@kad/shared";
import type { Bestiary, ClientIntent, EncounterMap, EngineContext, RunState } from "@kad/shared";
import { chapters, context, start } from "./riftlight-test-support.ts";
const root = path.resolve(import.meta.dirname, "../..");
const bestiary = JSON.parse(fs.readFileSync(path.join(root, "content/bestiary.json"), "utf8")) as Bestiary;
const map = JSON.parse(fs.readFileSync(path.join(root, "content/maps/riftlight_bone_yard.json"), "utf8")) as EncounterMap;
const TEAR = { x: 6, y: 3 };
const PIP = { x: 3, y: 7 };
const HAZARDS = [{ x: 5, y: 2 }, { x: 4, y: 5 }];
const FIGHTS = { fight_quick: { crawlers: 2, turns: 2 }, fight_quick_pip: { crawlers: 2, turns: 2 }, fight_grown: { crawlers: 3, turns: 3 }, fight_grown_pip: { crawlers: 3, turns: 3 } } as const;

function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext) {
  const result = applyIntent(state, { playerId, intent }, ctx);
  expect(result.error, `${state.sceneId}/${intent.type}`).toBeUndefined();
  return result.state;
}
function setup(sceneId: string, face: number, size = 3) {
  const chapter = structuredClone(chapters.get("riftlight-bone-yard")!);
  for (const scene of Object.values(chapter.scenes)) if (scene.type === "encounter") scene.enemies = scene.enemies.map(e => {
    const loaded = resolveEnemy(e, bestiary); expect(loaded.problems).toEqual([]); return loaded.spec!;
  });
  const ctx: EngineContext = { ...context(chapter, face), map: id => id === map.id ? map : null };
  let state = start(chapter, "manticore", "duskrunner", { bones_pip_chip: sceneId.endsWith("_pip") }, size);
  const entered = enterScene(state, sceneId, ctx); expect(entered.error).toBeUndefined(); state = entered.state;
  for (const p of state.party) state = must(state, p.playerId, { type: "READY", ready: true }, ctx);
  expect(state.encounter).not.toBeNull();
  return { state, ctx };
}
/** Walk the actor toward `target`, keeping off the loose stones; true when it ends beside it. */
function approach(state: RunState, ctx: EngineContext, target: { x: number; y: number }) {
  const actor = currentActorId(state.encounter!)!;
  const member = state.party.find(p => p.character.id === actor)!;
  const distance = (p: { x: number; y: number }) => stepsBetween(p, target);
  if (distance(positionOf(state.encounter!, actor)!) > 1) {
    const move = [...legalMoves(state.encounter!)].filter(p => !HAZARDS.some(h => h.x === p.x && h.y === p.y)).sort((a, b) => distance(a) - distance(b))[0];
    if (move && distance(move) < distance(positionOf(state.encounter!, actor)!)) state = must(state, member.playerId, { type: "MOVE", to: { x: move.x, y: move.y } }, ctx);
  }
  const beside = distance(positionOf(state.encounter!, actor)!) <= 1;
  return { state: must(state, member.playerId, { type: "END_TURN" }, ctx), beside };
}

it.each(Object.entries(FIGHTS))("%s brings the crawlers the shove or the wait called for, and closes in its turns", (sceneId, spec) => {
  const scene = chapters.get("riftlight-bone-yard")!.scenes[sceneId]!;
  if (scene.type !== "encounter") throw new Error("Expected a fight");
  const { state } = setup(sceneId, 1);
  expect(state.encounter!.combatants.filter(c => c.side === "enemy")).toHaveLength(spec.crawlers);
  expect(scene.environment!.objectives![0]).toMatchObject({ kind: "close", turns: spec.turns, endsFight: true });
});

it.each(Object.keys(FIGHTS))("%s can close the tear through real board turns", sceneId => {
  let { state, ctx } = setup(sceneId, 1);
  let turns = 0, working = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(100);
    const moved = approach(state, ctx, TEAR);
    state = moved.state;
    if (moved.beside) working++;
  }
  expect(state.sceneId).toBe("court_after");
  expect(state.flags.bones_tear_closed).toBe(true);
  expect(working).toBe(FIGHTS[sceneId as keyof typeof FIGHTS].turns);
  expect(state.fightEndings?.[0]?.byObjective).toBe("Close the fresh tear");
  expect(state.flags.bones_pip_freed).not.toBe(true);
  expect(state.narration).toContain("folds shut");
});

it.each(["fight_quick_pip", "fight_grown_pip"])("%s: a hero who pulls Pip out first still closes the tear, and Pip is freed", sceneId => {
  let { state, ctx } = setup(sceneId, 1);
  const first = state.party[0]!.character.id;
  let freedTurn = false, turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(150);
    const actor = currentActorId(state.encounter)!;
    const moved = approach(state, ctx, actor === first && !freedTurn ? PIP : TEAR);
    if (actor === first && !freedTurn && moved.beside) freedTurn = true;
    state = moved.state;
  }
  expect(freedTurn).toBe(true);
  expect(state.sceneId).toBe("court_after");
  expect(state.flags.bones_pip_freed).toBe(true);
  expect(state.narration).toContain("Pip tumbles out of the pile");
});

it.each(Object.keys(FIGHTS))("%s: a lost fight costs the drawing and the short way, and the story goes on", sceneId => {
  let { state, ctx } = setup(sceneId, 20);
  let turns = 0;
  while (state.encounter) {
    expect(++turns).toBeLessThan(200);
    const actor = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === actor)!;
    state = must(state, member.playerId, { type: "END_TURN" }, ctx);
  }
  expect(state.sceneId).toBe("swarmed");
  expect(state.flags).toMatchObject({ bones_retreat: true, bones_drawing_lost: true });
  expect(state.flags.bones_got_past).not.toBe(true);
  expect(state.flags.bones_tear_closed).not.toBe(true);
  expect(state.party.every(p => p.hp > 0 && !p.down)).toBe(true);
  expect(state.prompt?.kind === "choice" && state.prompt.options.map(o => o.id)).toEqual(["rim"]);
});
