// Isolated visual smoke check: no room creation or existing dev server required.
// Run from the repo root with `npm run atlas:review`.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const html = `<!doctype html><html><body><div id="root" style="position:fixed;inset:0" class="kad-surface kad-surface--map"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorldMapPanel } from '/src/screens/WorldMapPanel.tsx';
import { useGameStore } from '/src/store/index.ts';
import { setFieldGuideDiscoveries } from '/src/store/field-guide-discoveries.ts';
import { makeState, makeMember } from '/src/testing/fixtures.ts';
import { makeChapter } from '/@fs/${process.cwd().replaceAll('\\', '/')}/packages/shared/src/test-fixtures.ts';
import '/src/styles/theme.css';
import '/src/styles/components.css';
const world = await fetch('/content/world.json').then(r=>r.json());
const chapter = {...makeChapter(), biome:'enchanted_woods'};
useGameStore.setState({state:makeState({phase:'scene',chapterId:chapter.id,sceneId:chapter.entry,party:[makeMember()]}),chapter,world,
loadWorld:async()=>{},loadChapter:async()=>{},loadContent:async()=>{}});
window.discover=()=>setFieldGuideDiscoveries({'biome.enchanted_woods':{firstFoundBy:'p_1',foundAt:'2026-10-15'},'location.mosshome':{firstFoundBy:'p_1',foundAt:'2026-10-15'},'location.exchange':{firstFoundBy:'p_1',foundAt:'2026-10-15'},'location.stone_crossing':{firstFoundBy:'p_1',foundAt:'2026-10-15'}});
createRoot(document.getElementById('root')).render(React.createElement(WorldMapPanel));
</script></body></html>`;
const server = await createServer({configFile:false,root:process.cwd()+'/packages/client',plugins:[react(),{name:'review',configureServer(s){
  s.middlewares.use('/assets',express.static(process.cwd()+'/assets'));
  s.middlewares.use('/content',express.static(process.cwd()+'/content'));
  s.middlewares.use('/atlas-review',async (_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/atlas-review',html));});
}}],server:{host:'127.0.0.1',port:5175,strictPort:true,fs:{allow:[process.cwd()]}}});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:1200,height:800}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const waitForTiles=()=>page.waitForFunction(()=>[...document.querySelectorAll('.atlas__tile')].filter(i=>{
   const a=i.getBoundingClientRect(),b=document.querySelector('.atlas__viewport').getBoundingClientRect();
   return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 }).every(i=>i.complete&&i.naturalWidth>0));
 const centerAt=async(x,y)=>{
   await page.evaluate(({x,y})=>{const v=document.querySelector('.atlas__viewport'),s=document.querySelector('.atlas__sheet');
     v.scrollTo({left:s.offsetWidth*x/1000-v.clientWidth/2,top:s.offsetHeight*y/1000-v.clientHeight/2});}, {x,y});
   await waitForTiles();
 };
 await page.goto('http://127.0.0.1:5175/atlas-review');
 await page.getByRole('button',{name:'Enchanted Woods',exact:true}).click();
 await page.locator('.atlas__tile').first().waitFor();
 if(await page.getByRole('button',{name:'Read about MossHome'}).count()) throw Error('undiscovered label leaked');
 await page.evaluate(()=>window.discover());
 await page.getByRole('button',{name:'Read about MossHome'}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.atlas__tile')].filter(i=>{
   const a=i.getBoundingClientRect(),b=document.querySelector('.atlas__viewport').getBoundingClientRect();
   return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 }).every(i=>i.complete&&i.naturalWidth>0));
 const coversPane = await page.evaluate(()=>{
   const a=document.querySelector('.atlas__sheet').getBoundingClientRect(),b=document.querySelector('.atlas__viewport').getBoundingClientRect();
   return a.width>=b.width&&a.height>=b.height;
 });
 if(!coversPane) throw Error('Continuous atlas leaves sheet gutters');
 await mkdir('test-results',{recursive:true});
 await page.screenshot({path:'test-results/atlas-desktop.png'});
 await page.getByRole('button',{name:'Read about MossHome'}).click();
 await page.getByRole('heading',{name:'MossHome',exact:true}).waitFor();
 await page.getByRole('button',{name:'Enchanted Woods',exact:true}).last().click();
 await page.getByRole('heading',{name:'Enchanted Woods',exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to map',exact:true}).click();
 await page.getByRole('button',{name:'Closer'}).click();
 await page.locator('[data-patch="northwest"]').waitFor();
 await centerAt(500,500);
 await page.screenshot({path:'test-results/atlas-sections.png'});
 await page.getByRole('button',{name:'The Sunward Fields',exact:true}).click();
 const closer=page.getByRole('button',{name:'Closer'});
 while(await closer.isEnabled()) await closer.click();
 await page.locator('[data-route="route.exchange_to_sunward_fields"]').waitFor();
 await page.getByText('Roads and crossings (4)',{exact:true}).click();
 await page.getByRole('button',{name:'Exchange–Sunward Road',exact:true}).click();
 await waitForTiles();
 await page.screenshot({path:'test-results/atlas-routes.png'});
 await page.getByRole('button',{name:'Ashspan Bridge',exact:true}).click();
 await waitForTiles();
 await page.screenshot({path:'test-results/atlas-bridge.png'});
 await page.getByRole('checkbox',{name:'Routes',exact:true}).uncheck();
 if(await page.locator('[data-route]').count()) throw Error('Route toggle did not hide routes');
 await page.getByRole('button',{name:'Enchanted Woods',exact:true}).first().click();
 await page.getByRole('checkbox',{name:'Routes',exact:true}).check();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Closer'}).click();
 await waitForTiles();
 await page.screenshot({path:'test-results/atlas-phone.png'});
 if(errors.length) throw Error(errors.join('\n'));
 console.log('Browser review passed: desktop, phone, continuous coverage, tile loading, discovery reveal, Field Guide links, highest-detail routes and toggle.');
} finally {await browser.close();await server.close();}
