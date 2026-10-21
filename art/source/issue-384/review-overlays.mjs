import fs from 'node:fs';
import { chromium } from '@playwright/test';
const mf=JSON.parse(fs.readFileSync('assets/manifest.json','utf8'));
const uri=p=>'data:image/'+(p.endsWith('.webp')?'webp':'png')+';base64,'+fs.readFileSync(p).toString('base64');
const backgrounds=['assets/scenes/entry/home-market.webp','assets/scenes/gemfall/hollow-gate.webp'].map(uri);
const portrait=uri('assets/characters/unicorn/fledgling/assembled.png');
const sections=mf.togetherOverlays.map(move=>{
  const bands=move.band.states.map(state=>{
    const overlay=uri(`assets/together/${move.move}/band-${state}.png`);
    return `<h3>${state}</h3><div class="bands">${backgrounds.map(bg=>`<div class="band" style="background-image:url('${bg}')"><img src="${overlay}"></div>`).join('')}</div>`;
  }).join('');
  const tokens=backgrounds.map(bg=>`<div class="tokens" style="background-image:url('${bg}')">${move.token.states.map(state=>{
    const ring=uri(`assets/together/${move.move}/token-${state}.png`);
    return `<div><h4>${state}</h4>${[128,72].map(size=>`<span class="token" style="width:${size}px;height:${size}px"><img class="portrait" src="${portrait}"><img class="ring" src="${ring}"></span>`).join('')}</div>`;
  }).join('')}</div>`).join('');
  return `<section><h2>${move.move}</h2>${bands}<h3>TV 128 px / phone 72 px</h3>${tokens}</section>`;
}).join('');
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Issue 384 overlay review</title><style>
body{background:#171721;color:#fff4dd;font:18px system-ui;margin:28px}h1{margin:0}h2{font-size:30px}h3{margin:14px 0 6px}h4{margin:0 0 12px;font-size:16px;text-shadow:0 1px 3px #000}.bands{display:flex;gap:12px}.band{width:800px;height:180px;position:relative;background-size:cover;background-position:center}.band img{width:100%;height:100%}.tokens{display:flex;gap:28px;background-size:cover;background-position:center;margin:12px 0;padding:14px;width:1584px}.tokens>div{width:360px}.token{display:inline-block;position:relative;margin:0 12px}.ring{position:absolute;inset:0;width:100%;height:100%}.portrait{position:absolute;left:19%;top:19%;width:62%;height:62%;object-fit:contain;border-radius:50%;background:#2f3245}section{margin:36px 0 64px}
</style></head><body><h1>Group-action overlay review — #384</h1><p>Bright home market and dark Hollow Gate; source artwork shown at half-size for bands.</p>${sections}</body></html>`;
fs.writeFileSync('art/review/issue-384/overlays.html',html);
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1668,height:1000},deviceScaleFactor:1});
  await page.setContent(html);
  await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
  await page.screenshot({path:'art/review/issue-384/overlays.png',fullPage:true});
} finally {await browser.close();}
