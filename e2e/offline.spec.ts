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
import { startCountingProxy } from "./counting-proxy";

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

test("the book saves its art even when it opens before the worker has taken over", async ({ browser }) => {
  // A phone that played before it had a worker: an identity, and no worker yet.
  const earlier = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const before = await earlier.newPage();
  await before.goto("/");
  await before.getByRole("button", { name: /want to host/i }).click();
  await before.getByText("Phone Mode").click();
  await before.getByLabel(/your name/i).fill("Ada");
  await before.getByRole("button", { name: /^start a game$/i }).click();
  await expect(before).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
  await createCharacter(before, "unicorn", HERO);
  await before.getByRole("button", { name: /begin the adventure/i }).click(TAP);
  await expect(before.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
  const identity = await earlier.storageState();
  await earlier.close();

  // Its first visit with a worker goes straight to the book. The worker
  // registers after `load` and then has ~2MB to save, so the book is open —
  // and wants its art saved — before any worker controls the page.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: identity });
  const phone = await context.newPage();
  try {
    await phone.goto("/journal");
    await expect(phone.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);
    expect(
      await phone.evaluate(() => navigator.serviceWorker.controller === null),
      "a worker already controlled the page, so this did not test the race",
    ).toBe(true);

    const painting = await phone.evaluate(async () => {
      const world = (await (await fetch("/content/world.json")).json()) as { image: { src: string } };
      return world.image.src;
    });
    await expect.poll(() => kept(phone, painting), { timeout: 60_000 }).toBe(true);
  } finally {
    await context.close();
  }
});

test("a tab left open across a deploy can still open the book", async ({ browser, baseURL }) => {
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    // A tab on this build, which has never opened the book: its code for the
    // book is a chunk it has not imported yet.
    await phone.goto("/");
    await controlled(phone);
    await expect
      .poll(() => phone.evaluate(async () => (await caches.match("/__kad/bundle-list")) !== undefined), { timeout: 20_000 })
      .toBe(true);

    // The deploy: a new worker whose build lists none of this build's code,
    // and a bucket that no longer has it (scripts/deploy.sh syncs `--delete`).
    proxy.configure({
      rewrite: (path) =>
        path === "/sw.js"
          ? (text) =>
              text
                .replace(/const __KAD_BUNDLE__ = \[[^\]]*\];/, "const __KAD_BUNDLE__ = [];")
                .replace(/const __KAD_PRECACHE__ = \[[^\]]*\];/, "const __KAD_PRECACHE__ = [];")
          : undefined,
      gone: (path) => path.startsWith("/bundle/"),
    });
    await phone.evaluate(async () => {
      const taken = new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      await (await navigator.serviceWorker.getRegistration())?.update();
      await taken;
    });
    // The new worker has recorded its own (empty) list: it has finished taking over.
    await expect
      .poll(() => phone.evaluate(async () => (await (await caches.match("/__kad/bundle-list"))?.json()) as unknown), { timeout: 20_000 })
      .toEqual([]);

    // The old tab opens the book for the first time, importing the old build's chunk.
    await phone.evaluate(() => {
      history.pushState(null, "", "/journal");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(phone.getByText(/your adventure book is empty/i)).toBeVisible(TAP);
    await expect(phone.getByText(/couldn.t open/i)).toHaveCount(0);
  } finally {
    await context.close();
    await proxy.close();
  }
});
