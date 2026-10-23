/** Review the real RiftGlyph component/CSS, without changing a campaign. */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'art/review/painted-rifts');
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painted rifts · animation review</title><style>
* {box-sizing:border-box} body {margin:0;background:#191925;color:#e3ddce;font:16px system-ui}
main {max-width:1440px;margin:auto;padding:28px} h1 {font:32px Georgia;margin:0 0 12px}
p {line-height:1.5;color:#beb8b1} .cards {display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.card {background:#242432;border:1px solid #474352;border-radius:12px;padding:20px;min-height:220px}
.paint {font-size:42px;height:150px;display:flex;align-items:center;justify-content:center}
.caption {font-size:13px;color:#c4beb7;line-height:1.5} .grayscale .paint {filter:grayscale(1)}
.scenes {display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}
.scene {position:relative;aspect-ratio:16/9;background-size:cover;border-radius:12px;overflow:hidden}
.scene .paint {position:absolute;bottom:2%;left:32%;font-size:60px;height:220px}
.scene canvas {display:block;width:100%;height:100%}
label {display:block;margin:16px 0} @media(max-width:600px){main{padding:18px}.scenes{grid-template-columns:1fr}.scene .paint{font-size:40px;height:140px;left:30%}}
</style></head><body><main><h1>Painted rifts</h1>
<p>The shared doorway stays neutral. Only a Starweaver's World view adds colored, animated readings.</p>
<label><input id="gray" type="checkbox"> Compare patterns in grayscale</label>
<div id="root"></div><p>Opening and closing</p><div id="transitions" class="cards"></div>
</main><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import {RiftGlyph} from '/src/screens/RiftSight.tsx';
import {RIFT_SHEET,RIFT_SHEET_MS} from '/src/screens/riftlight.ts';
import {Application,Assets} from 'pixi.js';
import {createScene} from '/src/world/scene.ts';
import {stageCast} from '/src/world/cast.ts';
import {makeMember,makeCharacter} from '/src/testing/fixtures.ts';
const h=React.createElement;
const examples=[['Neutral shimmer',{status:'open',persistent:true},false,'TV and other phones'],
['Green + amber + violet',{status:'dormant',usesLeft:1,oneWay:true},true,'Breathing brackets · rim flicker · inward spiral'],
['Amber + violet',{status:'open',usesLeft:1,oneWay:true},true,'Candle-like rim flicker · inward spiral'],
['Green + blue',{status:'dormant',persistent:true},true,'Breathing brackets · outward ripples'],
['Blue + linked',{status:'open',persistent:true,linked:true},true,'Outward ripples · paired beat'],
['Timed',{status:'open',usesLeft:1,expiresIn:{unit:'visits',count:2}},true,'The complete painted stack contracts'],
['Unstable',{status:'open',usesLeft:1,unstable:true},true,'The complete painted stack stutters']];
createRoot(document.querySelector('#root')).render(h(React.Fragment,null,
h('div',{className:'scenes'},h('div',{className:'scene'}),h('div',{className:'scene'})),
h('div',{className:'cards'},...examples.map(([title,rift,riftlight,caption])=>h('article',{className:'card','data-title':title},h('b',null,title),h('div',{className:'paint'},h(RiftGlyph,{rift,riftlight})),h('div',{className:'caption'},caption))))));
function transition(effect){return h('article',{className:'card'},h('b',null,effect),h('div',{className:'paint'},h('span',{className:'rift-glyph','aria-hidden':true},h('span',{className:'rift-glyph__layer rift-glyph__layer--once','data-effect':effect,style:{backgroundImage:'url(/assets/effects/'+effect+'.sheet.png)',animationDuration:RIFT_SHEET_MS+'ms','--rift-columns':RIFT_SHEET.columns,'--rift-rows':Math.ceil(RIFT_SHEET.frames/RIFT_SHEET.columns)}}))))}
createRoot(document.querySelector('#transitions')).render(h(React.Fragment,null,transition('rift_open'),transition('rift_collapse')));
document.querySelector('#gray').onchange=e=>document.body.classList.toggle('grayscale',e.target.checked);
while(document.querySelectorAll('.scene').length!==2)await new Promise(requestAnimationFrame);
window.reviewStages=[];
for(const [index,host] of [...document.querySelectorAll('.scene')].entries()){
  const app=new Application();
  await app.init({width:host.clientWidth,height:host.clientHeight,antialias:true,resolution:1,preference:'webgl',preserveDrawingBuffer:true});
  host.append(app.canvas);
  const scene=createScene(app);
  scene.setBiome('glacier_of_origins',index?'scenes/gemfall/empty-chair-tavern':null);
  scene.setParty(['unicorn','kitsune','bigfoot'].map((species,i)=>makeMember({character:makeCharacter({id:'review-'+i,species,name:['Sparklehoof','Tumblefern','Bramblebeard'][i]})})));
  scene.setCast(stageCast([{figure:'cast/orin_vale',name:'Master Orin Vale'}]));
  scene.setRift('steady','review');
  scene.resize(host.clientWidth,host.clientHeight);
  window.reviewStages.push({app,scene});
}
window.reviewReady=true;
window.reviewAssets=Assets;
</script></body></html>`;

const server = await createServer({ root: path.join(root, 'packages/client'),
  server: { port: 5194, strictPort: true },
  plugins:[{name:'rift-art-review',configureServer(dev){
    dev.middlewares.use(async(req,res,next)=>{
      if(req.url!=='/rift-art-review')return next();
      res.setHeader('Content-Type','text/html');
      res.end(await dev.transformIndexHtml('/rift-art-review',html));
    });
  }}] });
await server.listen();
const browser = await chromium.launch();
try {
  await mkdir(output, {recursive:true});
  const errors=[];
  for (const [mode,width,height] of [['tv',1440,1080],['phone',390,844]]) {
    const page = await browser.newPage({viewport:{width,height}});
    // Exercise Pixi with a reported 4K limit and reject oversized uploads,
    // even when the development computer's GPU supports larger textures.
    await page.addInitScript(()=>{
      for(const Context of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
        if(!Context)continue;
        const proto=Context.prototype;
        const getParameter=proto.getParameter;
        proto.getParameter=function(parameter){return parameter===this.MAX_TEXTURE_SIZE?4096:getParameter.call(this,parameter);};
        const texImage2D=proto.texImage2D;
        proto.texImage2D=function(...args){
          const source=args.at(-1);
          const width=args.length>=9?args[3]:source?.width;
          const height=args.length>=9?args[4]:source?.height;
          if(width>4096||height>4096)throw new Error('Texture exceeds 4K: '+width+'x'+height);
          return texImage2D.apply(this,args);
        };
      }
    });
    page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/assets/**', async route=>{
      const relative=new URL(route.request().url()).pathname;
      if (!relative.startsWith('/assets/')) return route.continue();
      const body=await readFile(path.join(root,relative));
      await route.fulfill({body,contentType:relative.endsWith('.png')?'image/png':'image/webp'});
    });
    await page.goto('http://localhost:5194/rift-art-review');
    await page.waitForSelector('.rift-glyph__layer');
    await page.evaluate(async()=>{
      const urls=[...document.querySelectorAll('[style*="background-image"]')].map(el=>getComputedStyle(el).backgroundImage.slice(5,-2));
      await Promise.all(urls.map(url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=url;})));
    });
    const metrics=await page.evaluate(()=>{
      const layers=[...document.querySelectorAll('.rift-glyph__layer')];
      for(const animation of document.getAnimations()){animation.pause();animation.currentTime=1000;}
      return layers.map(el=>({name:getComputedStyle(el).animationName,size:getComputedStyle(el).backgroundSize}));
    });
    assert(metrics.every(m=>m.name.startsWith('rift-frames')&&m.size==='1200% 200%'));
    // Sample every CSS frame, including both sides of the row transition.
    const positions=await page.evaluate(()=>{
      const layer=document.querySelector('[data-title="Neutral shimmer"] .rift-glyph__layer');
      const animation=layer.getAnimations()[0];
      animation.effect.updateTiming({delay:0});
      return Array.from({length:24},(_,i)=>{
        animation.currentTime=(i+0.5)*2000/24;
        const css=getComputedStyle(layer);
        return [parseFloat(css.backgroundPositionX),parseFloat(css.backgroundPositionY)];
      });
    });
    positions.forEach(([x,y],i)=>{
      assert(Math.abs(x-(i%12)*100/11)<0.001, 'CSS column '+i);
      assert.equal(y,Math.floor(i/12)*100,'CSS row '+i);
    });
    await page.waitForFunction(()=>window.reviewReady&&window.reviewStages.length===2&&window.reviewStages.every(({app,scene})=>app.stage.getChildByLabel('rift',true)?.visible&&scene.storyFigureReport().every(f=>f.paint)));
    await page.waitForTimeout(2000); // Let the real stage's entrance/camera settle.
    const stageAlpha=await page.evaluate(()=>window.reviewStages.map(({app})=>app.stage.getChildByLabel('rift',true).alpha));
    assert.deepEqual(stageAlpha,[1,1]);
    await page.screenshot({path:path.join(output,`review-${mode}.png`),fullPage:true});
    await page.getByLabel('Compare patterns in grayscale').check();
    await page.screenshot({path:path.join(output,`review-${mode}-grayscale.png`),fullPage:true});
    // Exercise the real stage's one-shot -> loop -> gone lifecycle too.
    await page.evaluate(()=>window.reviewStages[0].scene.setRift('open','review-open'));
    await page.waitForFunction(()=>{
      const sprite=window.reviewStages[0].app.stage.getChildByLabel('rift',true);
      return sprite?.parent.visible&&sprite.texture.source===window.reviewAssets.get('/assets/effects/rift_neutral.sheet.png').source;
    });
    await page.evaluate(()=>window.reviewStages[0].scene.setRift('collapse','review-close'));
    await page.waitForFunction(()=>!window.reviewStages[0].app.stage.getChildByLabel('rift',true));
    await page.evaluate(()=>window.reviewStages[0].scene.setRift('steady','review-restored'));
    await page.waitForFunction(()=>window.reviewStages[0].app.stage.getChildByLabel('rift',true)?.parent.visible);
    // Last frame of a one-shot must stay on the sheet, never the phantom 25th frame.
    const end=await page.evaluate(()=>{
      for(const animation of document.getAnimations())animation.currentTime=2000;
      return [...document.querySelectorAll('.rift-glyph__layer--once')].map(el=>getComputedStyle(el).backgroundPosition);
    });
    assert.deepEqual(end,['100% 100%','100% 100%']);
    await page.emulateMedia({reducedMotion:'reduce'});
    const still=await page.locator('.rift-glyph__layer:not(.rift-glyph__layer--once)').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationName==='none'&&getComputedStyle(n).backgroundPosition==='0% 100%'));
    assert(still);
    await page.screenshot({path:path.join(output,`review-${mode}-reduced.png`),fullPage:true});
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: real component/stage at TV/phone sizes; neutral shared scenes; grayscale; reduced motion; CSS endpoints; stage opening -> loop -> closing -> gone.');
} finally {await browser.close();await server.close();}
