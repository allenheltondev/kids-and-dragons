/**
 * Joining on a phone, at the playtest's widths (320, 360 and 390px) and at the
 * largest text: making a hero, coming back with a saved one, and the You page.
 *
 * The owner's report: "choosing your character has the buttons overflowing off
 * the screen". At 320px a stat row's free-point chip sat on its name, and at
 * larger text the name field's width pushed the whole step, and "That's me!",
 * off the right edge. So on every step this asserts nothing runs off either
 * side, the page never scrolls sideways, and the step's way on is on screen.
 *
 * And the You page's folds: the goal is one line until it is opened, and a
 * section folded stays folded on that phone.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;

type Text = "normal" | "large" | "largest";
const CASES: { width: number; text: Text }[] = [
  { width: 320, text: "normal" },
  { width: 360, text: "normal" },
  { width: 390, text: "normal" },
  { width: 320, text: "large" },
  { width: 320, text: "largest" },
  { width: 390, text: "largest" },
];

/** What runs off the screen sideways, by class, and the page's own sideways scroll. */
async function offScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > width) out.push(`page scrolls sideways (${String(document.documentElement.scrollWidth)})`);
    for (const el of document.querySelectorAll<HTMLElement>(".kad-surface--player *")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // A row that scrolls sideways on purpose (the party strip) holds its own overflow.
      if (el.closest(".party-strip__list")) continue;
      if (box.right > width + 1 || box.left < -1) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
    }
    return out.slice(0, 8);
  });
}

async function inView(page: Page, name: RegExp): Promise<void> {
  const button = page.getByRole("button", { name }).last();
  await expect(button).toBeVisible(TAP);
  const box = await button.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, `${String(name)} has a box`).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.describe("a phone joining, at the playtest's widths", () => {
  test.setTimeout(180_000);
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function context(browser: Browser, width: number, text: Text): Promise<BrowserContext> {
    const made = await browser.newContext({ viewport: { width, height: 720 }, hasTouch: true, isMobile: true });
    open.push(made);
    if (text !== "normal") await made.addInitScript(`localStorage.setItem("kad.a11y", JSON.stringify({ text: "${text}" }))`);
    return made;
  }

  async function lobby(browser: Browser): Promise<string> {
    const made = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    open.push(made);
    const tv = await made.newPage();
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    return new URL(tv.url()).pathname.split("/").pop() ?? "";
  }

  /** A new page on the phone, opened after the room's TV so it is the one in front. */
  async function join(phone: BrowserContext, code: string): Promise<Page> {
    const page = await phone.newPage();
    await page.goto("/");
    await page.getByLabel(/room code/i).fill(code);
    await page.getByRole("button", { name: /join a game/i }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    return page;
  }

  for (const { width, text } of CASES) {
    test(`makes a hero and comes back with one at ${String(width)}px, ${text} text`, async ({ browser }) => {
      const phone = await context(browser, width, text);
      const kid = await join(phone, await lobby(browser));

      const fits = async (step: string, way: RegExp): Promise<void> => {
        expect(await offScreen(kid), step).toEqual([]);
        await inView(kid, way);
      };

      await kid.getByRole("button", { name: /unicorn/i }).first().click(TAP);
      await fits("species", /^next$/i);
      await kid.getByRole("button", { name: /^next$/i }).click(TAP);
      await kid.locator(".creation-card").filter({ hasText: /thornguard/i }).first().click(TAP);
      await fits("class", /^next$/i);
      await kid.getByRole("button", { name: /^next$/i }).click(TAP);
      await fits("stats", /^next$/i);
      // Halfway, when a row shows both "take one off" and "add one".
      await kid.getByRole("button", { name: /add a point to might/i }).click(TAP);
      await fits("stats, both buttons", /^next$/i);
      for (let i = 0; i < 12; i++) {
        const adds = kid.getByRole("button", { name: /add a point to/i });
        if ((await adds.count()) === 0) break;
        await adds.first().click(TAP);
      }
      await fits("stats, spent", /^next$/i);
      // The name on a stat row is never under its free-point chip.
      const rows = await kid.locator(".creation-stat").evaluateAll((all) =>
        all.map((row) => {
          const name = row.querySelector(".creation-stat__name")!.getBoundingClientRect();
          const chip = row.querySelector(".creation-stat__bonus .kad-chip")?.getBoundingClientRect();
          const overlaps = chip !== undefined && chip.left < name.right && chip.right > name.left && chip.top < name.bottom && chip.bottom > name.top;
          return { clipped: (row.querySelector(".creation-stat__name") as HTMLElement).scrollWidth > Math.ceil(name.width) + 1, overlaps };
        }),
      );
      expect(rows.filter((row) => row.overlaps || row.clipped)).toEqual([]);
      await kid.getByRole("button", { name: /^next$/i }).click(TAP);
      await kid.getByPlaceholder("Tap to type").fill("Thistlewhisker", TAP);
      await fits("name", /that's me/i);
      // "That's me!" in full beside "Back", never cut to "That'…".
      const label = kid.getByRole("button", { name: /that's me/i }).locator(".kad-button__label");
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await kid.getByRole("button", { name: /that's me/i }).click(TAP);
      await expect(kid.getByRole("button", { name: /^Ready to play$/i })).toBeVisible(TAP);
      expect(await offScreen(kid), "lobby").toEqual([]);

      // The same phone in another room: it has a hero to bring.
      await kid.close();
      const back = await join(phone, await lobby(browser));
      const hero = back.locator(".welcome-back__hero").first();
      // A dispatched click, not a pointer tap: what is measured here is the layout once a hero is
      // chosen, and a tap on this card from the second room's page could stall Playwright's
      // actionability wait past its timeout although the page answers it at once.
      await expect(hero).toBeVisible(TAP);
      await hero.dispatchEvent("click");
      await expect(hero).toHaveAttribute("aria-pressed", "true", TAP);
      await expect(back.getByRole("button", { name: "Play as Thistlewhisker" })).toBeVisible(TAP);
      expect(await offScreen(back), "welcome back").toEqual([]);
      await inView(back, /^Play as Thistlewhisker$/);
      await inView(back, /make someone new/i);
      for (const name of [/^Play as Thistlewhisker$/, /make someone new/i]) {
        const cut = await back.getByRole("button", { name }).locator(".kad-button__label").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(cut, String(name)).toBe(false);
      }
    });
  }

  test("the You page folds, and the phone remembers how it was left", async ({ browser }) => {
    const phone = await context(browser, 360, "normal");
    const kid = await join(phone, await lobby(browser));
    await kid.getByRole("button", { name: /unicorn/i }).first().click(TAP);
    await kid.getByRole("button", { name: /^next$/i }).click(TAP);
    await kid.locator(".creation-card").filter({ hasText: /thornguard/i }).first().click(TAP);
    await kid.getByRole("button", { name: /^next$/i }).click(TAP);
    for (let i = 0; i < 12; i++) {
      const adds = kid.getByRole("button", { name: /add a point to/i });
      if ((await adds.count()) === 0) break;
      await adds.first().click(TAP);
    }
    await kid.getByRole("button", { name: /^next$/i }).click(TAP);
    await kid.getByPlaceholder("Tap to type").fill("Sparklehoof", TAP);
    await kid.getByRole("button", { name: /that's me/i }).click(TAP);

    const stats = kid.getByRole("button", { name: "Your stats" });
    await expect(stats).toHaveAttribute("aria-expanded", "true", TAP);
    await expect(kid.locator(".stat-row")).toBeVisible();
    await stats.click();
    await expect(stats).toHaveAttribute("aria-expanded", "false");
    await expect(kid.locator(".stat-row")).toBeHidden();
    await kid.reload();
    await expect(kid.getByRole("button", { name: "Your stats" })).toHaveAttribute("aria-expanded", "false", TAP);
    await expect(kid.locator(".stat-row")).toBeHidden();
    expect(await offScreen(kid)).toEqual([]);
  });
});
