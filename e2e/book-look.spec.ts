/**
 * The book's Look page on a narrow phone (#685; docs/hero-looks.md §8.1): a
 * hero's longest allowed name (16 characters, hero-names.ts `NAME_MAX_LENGTH`)
 * stays whole on one line on every Nameplate and Title tile, plain or styled,
 * shrunk to fit its tile, never wrapped or cut off. jsdom has no layout, so
 * this is measured in a browser.
 */

import { test, expect, type Locator } from "@playwright/test";
import { phoneStorage, seedTable } from "./seed";

const TAP = { timeout: 20_000 } as const;
const HERO = "Sparklehoof Jinx"; // 16 characters, the most a name may have

/** How a name preview sits in its tile: on one line, and inside the tile's art. */
async function fit(preview: Locator): Promise<{ lines: number; overflow: number; text: string }> {
  return preview.evaluate((el) => {
    const name = el.querySelector(".hero-name__name") ?? el;
    const range = document.createRange();
    range.selectNodeContents(name);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    const art = el.closest(".book-look__tile-art") as HTMLElement;
    const box = el.getBoundingClientRect();
    const frame = art.getBoundingClientRect();
    const overflow = Math.max(0, Math.round(frame.left - box.left), Math.round(box.right - frame.right));
    return { lines: tops.size, overflow, text: name.textContent ?? "" };
  });
}

test("a hero's longest name stays whole on one line on every name tile, plain or styled", async ({ browser }) => {
  test.setTimeout(120_000);
  const table = await seedTable({ mode: "travel", ready: false, heroes: [{ name: HERO, species: "unicorn", class: "songkeeper" }] });
  // The narrowest phone the book is drawn for.
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, storageState: phoneStorage(table.phones[0]!) });
  try {
    const page = await context.newPage();
    await page.goto("/journal");
    await expect(page.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);
    await page.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Look" }).click(TAP);
    const look = page.getByTestId("look-editor");
    await expect(look).toBeVisible(TAP);

    const tiles: [string, string][] = [
      ["nameplate", '[data-nameplate="plain"]'],
      ["nameplate", "[data-nameplate]:not([data-nameplate=\"plain\"])"],
      ["title", '[data-title=""]'],
      ["title", '[data-title]:not([data-title=""])'],
    ];
    for (const [shelf, selector] of tiles) {
      await look.locator(`[data-shelf="${shelf}"]`).click(TAP);
      const tile = look.locator(selector).first();
      await expect(tile).toBeVisible(TAP);
      const measured = await fit(tile.getByTestId("look-name-preview"));
      expect(measured.text, `${shelf} ${selector}: the whole name`).toBe(HERO);
      expect(measured.lines, `${shelf} ${selector}: the name on one line`).toBe(1);
      expect(measured.overflow, `${shelf} ${selector}: the name inside its tile`).toBe(0);
    }
  } finally {
    await context.close();
  }
});
