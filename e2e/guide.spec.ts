/**
 * The grown-up's guide (#257), in a real browser: reachable from the start
 * screen, drawn from its own chunk, its pictures served, and a way back.
 * Its words are held to the screens by tools/guide/guide.test.mjs.
 */

import { test, expect } from "@playwright/test";

const TAP = { timeout: 15_000 } as const;

test("a grown-up opens the guide from the start screen, sees the real screens, and goes back", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const fetched: string[] = [];
  page.on("request", (request) => fetched.push(new URL(request.url()).pathname));

  await page.goto("/");
  await expect(page.getByRole("button", { name: /want to host/i })).toBeVisible(TAP);
  // Nothing of the guide comes with the start screen.
  expect(fetched.filter((path) => /guide-pictures|\/guide\//.test(path))).toEqual([]);

  await page.getByRole("button", { name: /read the grown-up.s guide/i }).click(TAP);
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole("heading", { level: 1, name: /guide to running a game/i })).toBeVisible(TAP);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Quick start");
  await expect(page.getByRole("button", { name: "Print this guide" })).toBeVisible();

  // The first picture is a real file, not a broken image.
  const picture = page.locator(".guide__picture").first();
  await picture.scrollIntoViewIfNeeded();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), TAP).toBeGreaterThan(100);

  // A link straight to it works too, with nothing else open.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /guide to running a game/i })).toBeVisible(TAP);

  await page.getByRole("button", { name: "Back to the start" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /want to host/i })).toBeVisible(TAP);
  await context.close();
});
