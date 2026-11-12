import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, committedAttacks, createRunState, currentActorId, enterScene, legalActions, legalMoves, newCharacter, positionOf, resolveCharacter, stepsBetween, type ClassId, type ClientIntent, type EngineContext, type RunState } from "@kad/shared";
import { APPEARANCE } from "../../packages/shared/src/test-fixtures.ts";
import { loadContent } from "../../packages/server/src/content/loader.ts";
import { fightResult } from "../../packages/client/src/world/riftlight-art.ts";

const content = await loadContent(path.resolve(import.meta.dirname, "../../content"));
const cases = [
  { chapter: "riftlight-ashspan-bridge", scene: "mimic_fight", kind: "escape", target: { x: 6, y: 3 }, win: "mimic_won", loss: "mimic_shooed", item: "quickfoot_lace" },
  { chapter: "riftlight-cairnstep-pass", scene: "cache_fight", kind: "hold", target: { x: 3, y: 2 }, win: "neck", loss: "neck", item: "hearthstone_bead" },
  { chapter: "riftlight-headwaters-washout", scene: "drake_fight", kind: "close", target: { x: 4, y: 2 }, win: "ledge_ahead", loss: "drake_rescued", item: "river_charm" },
  { chapter: "bramblewood-01", scene: "encounter_bramblewisps", kind: "tag", target: { x: 6, y: 3 }, win: "scene_wisp_friends", loss: "scene_bundled", item: "mosslight_jar" },
] as const;
type Case = typeof cases[number];

function setup(c: Case, seats = 1, cls?: ClassId) {
  const chapter = content.chapter(c.chapter)!;
  const ctx: EngineContext = { chapter, rules: content.rules(), items: content.items(), abilities: content.abilities(), map: id => content.map(id), rng: { next: () => .025 }, now: "2026-11-12T12:00:00Z" };
  let state = createRunState({ runId: "remaining", roomCode: "LEFT", mode: "party", campaignId: chapter.campaignId, now: ctx.now });
  state.chapterId = chapter.id;
  state.flags = { loop_tied: true };
  state.party = Array.from({ length: seats }, (_, i) => {
    const playerId = `p${i + 1}`;
    const character = resolveCharacter(newCharacter({ id: `hero${i}`, householdId: "test", ownerPlayerId: playerId, name: `Friend ${i + 1}`, species: "kitsune", class: cls ?? (c.kind === "tag" ? "starweaver" : "songkeeper"), stats: { might: 1, quick: 1, clever: 1, heart: 0 }, appearance: APPEARANCE, rules: ctx.rules, startingLevel: c.kind === "tag" ? 1 : 4, now: ctx.now }), ctx.rules, ctx.items);
    return { playerId, character, hp: character.maxHp, down: false, ready: true, connected: true };
  });
  const entered = enterScene(state, c.scene, ctx);
  expect(entered.error).toBeUndefined();
  state = entered.state;
  for (const member of state.party) {
    const ready = applyIntent(state, { playerId: member.playerId, intent: { type: "READY", ready: true } }, ctx);
    expect(ready.error).toBeUndefined();
    state = ready.state;
  }
  return { state, ctx };
}
function act(state: RunState, ctx: EngineContext, intent: ClientIntent) {
  const playerId = state.party.find(p => p.character.id === currentActorId(state.encounter!))!.playerId;
  const result = applyIntent(state, { playerId, intent }, ctx);
  expect(result.error, JSON.stringify(intent)).toBeUndefined();
  return result;
}
function work(state: RunState, ctx: EngineContext, c: Case): RunState {
  const e = state.encounter!, actor = currentActorId(e)!;
  const danger = committedAttacks(e).flatMap(w => w.tiles);
  const hazards = e.environment?.spec.hazards?.flatMap(h => h.tiles) ?? [];
  const distance = (p: { x: number; y: number }) => c.kind === "tag"
    ? Math.max(0, Math.min(...e.combatants.filter(f => f.side === "enemy" && !f.down).map(f => stepsBetween(p, positionOf(e, f.id)!))) - 1)
    : Math.max(0, stepsBetween(p, c.target) - (c.kind === "close" ? 1 : 0));
  const score = (p: { x: number; y: number }) => distance(p) + 20 * Number(danger.some(t => t.x === p.x && t.y === p.y)) + 30 * Number(hazards.some(t => t.x === p.x && t.y === p.y));
  const at = positionOf(e, actor)!;
  const tile = [...legalMoves(e)].sort((a, b) => score(a) - score(b))[0];
  if (tile && score(tile) < score(at)) state = act(state, ctx, { type: "MOVE", to: tile }).state;
  if (c.kind === "tag") {
    const choices = legalActions(state.encounter!, { rules: ctx.rules, abilities: ctx.abilities!, rng: ctx.rng });
    const burst = choices.find(a => a.abilityId === "burst" && a.tiles.length);
    const positions = state.encounter!.combatants.filter(f => f.side === "enemy" && !f.down).map(f => positionOf(state.encounter!, f.id)!);
    const caught = (p: { x: number; y: number }) => positions.filter(t => t.x >= p.x && t.x < p.x + 2 && t.y >= p.y && t.y < p.y + 2).length;
    const aim = burst ? [...burst.tiles].sort((a, b) => caught(b) - caught(a))[0] : undefined;
    const attack = choices.find(a => a.abilityId === "attack" && a.targets.length);
    if (aim || attack) {
      state = act(state, { ...ctx, rng: { next: () => .999 } }, aim ? { type: "COMBAT_ACTION", abilityId: "burst", targetTile: aim } : { type: "COMBAT_ACTION", abilityId: attack!.abilityId, targetId: attack!.targets[0]! }).state;
      if (!state.encounter || currentActorId(state.encounter) !== actor) return state;
    }
  }
  return act(state, ctx, { type: "END_TURN" }).state;
}
describe.each(cases)("$chapter / $scene", c => {
  it.each([1, 2, 4])("%i heroes can finish the actual plan through saved-state reloads", seats => {
    let { state, ctx } = setup(c, seats);
    for (let turn = 0; state.encounter && turn < 90; turn++) state = JSON.parse(JSON.stringify(work(state, ctx, c)));
    expect(state.encounter).toBeNull();
    expect(state.lastEncounter).toMatchObject({ destination: c.win, outcome: c.kind === "escape" ? "escaped" : "victory" });
    expect(state.party.some(p => p.character.inventory.some(i => i.itemId === c.item))).toBe(true);
    if (c.kind !== "tag") expect(fightResult(content.chapter(c.chapter)!, JSON.parse(JSON.stringify(state)))?.won).toBe(true);
    if (c.kind === "hold") expect(state.flags.winter_stores_guarded).toBe(true);
    if (c.kind === "close") expect(state.flags.ford_stone_rolled).toBe(true);
  });
  it("ignoring the situation takes its authored recovery without the reward", () => {
    let { state, ctx } = setup(c);
    for (let turn = 0; state.encounter && turn < 90; turn++) state = act(state, ctx, { type: "END_TURN" }).state;
    expect(state.lastEncounter?.destination).toBe(c.loss);
    expect(state.lastEncounter?.outcome).toMatch(/timedOut|defeat/);
    expect(state.party.some(p => p.character.inventory.some(i => i.itemId === c.item))).toBe(false);
    if (c.kind !== "tag") expect(fightResult(content.chapter(c.chapter)!, state)?.won).toBe(false);
    if (c.kind === "hold") expect(state.flags.wolves_took_hay).toBe(true);
    if (c.kind === "close") expect(state.flags.loop_tied).toBe(false);
  });
});

it("every friend must clear Ashspan's ramp, with the first crossing saved", () => {
  const c = cases[0];
  let { state, ctx } = setup(c, 2);
  for (let turn = 0; state.encounter && !state.encounter.combatants.some(f => f.escaped) && turn < 20; turn++) state = work(state, ctx, c);
  expect(state.encounter?.combatants.filter(f => f.escaped)).toHaveLength(1);
  state = JSON.parse(JSON.stringify(state));
  for (let turn = 0; state.encounter && turn < 20; turn++) state = work(state, ctx, c);
  expect(state.lastEncounter?.outcome).toBe("escaped");
});

it("the ford current sweeps a poor stop back without erasing the first turn's work", () => {
  const c = cases[2];
  let { state, ctx } = setup(c);
  state = act(state, ctx, { type: "MOVE", to: { x: 3, y: 2 } }).state;
  state = act(state, ctx, { type: "END_TURN" }).state;
  expect(state.encounter?.environment?.objectives).toEqual([1]);
  state = act(state, ctx, { type: "MOVE", to: { x: 2, y: 3 } }).state;
  state = act(state, ctx, { type: "END_TURN" }).state;
  expect(positionOf(state.encounter!, currentActorId(state.encounter!)!)?.x).toBe(0);
  expect(state.encounter?.environment?.objectives).toEqual([1]);
  for (let turn = 0; state.encounter && turn < 30; turn++) state = work(state, ctx, c);
  expect(state.flags.ford_stone_rolled).toBe(true);
});

it("leaving the winter stores saves earned progress but gives the wolves a round", () => {
  const c = cases[1];
  let { state, ctx } = setup(c);
  state = work(state, ctx, c);
  expect(state.encounter?.environment?.objectives).toEqual([1]);
  state = act(state, ctx, { type: "MOVE", to: { x: 0, y: 3 } }).state;
  state = act(state, ctx, { type: "END_TURN" }).state;
  expect(state.encounter?.environment?.objectives).toEqual([1]);
  for (let turn = 0; state.encounter && turn < 30; turn++) state = work(state, ctx, c);
  expect(state.flags.winter_stores_guarded).toBe(true);
});

it("a first-level melee hero can play tag without Burst", () => {
  const c = cases[3];
  let { state, ctx } = setup(c, 1, "thornguard");
  for (let turn = 0; state.encounter && turn < 60; turn++) state = work(state, ctx, c);
  expect(state.lastEncounter?.outcome).toBe("victory");
});

it("ignoring marked sparks hurts, but leaves time to recover and win the jar", () => {
  const c = cases[3];
  let { state, ctx } = setup(c);
  const hero = () => state.encounter!.combatants.find(f => f.id === state.party[0]!.character.id)!;
  const hp = hero().hp;
  for (let turn = 0; state.encounter && hero().hp === hp && turn < 5; turn++) {
    state = act(state, { ...ctx, rng: { next: () => .999 } }, { type: "END_TURN" }).state;
  }
  expect(hero().hp).toBeLessThan(hp);
  expect(hero().down).toBe(false);
  for (let turn = 0; state.encounter && turn < 60; turn++) state = work(state, ctx, c);
  expect(state.lastEncounter?.outcome).toBe("victory");
});

it("a thorn mistake leaves steps to escape, and a daze interrupts a committed tag", () => {
  const c = cases[3];
  let { state, ctx } = setup(c);
  state = act(state, ctx, { type: "MOVE", to: { x: 3, y: 3 } }).state;
  const tag = committedAttacks(state.encounter!)[0]!;
  const interrupt = act(state, ctx, { type: "COMBAT_ACTION", abilityId: "fox_fire", targetId: tag.actorId });
  expect(interrupt.presentation?.kind).toBe("COMBAT_SEQUENCE");
  if (interrupt.presentation?.kind === "COMBAT_SEQUENCE") expect(interrupt.presentation.events).toContainEqual({ type: "windupInterrupted", actorId: tag.actorId });
  state = interrupt.state;
  expect(state.encounter!.stepsLeft).toBe(state.party[0]!.character.steps - 2);
  expect(state.encounter!.stepsLeft).toBeGreaterThan(0);
  for (let turn = 0; state.encounter && turn < 60; turn++) state = work(state, ctx, c);
  expect(state.lastEncounter?.outcome).toBe("victory");
});
