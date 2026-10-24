/**
 * A broken cache heals itself (#455), against a production build.
 *
 * A phone under a controlling worker whose saved copy of the entry script is
 * gone, and whose network answers that script 404 for two loads: the app
 * cannot start. The inline watchdog in index.html (src/boot/) retries once,
 * then on the second failed boot clears every cache and worker registration
 * and reloads. The third load finds the script and the home screen draws,
 * with nobody touching the page in between. sessionStorage shows the one heal.
 */

import { test, expect, type Page } from "@playwright/test";
import { startCountingProxy } from "./counting-proxy";

const ATTEMPTS_KEY = "kad.boot.attempts";
const HEALS_KEY = "kad.boot.heals";

async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
}

test("a page that cannot start clears its caches and workers and starts", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /host a game/i })).toBeVisible({ timeout: 20_000 });
    await controlled(page);
    await expect
      .poll(() => page.evaluate(async () => (await caches.match("/__kad/bundle-list")) !== undefined), { timeout: 20_000 })
      .toBe(true);
    // A hero's saved data must come through untouched.
    await page.evaluate(() => localStorage.setItem("kad.e2e.keep", "yes"));

    // --- The break: the worker no longer holds the entry script, and the network 404s it twice ---
    const entry = await page.evaluate(() => new URL(document.querySelector<HTMLScriptElement>("script[type=module][src]")!.src).pathname);
    expect(entry).toMatch(/^\/bundle\//);
    await page.evaluate(async (path) => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) if (new URL(request.url).pathname === path) await cache.delete(request);
      }
    }, entry);
    let asked = 0;
    proxy.configure({ gone: (path) => path === entry && (asked += 1) <= 2 });

    // --- One load; the page does the rest ---
    await page.reload();
    await expect(page.getByRole("button", { name: /host a game/i })).toBeVisible({ timeout: 60_000 });

    expect(await page.evaluate((k) => sessionStorage.getItem(k), HEALS_KEY)).toBe("1");
    expect(await page.evaluate((k) => sessionStorage.getItem(k), ATTEMPTS_KEY)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("kad.e2e.keep"))).toBe("yes");
    expect(asked).toBeGreaterThanOrEqual(2);
  } finally {
    await context.close();
    await proxy.close();
  }
});
