/**
 * The size line (#370): every figure page says how big it is, in both units
 * with a comparison, and a page canon gives no height says nothing.
 * Built from wiki/public, like the other wiki specs.
 */
import { test, expect } from '@playwright/test';

const SIZED: [path: string, line: string][] = [
  ['/items/crimson_shard/', '8 cm (3 in), fits in a teapot.'],
  ['/characters/griffin/', '1.6 m (5 ft 3 in), as tall as a grown-up.'],
  ['/creatures/legend_dragon/', '14 m (46 ft), as long as a whale.'],
  ['/creatures/embermoth/', '18 cm (7 in), fits in a backpack. Usually flies.'],
  ['/npcs/merfolk/', '1.7 m (5 ft 7 in), as tall as a grown-up. Swims.'],
  ['/individuals/pib/', '25 cm (10 in), fits in a backpack.'],
];

test.describe('Size line (#370)', () => {
  for (const [path, line] of SIZED) {
    test(`${path} shows its size`, async ({ page }) => {
      await page.goto(path);
      const field = page.locator('.wiki-infobox .wiki-infobox__field--size');
      await expect(field).toHaveCount(1);
      await expect(field.locator('dt')).toHaveText('Size');
      await expect(field.locator('dd')).toHaveText(line);
    });
  }

  test('a page with no height has no size line', async ({ page }) => {
    await page.goto('/biomes/plains/');
    await expect(page.locator('.wiki-infobox')).toBeVisible();
    await expect(page.locator('.wiki-infobox__field--size')).toHaveCount(0);
  });
});
