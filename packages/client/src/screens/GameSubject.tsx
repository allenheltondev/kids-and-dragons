import { useState, type CSSProperties } from "react";
import type { CastMember } from "@kad/shared";
import { castSize, NOMINAL_PAINT, STANCE_LIFT, type PaintBox } from "../world/figure-scale";

export interface GameSubject extends CastMember { url: string }
/** Use the scene's size override, and measure transparent padding rather than sizing the file. */
export function GameSubjectImage({ subject, className, left="50%" }: { subject: GameSubject; className: string; left?:string }) {
  const [failed,setFailed]=useState<string|null>(null);
  const [measured, setMeasured] = useState<{url:string;box:PaintBox} | null>(null);
  const box = measured?.url === subject.url ? measured.box : NOMINAL_PAINT;
  const size = castSize(subject.figure, subject.size, subject.stance);
  const scale = size.heightCm / 215 * (NOMINAL_PAINT.bottom - NOMINAL_PAINT.top) / (box.bottom - box.top);
  const side = `calc(min(var(--figure-height, 110cqh), var(--figure-width, 32cqw)) * ${scale})`;
  return <img className={className} src={subject.url} alt="" draggable={false} data-height-cm={size.heightCm} data-measured={measured?.url===subject.url}
    style={{ visibility:failed===subject.url?"hidden":undefined,width:side,height:side,maxWidth:"none",left,bottom:`calc(var(--subject-ground, 0%) + ${side} * ${box.bottom - 1 + STANCE_LIFT[size.stance] * (box.bottom-box.top)})`,transform:"translateX(-50%)" } as CSSProperties}
    onLoad={event => {
      setFailed(null);
      try {
        const canvas=document.createElement("canvas");canvas.width=canvas.height=64;
        const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)return;
        ctx.drawImage(event.currentTarget,0,0,64,64);
        const pixels=ctx.getImageData(0,0,64,64).data;
        let top=64,bottom=-1,left=64,right=-1;
        for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(pixels[(y*64+x)*4+3]!>64){top=Math.min(top,y);bottom=y;left=Math.min(left,x);right=Math.max(right,x);}
        if(bottom>=top)setMeasured({url:subject.url,box:{top:top/64,bottom:(bottom+1)/64,left:left/64,right:(right+1)/64}});
      } catch { /* The nominal art contract remains usable when pixels cannot be read. */ }
    }} onError={()=>setFailed(subject.url)} />;
}
