/**
 * A family tablet as the Party Mode TV (#274), in a real browser against the
 * real stack. The tablet opens the lobby under its household's own name,
 * seats nobody, and runs the room on its shared token alone: it sees a phone
 * arrive, takes it out, and is still the host after a hard refresh. Another
 * tablet that knows the code is not.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;

test.describe("a family tablet as the TV", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function device(browser: Browser, width: number, height: number): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width, height } });
    open.push(ctx);
    return ctx.newPage();
  }

  /** The dev sign-in: any eight digits work (`createDevAuthClient`). */
  async function signIn(page: Page, email: string): Promise<void> {
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /send the code/i }).click();
    await page.getByLabel("The code").fill("12345678");
  }

  /** A signed-in owner's phone, so the family exists, then a tablet made theirs. */
  async function familyTablet(browser: Browser, email: string): Promise<Page> {
    const grownUp = await device(browser, 390, 844);
    await grownUp.goto("/account");
    await grownUp.getByRole("button", { name: /sign in or create an account/i }).click(TAP);
    await signIn(grownUp, email);
    await grownUp.getByRole("button", { name: /back to the game/i }).click(TAP);
    await grownUp.getByRole("button", { name: "Back to the start" }).click();

    return sharedTablet(browser, email);
  }

  async function sharedTablet(browser: Browser, email: string): Promise<Page> {
    const tablet = await device(browser, 1280, 800);
    await tablet.goto("/account");
    await tablet.getByRole("button", { name: /make it a family tablet/i }).click(TAP);
    await signIn(tablet, email);
    await tablet.getByRole("button", { name: /^done$/i }).click(TAP);
    await expect(tablet.getByRole("heading", { name: /who.s playing\?/i })).toBeVisible(TAP);
    return tablet;
  }

  test("hosts the lobby, takes a phone out, and is still the host after a hard refresh", async ({ browser }) => {
    test.setTimeout(180_000);
    const email = `grown-up-${Date.now()}@example.com`;
    const tablet = await familyTablet(browser, email);

    await tablet.getByRole("button", { name: /show the game on this screen/i }).click();
    await expect(tablet).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const code = new URL(tablet.url()).pathname.split("/").pop() ?? "";
    await expect(tablet.getByText(/room code/i).first()).toBeVisible(TAP);

    // A phone with the code joins the family's room, and the tablet sees it arrive.
    const phone = await device(browser, 390, 844);
    await phone.goto("/");
    await phone.getByLabel(/room code/i).fill(code);
    await phone.getByRole("button", { name: /join a game/i }).click();
    await expect(phone).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    // On the shared screen who joined is one line with nothing to tap; it goes by itself.
    await expect(tablet.locator(".kad-arrival")).toContainText("joined", TAP);

    // A hard refresh reattaches as host: the tablet's shared token proves it.
    // Arrivals are live only, so a second phone arriving afterwards is the proof.
    await tablet.reload();
    await expect(tablet).toHaveURL(new RegExp(`/tv/${code}$`));
    const second = await device(browser, 390, 844);
    await second.goto("/");
    await second.getByLabel(/room code/i).fill(code);
    await second.getByRole("button", { name: /join a game/i }).click();
    await expect(second).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await expect(tablet.locator(".kad-arrival")).toContainText("joined", TAP);

    // And as host it can act, with the shared token alone: Remove is in the Room panel, where
    // the roster lists everyone in the order they came, so the newest is last.
    await tablet.getByRole("button", { name: "Room", exact: true }).click(TAP);
    const roster = tablet.getByRole("list", { name: "Who is in this room" });
    await expect(roster.getByRole("listitem")).toHaveCount(2, TAP);
    await roster.getByRole("listitem").last().getByRole("button", { name: /^Remove .* from this game$/ }).click(TAP);
    await expect(second.getByText(/took this phone out/i)).toBeVisible(TAP);
    await expect(phone.getByText(/took this phone out/i)).toHaveCount(0);

    // Throughout, the tablet kept only its shared token: no kid, no device binding.
    const kept = await tablet.evaluate(() => ({
      local: Object.keys(localStorage),
      tab: Object.keys(sessionStorage),
    }));
    expect(kept.local).toEqual(["kad.shared"]);
    expect(kept.tab.filter((key) => key.startsWith("kad.session."))).toEqual([]);
  });

  test("is not shown by a stranger's browser, or by another of the family's tablets", async ({ browser }) => {
    test.setTimeout(180_000);
    const email = `grown-up-${Date.now()}@example.com`;
    const tablet = await familyTablet(browser, email);
    await tablet.getByRole("button", { name: /show the game on this screen/i }).click();
    await expect(tablet).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const code = new URL(tablet.url()).pathname.split("/").pop() ?? "";

    // Another tablet of the same family did not open this room, and is told so
    // rather than shown the party: a TV is the one that opened the room.
    const sibling = await sharedTablet(browser, email);
    await sibling.goto(`/tv/${code}`);
    await expect(sibling.getByText(/only the screen that opened this room/i).first()).toBeVisible(TAP);
    await expect(sibling.getByRole("button", { name: /^Remove .* from this game$/ })).toHaveCount(0);

    const stranger = await device(browser, 1280, 720);
    await stranger.goto(`/tv/${code}`);
    await expect(stranger.getByText(/only the screen that opened this room/i).first()).toBeVisible(TAP);
  });
});
