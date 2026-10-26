import { useState, type CSSProperties } from "react";
import { balanceReady, precisionPosition, precisionSuccess, relayHolder, supportsReady } from "@kad/shared";
import type { InteractionPrompt, PartyMember } from "@kad/shared";
import { useChapter, useRunState } from "../store";
import { reducedMotion } from "../a11y/prefs";
import { characterWorldArtUrl } from "../world/art-paths";
import { interactionAppearance, reactionFigure } from "../world/riftlight-art";
import "./InteractionArt.css";

export const propUrl = (id: string): string => "/assets/story-props/"+id+".webp";
export function glyphUrl(label: string): string | null {
 const text=label.toLowerCase();
 if (/tick/.test(text))return "/assets/story-glyphs/tick.svg";
 if (/tock/.test(text))return "/assets/story-glyphs/tock.svg";
 if (/hush|rest|quiet/.test(text))return "/assets/story-glyphs/hush.svg";
 if (/slow/.test(text))return "/assets/story-glyphs/slow.svg";
 if (/quick/.test(text))return "/assets/story-glyphs/quick.svg";
 if (/hold/.test(text))return "/assets/story-glyphs/hold.svg";
 if (/low/.test(text))return propUrl("note-low");
 if (/rise|high/.test(text))return propUrl("note-high");
 if (/hold|middle|mid/.test(text))return propUrl("note-middle");
 return null;
}
export function PaintedGlyph({label}:{label:string}) {
 const url=glyphUrl(label);return url?<img className="painted-glyph" src={url} alt="" aria-hidden="true" />:null;
}
export function PaintedCover({ bells, reveal, diving=false, icon }: {bells:boolean;reveal:boolean;diving?:boolean;icon?:string}) {
 const [failed,setFailed]=useState(false);
 return <span className={"painted-cover"+(bells?" painted-cover--bell":"")} aria-hidden="true">
  {reveal&&(icon?<span className="painted-cover__glow" />:<img className="painted-cover__peek" src={bells?propUrl("ticking-crystal"):"/assets/cast/"+(diving?"kid_burrowing":"kid_peeking")+"/assembled.png"} alt="" />)}
  {!failed && <img className="painted-cover__front" src={propUrl(icon ?? (bells?"wind-bells":"snow-mound"))} alt="" onError={()=>setFailed(true)} />}
  {failed && <span className="painted-cover__fallback" />}
 </span>;
}
function Picture({id,style,className=""}:{id:string;style?:CSSProperties;className?:string}) {
 return <img className={"interaction-art__prop "+className} src={propUrl(id)} alt="" style={style} decoding="async" onError={e=>{e.currentTarget.style.visibility="hidden";}} />;
}
/** Uses the same clock and authoritative prompt as the controls. It never scores an action. */
export function PaintedInteraction({prompt,party,now}:{prompt:InteractionPrompt;party:PartyMember[];now:number}) {
 const state=useRunState();
 const chapter=useChapter();
 const appearance=interactionAppearance(chapter?.id===state?.chapterId?chapter:null,state?.sceneId);
 if(!appearance || prompt.spec.kind==="tracking")return null;
 const {spec}=prompt;
 const still=reducedMotion()||prompt.relaxed||prompt.phase!=="active";
 const elapsed=Math.max(0,now-Date.parse(prompt.startedAt??new Date(now).toISOString()));
 const connected=party.filter(m=>m.connected).map(m=>m.playerId);
 let props=(appearance.props ?? []).filter(id=>!id.startsWith("note-"));
 if(props.includes("rope-taut")&&props.includes("rope-sag")) {
  const ready=spec.kind==="cooperate"?supportsReady(prompt,connected,new Date(now).toISOString()):spec.kind==="balance"?balanceReady(prompt,connected):false;
  props=[ready?"rope-taut":"rope-sag"];
 }
 const primary=props[0];
 const style:CSSProperties={};
 if(!still && (spec.kind==="precision" || spec.kind==="timing")) {
  const position=precisionPosition(elapsed,spec.periodMs);
  if(spec.kind==="precision") {style.left=(10+position*80)+"%";style.top=(65-Math.sin(position*Math.PI)*25)+"%";style.transform="translate(-50%,-50%) rotate("+(-25+position*50)+"deg)";}
  else {const safe=precisionSuccess(spec,position,prompt.relaxed);style.transform="translate(-50%,-50%) scaleY("+(safe?0.65:1)+")";style.opacity=safe?0.68:1; if(primary==="moving-floe" || primary==="ferry-boat")style.left=(40+position*20)+"%";}
 }
 if(spec.kind==="balance") {
  const levels=connected.map(id=>prompt.levels?.[id]??0);
  const tilt=levels.length>1?(levels.at(-1)!-levels[0]!)*20:0;
  style.transform="translate(-50%,-50%) rotate("+(still?0:tilt)+"deg)";
 }
 if(spec.kind==="relay") {
  const holder=relayHolder(prompt,connected);
  const index=holder?Math.max(0,party.findIndex(m=>m.playerId===holder)):party.length;
  style.left=(15+(index/Math.max(1,party.length))*70)+"%";
  style.top=prompt.caughtBy===holder?"44%":"35%";
 }
 if(prompt.phase==="ready"&&state?.sceneId==="interaction_egg_baskets"&&primary==="prop_egg_basket"){style.left="70%";style.top="48%";}
 if(spec.kind==="cooperate" && primary) {
  const supported=supportsReady(prompt,connected,new Date(now).toISOString());
  style.top=supported?"40%":"60%";
 }
 if(state?.sceneId==="chalk_snap"){style.left="50%";style.top="50%";style.transform="translate(-50%,-50%)";}
 if(spec.kind==="play"&&primary==="hatch-cover"){const open=spec.stages?.length?Math.min(1,(prompt.taps??0)/spec.stages.length):1;style.transform="translate(-50%,-50%) rotate("+(-open*65)+"deg)";}
 if(spec.kind==="play")style.filter=prompt.reactions?.length?"drop-shadow(0 0 6px #e6c878)":"none";
 const extras=state?.sceneId==="hatch_party"?["skupper_child","skupper_grandmother","skupper_weaver"]:state?.sceneId==="camp_play"&&state.chapterId==="riftlight-sky-islands-arrival"?["camp_hen"]:[];
 const reaction=reactionFigure(state?.sceneId??null,prompt,elapsed,chapter);
 return <div className="interaction-art" aria-hidden="true" data-kind={spec.kind} data-scene={state?.sceneId??undefined} data-still={still} data-phase={prompt.phase} key={prompt.openedSeq+":"+prompt.attempt}>
  {props.slice(1).map((id,index)=><Picture key={id} id={id} className="interaction-art__support" style={{left:(spec.kind==="precision"?10+spec.target*80:id==="fight-signal-pole"||id==="rope-basket"?85:15+index*70/Math.max(1,props.length-2))+"%",top:"58%"}} />)}
  {primary&&<Picture id={primary} style={style} className="interaction-art__main" />}
  {extras.map((id,index)=><img key={id} className="interaction-art__extra" src={"/assets/cast/"+id+"/assembled.png"} alt="" style={{left:(10+index*65/Math.max(1,extras.length-1))+"%"}} />)}
  {reaction&&<img className="interaction-art__reaction" src={"/assets/cast/"+reaction+"/assembled.png"} alt="" />}
  {["relay","cooperate","balance","precision","timing"].includes(spec.kind)&&party.map((member,index)=><img key={member.playerId}
   className={"interaction-art__hero"+(spec.kind==="relay"&&prompt.caughtBy===member.playerId?" interaction-art__hero--catch":"")}
   src={characterWorldArtUrl(member.character.species,member.character.tier,member.character.class)} alt=""
   style={{left:(15+index*70/Math.max(1,party.length))+"%"}} />)}
 </div>;
}
