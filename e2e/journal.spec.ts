/**
 * The adventure book, between games (spec §2.3).
 *
 * One phone plays a little — makes a hero, starts the chapter, which puts the
 * chapter's country in the Field Guide and the party on the map — then walks
 * away to the home screen and studies it all with no game going: the hero,
 * the map with "You were here", the guide. Then the signal drops and the book
 * still opens, saying it is last time's. And the tray's Play goes home.
 *
 * A TV that only hosted is never offered the book: it is nobody.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { createCharacter } from "./characters";

const TAP = { timeout: 20_000 } as const;
const BOOK = /open your book/i;

test.describe("the adventure book", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function client(browser: Browser, width: number, height: number): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    open.push(context);
    return context.newPage();
  }

  test("after a game, a phone studies its hero, the map and the guide, even offline", async ({ browser }) => {
    test.setTimeout(180_000);
    const HERO = "Moonbeam";
    const phone = await client(browser, 390, 844);

    // A phone that has never played has nothing to open.
    await phone.goto("/");
    await expect(phone.getByRole("button", { name: /join a game/i })).toBeVisible();
    await expect(phone.getByRole("button", { name: BOOK })).toHaveCount(0);

    // --- Play a little: Phone Mode, a hero, the chapter begins ---
    await phone.getByRole("button", { name: /want to host/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/adventurer name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    await createCharacter(phone, "unicorn", HERO);
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    // The chapter has started once the lobby's begin button is gone.
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);

    // --- Walk away, and open the book ---
    await phone.goto("/");
    await phone.getByRole("button", { name: BOOK }).click(TAP);
    await expect(phone).toHaveURL(/\/journal$/);
    const tray = phone.getByRole("navigation", { name: "What to look at" });

    const sheet = phone.getByRole("region", { name: `${HERO}'s character sheet` });
    await expect(sheet).toBeVisible(TAP);
    await expect(sheet.getByText(/tap something in the bag/i)).toBeVisible();

    await tray.getByRole("button", { name: "Map" }).click(TAP);
    await expect(phone.getByText(/^Last seen in /)).toBeVisible(TAP);
    await expect(phone.getByText("You were here")).toBeVisible();

    await tray.getByRole("button", { name: "Guide" }).click(TAP);
    const guide = phone.getByRole("region", { name: "Field Guide" });
    // The chapter's country went in the book the moment the chapter began.
    await expect(guide.getByText(/^[1-9]\d* of \d+ found$/)).toBeVisible(TAP);
    // In play the guide offers a way back to the bag; the book has its own tray.
    await expect(guide.getByRole("button", { name: /back to your bag/i })).toHaveCount(0);

    // --- No signal: last time's book, saying so ---
    await tray.getByRole("button", { name: "Play" }).click(TAP);
    await expect(phone).toHaveURL(/\/$/);
    await phone.route("**/api/journal", (route) => route.abort("internetdisconnected"));
    await phone.getByRole("button", { name: BOOK }).click(TAP);
    await expect(phone.getByText(/no signal/i)).toBeVisible(TAP);
    await expect(phone.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible();

    // The signal comes back: try again, and the note goes.
    await phone.unroute("**/api/journal");
    await phone.getByRole("button", { name: /try again/i }).click(TAP);
    await expect(phone.getByText(/no signal/i)).toHaveCount(0, TAP);
  });

  test("a TV that only hosted is never offered the book", async ({ browser }) => {
    const tv = await client(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /want to host/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z0-9]{4}$/);

    await tv.goto("/");
    await expect(tv.getByRole("button", { name: /join a game/i })).toBeVisible();
    await expect(tv.getByRole("button", { name: BOOK })).toHaveCount(0);
  });
});
