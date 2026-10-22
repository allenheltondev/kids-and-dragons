/**
 * Install guidance and the installed app's first launch (#412), in a real
 * browser against the dev stack.
 *
 * A tab that can install gets one quiet card on the home screen, never on the
 * TV and never in the installed app. The installed app, opened with nothing in
 * its storage, asks "Played in Safari before?" before anything can make a new
 * hero, and bringing one over lands on the existing pairing panel (#281).
 *
 * "Installed" is emulated: `(display-mode: standalone)` is stubbed before the
 * page loads, and an iPhone is a user agent. Whether a real iPhone's Home
 * Screen app starts with storage apart from Safari's, which is the whole
 * reason for the question, is device QA (#414), not something Chromium can
 * show.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const INSTALL = /install kids & dragons/i;
const ASK = /played in safari before/i;

/** Make `(display-mode: standalone)` match, as it does in an installed app. */
function standalone(): void {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string): MediaQueryList => {
    if (!/display-mode:\s*standalone/.test(query)) return original(query);
    const quiet = (): void => undefined;
    return {
      matches: true,
      media: query,
      onchange: null,
      addEventListener: quiet,
      removeEventListener: quiet,
      addListener: quiet,
      removeListener: quiet,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

test.describe("install guidance", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function iphone(browser: Browser, installed: boolean): Promise<Page> {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: IPHONE_SAFARI,
      hasTouch: true,
    });
    open.push(context);
    if (installed) await context.addInitScript(standalone);
    return context.newPage();
  }

  test("an iPhone tab is told how to install; the TV never is", async ({ browser }) => {
    const tab = await iphone(browser, false);
    await tab.goto("/");
    await expect(tab.getByRole("heading", { name: INSTALL })).toBeVisible(TAP);
    await expect(tab.getByText(/add to home screen/i)).toBeVisible();
    // Never in the way of playing: joining is right there above it.
    await expect(tab.getByRole("button", { name: /join a game/i })).toBeVisible();

    await tab.goto("/tv/ABCD");
    await expect(tab.locator("#root")).not.toBeEmpty();
    await expect(tab.getByText(/install|add to home screen/i)).toHaveCount(0);
  });

  test("put away, the card stays away", async ({ browser }) => {
    const tab = await iphone(browser, false);
    await tab.goto("/");
    await tab.getByRole("button", { name: /not now/i }).click(TAP);
    await expect(tab.getByRole("heading", { name: INSTALL })).toHaveCount(0);
    await tab.reload();
    await expect(tab.getByRole("button", { name: /join a game/i })).toBeVisible(TAP);
    await expect(tab.getByRole("heading", { name: INSTALL })).toHaveCount(0);
  });

  test("Chromium's own offer becomes an Install button, used once", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    open.push(context);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("button", { name: /join a game/i })).toBeVisible(TAP);
    // Headless Chromium never offers on the dev server: hand it the offer it would make.
    await expect(page.getByRole("heading", { name: INSTALL })).toHaveCount(0);
    await page.evaluate(() => {
      const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          (window as unknown as { prompted: number }).prompted = 1;
        },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(offer);
    });
    await page.getByRole("button", { name: /^install$/i }).click(TAP);
    expect(await page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
    await expect(page.getByRole("heading", { name: INSTALL })).toHaveCount(0);
  });

  test("the installed app never offers to install, and asks about Safari first", async ({ browser }) => {
    const app = await iphone(browser, true);
    await app.goto("/");
    await expect(app.getByRole("heading", { name: ASK })).toBeVisible(TAP);
    await expect(app.getByRole("heading", { name: INSTALL })).toHaveCount(0);
    // Nothing to join or host with until it is answered, and nobody made yet.
    await expect(app.getByRole("button", { name: /join a game/i })).toHaveCount(0);
    await expect(app.getByRole("button", { name: /host a game/i })).toHaveCount(0);
    expect(await app.evaluate(() => localStorage.getItem("kad.device"))).toBeNull();

    await app.getByRole("button", { name: /start fresh/i }).click(TAP);
    await expect(app.getByRole("button", { name: /join a game/i })).toBeVisible(TAP);
    await expect(app.getByRole("heading", { name: INSTALL })).toHaveCount(0);
    await app.reload();
    await expect(app.getByRole("button", { name: /join a game/i })).toBeVisible(TAP);
    await expect(app.getByRole("heading", { name: ASK })).toHaveCount(0);
    expect(await app.evaluate(() => localStorage.getItem("kad.device"))).toBeNull();
  });

  test("bringing a hero over lands on the pairing panel, with nothing spent or made", async ({ browser }) => {
    const app = await iphone(browser, true);
    await app.goto("/");
    await app.getByRole("button", { name: /bring my hero over/i }).click(TAP);
    await expect(app).toHaveURL(/\/account$/, TAP);
    await expect(app.getByRole("heading", { name: /bring my hero to this device/i })).toBeVisible(TAP);
    await expect(app.getByLabel("Your code")).toHaveValue("");
    await expect(app.getByText(/in safari, open kids & dragons/i)).toBeVisible();
    expect(await app.evaluate(() => localStorage.getItem("kad.device"))).toBeNull();

    // Backing out without a code asks again: no choice has been made yet.
    await app.getByRole("button", { name: /^back$/i }).click(TAP);
    await app.getByRole("button", { name: /back to the start/i }).click(TAP);
    await expect(app.getByRole("heading", { name: ASK })).toBeVisible(TAP);
  });
});
