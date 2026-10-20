/**
 * Help on every screen (#256), on a phone: the "?" names the screen that is up and reads it aloud, and
 * pressing and holding a thing shows what it does without breaking a tap or a scroll.
 *
 * The touches are real ones (CDP `Input.dispatchTouchEvent`), not a mouse pretending, because the thing
 * worth proving is what the browser does with a finger: a hold that is a scroll becomes `pointercancel`
 * and a tap still clicks. The smallest phone we design for, at the largest text size, so the "?" in the
 * corner row is also shown to be clear of its neighbours.
 */

import { test, expect, type CDPSession, type Locator, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded(TAP);
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" || at === undefined ? [] : [{ x: at.x, y: at.y }] });
}

/** A hero made and left in the lobby, where the bag is the screen. */
async function heroInTheLobby(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /host a game/i }).click(TAP);
  await page.getByText("Phone Mode", { exact: true }).click(TAP);
  await page.getByPlaceholder("Type your name").fill(name, TAP);
  await page.getByRole("button", { name: /start a game/i }).click(TAP);
  await expect(page).toHaveURL(/\/p\/[A-Z]{4}$/);
  await page.getByRole("button", { name: /unicorn/i }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.locator(".creation-choice, .creation-card, button").filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  for (let i = 0; i < 12; i++) {
    const adds = page.getByRole("button", { name: /add a point to/i });
    if ((await adds.count()) === 0) break;
    await adds.first().click(TAP);
  }
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
}

test("the ? and press-and-hold, on the smallest phone at the largest text", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("kad.a11y", JSON.stringify({ text: "largest", contrast: false, motion: false, hand: "off" }));
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".playtest { display: none !important; }";
      document.head.append(style);
    });
  });
  try {
    await heroInTheLobby(page, "Helpful");
    const cdp = await context.newCDPSession(page);

    // The "?" is there, big enough, and not on top of its neighbours.
    const help = page.getByRole("button", { name: "Help", exact: true });
    await expect(help).toBeVisible(TAP);
    const neighbours = [page.getByRole("button", { name: "Display settings" }).first(), page.getByRole("button", { name: /turn read-aloud/i }), page.getByRole("button", { name: /turn sound/i })];
    const helpBox = (await help.boundingBox())!;
    expect(helpBox.width).toBeGreaterThanOrEqual(43);
    expect(helpBox.height).toBeGreaterThanOrEqual(43);
    for (const other of neighbours) {
      if ((await other.count()) === 0) continue;
      const box = (await other.boundingBox())!;
      const apart = helpBox.x + helpBox.width <= box.x + 0.5 || box.x + box.width <= helpBox.x + 0.5 || helpBox.y + helpBox.height <= box.y + 0.5 || box.y + box.height <= helpBox.y + 0.5;
      expect(apart, "the ? does not overlap its neighbours").toBe(true);
    }

    // The bag is up: the sheet says so, and closes.
    await expect(page.getByRole("heading", { name: /Your things/ })).toBeVisible(TAP);
    await help.click(TAP);
    await expect(page.getByRole("dialog", { name: "Help" })).toContainText(/These are your things/);
    await page.getByRole("button", { name: "Got it" }).click(TAP);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // A new hero holds nothing yet, so the hold is proven on a scrolling list of the same shape as the
    // cards and the bag: real buttons wearing the same data attributes, in a box that scrolls.
    await page.evaluate(() => {
      const list = document.createElement("ul");
      list.id = "held-list";
      list.style.cssText = "position:fixed;inset:80px 40px 120px 40px;z-index:3;margin:0;padding:0;overflow-y:auto;background:#222;list-style:none";
      for (let i = 0; i < 12; i++) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Card ${String(i)}`;
        button.style.cssText = "display:block;width:100%;height:90px";
        button.setAttribute("aria-pressed", "false");
        button.dataset.helpKind = "card";
        button.dataset.helpName = `Card ${String(i)}`;
        button.dataset.helpText = "Does a card thing.";
        button.addEventListener("click", () => { button.setAttribute("aria-pressed", "true"); });
        item.append(button);
        list.append(item);
      }
      document.getElementById("root")!.append(list);
    });
    const first = page.getByRole("button", { name: "Card 0" });
    const at = await centerOf(first);

    // A tap still taps, and is not a hold.
    await touch(cdp, "touchStart", at);
    await touch(cdp, "touchEnd");
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await first.evaluate((button) => { button.setAttribute("aria-pressed", "false"); });

    // A finger that slides is a scroll: the list moves, there is no sheet, and no tap on what it started on.
    const scrolled = () => page.evaluate(() => document.getElementById("held-list")!.scrollTop);
    await touch(cdp, "touchStart", { x: at.x, y: at.y + 150 });
    for (let step = 1; step <= 10; step++) {
      await touch(cdp, "touchMove", { x: at.x, y: at.y + 150 - step * 15 });
      await page.waitForTimeout(80);
    }
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(200);
    expect(await scrolled(), "the list scrolled under the finger").toBeGreaterThan(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Card/ }).filter({ has: page.locator("xpath=self::*[@aria-pressed='true']") })).toHaveCount(0);

    // A finger that stays is a hold: the sheet names the card, and the hold did not also play it.
    await page.evaluate(() => { document.getElementById("held-list")!.scrollTop = 0; });
    await touch(cdp, "touchStart", at);
    await page.waitForTimeout(700);
    await touch(cdp, "touchEnd");
    const sheet = page.getByRole("dialog", { name: "Card 0" });
    await expect(sheet).toBeVisible(TAP);
    await expect(sheet).toContainText("Does a card thing.");
    await sheet.getByRole("button", { name: "Got it" }).click(TAP);
    await expect(first).toHaveAttribute("aria-pressed", "false");
  } finally {
    await context.close();
  }
});

test("the shared screen says how to join, in one line with a picture", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: /host a game/i }).click(TAP);
  await page.getByText("Party Mode", { exact: true }).click(TAP);
  await page.getByRole("button", { name: /open the lobby here/i }).click(TAP);
  await expect(page).toHaveURL(/\/tv\/[A-Z]{4}$/);
  const step = page.locator(".lobby__join-step");
  await expect(step).toContainText(/Scan this with your phone or tablet/, TAP);
  await expect(step.locator("svg, img").first()).toBeVisible();
  // It sits beneath the code and the QR, inside the screen, and nothing needs scrolling to read it.
  const box = (await step.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  // No "?" on the TV: it is nobody's hands.
  await expect(page.getByRole("button", { name: "Help", exact: true })).toHaveCount(0);
});
