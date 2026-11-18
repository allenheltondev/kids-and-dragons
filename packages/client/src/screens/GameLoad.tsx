import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PartyMember } from "@kad/shared";
import { figureSize } from "../world/figure-scale";

export interface SupportHero { member: PartyMember; x: number }
/** Stage a carried load against the crew, with straps to every helper.
 * This is display geometry only: lift, tilt and scoring still come from the shared rules. */
export function GameLoad({ crew, cameraWidth, left, right=100-left, rise=0, tilt=0, enabled=true, attachmentRise=0, attachmentInset=0, className, children }: {
  crew: SupportHero[]; cameraWidth:number; left:number; right?:number; rise?:number; tilt?:number; enabled?:boolean; attachmentRise?:number; attachmentInset?:number; className:string;children:ReactNode;
}) {
  const svg=useRef<SVGSVGElement>(null);
  const [size,setSize]=useState({width:0,height:0});
  useLayoutEffect(()=>{
    const node=svg.current;if(!node)return;
    const update=()=>{const r=node.getBoundingClientRect();setSize(old=>old.width===r.width&&old.height===r.height?old:{width:r.width,height:r.height});};
    update();if(typeof ResizeObserver==="undefined")return;const observer=new ResizeObserver(update);observer.observe(node);return()=>observer.disconnect();
  },[]);
  const base=Math.min(size.height*1.1,size.width*cameraWidth/100);
  const hands=crew.map(({member,x})=>{
    const canvas=base*figureSize(`characters/${member.character.species}`).heightCm/215;
    return {x:size.width*x/100+(x<(left+right)/2?1:-1)*canvas*.1,y:size.height*.88-canvas*.329};
  });
  const y=Math.min(size.height*.91,Math.max(...hands.map(p=>p.y),size.height*.6)+size.height*(.07-Math.min(.04,rise)));
  const delta=Math.max(-.02,Math.min(.02,tilt))*size.height;
  const span=size.width*(right-left)/100;
  const angle=Math.atan2(delta*2,span)*180/Math.PI;
  return <>
    <svg ref={svg} className="game-load-straps" aria-hidden="true" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",overflow:"visible"}}>
      {enabled&&size.height>0&&hands.map((p,i)=>{
        const center=size.width*(left+right)/200;
        const anchor=size.width*(p.x<center?left+attachmentInset*100:right-attachmentInset*100)/100;
        const radians=angle*Math.PI/180;
        const dx=anchor-center,dy=-attachmentRise*size.width;
        const x=center+dx*Math.cos(radians)-dy*Math.sin(radians);
        const end=y+dx*Math.sin(radians)+dy*Math.cos(radians);
        return <path key={crew[i]!.member.playerId} d={`M ${p.x} ${p.y} Q ${(p.x+x)/2} ${Math.max(p.y,end)+size.height*.015} ${x} ${end}`} fill="none" stroke="#b5915b" strokeWidth="2.5" />;
      })}
    </svg>
    <div className={className} style={enabled&&size.height>0?{left:`${left}%`,width:`${right-left}%`,bottom:`${size.height-y}px`,transform:`rotate(${angle}deg)`,transformOrigin:"50% 100%"}:undefined}>{children}</div>
  </>;
}
