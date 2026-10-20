/**
 * A kid's own page (#299), in a real browser against the real stack.
 *
 * Ada plays a little on her phone, opens "Me" in her adventure book, and sees
 * her hero and the badge her first find earned. She sets a color, a frame for
 * her hero and a title. A second device paired to her (#281) shows the same
 * page, and so does her phone after a reload. A browser that is nobody has no
 * page and cannot save one. With the largest text and one-handed play on,
 * every control on the page is still where a thumb can tap it.
 */

import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { createCharacter } from "./characters";

const TAP = { timeout: 20_000 } as const;
const HERO = "Moonbeam";

test.describe("a kid's own page", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function client(browser: Browser, width = 390, height = 844, prefs?: object): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    open.push(context);
    const page = await context.newPage();
    if (prefs) await page.addInitScript((value) => localStorage.setItem("kad.a11y", JSON.stringify(value)), prefs);
    return page;
  }

  async function openMe(page: Page): Promise<void> {
    await page.goto("/");
    await page.getByRole("button", { name: /open your book/i }).click(TAP);
    await expect(page).toHaveURL(/\/journal$/);
    await page.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Me" }).click(TAP);
    await expect(page.getByRole("heading", { name: "Ada", level: 2 })).toBeVisible(TAP);
  }

  async function play(phone: Page): Promise<void> {
    await phone.goto("/");
    await phone.getByRole("button", { name: /host a game/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel("Your adventurer name").fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    await createCharacter(phone, "unicorn", HERO);
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    // The chapter has started once the lobby's begin button is gone, and its country is in the Field Guide.
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
  }

  /** A preset is a label around a hidden radio, so a thumb taps the label. */
  async function choose(group: Locator, name: RegExp): Promise<void> {
    await group.locator("label").filter({ hasText: name }).click(TAP);
  }

  async function expectPicked(page: Page): Promise<void> {
    await expect(page.getByRole("radio", { name: /berry/i })).toBeChecked(TAP);
    await expect(page.getByRole("radiogroup", { name: `Frame for ${HERO}` }).getByRole("radio", { name: /ivy/i })).toBeChecked(TAP);
    await expect(page.getByRole("radiogroup", { name: "Pick a title" }).getByRole("radio", { name: /sharp eyes/i })).toBeChecked(TAP);
    await expect(page.locator(".profile__title")).toHaveText("Sharp Eyes");
    await expect(page.locator(".profile")).toHaveAttribute("data-profile-color", "berry");
    await expect(page.locator(".profile__frame").first()).toHaveAttribute("data-frame", "ivy");
  }

  test("she sets a color, a frame and a title on her phone, and a second device paired to her shows them", async ({ browser }) => {
    test.setTimeout(240_000);

    // --- Ada plays a little, then opens her page ---
    const phone = await client(browser);
    await play(phone);
    await openMe(phone);
    await expect(phone.getByRole("heading", { name: HERO, level: 4 })).toBeVisible(TAP);
    await expect(phone.getByRole("region", { name: /your heroes/i }).getByText(/Level \d+/)).toBeVisible();
    // Her first find earned a badge, and nothing is picked yet.
    const badges = phone.getByRole("region", { name: /your badges/i });
    await expect(badges.getByText("Sharp Eyes")).toBeVisible(TAP);
    await expect(phone.getByText(/you found/i)).toBeVisible();
    await expect(phone.locator(".profile__title")).toHaveText("Adventurer");

    // --- She makes it hers ---
    await choose(phone.getByRole("radiogroup", { name: "Pick a color" }), /berry/i);
    await choose(phone.getByRole("radiogroup", { name: `Frame for ${HERO}` }), /ivy/i);
    await choose(phone.getByRole("radiogroup", { name: "Pick a title" }), /sharp eyes/i);
    await expect(phone.getByRole("status").filter({ hasText: /saved/i })).toBeVisible(TAP);
    await expectPicked(phone);

    // --- A second device, paired to her, shows the same page ---
    await phone.goto("/account");
    await phone.getByRole("button", { name: /play as me on another device/i }).click(TAP);
    const code = (await phone.locator(".pair__code").textContent(TAP)) ?? "";
    expect(code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);

    const second = await client(browser);
    await second.goto("/account");
    await second.getByRole("button", { name: /bring my hero to this device/i }).click(TAP);
    await second.getByLabel("Your code").fill(code);
    await second.getByRole("button", { name: /that.s me/i }).click(TAP);
    await expect(second).toHaveURL(/\/journal$/, TAP);
    await second.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Me" }).click(TAP);
    await expect(second.getByRole("heading", { name: "Ada", level: 2 })).toBeVisible(TAP);
    await expectPicked(second);

    // --- And her own phone, opened fresh ---
    await openMe(phone);
    await expectPicked(phone);

    // --- A browser that is nobody has no page, and cannot save one ---
    const stranger = await client(browser);
    await stranger.goto("/");
    await expect(stranger.getByRole("button", { name: /open your book/i })).toHaveCount(0);
    const refused = await stranger.request.post("/api/profile/flair", { data: { color: "sky" } });
    expect(refused.status()).toBe(401);
  });

  test("with the largest text and one-handed play on, every control on her page can be tapped", async ({ browser }) => {
    test.setTimeout(240_000);
    const prefs = { text: "largest", contrast: true, motion: true, hand: "right" };
    const phone = await client(browser, 360, 640, prefs);
    await phone.addInitScript(() => {
      // Dev-server tooling that production does not ship floats over the foot of the pane.
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = ".playtest { display: none !important; }";
        document.head.append(style);
      });
    });
    await play(phone);
    await openMe(phone);

    const viewport = phone.viewportSize()!;
    const controls: Locator[] = [
      phone.getByRole("radiogroup", { name: "Pick a color" }).locator("label"),
      phone.getByRole("radiogroup", { name: `Frame for ${HERO}` }).locator("label"),
      phone.getByRole("radiogroup", { name: "Pick a title" }).locator("label"),
    ];
    for (const group of controls) {
      const count = await group.count();
      expect(count).toBeGreaterThan(1);
      for (let i = 0; i < count; i++) {
        const control = group.nth(i);
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        const label = (await control.textContent()) ?? "a choice";
        expect(box.x, `${label} inside the left edge`).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width, `${label} inside the right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(box.height, `${label} is a real target`).toBeGreaterThanOrEqual(43);
        await control.click({ trial: true, timeout: 5_000 });
      }
    }
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "the page does not scroll sideways").toBeLessThanOrEqual(1);
    // It still saves at this size.
    await choose(phone.getByRole("radiogroup", { name: "Pick a color" }), /plum/i);
    await expect(phone.getByRole("status").filter({ hasText: /saved/i })).toBeVisible(TAP);
  });

  test("a kid seated on a family tablet opens her book from the tray, sees her page, and a preset she changes is saved", async ({ browser }) => {
    test.setTimeout(240_000);
    const email = `grown-up-${Date.now()}@example.com`;
    const signIn = async (page: Page): Promise<void> => {
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: /send the code/i }).click();
      await page.getByLabel("The code").fill("12345678");
    };

    // --- A grown-up's phone: an account, a family, and a Phone Mode room ---
    const grownUp = await client(browser);
    await grownUp.goto("/account");
    await grownUp.getByRole("button", { name: /sign in or create an account/i }).click(TAP);
    await signIn(grownUp);
    await grownUp.getByRole("button", { name: /back to the game/i }).click(TAP);
    await grownUp.getByRole("button", { name: "Back to the start" }).click();
    await grownUp.getByRole("button", { name: /host a game/i }).click();
    await grownUp.getByText("Phone Mode").click();
    await grownUp.getByLabel("Your adventurer name").fill("Grown-up");
    await grownUp.getByRole("button", { name: /^start a game$/i }).click();
    await expect(grownUp).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const code = new URL(grownUp.url()).pathname.split("/").pop() ?? "";

    // --- The family tablet, at the largest text and one-handed, with Ada picked ---
    const tablet = await client(browser, 820, 1100, { text: "largest", contrast: true, motion: true, hand: "right" });
    await tablet.goto("/account");
    await tablet.getByRole("button", { name: /make it a family tablet/i }).click(TAP);
    await signIn(tablet);
    await tablet.getByRole("button", { name: /^done$/i }).click(TAP);
    await tablet.getByRole("button", { name: /someone new/i }).click(TAP);
    await tablet.getByPlaceholder("Type your name").fill("Ada");
    await tablet.getByRole("button", { name: /that.s me/i }).click(TAP);
    await tablet.getByLabel("Room code, four letters").fill(code);
    await tablet.getByRole("button", { name: /join a game/i }).click();
    await expect(tablet).toHaveURL(new RegExp(`/p/${code}$`), TAP);

    // --- Sat down: the tray has her book, clear of the corner controls and the other tabs ---
    const tray = tablet.getByRole("navigation", { name: "What to look at" });
    const book = tray.getByRole("button", { name: "Book" });
    await expect(book).toBeVisible(TAP);
    const boxes = [
      { name: "Book", locator: book },
      ...(await tray.getByRole("button").all()).map((locator, i) => ({ name: `tray tab ${i}`, locator })),
      { name: "Display settings", locator: tablet.getByRole("button", { name: "Display settings" }).first() },
      { name: "Read-aloud", locator: tablet.getByRole("button", { name: /turn read-aloud/i }) },
    ];
    const rects = [];
    for (const { name, locator } of boxes) {
      const box = await locator.boundingBox();
      expect(box, `${name} has a box`).not.toBeNull();
      rects.push({ name, ...box! });
    }
    const view = tablet.viewportSize()!;
    const bookBox = rects[0]!;
    expect(bookBox.x + bookBox.width, "Book inside the right edge").toBeLessThanOrEqual(view.width + 0.5);
    expect(bookBox.width, "Book is a real target").toBeGreaterThanOrEqual(43);
    for (const other of rects.slice(1)) {
      if (other.name === "tray tab 4") continue; // the Book tab itself, counted once above
      const apart = bookBox.x >= other.x + other.width - 0.5 || other.x >= bookBox.x + bookBox.width - 0.5
        || bookBox.y >= other.y + other.height - 0.5 || other.y >= bookBox.y + bookBox.height - 0.5;
      expect(apart, `Book overlaps ${other.name}`).toBe(true);
    }
    await book.click({ trial: true });

    // --- Her page opens with her seat; she changes a color; it is saved ---
    await book.click(TAP);
    await expect(tablet).toHaveURL(/\/journal$/);
    await tablet.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Me" }).click(TAP);
    await expect(tablet.getByRole("heading", { name: "Ada", level: 2 })).toBeVisible(TAP);
    await choose(tablet.getByRole("radiogroup", { name: "Pick a color" }), /lagoon/i);
    await expect(tablet.getByRole("status").filter({ hasText: /saved/i })).toBeVisible(TAP);
    await expect(tablet.locator(".profile")).toHaveAttribute("data-profile-color", "lagoon");

    // Back to the game from the book's own Play tab, and in again: the tablet keeps nothing,
    // so what she sees now was read from the server with her seat.
    await tablet.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Play" }).click(TAP);
    await expect(tablet).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await tray.getByRole("button", { name: "Book" }).click(TAP);
    await tablet.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Me" }).click(TAP);
    await expect(tablet.getByRole("radio", { name: /lagoon/i })).toBeChecked(TAP);
    expect(await tablet.evaluate(() => Object.keys(localStorage))).not.toContain("kad.journal");
  });
});
