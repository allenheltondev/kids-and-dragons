/**
 * Another TV in another place (screens/OtherScreen.tsx, handlers/screens.ts),
 * against the real stack: the TV that opened the room makes a code from its
 * Room panel, a second TV types it on its start screen and shows the same
 * lobby, a kid at the second place joins from that TV's room code, a refresh
 * brings the second TV straight back, a spent code is refused once, on the
 * card, and closing the room ends the game on both TVs.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const TAP = { timeout: 15_000 } as const;

test.describe("another TV in another place", () => {
  const openContexts: BrowserContext[] = [];

  async function open(browser: Browser, size: { width: number; height: number }): Promise<Page> {
    const context = await browser.newContext({ viewport: size });
    openContexts.push(context);
    return context.newPage();
  }
  const tv = (browser: Browser) => open(browser, { width: 1280, height: 720 });
  const phone = (browser: Browser) => open(browser, { width: 390, height: 844 });

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("a second TV shows the game from a code, and ends with it", async ({ browser }) => {
    // --- The leader's TV opens a lobby ---
    const leader = await tv(browser);
    await leader.goto("/");
    await leader.getByRole("button", { name: /host a game/i }).click();
    await leader.getByRole("button", { name: "Open the lobby here" }).click();
    await expect(leader).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const room = new URL(leader.url()).pathname.split("/").pop() ?? "";

    // --- Room, then Another TV: folded until asked, and a code once asked ---
    await leader.getByRole("button", { name: /^Room/ }).click();
    const section = leader.locator("details", { hasText: "Another TV" });
    await expect(section).not.toHaveAttribute("open", "");
    await section.locator("summary").click();
    await leader.getByRole("button", { name: "Get a code for the other TV" }).click();
    const shown = leader.getByLabel("Code for the other TV");
    await expect(shown).toHaveText(/^[A-Z]{4}-[A-Z]{4}$/, TAP);
    const code = (await shown.textContent())?.trim() ?? "";

    // --- The other TV: a quiet link in its Host card, then the same lobby ---
    const follower = await tv(browser);
    await follower.goto("/");
    await follower.getByRole("button", { name: /host a game/i }).click();
    await follower.getByRole("button", { name: "Join a game lobby" }).click();
    await follower.getByLabel("Code for this TV").fill(code.toLowerCase());
    await follower.getByRole("button", { name: "Show the game here" }).click();
    await expect(follower).toHaveURL(new RegExp(`/tv/${room}$`), TAP);
    // It shows the game, and does not run it.
    await expect(follower.getByRole("button", { name: /^Room/ })).toHaveCount(0);
    // The leader's Room panel counts it, folded section and all.
    await expect(leader.getByText("1 other TV is showing this game")).toBeVisible(TAP);

    // --- A kid at the other place joins with the room code, and both TVs see them ---
    const kid = await phone(browser);
    await kid.goto("/");
    await kid.getByLabel(/room code/i).fill(room);
    await kid.getByRole("button", { name: /join a game/i }).click();
    await expect(kid).toHaveURL(new RegExp(`/p/${room}$`), TAP);
    // The leader's Room panel is still open from making the code.
    await expect(leader.getByText(/1 in this room/)).toBeVisible(TAP);

    // --- A refresh on the other TV comes straight back to the game ---
    await follower.reload();
    await expect(follower).toHaveURL(new RegExp(`/tv/${room}$`), TAP);
    await expect(follower.getByText(room.split("").join("")).first()).toBeVisible(TAP);

    // --- The code is spent: said once, on the card ---
    const third = await tv(browser);
    await third.goto(`/?screen=${code.replace("-", "")}`);
    await expect(third.getByLabel("Code for this TV")).toHaveValue(code, TAP);
    await third.getByRole("button", { name: "Show the game here" }).click();
    await expect(third.locator(".home__error")).toContainText(/didn't work/, TAP);
    await expect(third.locator(".kad-toast")).toHaveCount(0);

    // --- Closing the room ends the game on both TVs ---
    await leader.getByRole("button", { name: "Close the room" }).click();
    await leader.getByRole("button", { name: "Close it" }).click();
    await expect(follower.getByText(/closed the room/)).toBeVisible(TAP);
  });
});
