/**
 * Kids & Dragons can be installed (epic #410), in the build families actually
 * get: the manifest resolves with a manifest's type, every icon it names is a
 * real PNG, and Chromium's own installability check, which also wants the
 * service worker, finds nothing missing. Installing is never required: the TV,
 * the book and a join link all still open in a plain tab.
 *
 * Headless Chromium is not an iPhone. Safari's Add to Home Screen, and what a
 * Home Screen app's separate storage does to a hero, are real-device QA.
 * Runs under playwright.prod.config.ts, which builds and serves the client.
 */

import { test, expect } from "@playwright/test";

test.describe("installable", () => {
  test("the manifest and its icons are served as what they are", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^application\/manifest\+json/);
    const manifest = (await response.json()) as { icons: { src: string }[] };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of [...manifest.icons, { src: "/apple-touch-icon.png" }]) {
      const image = await request.get(icon.src);
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()["content-type"], icon.src).toBe("image/png");
    }
  });

  test("Chromium finds nothing standing in the way of installing", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
    const cdp = await page.context().newCDPSession(page);
    const { url, errors } = await cdp.send("Page.getAppManifest");
    expect(url).toMatch(/\/manifest\.webmanifest$/);
    expect(errors).toEqual([]);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    // Every Playwright context is an incognito profile, which Chromium never
    // installs from. That is the harness, not the site; anything else is ours.
    expect(installabilityErrors.map((error) => error.errorId).filter((id) => id !== "in-incognito")).toEqual([]);
  });

  test("a plain tab still opens the TV, the book and a join link, with nothing asking to install", async ({ page }) => {
    for (const path of ["/tv/ABCD", "/journal", "/p/ABCD"]) {
      await page.goto(path);
      await expect(page.locator("#root"), path).not.toBeEmpty();
      await expect(page.getByText(/install|add to home screen/i), path).toHaveCount(0);
    }
  });
});
