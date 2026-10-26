import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, enterScene, resolveEnemy } from "@kad/shared";
import type { Bestiary, EncounterMap, EngineContext } from "@kad/shared";
import { chapters, context, start } from "../../tools/content/riftlight-test-support";
import { fightResult, interactionAppearance } from "../../packages/client/src/world/riftlight-art";

const RIFTLIGHT_ART={fights:[...chapters.values()].flatMap(c=>c.presentation?.fights??[])};
const root=path.resolve(import.meta.dirname,"../..");
const bestiary=JSON.parse(fs.readFileSync(path.join(root,"content/bestiary.json"),"utf8")) as Bestiary;
function play(fight:typeof RIFTLIGHT_ART.fights[number],won:boolean) {
 const chapter=structuredClone(chapters.get(fight.chapter)!);
 const scene=chapter.scenes[fight.scene]!;
 if(scene.type!=="encounter")throw Error("missing fight");
 scene.enemies=scene.enemies.map(enemy=>resolveEnemy(enemy,bestiary).spec!);
 const ctx:EngineContext={...context(chapter),chapter,map:id=>JSON.parse(fs.readFileSync(path.join(root,"content/maps",id+".json"),"utf8")) as EncounterMap};
 let state=enterScene(start(chapter,"manticore","duskrunner"),fight.scene,ctx).state;
 if(state.prompt?.kind==="ready") {
  const ready=applyIntent(state,{playerId:"p1",intent:{type:"READY",ready:true}},ctx);
  expect(ready.error).toBeUndefined();state=ready.state;
 }
 expect(state.encounter).toBeTruthy();
 const finished={...state.encounter!,combatants:state.encounter!.combatants.map(c=>(won?c.side==="enemy":c.side==="party")?{...c,hp:0,down:true}:c)};
 const result=applyIntent({...state,encounter:finished},{playerId:"p1",intent:{type:"ADVANCE"}},ctx);
 expect(result.error).toBeUndefined();
 return {chapter,ctx,state:result.state};
}
describe("persisted outcome art for the six opening fights",()=>{
 for(const fight of RIFTLIGHT_ART.fights)for(const won of [true,false])it(fight.scene+" "+(won?"victory":"rescue"),()=>{
  const {chapter,state,ctx}=play(fight,won);
  expect(state.sceneId).toBe(won?fight.victoryScene:fight.defeatScene);
  expect(state.lastEncounter).toMatchObject({chapterId:chapter.id,sceneId:fight.scene,destination:state.sceneId,outcome:won?"victory":"defeat"});
  if(won)expect(state.lastEncounter!.coinsEarned).toBeGreaterThan(0);
  else expect(state.lastEncounter!.coinsEarned).toBe(0);
  const restored=JSON.parse(JSON.stringify(state));
  expect(fightResult(chapter,restored)?.won).toBe(won);
  expect(fightResult(chapter,{...restored,lastEncounter:undefined})).toBeNull();
  expect(fightResult(chapter,{...restored,sceneId:"unrelated_scene"})).toBeNull();
  const left=enterScene(restored,chapter.entry,ctx);
  expect(left.error).toBeUndefined();expect(left.state.lastEncounter).toBeUndefined();
 });
 it("covers all authored interactions with real painted files",()=>{
  let count=0;
  for(const chapter of chapters.values())for(const [id,scene]of Object.entries(chapter.scenes)){
   if(scene.type!=="interaction" || !chapter.id.startsWith("riftlight-"))continue;
   const art=interactionAppearance(chapter,id);expect(art,chapter.id+"/"+id).not.toBeNull();
   for(const prop of art!.props ?? [])expect(fs.existsSync(path.join(root,"assets/story-props",prop+".webp")),prop).toBe(true);
   count++;
  }
  expect(count).toBe(50);
 });
 it("resolves all declared encounter terrain and pose art",()=>{
  for(const fight of RIFTLIGHT_ART.fights) {
   for(const url of [fight.tileUrl,fight.activeUrl,fight.retreatUrl])expect(fs.existsSync(path.join(root,url.slice(1))),url).toBe(true);
   for(const prop of fight.terrainProps)expect(fs.existsSync(path.join(root,"assets/story-props",prop+".webp")),prop).toBe(true);
   if(fight.rescueFigure)expect(fs.existsSync(path.join(root,"assets/cast",fight.rescueFigure,"assembled.png"))).toBe(true);
  }
 });
});
