/** Painted presentation for the authored Riftlight opening. No input or reward logic. */
import type { CastMember, Chapter, InteractionPrompt, RunState } from "@kad/shared";

export type FightAppearance = NonNullable<NonNullable<Chapter["presentation"]>["fights"]>[number];
export interface InteractionAppearance { props?: string[]; coverIcons?: string[] }
export function fightAppearance(chapter: Chapter | null, state: RunState | null): FightAppearance | null {
 if (!chapter || !state || chapter.id !== state.chapterId) return null;
 return chapter.presentation?.fights?.find(f => f.chapter === chapter.id && f.scene === state.sceneId) ?? null;
}
export function fightResult(chapter: Chapter | null, state: RunState | null): { art: FightAppearance; won: boolean } | null {
 const receipt = state?.lastEncounter;
 if (!chapter || !state || !receipt || chapter.id !== state.chapterId || receipt.chapterId !== chapter.id ||
     receipt.destination !== state.sceneId || state.encounter || !["victory","defeat"].includes(receipt.outcome)) return null;
 const art = chapter.presentation?.fights?.find(f => f.chapter === chapter.id && f.scene === receipt.sceneId);
 if (!art || state.sceneId !== (receipt.outcome === "victory" ? art.victoryScene : art.defeatScene)) return null;
 return { art, won: receipt.outcome === "victory" };
}
export function interactionAppearance(chapter: Chapter | null | undefined, sceneId: string | null | undefined): InteractionAppearance | null {
 return sceneId ? chapter?.presentation?.interactions?.[sceneId] ?? null : null;
}
export function introAppearance(chapter: Chapter | null, state: RunState | null): FightAppearance | null {
 if (!chapter || !state || chapter.id !== state.chapterId) return null;
 return chapter.presentation?.fights?.find(f => f.chapter === chapter.id && f.introScenes.includes(state.sceneId ?? "")) ?? null;
}
export function reactionFigure(sceneId: string | null, prompt: InteractionPrompt, elapsed = 0, chapter?: Chapter | null): string | null {
 const rule=chapter?.presentation?.reactions?.[sceneId??''];
 if(!rule)return null;
 if(prompt.phase==='result'&&prompt.outcome==='failure'&&rule.onFailure)return rule.onFailure;
 const spec=prompt.spec;
 if(spec.kind==='memory'&&rule.memory){
  const step=spec.stepMs*(prompt.relaxed?2:1);
  const id=spec.answer[Math.min(spec.answer.length-1,Math.floor(Math.max(0,elapsed)/step))];
  return rule.memory[id??'']??rule.defaultFigure??null;
 }
 const last=prompt.reactions?.at(-1);
 const id=last?prompt.contributions?.[last.playerId]:undefined;
 return rule.options?.[id??'']??rule.defaultFigure??null;
}
/** Preserve the authored guest list, replacing only the figure whose action is shown. */
export function artCast(chapter: Chapter, state: RunState, members: readonly CastMember[]): CastMember[] {
 const result = fightResult(chapter,state);
 const selected=result?.art.outcomeCast?.[result.won?'victory':'defeat']??members;
 const out=selected.map(m=>({...m}));
 const intro=introAppearance(chapter,state);
 if(intro && intro.creature !== "mire_mimic" && !out.some(m=>m.figure==="entities/"+intro.creature) && out.length<3)
  out.push({figure:"entities/"+intro.creature});
 return out;
}
export function castPoseUrl(figure: string, chapter: Chapter, state: RunState): string | null {
 const intro=introAppearance(chapter,state);
 if(intro && figure === "entities/"+intro.creature) return intro.activeUrl;
 const result=fightResult(chapter,state);
 if(result && figure === "entities/"+result.art.creature)
  return result.won ? result.art.retreatUrl : result.art.poses.recovery ? "/assets/entities/"+result.art.creature+"/"+result.art.poses.recovery+".png" : null;
 const prompt=state.prompt?.kind==="interaction"?state.prompt:null;
 if(prompt) {
  const reaction=reactionFigure(state.sceneId,prompt,0,chapter);
  const matches=reaction?.startsWith("duckling_")?figure==="entities/duckling":reaction?.startsWith("kid_")?figure==="cast/snowhorn_kid":figure==="entities/snowhorn_goat";
  if(reaction && matches)
   return "/assets/cast/"+reaction+"/assembled.png";
  const special=chapter.presentation?.castPoses?.[state.sceneId??'']?.[figure];
  if(special)return '/assets/cast/'+special+'/assembled.png';
 }
 return null;
}

export function interactionBackdrop(chapter: Chapter | null,state: RunState | null): string | null {
 if(chapter?.id!=="riftlight-saltrot-arrival" || state?.chapterId!==chapter.id || state.sceneId!=="hatch_party" || state.prompt?.kind!=="interaction" || state.prompt.spec.kind!=="play")return null;
 const prompt=state.prompt;
 if(prompt.spec.kind!=="play")return null;
 const open=!prompt.spec.stages?.length || (prompt.taps??0)>=prompt.spec.stages.length || (prompt.phase==="result"&&prompt.outcome!=="failure");
 return "scenes/riftlight/tidepocket-"+(open?"open":"buried")+"-hatch";
}
