/**
 * The privacy link (#523) where a kid can land directly, against the real stack.
 *
 * The owner's rule: the quiet link is on every screen that is not the game itself, and on
 * anywhere a kid can arrive straight from a link. This starts from a direct room link,
 * not the start screen, then follows a phone into hero creation and the lobby, and checks
 * the link in the lobby. (That it is absent once the game is on is `PlayerView`'s phase check,
 * not asserted here.) It opens the policy in a tab of its own, so a hero half named is not lost
 * by tapping it.
 */

import { test, expect, type Page } from "@playwright/test";
import { createCharacter } from "./characters";

const TAP = { timeout: 20_000 } as const;

/** The footer link: the same quiet "Privacy" link on every screen that is not the game. */
const privacy = (page: Page) => page.getByRole("link", { name: /^privacy$/i });

test.describe("the privacy link where a kid can land", () => {
  test.setTimeout(240_000);

  test("a direct room link, hero creation and the lobby have it", async ({ browser }) => {
    const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const host = await hostContext.newPage();
    await host.goto("/");
    await host.getByRole("button", { name: /host a game/i }).click();
    await host.getByText("Phone Mode").click();
    await host.getByLabel(/adventurer name/i).fill("Grown-up");
    await host.getByRole("button", { name: /^start a game$/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const code = new URL(host.url()).pathname.split("/").pop() ?? "";

    // Hero creation: the host has a room and no hero yet.
    await expect(privacy(host)).toBeVisible(TAP);
    await expect(privacy(host)).toHaveAttribute("href", "/privacy");
    await expect(privacy(host)).toHaveAttribute("target", "_blank");

    // A first-time phone lands on the room link directly, before any start screen.
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const guest = await guestContext.newPage();
    await guest.goto(`/p/${code}`);
    await expect(privacy(guest)).toBeVisible(TAP);

    // The policy opens in its own tab without leaving the page, and needs no room or account.
    const [policy] = await Promise.all([guestContext.waitForEvent("page"), privacy(guest).click()]);
    await policy.waitForLoadState();
    await expect(policy).toHaveURL(/\/privacy$/);
    await expect(policy.getByRole("heading", { name: "Privacy" })).toBeVisible(TAP);
    await policy.close();
    await expect(guest).toHaveURL(new RegExp(`/p/${code}$`));

    // The host makes a hero; the lobby (not the game yet) keeps the link.
    await createCharacter(host, "unicorn", "Pip");
    await expect(privacy(host)).toBeVisible(TAP);

    await hostContext.close();
    await guestContext.close();
  });
});
