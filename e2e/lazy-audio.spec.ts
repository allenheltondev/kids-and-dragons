/**
 * The sound engine arrives after the home screen, not with it (#318).
 * `perf:bundle` weighs only the static first paint, so this holds the engine's
 * request open in a real browser: the home screen must be usable while it is
 * pending, and the sound button appears, and works, once it lands.
 *
 * Under the dev server the engine is its own module (`/src/audio/engine.ts`);
 * in a build it is the lazy `/bundle/audio-….js` chunk. Both are matched.
 */

import { test, expect } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;
const ENGINE = /\/(?:src\/audio\/(?:engine|AudioControl)\.tsx?|bundle\/audio-[^/]*\.js)(?:\?|$)/;

test("the home screen is usable before the sound engine arrives, and sound works once it does", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const asked: string[] = [];
  await page.route(ENGINE, async (route) => {
    asked.push(route.request().url());
    await held;
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /grown-ups: sign in/i })).toBeVisible(TAP);
  await expect.poll(() => asked.length, TAP).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /turn sound/i })).toHaveCount(0);

  release();
  const sound = page.getByRole("button", { name: "Turn sound off" });
  await expect(sound).toBeVisible(TAP);
  await sound.click();
  await expect(page.getByRole("button", { name: "Turn sound on" })).toHaveAttribute("aria-pressed", "true");
});

// The corner row is anchored to the right, so the sound button (and, on a wide screen, the "click for
// sound" hint beside it) landing late used to slide the other controls left, and the hint leaving on the
// first tap slid them back. A tap that started on read-aloud then ended somewhere else and did nothing:
// the flake in #327, and the same thing a kid on a slow tablet sees. The row holds still.
for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`the corner controls do not move when the sound engine lands (${viewport.width}px)`, async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.setViewportSize(viewport);
    await page.route(ENGINE, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("/");
    const readAloud = page.getByRole("button", { name: /turn read-aloud on/i });
    const settings = page.getByRole("button", { name: "Display settings" }).first();
    await expect(readAloud).toBeVisible(TAP);
    await expect(settings).toBeVisible(TAP);
    const before = { readAloud: await readAloud.boundingBox(), settings: await settings.boundingBox() };
    expect(before.readAloud).not.toBeNull();

    release();
    const sound = page.getByRole("button", { name: "Turn sound off" });
    await expect(sound).toBeVisible(TAP);
    expect(await readAloud.boundingBox(), "read-aloud stays where it was").toEqual(before.readAloud);
    expect(await settings.boundingBox(), "display settings stays where it was").toEqual(before.settings);

    // The first tap anywhere unlocks sound and takes the hint away: still nothing moves.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator(".kad-audio-control__hint")).toHaveCount(0, TAP);
    expect(await readAloud.boundingBox(), "read-aloud stays put after the unlock").toEqual(before.readAloud);
  });
}
