/** Photograph the asset review, without changing campaign data or game UI. */
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const review = path.join(root, 'art/review/riftlight');
const browser = await chromium.launch();
try {
  for (const [mode, viewport] of [['tv', { width: 1920, height: 1080 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const url = pathToFileURL(path.join(review, 'index.html'));
    url.searchParams.set('mode', mode);
    await page.goto(url.href);
    await page.locator('.icons img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    if (mode === 'tv') {
      const layers = await page.locator('.layer').evaluateAll((nodes) => nodes.map((node) => node.style.backgroundImage));
      if (layers.length !== 1 || !layers[0].includes('rift_neutral.sheet.png')) throw new Error('TV must show only neutral');
    }
    // Pause every layer at the same phase for reproducible screenshots.
    await page.locator('.layer').evaluateAll((nodes) => {
      for (const node of nodes) { node.style.animationDelay = '-0.416s'; node.style.animationPlayState = 'paused'; }
    });
    await page.screenshot({ path: path.join(review, `asset-${mode}.png`), fullPage: true });
    if (mode === 'phone') {
      await page.getByLabel('Grayscale').check();
      await page.screenshot({ path: path.join(review, 'asset-phone-grayscale.png'), fullPage: true });
    }
    await page.close();
  }
} finally { await browser.close(); }
