/** Capture every Riftlight activity on its actual TV and small phone surfaces. */
import fs from 'node:fs';
import { expect } from '@playwright/test';
import { openTable } from './table.ts';
import type { Chapter } from '../../packages/shared/src/index.ts';
const dir = 'test-results/playtest/riftlight-catalog';
fs.mkdirSync(dir, { recursive: true });
const findings: { chapter: string; scene: string; image: string; broken: string[] }[] = [];
for (const file of fs.readdirSync('content/chapters').filter(f => f.startsWith('riftlight-'))) {
  const chapter = JSON.parse(fs.readFileSync('content/chapters/' + file, 'utf8')) as Chapter;
  const scenes = Object.entries(chapter.scenes).filter(([, scene]) => scene.type === 'interaction');
  if (!scenes.length) continue;
  const table = await openTable({ chapterId: chapter.id, sceneId: scenes[0]![0], players: 2, startServer: false });
  try {
    for (const phone of table.phones) await phone.setViewportSize({ width: 360, height: 640 });
    for (const [sceneId] of scenes) {
      if (sceneId !== scenes[0]![0]) await table.goto(sceneId);
      for (const phone of table.phones) await expect(phone.getByRole('region', { name: 'Interaction controls' })).toBeVisible();
      const lead = await table.lead();
      await lead.getByRole('button', { name: /We.*ready/i }).click();
      await expect.poll(async () => { const p = (await table.state()).prompt; return p?.kind === 'interaction' && p.phase === 'active'; }).toBe(true);
      const image = await table.snap(chapter.id + '-' + sceneId, dir);
      const broken: string[] = [];
      for (const page of [table.tv, ...table.phones]) {
        const images = await page.locator('.game__board img').evaluateAll(elements => elements
          .filter(el => (el as { complete?: boolean; naturalWidth?: number }).complete && (el as { naturalWidth?: number }).naturalWidth === 0)
          .map(el => (el as { src?: string }).src ?? ''));
        broken.push(...images);
      }
      findings.push({ chapter: chapter.id, scene: sceneId, image, broken: [...new Set(broken)] });
      console.log(findings.length, chapter.id, sceneId, broken.length ? 'BROKEN ' + broken.join(', ') : 'captured');
      fs.writeFileSync(dir + '/index.json', JSON.stringify(findings, null, 2));
    }
  } finally { await table.close(); }
}
console.log('Captured', findings.length, 'activities;', findings.filter(f => f.broken.length).length, 'with failed images.');
