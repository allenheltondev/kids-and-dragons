// Mechanical export of imagegen paintings onto the game's registered canvases.
// Run from the repository root: node art/source/issue-384/export.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const records = JSON.parse(fs.readFileSync('art/source/issue-384/paintings.json', 'utf8'));
function bounds(im) {
  let l = im.width, t = im.height, r = 0, b = 0;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (im.data[(y * im.width + x) * 4 + 3] > 8) {
      l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + 1); b = Math.max(b, y + 1);
    }
  }
  return [l, t, r, b];
}
// Bilinear resampling in premultiplied alpha avoids fringes on transparent edges.
function place(src, dst, box, target) {
  const [l,t,r,b] = box, [dx,dy,dw,dh] = target;
  for (let y = Math.max(0, Math.floor(dy)); y < Math.min(dst.height, Math.ceil(dy+dh)); y++) {
    for (let x = Math.max(0, Math.floor(dx)); x < Math.min(dst.width, Math.ceil(dx+dw)); x++) {
      const sx = l + (x-dx+0.5)*(r-l)/dw-0.5, sy = t+(y-dy+0.5)*(b-t)/dh-0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), fx=sx-ix, fy=sy-iy;
      const sums=[0,0,0,0];
      for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
        const xx=Math.max(l,Math.min(r-1,ix+i)), yy=Math.max(t,Math.min(b-1,iy+j));
        const p=(yy*src.width+xx)*4, w=(i?fx:1-fx)*(j?fy:1-fy), a=src.data[p+3]/255;
        for(let c=0;c<3;c++) sums[c]+=src.data[p+c]*a*w;
        sums[3]+=a*w;
      }
      const p=(y*dst.width+x)*4;
      for(let c=0;c<3;c++) dst.data[p+c]=sums[3]?Math.round(sums[c]/sums[3]):0;
      dst.data[p+3]=Math.round(sums[3]*255);
    }
  }
}
function components(im) {
  const seen=new Uint8Array(im.width*im.height), found=[];
  for(let start=0;start<seen.length;start++) {
    if(seen[start]||im.data[start*4+3]<=8) continue;
    const queue=[start];seen[start]=1;
    let l=im.width,t=im.height,r=0,b=0;
    for(let q=0;q<queue.length;q++) {
      const p=queue[q],x=p%im.width,y=Math.floor(p/im.width);
      l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);
      for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        if(xx<0||yy<0||xx>=im.width||yy>=im.height)continue;
        const n=yy*im.width+xx;
        if(!seen[n]&&im.data[n*4+3]>8) {seen[n]=1;queue.push(n);}
      }
    }
    found.push({box:[l,t,r,b],area:queue.length});
  }
  return found.sort((a,b)=>b.area-a.area);
}
function printTokens(src,dst,state) {
  // Register each painted print as a small sprite on the shared 75px circle.
  // Generation supplies the brushwork; export supplies exact UI registration.
  const angles=[-90,-18,54,126,198];
  let pieces;
  if(state==='empty') {
    const groups=angles.map(()=>[src.width,src.height,0,0]);
    for(let y=0;y<src.height;y++) for(let x=0;x<src.width;x++) {
      if(src.data[(y*src.width+x)*4+3]<=8)continue;
      const a=Math.atan2(y-src.height*.5,x-src.width*.5)*180/Math.PI;
      const differences=angles.map(v=>Math.abs(((a-v+540)%360)-180));
      const g=groups[differences.indexOf(Math.min(...differences))];
      g[0]=Math.min(g[0],x);g[1]=Math.min(g[1],y);g[2]=Math.max(g[2],x+1);g[3]=Math.max(g[3],y+1);
    }
    pieces=groups.map(box=>({box}));
  } else {
    pieces=components(src).slice(0,5).sort((a,b)=>{
      const angle=c=>{const [l,t,r,b]=c.box;return (Math.atan2((t+b)/2-src.height/2,(l+r)/2-src.width/2)*180/Math.PI+450)%360;};
      return angle(a)-angle(b);
    });
  }
  pieces.forEach((piece,i)=>{
    const rad=(-126+i*72)*Math.PI/180;
    const cx=95.5+75*Math.cos(rad),cy=95.5+75*Math.sin(rad);
    place(src,dst,piece.box,[cx-10,cy-10,20,20]);
  });
  if(state==='done') {
    const star=components(src).slice(5).filter(c=>c.area>100).sort((a,b)=>a.box[1]-b.box[1])[0];
    if(star) place(src,dst,star.box,[91,9,9,9]);
  }
  if(state==='helped') {
    const helpers=components(src).slice(5,10);
    helpers.forEach((piece,i)=>{
      const a=(-90+i*72)*Math.PI/180;
      place(src,dst,piece.box,[172+7*Math.cos(a)-2,95.5+7*Math.sin(a)-2,4,4]);
    });
  }
}
for (const row of records) {
  const src=PNG.sync.read(fs.readFileSync(row.source));
  const box=bounds(src), bw=box[2]-box[0], bh=box[3]-box[1];
  let dst, output;
  if (row.id.startsWith('cast/')) {
    dst=new PNG({width:1024,height:1024});
    const scale=Math.min(960/bw,800/bh), w=bw*scale, h=bh*scale;
    place(src,dst,box,[(1024-w)/2,901-h,w,h]);
    output=`assets/${row.id}/assembled.png`;
  } else if (row.id.includes('/band-')) {
    dst=new PNG({width:1600,height:360});
    // Both states share a lower-strip frame with room above for narration.
    const offsets={'heave/band-taut':[0,5],'hum/band-together':[10,5],'tiptoe/band-over':[-26,0]};
    const [ox,oy]=offsets[row.id]??[0,0];
    place(src,dst,box,[64+ox,110+oy,1472,240]);
    for(let y=0;y<360;y++) for(let x=0;x<1600;x++) {
      const p=(y*1600+x)*4;
      dst.data[p+3]=Math.round(dst.data[p+3]*Math.min(1,x/48,(1599-x)/48));
    }
    output=`assets/together/${row.id}.png`;
  } else {
    dst=new PNG({width:192,height:192});
    if(row.id.startsWith('tiptoe/')) printTokens(src,dst,row.id.split('-').at(-1));
    else if(row.id==='hum/token-helped') place(src,dst,[0,0,src.width,src.height],[5,5,182,182]);
    else place(src,dst,box,[10,10,172,172]);
    for(let y=0;y<192;y++) for(let x=0;x<192;x++) {
      const p=(y*192+x)*4, radius=Math.hypot(x-95.5,y-95.5);
      if(radius<=62 || x<8 || y<8 || x>=184 || y>=184) dst.data[p+3]=0;
    }
    output=`assets/together/${row.id}.png`;
  }
  const dest=path.join(root,output);
  // Limit overlay encoding precision to keep these lazy-loaded UI strips light.
  if (!row.id.startsWith('cast/')) for(let p=0;p<dst.data.length;p+=4) {
    for(let c=0;c<3;c++) dst.data[p+c]=Math.min(255,Math.round(dst.data[p+c]/16)*16);
    dst.data[p+3]=Math.min(255,Math.round(dst.data[p+3]/16)*16);
  }
  if(row.id.includes('/band-')) for(let y=0;y<360;y++) for(let x=0;x<1600;x++) {
    if(x<48||x>=1552) {
      const p=(y*1600+x)*4+3;dst.data[p]=Math.min(254,dst.data[p]);
    }
  }
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,PNG.sync.write(dst,{filterType:4}));
  console.log(output,fs.statSync(dest).size);
}
