import { useState, type CSSProperties, type SyntheticEvent } from "react";
import type { CastMember } from "@kad/shared";
import { castSize, NOMINAL_PAINT, STANCE_LIFT, type PaintBox } from "../world/figure-scale";

export interface GameSubject extends CastMember { url: string }
export interface GamePropShape { aspect:number; left:{x:number;y:number}; right:{x:number;y:number} }
/** Alpha bounds are shared by creature sizing and prop support points. No Pixi dependency. */
function useGamePaint(url:string, onShape?:(shape:GamePropShape)=>void) {
  const [failed,setFailed]=useState<string|null>(null);
  const [measured,setMeasured]=useState<{url:string;box:PaintBox}|null>(null);
  const box=measured?.url===url?measured.box:NOMINAL_PAINT;
  const onLoad=(event:SyntheticEvent<HTMLImageElement>)=>{
    setFailed(null);
    try {
      const canvas=document.createElement("canvas");canvas.width=canvas.height=64;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)return;
      ctx.drawImage(event.currentTarget,0,0,64,64);
      const pixels=ctx.getImageData(0,0,64,64).data;
      const opaque=(x:number,y:number)=>(pixels[(y*64+x)*4+3]??0)>64;
      let top=64,bottom=-1,left=64,right=-1;
      for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(opaque(x,y)){top=Math.min(top,y);bottom=y;left=Math.min(left,x);right=Math.max(right,x);}
      if(bottom<top)return;
      const width=right+1-left;
      const support=(fraction:number)=>{
        const x=Math.round(left+(width-1)*fraction);
        let foot=bottom;
        for(let y=bottom;y>=top;y--)if(opaque(x,y)){foot=y;break;}
        return {x:(x+.5-left)/width,y:(foot-bottom)/width};
      };
      setMeasured({url,box:{top:top/64,bottom:(bottom+1)/64,left:left/64,right:(right+1)/64}});
      onShape?.({aspect:width/(bottom+1-top),left:support(.12),right:support(.88)});
    } catch { /* The nominal art contract remains usable when pixels cannot be read. */ }
  };
  return {box,ready:measured?.url===url,visibility:failed===url?"hidden" as const:undefined,onLoad,onError:()=>setFailed(url)};
}

/** Use the scene's size override, measuring paint rather than transparent padding. */
export function GameSubjectImage({subject,className,left="50%"}:{subject:GameSubject;className:string;left?:string}) {
  const paint=useGamePaint(subject.url),box=paint.box;
  const size=castSize(subject.figure,subject.size,subject.stance);
  const scale=size.heightCm/215*(NOMINAL_PAINT.bottom-NOMINAL_PAINT.top)/(box.bottom-box.top);
  const side=`calc(min(var(--figure-height, 110cqh), var(--figure-width, 32cqw)) * ${scale})`;
  return <img className={className} src={subject.url} alt="" draggable={false} data-height-cm={size.heightCm} data-measured={paint.ready}
    style={{visibility:paint.visibility,width:side,height:side,maxWidth:"none",left,bottom:`calc(var(--subject-ground, 0%) + ${side} * ${box.bottom-1+STANCE_LIFT[size.stance]*(box.bottom-box.top)})`,transform:"translateX(-50%)"} as CSSProperties}
    onLoad={paint.onLoad} onError={paint.onError} />;
}

/** Fill the support span with painted pixels while preserving the painting's aspect. */
export function GamePropImage({url,className,onShape,onError}:{url:string;className:string;onShape:(shape:GamePropShape)=>void;onError:()=>void}) {
  const paint=useGamePaint(url,onShape),box=paint.box;
  return <img src={url} className={className} alt="" draggable={false} data-measured={paint.ready} data-paint-width={box.right-box.left} data-paint-height={box.bottom-box.top}
    style={{position:"absolute",visibility:paint.visibility,left:"50%",top:"auto",bottom:0,width:`${100/(box.right-box.left)}%`,height:"auto",maxWidth:"none",transform:`translate(${-50*(box.left+box.right)}%,${100*(1-box.bottom)}%)`}}
    onLoad={paint.onLoad} onError={()=>{paint.onError();onError();}} />;
}
