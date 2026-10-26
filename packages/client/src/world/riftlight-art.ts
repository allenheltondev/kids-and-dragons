/** Painted presentation for the authored Riftlight opening. No input or reward logic. */
import type { CastMember, Chapter, InteractionPrompt, RunState } from "@kad/shared";
import raw from "./riftlight-art.generated.json";

export interface FightAppearance {
 chapter: string; scene: string; creature: string; introScenes: string[]; board: string;
 backdrop: string; props: string[]; poses: Record<string,string>; victoryScene: string; defeatScene: string;
 tileUrl: string; terrainProps: string[]; rescueFigure: string; activeUrl: string; retreatUrl: string; retreatDirection: number;
}
export interface InteractionAppearance { props: string[] }
const catalog = raw as unknown as { fights: FightAppearance[]; interactions: Record<string,Record<string,InteractionAppearance>> };
export const RIFTLIGHT_ART = catalog;
export function fightAppearance(chapter: Chapter | null, state: RunState | null): FightAppearance | null {
 if (!chapter || !state || chapter.id !== state.chapterId) return null;
 return catalog.fights.find(f => f.chapter === chapter.id && f.scene === state.sceneId) ?? null;
}
export function fightResult(chapter: Chapter | null, state: RunState | null): { art: FightAppearance; won: boolean } | null {
 const receipt = state?.lastEncounter;
 if (!chapter || !state || !receipt || chapter.id !== state.chapterId || receipt.chapterId !== chapter.id ||
     receipt.destination !== state.sceneId || state.encounter || !["victory","defeat"].includes(receipt.outcome)) return null;
 const art = catalog.fights.find(f => f.chapter === chapter.id && f.scene === receipt.sceneId);
 if (!art || state.sceneId !== (receipt.outcome === "victory" ? art.victoryScene : art.defeatScene)) return null;
 return { art, won: receipt.outcome === "victory" };
}
export function interactionAppearance(chapterId: string | null | undefined, sceneId: string | null | undefined): InteractionAppearance | null {
 return chapterId && sceneId ? catalog.interactions[chapterId]?.[sceneId] ?? null : null;
}
export function introAppearance(chapter: Chapter | null, state: RunState | null): FightAppearance | null {
 if (!chapter || !state || chapter.id !== state.chapterId) return null;
 return catalog.fights.find(f => f.chapter === chapter.id && f.introScenes.includes(state.sceneId ?? "")) ?? null;
}
export function reactionFigure(sceneId: string | null, prompt: InteractionPrompt, elapsed = 0): string | null {
 const spec = prompt.spec;
 if (spec.kind === "memory" && sceneId === "note_try") {
  const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
  const id = spec.answer[Math.min(spec.answer.length - 1, Math.floor(Math.max(0,elapsed)/step))];
  const text = (spec.options.find(o => o.id === id)?.label ?? id ?? "").toLowerCase();
  return /rise|high/.test(text) ? "singer_rise" : /hold|middle/.test(text) ? "singer_hold" : "singer_low";
 }
 if (sceneId==="carry_beam"&&prompt.phase==="result"&&prompt.outcome==="failure")return "kid_kicking";
 if (spec.kind !== "play") return null;
 const last = prompt.reactions?.at(-1);
 const id = last ? prompt.contributions?.[last.playerId] : undefined;
 const text = (spec.options.find(o => o.id === id)?.label ?? id ?? "").toLowerCase();
 if (sceneId === "duck_play") return /crumb|feed|oat/.test(text) ? "duckling_crumbs" : /yawn|sleep|rest/.test(text) ? "duckling_yawning" : /peep|sing|talk/.test(text) ? "duckling_peeping" : "duckling_heap";
 if (sceneId === "ridge_lee") return /hum|sing|tune/.test(text) ? "kid_listening" : /rub|kick|warm/.test(text) ? "kid_kicking" : "kid_shivering";
 if (sceneId === "herd_play") return /hay|feed/.test(text) ? "goat_chewing" : /brush|pet|rub/.test(text) ? "goat_leaning" : "lead_goat_bell";
 return null;
}
/** Preserve the authored guest list, replacing only the figure whose action is shown. */
export function artCast(chapter: Chapter, state: RunState, members: readonly CastMember[]): CastMember[] {
 const result = fightResult(chapter,state);
 const out = members.map(m => ({...m}));
 if (result) {
  const {art,won} = result;
  if (!won && art.rescueFigure) {
   const find = out.findIndex(m => art.rescueFigure === "tamsin_whistling" ? /tamsin|ridge.griffin/i.test(m.name ?? m.figure) :
     art.rescueFigure === "brask_pot_lid" ? /brask|pass_keeper/i.test(m.name ?? m.figure) :
     art.rescueFigure === "ossley_pole_tip" ? /ossley/i.test(m.name ?? m.figure) : false);
   if (find >= 0) out[find] = {...out[find]!,figure:"cast/"+art.rescueFigure};
   else if (out.length < 3) out.push({figure:"cast/"+art.rescueFigure,name:art.rescueFigure === "tidepocket_pots" ? "Tidepocket family" : undefined});
  }
  if (won && art.creature === "will_o_wisp") {
   for (const member of out) if (member.figure === "cast/pip_thistledown") member.figure="cast/pip_catching_glow";
  }
  if (!won && art.poses.recovery && out.length < 3) out.push({figure:"entities/"+art.creature,name:"Young river drakes",count:2});
 }
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
  const reaction=reactionFigure(state.sceneId,prompt);
  const matches=reaction?.startsWith("duckling_")?figure==="entities/duckling":reaction?.startsWith("kid_")?figure==="cast/snowhorn_kid":figure==="entities/snowhorn_goat";
  if(reaction && matches)
   return "/assets/cast/"+reaction+"/assembled.png";
  if(state.sceneId==="ferry_dock"&&figure==="cast/old_ossley")return "/assets/cast/ossley_pole_tip/assembled.png";
  if(["shelf_cross","crust_hold","herd_play"].includes(state.sceneId??"")&&figure==="cast/yeti_herder")return "/assets/cast/herder_hay_water/assembled.png";
  if((state.sceneId==="trial_echo"||state.sceneId==="song_track") && figure==="cast/seren_wisp") return "/assets/cast/seren_listening/assembled.png";
  if(state.sceneId==="trial_echo"&&figure==="cast/lady_olivia")return "/assets/cast/olivia_blanket/assembled.png";
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
