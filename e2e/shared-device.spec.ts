/**
 * A family tablet (#250), in a real browser against the real stack.
 *
 * The server tests prove a shared tablet is never handed a kid's long-lived
 * token. What only a browser can prove is the other half: where the tablet
 * keeps the one kid's room session, so that the next kid, who picks the
 * tablet up or opens the room's QR (a fresh tab), is asked who they are
 * instead of landing in the last kid's seat. A refresh, meanwhile, keeps the
 * seat, as it does on any phone (architecture §4.3).
 */

import { test, expect, type Browser, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;
const WHO = /who.s playing\?/i;

test.describe("a family tablet", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function context(browser: Browser) {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 } });
    open.push(ctx);
    return ctx;
  }

  /** The dev sign-in: any eight digits work (`createDevAuthClient`). */
  async function signIn(page: Page, email: string): Promise<void> {
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /send the code/i }).click();
    await page.getByLabel("The code").fill("12345678");
  }

  async function storage(page: Page) {
    return page.evaluate(() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      tab: Object.fromEntries(Object.entries(sessionStorage)),
    }));
  }

  test("seats a kid for one room, and asks the next tab who is playing", async ({ browser }) => {
    test.setTimeout(180_000);
    // The dev table outlives a run, so each run is its own family.
    const email = `grown-up-${Date.now()}@example.com`;

    // --- A grown-up's phone: an account, a family, and a Phone Mode room ---
    const phone = await (await context(browser)).newPage();
    await phone.goto("/");
    await phone.getByRole("button", { name: /sign in or create an account/i }).click(TAP);
    await signIn(phone, email);
    await phone.getByRole("button", { name: /back to the game/i }).click(TAP);
    await phone.getByRole("button", { name: /want to host/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/your name/i).fill("Grown-up");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const code = new URL(phone.url()).pathname.split("/").pop() ?? "";

    // --- The tablet: the same grown-up makes it the family's ---
    const tabletContext = await context(browser);
    const tablet = await tabletContext.newPage();
    await tablet.goto("/");
    await tablet.getByRole("button", { name: /make it a family tablet/i }).click(TAP);
    await signIn(tablet, email);
    await tablet.getByRole("button", { name: /^done$/i }).click(TAP);
    await expect(tablet.getByRole("heading", { name: WHO })).toBeVisible(TAP);

    // --- A new kid picks themselves and joins ---
    await tablet.getByRole("button", { name: /someone new/i }).click();
    await tablet.getByPlaceholder("Type your name").fill("Ada");
    await tablet.getByRole("button", { name: /that.s me/i }).click();
    await expect(tablet.getByRole("heading", { name: /hi, ada!/i })).toBeVisible();
    await tablet.getByLabel("Room code, four letters").fill(code);
    await tablet.getByRole("button", { name: /join a game/i }).click();
    await expect(tablet).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await expect(tablet.getByRole("heading", { name: WHO })).toHaveCount(0);

    // The seat lives in this tab, and nothing long-lived names Ada.
    const seated = await storage(tablet);
    expect(Object.keys(seated.local)).toEqual(["kad.shared"]);
    expect(Object.keys(seated.tab)).toContain(`kad.session.${code}`);

    // A refresh keeps the seat, as on any phone.
    await tablet.reload();
    await expect(tablet).toHaveURL(new RegExp(`/p/${code}$`));
    await expect(tablet.getByRole("heading", { name: WHO })).toHaveCount(0, TAP);

    // --- The next kid opens the room's link: a fresh tab asks again ---
    const next = await tabletContext.newPage();
    await next.goto(`/p/${code}`);
    await expect(next.getByRole("heading", { name: WHO })).toBeVisible(TAP);
    // Ada, added a minute ago, is a face now; nobody is seated in this tab.
    await expect(next.getByRole("button", { name: /^Ada/ })).toBeVisible();
    expect(Object.keys((await storage(next)).tab)).not.toContain(`kad.session.${code}`);
  });
  test("an owner forgets the tablet from their phone, and the tablet goes back to an ordinary home", async ({ browser }) => {
    test.setTimeout(180_000);
    const email = `grown-up-${Date.now()}@example.com`;

    // --- A grown-up's phone: an account and a family ---
    const phone = await (await context(browser)).newPage();
    await phone.goto("/");
    await phone.getByRole("button", { name: /sign in or create an account/i }).click(TAP);
    await signIn(phone, email);
    await phone.getByRole("button", { name: /back to the game/i }).click(TAP);
    await phone.getByRole("button", { name: /want to host/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/your name/i).fill("Grown-up");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);

    // --- The family tablet ---
    const tablet = await (await context(browser)).newPage();
    await tablet.goto("/");
    await tablet.getByRole("button", { name: /make it a family tablet/i }).click(TAP);
    await signIn(tablet, email);
    await tablet.getByRole("button", { name: /^done$/i }).click(TAP);
    await expect(tablet.getByRole("heading", { name: WHO })).toBeVisible(TAP);

    // --- Another device of the grown-up's lists it and forgets it ---
    const other = await (await context(browser)).newPage();
    await other.goto("/");
    await other.getByRole("button", { name: /run a group/i }).click(TAP);
    await signIn(other, email);
    await expect(other.getByRole("heading", { name: "Family tablets" })).toBeVisible(TAP);
    await other.getByRole("button", { name: /^forget this/i }).first().click();
    await expect(other.getByText(/no family tablets set up yet/i)).toBeVisible(TAP);

    // --- The tablet's next request is refused, and it is an ordinary home again ---
    await tablet.reload();
    await expect(tablet.getByRole("heading", { name: WHO })).toHaveCount(0, TAP);
    await expect(tablet.getByRole("button", { name: /want to host/i })).toBeVisible(TAP);
  });
});
