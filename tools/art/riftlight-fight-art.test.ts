import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root=fileURLToPath(new URL("../..", import.meta.url));
const read=(path: string)=>JSON.parse(readFileSync(`${root}/${path}`,"utf8"));
const manifest=read("assets/manifest.json");
const bindings=manifest.fightArt.encounters;
const source=read("docs/reviews/issue-494/batch-4/source-fight-scenes.json");

describe("Riftlight's six nonlethal fight art bindings",()=>{
 it("covers the requested fights without changing their generic board identities",()=>{
  expect(bindings.map((b: any)=>[b.chapter,b.scene,b.board,b.creature])).toEqual([
   ["riftlight-headwaters-washout","drake_fight","ford","river_drake"],
   ["riftlight-frostfang-shore","bar_crab","ford","glassback_crab"],
   ["riftlight-cairnstep-pass","cache_fight","switchback","cinder_wolf"],
   ["riftlight-saltrot-arrival","crab_fight","reedbank","glassback_crab"],
   ["riftlight-ashspan-bridge","mimic_fight","reedbank","mire_mimic"],
   ["riftlight-sky-islands-arrival","wisp_fight","glade","will_o_wisp"],
  ]);
 });
 it("resolves every pose, backdrop and support prop through the delivered catalog",()=>{
  for(const binding of bindings){
   const creature=manifest.entities.find((e: any)=>e.id===binding.creature);
   for(const state of Object.values(binding.poses)){
    const path=state==="ordinary"?`entities/${creature.id}/assembled.png`:creature.states[state as string];
    expect(path,`${binding.scene} ${state}`).toBeDefined();
    expect(existsSync(`${root}/assets/${path}`),path).toBe(true);
   }
   expect(manifest.sceneIllustrations).toContain(binding.backdrop);
   expect(existsSync(`${root}/assets/${binding.backdrop}.webp`)).toBe(true);
   for(const prop of binding.props)expect(manifest.storyProps.ids).toContain(prop);
  }
 });
 it("uses existing reward items and their matching pickup illustrations",()=>{
  const items=read("content/items.json");
  const pickups: Record<string,string>={river_charm:"pickup-river-charm",luckstone:"pickup-luckstone",hearthstone_bead:"pickup-hearthstone-bead",quickfoot_lace:"pickup-quickfoot-lace",mosslight_jar:"pickup-mosslight-jar"};
  for(const binding of bindings){
   expect(items[binding.rewardItem]).toBeDefined();
   expect(binding.props).toContain(pickups[binding.rewardItem]);
  }
  expect(new Set(bindings.map((b: any)=>b.rewardItem)).size).toBe(5);
 });
 it("preserves authored outcome destinations and identifies shared win/loss scenes",()=>{
  expect(manifest.fightArt.revision).toBe(source.revision);
  for(const binding of bindings){
   const original=source.encounters.find((s: any)=>s.chapter===binding.chapter&&s.scene===binding.scene).definition;
   expect(binding.victoryScene).toBe(original.onVictory.goto);
   expect(binding.defeatScene).toBe(original.onDefeat.goto);
   expect(binding.sharedOutcome).toBe(original.onVictory.goto===original.onDefeat.goto);
   expect(binding.rewardItem).toBe(original.onVictory.effects.find((e: any)=>e.type==="grantItem").itemId);
  }
  expect(bindings.filter((b: any)=>b.sharedOutcome).map((b: any)=>b.scene)).toEqual(["bar_crab","cache_fight"]);
 });
});
