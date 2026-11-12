import fs from "node:fs";
import type { Page } from "@playwright/test";

/** Capture actual paintings, not the board's honest loading placeholders. */
export async function combatPaintReady(page: Page, chapterId: string, sceneId: string) {
  const chapter = JSON.parse(fs.readFileSync(new URL(`../content/chapters/${chapterId}.json`, import.meta.url), "utf8"));
  const scene = chapter.scenes[sceneId];
  const fight = chapter.presentation?.fights?.find((f: { scene: string }) => f.scene === sceneId);
  const urls = new Set<string>([fight?.tileUrl ?? `/assets/biomes/${chapter.biome}/tiles.png`]);
  if (fight?.activeUrl) urls.add(fight.activeUrl);
  if (scene.art) urls.add(`/assets/${scene.art}.webp`);
  for (const prop of fight?.terrainProps ?? []) urls.add(`/assets/story-props/${prop}.webp`);
  for (const feature of [...(scene.environment?.objectives ?? []), ...(scene.environment?.hazards ?? []), ...(scene.environment?.exits ?? [])]) {
    if (feature.art) urls.add(`/assets/story-props/${feature.art}.webp`);
  }
  for (const enemy of scene.enemies) if (enemy.creature) urls.add(`/assets/entities/${enemy.creature}/assembled.png`);
  await page.evaluate(async urls => {
    await Promise.all(urls.map(async url => { const img = new Image(); img.src = url; await img.decode(); }));
    await Promise.all([...document.querySelectorAll<HTMLImageElement>(".turn-banner img, .fight-log img")].filter(img => img.currentSrc || img.src).map(img => img.decode()));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, [...urls]);
}
