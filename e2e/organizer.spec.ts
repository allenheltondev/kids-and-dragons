/**
 * Organizer-run groups (#248), in a real browser against the real stack.
 *
 * Two grown-ups who are not one family run one group: the first starts it
 * and adds a kid, the second joins with her code and adds another, then sets
 * up the group's tablet. Both kids, from different families, are faces on it
 * and sit down at one TV's room together.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;
const WHO = /who.s playing\?/i;

test.describe("a group with two organizers", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function page(browser: Browser): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 } });
    open.push(ctx);
    return ctx.newPage();
  }

  /** The dev sign-in: any eight digits work (`createDevAuthClient`). */
  async function signIn(on: Page, email: string): Promise<void> {
    await on.getByLabel("Email").fill(email);
    await on.getByRole("button", { name: /send the code/i }).click();
    await on.getByLabel("The code").fill("12345678");
  }

  test("two grown-ups run one group, and its kids play at one table", async ({ browser }) => {
    test.setTimeout(180_000);
    // The dev table outlives a run, so each run is its own pair of grown-ups.
    const run = Date.now();
    const ana = `ana-${run}@example.com`;
    const ben = `ben-${run}@example.com`;
    const club = `Club ${run % 100000}`;

    // --- Ana starts the group and adds a kid ---
    const anaPage = await page(browser);
    await anaPage.goto("/");
    await anaPage.getByRole("button", { name: /run a group/i }).click(TAP);
    await signIn(anaPage, ana);
    await expect(anaPage.getByRole("heading", { name: /your groups/i })).toBeVisible(TAP);
    await anaPage.getByLabel("Start a new group").fill(club);
    await anaPage.getByRole("button", { name: /start it/i }).click();
    await expect(anaPage.getByRole("heading", { name: club })).toBeVisible(TAP);
    await anaPage.getByLabel("Add a kid").fill("Posy");
    await anaPage.getByRole("button", { name: /^add$/i }).click();
    await expect(anaPage.getByText("Posy", { exact: true })).toBeVisible(TAP);

    await anaPage.getByRole("button", { name: /invite another grown-up/i }).click();
    const code = (await anaPage.locator(".organizer__code").textContent({ timeout: 20_000 })) ?? "";
    expect(code).toMatch(/^[A-Z]{5}-[A-Z]{5}$/);

    // --- Ben, from another family, joins with the code and adds his kid ---
    const benPage = await page(browser);
    await benPage.goto("/");
    await benPage.getByRole("button", { name: /run a group/i }).click(TAP);
    await signIn(benPage, ben);
    await benPage.getByLabel("Have an organizer code?").fill(code);
    await benPage.getByRole("button", { name: /join as an organizer/i }).click();
    await expect(benPage.getByRole("heading", { name: club })).toBeVisible(TAP);
    await expect(benPage.getByText("Posy", { exact: true })).toBeVisible();
    await expect(benPage.getByText(`${ana}`)).toBeVisible();
    await benPage.getByLabel("Add a kid").fill("Gullet");
    await benPage.getByRole("button", { name: /^add$/i }).click();
    await expect(benPage.getByText("Gullet", { exact: true })).toBeVisible(TAP);
    await benPage.getByRole("button", { name: /^done$/i }).click();

    // --- Ben sets up the group's tablet; both kids are faces on it ---
    const tablet = await page(browser);
    await tablet.goto("/");
    await tablet.getByRole("button", { name: /make it a family tablet/i }).click(TAP);
    await signIn(tablet, ben);
    await tablet.getByRole("button", { name: /^done$/i }).click(TAP);
    await expect(tablet.getByRole("heading", { name: WHO })).toBeVisible(TAP);
    await expect(tablet.getByRole("button", { name: /^Posy/ })).toBeVisible();
    await expect(tablet.getByRole("button", { name: /^Gullet/ })).toBeVisible();

    // --- A TV opens a room, and the two kids sit down at it ---
    const tv = await page(browser);
    await tv.goto("/");
    await tv.getByRole("button", { name: /want to host/i }).click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const room = new URL(tv.url()).pathname.split("/").pop() ?? "";

    for (const [i, kid] of ["Posy", "Gullet"].entries()) {
      const seat = i === 0 ? tablet : await tablet.context().newPage();
      if (i > 0) await seat.goto("/");
      await seat.getByRole("button", { name: new RegExp(`^${kid}`) }).click(TAP);
      await seat.getByLabel("Room code, four letters").fill(room);
      await seat.getByRole("button", { name: /join a game/i }).click();
      await expect(seat).toHaveURL(new RegExp(`/p/${room}$`), TAP);
    }
    await expect(tv.getByText("Posy")).toBeVisible(TAP);
    await expect(tv.getByText("Gullet")).toBeVisible(TAP);
  });
});
