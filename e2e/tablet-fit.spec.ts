/**
 * A tablet held sideways (layout/landscape.ts): the world beside the controls, sized for the pane
 * each is in, not for the screen.
 *
 * A surface sets its font-size in cqw/cqh (theme.css), and those units measure the nearest size
 * container above it. Without one they measured the viewport, so side by side the controls, in a
 * pane half the screen wide, were sized for the whole screen: 21px type and 90px choices on an
 * iPad, 135px at the largest text, and four choices filled a 768px screen. The panes are size
 * containers now. This holds the sizes a pane that wide should have, at normal text on an iPad
 * and at the largest text on the smallest one, and that every choice is on screen in its pane.
 */

import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";

const TAP = { timeout: 20_000 } as const;

const CASES = [
  // The surface's floor (15px) times the text scale: a pane ~460px wide is past neither bound.
  { width: 1180, height: 820, text: "normal", font: 15, tallest: 70 },
  { width: 1024, height: 768, text: "largest", font: 22.5, tallest: 105 },
] as const;

test.describe("a tablet held sideways", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function tablet(browser: Browser, width: number, height: number, text: string): Promise<BrowserContext> {
    const made = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    open.push(made);
    if (text !== "normal") await made.addInitScript(`localStorage.setItem("kad.a11y", JSON.stringify({ text: "${text}" }))`);
    return made;
  }

  for (const { width, height, text, font, tallest } of CASES) {
    test(`sizes the controls for their pane at ${String(width)}x${String(height)}, ${text} text`, async ({ browser }) => {
      test.setTimeout(120_000);
      const page = await (await tablet(browser, width, height, text)).newPage();
      await page.goto("/");
      await page.getByRole("button", { name: /host a game/i }).click();
      await page.getByText("Phone Mode").click();
      await page.getByLabel("Your adventurer name").fill("Grown-up");
      await page.getByRole("button", { name: /^start a game$/i }).click();
      await expect(page).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
      await createCharacter(page, "unicorn", "Sparklehoof");
      await openPlayerTask(page);
      await page.getByRole("button", { name: /begin the adventure/i }).first().click(TAP);

      // Side by side: the world and the controls both up.
      await expect(page.locator(".kad-travel[data-side-by-side]")).toBeVisible(TAP);
      const choices = page.locator("[data-pane='player'] .choice");
      await expect(choices.first()).toBeVisible(TAP);
      await expect(page.locator("[data-pane='world'] .kad-surface--world")).toBeVisible();

      // Allow responsive layout and lazy artwork to settle after the scene arrives.
      // Keep every size and visibility constraint; retry the rendered measurement.
      await expect(async () => {
        const sizes = await page.evaluate(() => {
          const px = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : NaN);
          const pane = document.querySelector("[data-pane='player']")!.getBoundingClientRect();
          return {
            player: px(document.querySelector(".kad-surface--player")),
            world: px(document.querySelector(".kad-surface--world")),
            choices: [...document.querySelectorAll("[data-pane='player'] .choice")].map((el) => {
              const box = el.getBoundingClientRect();
              return {
                height: box.height,
                // Whole, inside the pane and the screen.
                seen: box.top >= pane.top - 1 && box.bottom <= Math.min(pane.bottom, innerHeight) + 1 &&
                  box.left >= pane.left - 1 && box.right <= pane.right + 1,
              };
            }),
          };
        });
        expect(sizes.player, "the controls' type, sized for their pane").toBeCloseTo(font, 1);
        expect(sizes.world, "the world's type, sized for its pane").toBeCloseTo(font, 1);
        expect(sizes.choices.length).toBeGreaterThan(0);
        for (const [i, choice] of sizes.choices.entries()) {
          expect(choice.height, `choice ${String(i + 1)} is a pane's height, not a screen's`).toBeLessThanOrEqual(tallest);
          expect(choice.seen, `choice ${String(i + 1)} is whole on screen in its pane`).toBe(true);
        }
      }).toPass({ timeout: 10_000 });
    });
  }
});
