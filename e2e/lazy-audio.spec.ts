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
  await expect(page.getByRole("button", { name: /run a group/i })).toBeVisible(TAP);
  await expect.poll(() => asked.length, TAP).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /turn sound/i })).toHaveCount(0);

  release();
  const sound = page.getByRole("button", { name: "Turn sound off" });
  await expect(sound).toBeVisible(TAP);
  await sound.click();
  await expect(page.getByRole("button", { name: "Turn sound on" })).toHaveAttribute("aria-pressed", "true");
});
