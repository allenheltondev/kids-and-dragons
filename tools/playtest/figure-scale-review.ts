/** Render the actual production mini-game components at phone and TV sizes.
 * npx tsx tools/playtest/figure-scale-review.ts (requires a running Vite server).
 * Checks painted-foot alignment, canonical species ratios, and usable figure sizes;
 * writes screenshots for composition review, independently of server/gameplay tests. */
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
const base=process.env.KAD_E2E_BASE_URL??'http://localhost:5173';
const out=process.env.KAD_REVIEW_OUT??'test-results/playtest/figure-scale';
fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(new URL('./fixtures/figure-scale.html',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:["--disable-features=LocalNetworkAccessChecks"],...(process.env.KAD_CHROMIUM?{executablePath:process.env.KAD_CHROMIUM}:{})});
try {
 for(const count of [2,4]) for(const kind of ['gem','haul','press','hum','tension','throw','cross','carry','cargo','legacy','legacycarry','relay']) for(const tv of [false,true]) {
  const page=await browser.newPage({viewport:tv?{width:1180,height:640}:{width:320,height:640},reducedMotion:'reduce'});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__figure-review?*',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(`${base}/__figure-review?kind=${kind}&n=${count}${tv?'&tv':''}`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.game-figure').first()).toBeVisible();
  await expect.poll(()=>page.locator('img').evaluateAll(es=>es.every(e=>(e as {complete:boolean}).complete)),{timeout:30000}).toBe(true);
  await page.locator('*').evaluateAll(es=>es.forEach(e=>e.getAnimations().forEach((a: {cancel():void})=>a.cancel())));
  const boxes=await page.locator('.game-figure').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
  expect(errors).toEqual([]);
  expect(boxes[0].height).toBeGreaterThan(tv?100:70);
  for(const [i,box] of boxes.entries()) {
   expect(box.width).toBeCloseTo(box.height,0);
   expect(box.y+box.height*.879).toBeCloseTo(boxes[0].y+boxes[0].height*.879,0);
   if(i>0) expect(box.height/boxes[0].height).toBeCloseTo([215,85,165,95][i]!/215,2);
  }
  await page.screenshot({path:`${out}/${kind}-${count}-${tv?'tv':'phone'}.png`});
  if(['gem','haul','carry','cargo','legacycarry'].includes(kind)) {
   const stage=await page.locator('.game-load-straps').boundingBox();
   const paths=await page.locator('.game-load-straps path').evaluateAll(es=>es.map(e=>e.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number)));
   expect(paths).toHaveLength(boxes.length);
   for(const [i,path] of paths.entries()) {
    expect(path.every(Number.isFinite)).toBe(true);
    expect(path[0]!+stage!.x).toBeGreaterThanOrEqual(boxes[i].x);
    expect(path[0]!+stage!.x).toBeLessThanOrEqual(boxes[i].right);
    expect(path[1]!+stage!.y).toBeGreaterThanOrEqual(boxes[i].y);
    expect(path[1]!+stage!.y).toBeLessThanOrEqual(boxes[i].bottom);
   }
  }
  if(kind==='gem') {
   await expect(page.locator('.gem-subject')).toHaveAttribute('data-height-cm','75');
   await expect(page.locator('.gem-subject')).toHaveAttribute('data-measured','true');
   await expect(page.locator('.gem-caption')).toBeVisible();
   const calf=await page.locator('.gem-subject').boundingBox();
   if(count===2&&tv) {
    await page.evaluate("const image=document.querySelector('.gem-subject');const canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.getContext('2d').drawImage(image,64,64,128,128);image.src=canvas.toDataURL();");
    await expect.poll(async()=>{const box=await page.locator('.gem-subject').boundingBox();return box!.height/calf!.height;}).toBeCloseTo(2,1);
   }
   await page.goto(`${base}/__figure-review?kind=gem&n=${count}&size=medium${tv?'&tv':''}`,{waitUntil:'domcontentloaded'});
   await expect(page.locator('.gem-subject')).toHaveAttribute('data-height-cm','150');
   await expect(page.locator('.gem-subject')).toHaveAttribute('data-measured','true');
   await expect.poll(async()=>{const box=await page.locator('.gem-subject').boundingBox();return Math.round(box!.height/calf!.height*100);}).toBe(200);
  }
  if(kind==='carry') {
   await expect(page.locator('.rift-beam__painting')).toHaveAttribute('data-measured','true');
   const field=await page.locator('.rift-field').boundingBox();
   const paint=await page.locator('.rift-beam__painting').boundingBox();
   const fill=Number(await page.locator('.rift-beam__painting').getAttribute('data-paint-width'));
   const height=Number(await page.locator('.rift-beam__painting').getAttribute('data-paint-height'));
   expect(paint!.width*fill).toBeGreaterThan(Math.min(field!.width*.76,field!.height*.55*fill/height)*.95);
  }
  if(kind==='carry') expect(await page.evaluate("getComputedStyle(document.querySelector('.rift-beam__painting')).objectFit")).toBe('contain');
  if(kind==='gem'&&!tv&&count===2) {
   for(const height of [480,800,640]) {
    await page.setViewportSize({width:320,height});
    const em=height<=740?8:10;
    await expect.poll(()=>page.evaluate("const field=document.querySelector('.gem-field');const css=getComputedStyle(field);({height:parseFloat(css.height)/parseFloat(css.fontSize),min:parseFloat(css.minHeight)/parseFloat(css.fontSize)})")).toEqual({height:em,min:height<=740?6:10});
    await expect(page.locator('.gem-force')).toBeVisible();
    await expect(page.getByRole('button',{name:'Lift the sling'})).toBeVisible();
    await page.screenshot({path:`${out}/gem-2-phone-${height}.png`});
   }
  }
  const held=kind==='relay'?await page.locator('.relay-world__flight').boundingBox():null;
  if(count===2 && ['throw','cross','relay'].includes(kind)) {
   await page.goto(`${base}/__figure-review?kind=${kind}&n=${count}&actor=1${tv?'&tv':''}`,{waitUntil:'domcontentloaded'});
   await expect(page.locator('.game-figure').first()).toBeVisible();
   if(kind==='relay') {
    await page.locator('*').evaluateAll(es=>es.forEach(e=>e.getAnimations().forEach((a: {cancel():void})=>a.cancel())));
    expect((await page.locator('.relay-world__flight').boundingBox())!.y).toBeGreaterThan(held!.y);
   } else {
    const small=await page.locator('.game-figure').boundingBox();
    expect(small!.height/boxes[0].height).toBeCloseTo(85/215,2);
   }
  }
  if(kind==='relay' && tv) {
   await page.goto(`${base}/__figure-review?kind=relay&n=${count}&tv&compact`,{waitUntil:'domcontentloaded'});
   await expect(page.locator('.game-figure').first()).toBeVisible();
   const stage=await page.locator('.relay-world__stage').boundingBox();
   for(const hero of await page.locator('.game-figure').all()) {
    const box=await hero.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(stage!.y);
    expect(box!.y+box!.height).toBeLessThanOrEqual(stage!.y+stage!.height);
   }
   await page.screenshot({path:`${out}/relay-${count}-compact-tv.png`});
  }
  console.log(`${kind}: ${count} heroes, ${tv?'TV':'phone'} passed`);
  await page.close();
 }
} finally {await browser.close();}


