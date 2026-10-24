/**
 * A phone in a room keeps its screen awake (#463), and lets go on leaving.
 *
 * `navigator.wakeLock` is stubbed before any page script runs; every request
 * and every release is recorded on `window` so the spec can read them.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./characters";

const TAP = { timeout: 20_000 } as const;

interface WakeLog {
  requests: number;
  releases: number;
}

function stubWakeLock(): void {
  const log = { requests: 0, releases: 0 };
  (window as unknown as { __wake: typeof log }).__wake = log;
  const wakeLock = {
    request: async (): Promise<unknown> => {
      log.requests += 1;
      const target = new EventTarget();
      let released = false;
      return Object.assign(target, {
        type: "screen",
        get released() { return released; },
        release: async () => {
          if (released) return;
          released = true;
          log.releases += 1;
          target.dispatchEvent(new Event("release"));
        },
      });
    },
  };
  Object.defineProperty(navigator, "wakeLock", { value: wakeLock, configurable: true });
}

const readLog = (page: Page): Promise<WakeLog> =>
  page.evaluate(() => (window as unknown as { __wake: WakeLog }).__wake);

test.describe("phone screen wake lock", () => {
  const openContexts: BrowserContext[] = [];

  async function device(browser: Browser, width = 390, height = 844, stub = false): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    openContexts.push(context);
    if (stub) await context.addInitScript(stubWakeLock);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("is requested in a room and released on leaving it", async ({ browser }) => {
    test.setTimeout(120_000);

    const tv = await device(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    const phone = await device(browser, 390, 844, true);
    await phone.goto("/");
    // Not in a room yet: nothing asked for.
    expect((await readLog(phone)).requests).toBe(0);

    await phone.getByLabel(/room code/i).fill(code);
    await phone.getByRole("button", { name: /join a game/i }).click();
    await expect(phone).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(phone, "unicorn", "Sam");

    await expect.poll(async () => (await readLog(phone)).requests, TAP).toBeGreaterThan(0);
    const held = await readLog(phone);
    expect(held.releases).toBeLessThan(held.requests);

    // Leaving the room (back to the lobby) lets the screen sleep again.
    await phone.goto("/");
    await expect.poll(async () => {
      const log = await readLog(phone);
      return log.releases >= 1;
    }, TAP).toBe(true);
  });
});
