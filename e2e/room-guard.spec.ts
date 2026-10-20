/**
 * The room code is the real boundary (#267): whoever opened the room sees
 * everyone who arrives, and can take one of them out with a tap, for good.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

test.describe("guarding the room", () => {
  const openContexts: BrowserContext[] = [];

  async function device(browser: Browser, width = 390, height = 844): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    openContexts.push(context);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("the TV sees a phone arrive, takes it out, and it stays out", async ({ browser }) => {
    const tv = await device(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;
    await expect(tv.getByText(/room code/i).first()).toBeVisible({ timeout: 10_000 });

    const stranger = await device(browser);
    await stranger.goto("/");
    await stranger.getByLabel(/room code/i).fill(code);
    await stranger.getByRole("button", { name: /join a game/i }).click();
    await expect(stranger).toHaveURL(new RegExp(`/p/${code}$`));

    // The TV opened the room, so it is the host: it is told, and it can act.
    const remove = tv.getByRole("button", { name: /^Remove .* from this game$/ });
    await expect(remove).toBeVisible({ timeout: 15_000 });
    await remove.click();

    await expect(stranger.getByText(/took this phone out/i)).toBeVisible({ timeout: 15_000 });

    // Back to the start, and the code no longer lets this phone in.
    await stranger.getByRole("button", { name: /back to the start/i }).click();
    await stranger.getByLabel(/room code/i).fill(code);
    await stranger.getByRole("button", { name: /join a game/i }).click();
    await expect(stranger.getByText(/taken out of that game/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
