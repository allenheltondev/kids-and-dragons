// Direct art acceptance for #384 until the approved #361 design's runtime gate is implemented.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const manifest=JSON.parse(fs.readFileSync('assets/manifest.json','utf8'));
const declared=new Set();
const stats=[];
for(const move of manifest.togetherOverlays) {
  for(const kind of ['band','token']) {
    const spec=move[kind], seen=new Set(), centres=[];
    for(const state of spec.states) {
      const file=`assets/together/${move.move}/${kind}-${state}.png`;
      declared.add(file);
      const bytes=fs.readFileSync(file), im=PNG.sync.read(bytes);
      const w=kind==='band'?spec.width:spec.size, h=kind==='band'?spec.height:spec.size;
      assert.equal(im.width,w,file+' width'); assert.equal(im.height,h,file+' height');
      assert.equal(im.colorType,6,file+' RGBA');
      assert.ok(bytes.length<=(kind==='band'?256000:30720),file+' byte cap');
      const fingerprint=im.data.toString('base64');
      assert.ok(!seen.has(fingerprint),file+' distinct state'); seen.add(fingerprint);
      let count=0,sx=0,sy=0;
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
        const a=im.data[(y*w+x)*4+3];
        if(kind==='band') {
          if(y<spec.clearTopPx) assert.equal(a,0,file+' clear top');
          if(x<spec.fadeSidePx || x>=w-spec.fadeSidePx) assert.ok(a<255,file+' side fade');
        } else {
          if(x<8||y<8||x>=w-8||y>=h-8||Math.hypot(x-(w-1)/2,y-(h-1)/2)<=spec.holeRadius)
            assert.equal(a,0,file+' edge/hole');
        }
        if(a>8) {count++;sx+=x;sy+=y;}
      }
      assert.ok(count>0,file+' visible');
      const centre=[sx/count,sy/count];centres.push(centre);
      if(kind==='token') assert.ok(Math.hypot(centre[0]-(w-1)/2,centre[1]-(h-1)/2)<=8,file+' centred ring '+centre);
      stats.push({file,bytes:bytes.length,centre});
    }
    if(kind==='band') assert.ok(Math.hypot(centres[0][0]-centres[1][0],centres[0][1]-centres[1][1])<=8,
      `${move.move} band states register: ${JSON.stringify(centres)}`);
  }
}
for(const dir of fs.readdirSync('assets/together')) for(const file of fs.readdirSync(`assets/together/${dir}`))
  if(file.endsWith('.png')) assert.ok(declared.has(`assets/together/${dir}/${file}`),'undeclared '+file);
assert.equal(declared.size,18);
console.log(JSON.stringify(stats,null,2));
console.log('PASS: 18 RGBA overlays; dimensions, caps, holes, margins, fades, distinct states and registration.');
