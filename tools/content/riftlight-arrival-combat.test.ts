import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, committedAttacks, currentActorId, encounterOutcome, enterScene, legalMoves, positionOf, stepsBetween, type ClientIntent, type EngineContext, type RunState } from "@kad/shared";
import { loadContent } from "../../packages/server/src/content/loader.ts";
import { context, start } from "./riftlight-test-support.ts";
import { describeBeats } from "../../packages/client/src/screens/fight-log.ts";

const content = await loadContent(path.resolve(import.meta.dirname, "../../content"));
const cases = [
  { chapter: "riftlight-saltrot-arrival", scene: "crab_fight", target: { x: 3, y: 2 }, kind: "hold", win: "crab_done", loss: "crab_rescued", flag: "saltrot_bank_held", item: "luckstone" },
  { chapter: "riftlight-frostfang-shore", scene: "bar_crab", target: { x: 4, y: 2 }, kind: "close", win: "bar_carry", loss: "bar_carry", flag: "bar_burrow_open", item: "luckstone" },
  { chapter: "riftlight-sky-islands-arrival", scene: "wisp_fight", target: { x: 4, y: 2 }, kind: "rescue", win: "wisps_shooed", loss: "wisps_rescued", flag: "signal_basket_freed", item: "mosslight_jar" },
] as const;
function act(state: RunState, ctx: EngineContext, intent: ClientIntent) {
  const playerId = state.party.find(p => p.character.id === currentActorId(state.encounter!))?.playerId ?? state.party[0]!.playerId;
  const result = applyIntent(state, { playerId, intent }, ctx);
  expect(result.error, JSON.stringify(intent)).toBeUndefined();
  return result.state;
}
function setup(c: typeof cases[number], seats: number) {
  const chapter = content.chapter(c.chapter)!;
  const ctx = { ...context(chapter, 1), abilities: content.abilities(), map: (id: string) => content.map(id) };
  let state = enterScene(start(chapter, "kitsune", "songkeeper", {}, seats), c.scene, ctx).state;
  for (const member of state.party) {
    const result = applyIntent(state, { playerId: member.playerId, intent: { type: "READY", ready: true } }, ctx);
    expect(result.error).toBeUndefined(); state = result.state;
  }
  expect(state.encounter).toBeTruthy();
  return { state, ctx };
}
function work(state: RunState, ctx: EngineContext, c: typeof cases[number]) {
  const encounter = state.encounter!, actor = currentActorId(encounter)!;
  const danger = committedAttacks(encounter).flatMap(w => w.tiles);
  const distance = (p: {x:number;y:number}) => Math.max(0, stepsBetween(p, c.target) - (c.kind === "hold" ? 0 : 1));
  const score = (p: {x:number;y:number}) => distance(p) + Number(danger.some(t => t.x === p.x && t.y === p.y)) * 10;
  const next = [...legalMoves(encounter)].filter(p => c.kind !== "hold" || p.x !== 2 || p.y !== 3).sort((a,b) => score(a)-score(b))[0];
  if (next && score(next) < score(positionOf(encounter, actor)!)) state = act(state, ctx, { type: "MOVE", to: next });
  return act(state, ctx, { type: "END_TURN" });
}
describe.each(cases)("$chapter arrival fight", c => {
  it.each([1,2,4])("%i support heroes finish the authored job without attacking, through reload", seats => {
    let { state, ctx } = setup(c, seats);
    let turns = 0;
    while (state.encounter) {
      expect(++turns).toBeLessThan(60);
      expect(state.encounter.combatants.filter(e => e.side === "enemy").every(e => !e.down)).toBe(true);
      state = JSON.parse(JSON.stringify(work(state, ctx, c)));
    }
    expect(state.sceneId).toBe(c.win);
    expect(state.lastEncounter?.outcome).toBe("victory");
    expect(state.flags[c.flag]).toBe(true);
    expect(state.party.some(p => p.character.inventory.some(i => i.itemId === c.item))).toBe(true);

  });
  it("ignoring the job takes the existing recovery and loses the reward", () => {
    let { state, ctx } = setup(c, 2);
    for (let turn=0; state.encounter && turn<60; turn++) state=act(state,ctx,{type:"END_TURN"});
    expect(state.encounter).toBeNull();
    expect(state.sceneId).toBe(c.loss);
    expect(state.lastEncounter?.outcome).toMatch(/timedOut|defeat/);
    expect(state.party.some(p => p.character.inventory.some(i => i.itemId === c.item))).toBe(false);
    if (c.kind === "hold") expect(state.flags).toMatchObject({saltrot_crabs_kept:true,saltrot_no_run:true});
    if (c.kind === "close") expect(state.flags.crab_won_the_bar).toBe(true);
  });
});
it("the beacon's enemies cannot be cleared to skip steadying the flame", () => {
  const c=cases[2];const {state}=setup(c,1);
  const cleared={...state.encounter!,combatants:state.encounter!.combatants.map(e=>e.side==='enemy'?{...e,down:true,hp:0}:e)};
  expect(encounterOutcome(cleared)).toBe('ongoing');
});

it("leaving the basket alone lets its tugger pull it loose", () => {
  let {state,ctx}=setup(cases[2],1);
  for(let turn=0;state.encounter&&turn<20;turn++)state=act(state,ctx,{type:'END_TURN'});
  expect(state.lastEncounter?.outcome).toBe('defeat');
  expect(state.fightEndings?.[0]?.lost).toContain('the signal basket');
});
it("the shell-bank's low approach starts slumping in round two, and a hero can recover", () => {
  const c=cases[0];let {state,ctx}=setup(c,1);
  state=act(state,ctx,{type:'MOVE',to:{x:2,y:3}});
  state=act(state,ctx,{type:'END_TURN'});
  expect(state.encounter!.stepsLeft).toBe(state.party[0]!.character.steps);
  state=act(state,ctx,{type:'END_TURN'});
  expect(state.encounter!.stepsLeft).toBe(state.party[0]!.character.steps-2);
  // A direct return lets a crab sit on the bank. Lure it downhill first.
  state=act(state,ctx,{type:"MOVE",to:{x:4,y:5}});
  state=act(state,ctx,{type:"END_TURN"});
  for(let turn=0;state.encounter&&turn<40;turn++)state=work(state,ctx,c);
  expect(state.lastEncounter?.outcome).toBe('victory');
  expect(state.flags.saltrot_bank_held).toBe(true);
});

it("the gravel-bar tell can be interrupted with Fox Fire, while the other crab remains a threat", () => {
  let {state,ctx}=setup(cases[1],1);
  const threats=committedAttacks(state.encounter!);
  expect(threats).toHaveLength(2);
  const target=threats[0]!.actorId;
  const result=applyIntent(state,{playerId:state.party[0]!.playerId,intent:{type:'COMBAT_ACTION',abilityId:'fox_fire',targetId:target}},ctx);
  expect(result.error).toBeUndefined();
  expect(result.presentation?.kind).toBe('COMBAT_SEQUENCE');
  if(result.presentation?.kind!=='COMBAT_SEQUENCE')throw Error('Expected combat sequence');
  expect(result.presentation.events).toContainEqual({type:'windupInterrupted',actorId:target});
  expect(describeBeats(result.presentation.events, result.state.encounter!, null, 1).map(beat => beat.text).join(" ")).toContain("lowers its claws");
  expect(result.presentation.events).toContainEqual(expect.objectContaining({type:'windupReleased',actorId:threats[1]!.actorId}));
  state=result.state;
  for(let turn=0;state.encounter&&turn<40;turn++)state=work(state,ctx,cases[1]);
  expect(state.flags.bar_burrow_open).toBe(true);
});
it("standing in the claw sweep hurts; moving clear afterward still recovers the goats' route", () => {
  let {state,ctx}=setup(cases[1],1);
  const hits={...ctx,rng:{next:()=>.999}};
  const hp=state.encounter!.combatants.find(c=>c.side==='party')!.hp;
  state=act(state,hits,{type:'END_TURN'});
  expect(state.encounter!.combatants.find(c=>c.side==='party')!.hp).toBeLessThan(hp);
  for(let turn=0;state.encounter&&turn<40;turn++)state=work(state,hits,cases[1]);
  expect(state.lastEncounter?.outcome).toBe('victory');
  expect(state.flags.bar_burrow_open).toBe(true);
});
