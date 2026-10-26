import { useChapter, useRunState } from "../store";
import { fightResult, introAppearance } from "../world/riftlight-art";
import "./StoryArtLayer.css";

/** Decorative payoff only; the persisted engine receipt owns the outcome and loot. */
export function StoryArtLayer() {
 const chapter=useChapter(),state=useRunState();
 if(!chapter || !state || chapter.id!==state.chapterId || state.encounter)return null;
 const result=fightResult(chapter,state),intro=introAppearance(chapter,state);
 if(!result && !intro)return null;
 const art=result?.art??intro!;
 const props=result ? result.won ? art.props.filter(id=>id.startsWith("pickup-")) :
  art.creature==="will_o_wisp"?["fight-shrine-bell"]:art.creature==="glassback_crab"?["fight-warm-mud-hollow"]:[] :
  art.creature==="mire_mimic"?["fight-disguised-planks"]:art.creature==="will_o_wisp"?["fight-sideways-flame"]:[];
 const showRetreat=result?.won ?? false;
 return <div className="story-art-layer" aria-hidden="true" key={state.chapterId+":"+state.sceneId+":"+(result?.won?"won":"arrival")}>
  {showRetreat&&<img className="story-art-layer__retreat" data-direction={art.retreatDirection} src={art.retreatUrl} alt="" />}
  {props.map(id=><img key={id} className={"story-art-layer__prop"+(id==="fight-disguised-planks"?" story-art-layer__breath":"")} src={"/assets/story-props/"+id+".webp"} alt="" />)}
  {intro?.creature==="will_o_wisp"&&[0,1].map(i=><img key={i} className="story-art-layer__wisp" style={{animationDelay:(-i*1.6)+"s"}} src="/assets/entities/will_o_wisp/assembled.png" alt="" />)}
  {result?.won&&art.creature==="mire_mimic"&&<img className="story-art-layer__little" src="/assets/entities/mire_mimic/little.png" alt="" />}
  {result?.won&&(state.lastEncounter?.coinsEarned??0)>0&&<span className="story-art-layer__coins">{[0,1,2].map(i=><img key={i} src="/assets/story-glyphs/coin.svg" alt="" style={{animationDelay:(i*.12)+"s"}} />)}</span>}
 </div>;
}
