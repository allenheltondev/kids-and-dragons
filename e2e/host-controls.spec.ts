/**
 * Running the room (#263), against the real stack: the phone that opened a
 * Phone Mode room sees who joined, locks the room so a newcomer is turned
 * away, takes a player out, and closes the room for everyone. Nothing here
 * is reachable from another player's phone.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { guidePicture } from "./guide-pictures";

const TAP = { timeout: 15_000 } as const;

test.describe("running the room", () => {
  const openContexts: BrowserContext[] = [];

  async function phone(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    openContexts.push(context);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function join(page: Page, code: string): Promise<void> {
    await page.goto("/");
    await page.getByLabel(/room code/i).fill(code);
    await page.getByRole("button", { name: /join a game/i }).click();
  }

  test("the host locks, removes and closes; nobody else can", async ({ browser }) => {
    // --- The host opens a Phone Mode room ---
    const host = await phone(browser);
    await host.goto("/");
    await host.getByRole("button", { name: /want to host/i }).click();
    await host.getByText("Phone Mode").click();
    await host.getByLabel(/adventurer name/i).fill("Grown-up");
    await host.getByRole("button", { name: /^start a game$/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const code = new URL(host.url()).pathname.split("/").pop() ?? "";

    // --- A guest joins, and is on the host's roster before making a hero ---
    const guest = await phone(browser);
    await join(guest, code);
    await expect(guest).toHaveURL(new RegExp(`/p/${code}$`), TAP);

    await host.getByText("Running this room").click();
    const roster = host.getByRole("list", { name: "Who is in this room" });
    // The host is listed too, as "(you)", and is still making a hero as well.
    const guestRow = roster.getByRole("listitem").filter({ hasNotText: "(you)" });
    await expect(guestRow.getByText(/Making a hero/)).toBeVisible(TAP);
    await guidePicture(host.locator(".kad-host"), "host-panel");
    // The guest's phone has no such panel.
    await expect(guest.getByText("Running this room")).toHaveCount(0);

    // --- Locked: a newcomer is turned away, and the lock is undone just as easily ---
    await host.getByRole("button", { name: "Lock the room" }).click();
    await expect(host.getByRole("button", { name: "Let new players join again" })).toBeVisible(TAP);
    const newcomer = await phone(browser);
    await join(newcomer, code);
    await expect(newcomer.getByText(/this game is locked/i).first()).toBeVisible(TAP);

    // --- Quiet: the host's switch reaches the guest's phone, and goes again ---
    const quietOn = () => guest.locator("html[data-quiet]");
    await host.getByRole("button", { name: "Quiet mode" }).click();
    await expect(quietOn()).toHaveCount(1, TAP);
    await host.getByRole("button", { name: "Turn quiet mode off" }).click();
    await expect(quietOn()).toHaveCount(0, TAP);

    // --- Keeper: the host hands the keeper role to a phone in the room (#272) ---
    await guestRow.getByRole("button", { name: /^Let .* keep this game$/ }).click();
    await expect(guestRow.getByText(/keeps the game/)).toBeVisible(TAP);
    await expect(guestRow.getByRole("button", { name: /keep this game$/ })).toHaveCount(0);

    // --- Removed: the guest is out ---
    await guestRow.getByRole("button", { name: /^Remove .* from this game$/ }).click();
    await expect(guest.getByText(/took this phone out/i)).toBeVisible(TAP);
    await expect(guestRow.getByText(/Taken out/)).toBeVisible(TAP);

    // --- Closed: after one "are you sure?", every screen leaves ---
    await host.getByRole("button", { name: "Close the room" }).click();
    await host.getByRole("button", { name: "Close it" }).click();
    await expect(host.getByText(/closed the room/i)).toBeVisible(TAP);
    await host.getByRole("button", { name: /back to the start/i }).click();

    // The code is gone: it reads as no room at all.
    await join(newcomer, code);
    await expect(newcomer.getByText(new RegExp(`no open room ${code}`, "i")).first()).toBeVisible(TAP);
  });
});
