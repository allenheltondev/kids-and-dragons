/**
 * The sign-in code arrives when a grown-up asks for it (#300), not with the
 * home screen. `perf:bundle` weighs only the static first paint, so this
 * watches what a real browser asks for: a home screen that nobody signs in
 * on never fetches the auth client or the organizer store.
 *
 * Under the dev server those are their own modules (`/src/sync/auth.ts`);
 * in a build they are lazy chunks (`/bundle/auth-….js`). Both are matched.
 */

import { test, expect, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;
const AUTH = /\/(?:src\/sync\/auth\.ts|bundle\/auth-[^/]*\.js)(?:\?|$)/;
const ORGANIZER = /\/(?:src\/store\/organizer\.ts|bundle\/organizer-[^/]*\.js)(?:\?|$)/;

function watch(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  return asked;
}

test("the home screen does not fetch sign-in until a grown-up opens it", async ({ page }) => {
  const asked = watch(page);
  await page.goto("/");
  // Sign-in is offered, so `check()` has run and the home screen is settled.
  await expect(page.getByRole("button", { name: /run a group/i })).toBeVisible(TAP);
  await page.waitForLoadState("networkidle");
  expect(asked.filter((url) => AUTH.test(url))).toEqual([]);
  expect(asked.filter((url) => ORGANIZER.test(url))).toEqual([]);

  await page.getByRole("button", { name: /run a group/i }).click();
  await expect(page.getByLabel("Email")).toBeVisible(TAP);
  await expect.poll(() => asked.some((url) => AUTH.test(url)), TAP).toBe(true);
});
