/**
 * The adventure book with no signal — on a reload, and in a new tab — against
 * a production build, where the service worker lives
 * (playwright.offline.config.ts; `npm run e2e:offline`).
 *
 * The review that asked for this was exact about the gap: going offline in a
 * tab that already had everything loaded proves nothing, because the page,
 * its code, the content and the map painting were all already in memory. So:
 * play a little, open the book once with a signal, then drop the network and
 * *reload*, and open it again in a fresh tab — and the hero, the map's
 * painting and the Field Guide must all still be there.
 */

import { test, expect, type Page } from "@playwright/test";
import { createCharacter } from "./characters";

const TAP = { timeout: 20_000 } as const;
const BOOK = /open your book/i;
const HERO = "Moonbeam";

/** True once the service worker controls the page. */
async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
}

/** Whether the worker has kept `url` in any of its caches. */
async function kept(page: Page, url: string): Promise<boolean> {
  return page.evaluate(async (target) => (await caches.match(target)) !== undefined, url);
}

/** At least one map image actually drawn — a broken image has no natural width. */
async function paintingShown(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>("img.atlas__painting, img.atlas__tile")].some(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
}

async function studyTheBook(page: Page): Promise<void> {
  const tray = page.getByRole("navigation", { name: "What to look at" });
  await expect(page.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);

  await tray.getByRole("button", { name: "Map" }).click(TAP);
  await expect(page.getByText(/^Last seen in /)).toBeVisible(TAP);
  await expect.poll(() => paintingShown(page), { timeout: 20_000 }).toBe(true);

  await tray.getByRole("button", { name: "Guide" }).click(TAP);
  const guide = page.getByRole("region", { name: "Field Guide" });
  await expect(guide.getByText(/^[1-9]\d* of \d+ found$/)).toBeVisible(TAP);
  // Open the find itself, whichever section it is in.
  for (const tab of await guide.getByRole("tab").all()) {
    await tab.click(TAP);
    const found = guide.locator("button.field-guide__card:not([disabled])");
    if ((await found.count()) === 0) continue;
    await found.first().click(TAP);
    await expect(guide.getByTestId("guide-detail")).toBeVisible(TAP);
    return;
  }
  throw new Error("the guide says something is found, but no section shows it");
}

test("the adventure book opens on a reload and in a new tab with no signal", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await context.newPage();

  // --- Online: the worker installs, a little play, the book opened once ---
  await phone.goto("/");
  await controlled(phone);

  await phone.getByRole("button", { name: /want to host/i }).click();
  await phone.getByText("Phone Mode").click();
  await phone.getByLabel(/your name/i).fill("Ada");
  await phone.getByRole("button", { name: /^start a game$/i }).click();
  await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
  await createCharacter(phone, "unicorn", HERO);
  await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
  await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);

  await phone.goto("/");
  await phone.getByRole("button", { name: BOOK }).click(TAP);
  await studyTheBook(phone);

  // The book saved its art while it had a signal (sw/warm.ts).
  const painting = await phone.evaluate(async () => {
    const world = (await (await fetch("/content/world.json")).json()) as { image: { src: string } };
    return world.image.src;
  });
  await expect.poll(() => kept(phone, painting), { timeout: 30_000 }).toBe(true);

  // --- No signal: a reload ---
  await context.setOffline(true);
  await phone.reload();
  await expect(phone.getByText(/no signal/i)).toBeVisible(TAP);
  await studyTheBook(phone);

  // --- No signal: a fresh tab, straight to the book ---
  const tab = await context.newPage();
  await tab.goto("/journal");
  await expect(tab.getByText(/no signal/i)).toBeVisible(TAP);
  await studyTheBook(tab);

  await context.close();
});
