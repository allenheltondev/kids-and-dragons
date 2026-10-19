/**
 * Take your hero home (#251), in a real browser against the real stack.
 *
 * A club leader makes a move code for one of the club's kids. Her mum, who
 * has never signed in, opens the code's link (what scanning its QR does),
 * signs in, and brings her home: the kid is in a new household and gone from
 * the club, and the code does not work a second time.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { guidePicture } from "./guide-pictures";

const TAP = { timeout: 20_000 } as const;

test.describe("moving a kid to another home", () => {
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

  test("a club kid goes home on her move code, and the code works once", async ({ browser }) => {
    test.setTimeout(180_000);
    const run = Date.now();
    const leader = `leader-${run}@example.com`;
    const mum = `mum-${run}@example.com`;
    const club = `Club ${run % 100000}`;
    const kid = `Ada${run % 1000}`;

    // --- The leader starts the club, adds Ada, and makes her a move code ---
    const leaderPage = await page(browser);
    await leaderPage.goto("/");
    await leaderPage.getByRole("button", { name: /run a group/i }).click(TAP);
    await signIn(leaderPage, leader);
    await leaderPage.getByLabel("Start a new group").fill(club);
    await leaderPage.getByRole("button", { name: /start it/i }).click();
    await expect(leaderPage.getByRole("heading", { name: club })).toBeVisible(TAP);
    await leaderPage.getByLabel("Add a kid").fill(kid);
    await leaderPage.getByRole("button", { name: /^add$/i }).click();
    await expect(leaderPage.getByText(kid, { exact: true })).toBeVisible(TAP);
    await leaderPage.getByLabel("Add a kid").fill("Bo");
    await leaderPage.getByRole("button", { name: /^add$/i }).click();
    await expect(leaderPage.getByText("Bo", { exact: true })).toBeVisible(TAP);

    const row = leaderPage.locator(".organizer__row", { hasText: kid });
    await row.getByRole("button", { name: /move home/i }).click();
    const card = leaderPage.getByRole("status", { name: `${kid}'s move code` });
    await expect(card).toBeVisible(TAP);
    await expect(card.getByRole("img", { name: `QR code to move ${kid}` })).toBeVisible(TAP);
    await guidePicture(card, "move-code");
    const shown = (await card.locator(".organizer__code").textContent()) ?? "";
    expect(shown).toMatch(/^[A-Z]{5}-[A-Z]{5}$/);

    // --- Her mum opens the link the QR holds, signs in, and brings her home ---
    const mumPage = await page(browser);
    await mumPage.goto(`/?move=${shown.replace("-", "")}`);
    await signIn(mumPage, mum);
    const field = mumPage.getByLabel("Taking a kid home? Their move code");
    await expect(field).toHaveValue(shown, TAP);
    await mumPage.getByRole("button", { name: /bring them home/i }).click();
    await expect(mumPage.getByRole("heading", { name: `${kid}'s household` })).toBeVisible(TAP);
    await expect(mumPage.getByText(`${kid} lives here now`)).toBeVisible();
    await expect(mumPage.getByText(kid, { exact: true })).toBeVisible();
    // The link is not left on the URL to ask again on a refresh.
    expect(new URL(mumPage.url()).search).toBe("");

    // --- Gone from the club; Bo stays ---
    await leaderPage.reload();
    await leaderPage.getByRole("button", { name: /run a group/i }).click(TAP);
    await signIn(leaderPage, leader);
    await expect(leaderPage.getByRole("heading", { name: club })).toBeVisible(TAP);
    await expect(leaderPage.getByText("Bo", { exact: true })).toBeVisible();
    await expect(leaderPage.getByText(kid, { exact: true })).toHaveCount(0);

    // --- The code is spent ---
    await mumPage.getByLabel("Bringing a kid here? Their move code").fill(shown);
    await mumPage.getByRole("button", { name: /bring them here/i }).click();
    await expect(mumPage.getByText(/that code didn.t work/i)).toBeVisible(TAP);
  });
});
