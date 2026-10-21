import fs from 'node:fs';
import { chromium } from '@playwright/test';
const rows=JSON.parse(fs.readFileSync('art/source/issue-384/paintings.json','utf8')).filter(r=>r.id.startsWith('cast/'));
const mf=JSON.parse(fs.readFileSync('assets/manifest.json','utf8'));
const cells=rows.map(row=>{
  const f=mf.castFigures.find(f=>'cast/'+f.id===row.id);
  const uri='data:image/png;base64,'+fs.readFileSync('assets/'+row.id+'/assembled.png').toString('base64');
  return `<article><h2>${f.name}</h2><p>${f.basis} · ${f.heightCm} cm · ${f.stance}</p><div class="pair"><img src="${uri}"><img src="${uri}"></div></article>`;
}).join('');
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Issue 384 cast</title><style>body{background:#242431;color:#fff4dd;font:16px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article{background:#353544;padding:10px}h2{font-size:19px;margin:0}p{margin:6px 0 12px;font-size:13px}.pair{display:flex}.pair img{width:50%;height:240px;object-fit:contain;background:#f3e8cd}.pair img+img{background:#171721}</style></head><body><h1>Gemfall cast — #384</h1><p>Each painting shown on light and dark; stage height comes from manifest data.</p><main>${cells}</main></body></html>`;
fs.writeFileSync('art/review/issue-384/cast.html',html);
const browser=await chromium.launch({headless:true});
try {const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.setContent(html);await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));await page.screenshot({path:'art/review/issue-384/cast.png',fullPage:true});}
finally {await browser.close();}
