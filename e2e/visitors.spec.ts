/**
 * Rooms open to visitors (#249), against the real stack: two households at
 * one table.
 *
 * A grown-up with an account hosts on their phone. A phone from another
 * household, with a game of its own behind it, is refused by the room's short
 * code. The grown-up signs in from the host's view to let visitors join, and
 * the visitor comes in on the longer code, makes a hero and plays. So does a
 * brand-new phone that has never played, which gets a household of its own
 * rather than the host's. Afterwards each hero is in its own household's
 * adventure book, not the host's.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { guidePicture } from "./guide-pictures";

const TAP = { timeout: 20_000 } as const;
const BOOK = /open your book/i;

test.describe("a room open to visitors", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function phone(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    open.push(context);
    return context.newPage();
  }

  /** The dev sign-in: any eight digits work (`createDevAuthClient`). */
  async function signIn(page: Page, email: string): Promise<void> {
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /send the code/i }).click();
    await page.getByLabel("The code").fill("12345678");
  }

  async function hostPhoneMode(page: Page, name: string): Promise<string> {
    await page.getByRole("button", { name: /want to host/i }).click();
    await page.getByText("Phone Mode").click();
    await page.getByLabel(/adventurer name/i).fill(name);
    await page.getByRole("button", { name: /^start a game$/i }).click();
    await expect(page).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    return new URL(page.url()).pathname.split("/").pop() ?? "";
  }

  /**
   * The household this browser's device token names. The dev token is an
   * unsigned envelope (`DevIdentity`), so the e2e can read it directly.
   */
  async function deviceHousehold(page: Page): Promise<string> {
    const token = await page.evaluate(() => {
      const raw = localStorage.getItem("kad.device");
      return raw ? ((JSON.parse(raw) as { deviceToken?: string }).deviceToken ?? "") : "";
    });
    expect(token).toMatch(/^kaddev\.d1\./);
    const claims = JSON.parse(Buffer.from(token.slice("kaddev.d1.".length), "base64url").toString("utf8")) as {
      householdId: string;
    };
    return claims.householdId;
  }

  async function join(page: Page, code: string): Promise<void> {
    await page.goto("/");
    await page.getByLabel(/room code/i).fill(code);
    await page.getByRole("button", { name: /join a game/i }).click();
  }

  test("two households play in one open room, and each keeps its own hero", async ({ browser }) => {
    test.setTimeout(240_000);
    // The dev table outlives a run, so each run is its own grown-up.
    const email = `host-${Date.now()}@example.com`;

    // --- A grown-up with an account hosts on their phone ---
    const host = await phone(browser);
    await host.goto("/");
    await host.getByRole("button", { name: /sign in or create an account/i }).click(TAP);
    await signIn(host, email);
    await host.getByRole("button", { name: /back to the game/i }).click(TAP);
    const code = await hostPhoneMode(host, "Grown-up");

    // --- A phone from another household: it has played a game of its own ---
    const visitor = await phone(browser);
    await visitor.goto("/");
    await hostPhoneMode(visitor, "Wren");

    // A closed room still turns it away.
    await join(visitor, code);
    await expect(visitor.getByText(/different household/i).first()).toBeVisible(TAP);

    // --- The grown-up lets visitors join, signing in from the host's view ---
    await host.getByText("Running this room").click();
    await host.getByRole("button", { name: "Let visitors join" }).click(TAP);
    await signIn(host, email);
    const longCode = host.locator(".kad-host__code");
    await expect(longCode).toHaveText(new RegExp(`^${code}[A-Z]{2}$`), TAP);
    const visitorCode = (await longCode.textContent()) ?? "";
    await expect(host.getByRole("button", { name: "Stop new visitors" })).toBeVisible();
    await guidePicture(host.locator(".kad-host"), "visitors");

    // The short code still does not let another household in; the long one does,
    // and lands the visitor on the room's own path.
    await join(visitor, code);
    await expect(visitor.getByText(/different household/i).first()).toBeVisible(TAP);
    await join(visitor, visitorCode);
    await expect(visitor).toHaveURL(new RegExp(`/p/${code}$`), TAP);

    // --- A brand-new phone that has never played joins on the long code ---
    // It gets a household of its own, never the host's.
    // A brand-new phone that types only the room's four letters (the first
    // four of the visitor code everybody was shown) is turned away, and is
    // left holding no identity in the host's household.
    const stranger = await phone(browser);
    await join(stranger, visitorCode.slice(0, 4));
    await expect(stranger.getByText(/visitor code/i).first()).toBeVisible(TAP);
    const strangerToken = await stranger.evaluate(() => {
      const raw = localStorage.getItem("kad.device");
      return raw ? ((JSON.parse(raw) as { deviceToken?: string }).deviceToken ?? "") : "";
    });
    expect(strangerToken).toBe("");

    const fresh = await phone(browser);
    await join(fresh, visitorCode);
    await expect(fresh).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    const homes = new Set([await deviceHousehold(host), await deviceHousehold(visitor), await deviceHousehold(fresh)]);
    expect(homes.size).toBe(3);

    // The host sees who is visiting.
    const roster = host.getByRole("list", { name: "Who is in this room" });
    await expect(roster.getByRole("listitem").filter({ hasText: /visiting/ })).toHaveCount(2, TAP);

    // --- Both make heroes, and the chapter begins ---
    await createCharacter(host, "unicorn", "Sunflower");
    await createCharacter(visitor, "griffin", "Skyclaw");
    await createCharacter(fresh, "dragonling", "Emberwing");
    await host.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(visitor.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
    await expect(host.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);

    // --- Afterwards, each hero is in its own household's book ---
    await visitor.goto("/");
    await visitor.getByRole("button", { name: BOOK }).click(TAP);
    await expect(visitor.getByRole("region", { name: "Skyclaw's character sheet" })).toBeVisible(TAP);

    await fresh.goto("/");
    await fresh.getByRole("button", { name: BOOK }).click(TAP);
    await expect(fresh.getByRole("region", { name: "Emberwing's character sheet" })).toBeVisible(TAP);

    await host.goto("/");
    await host.getByRole("button", { name: BOOK }).click(TAP);
    await expect(host.getByRole("region", { name: "Sunflower's character sheet" })).toBeVisible(TAP);
    await expect(host.getByText("Skyclaw")).toHaveCount(0);
    await expect(host.getByText("Emberwing")).toHaveCount(0);
  });
});
