import { test, expect, type Page } from "@playwright/test";

async function makeHero(page: Page): Promise<void> {
  await page.getByRole("button", { name: /unicorn/i }).first().click();
  await page.getByRole("button", { name: /^next$/i }).click();
  await page.locator(".creation-choice, .creation-card, button").filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i }).first().click();
  await page.getByRole("button", { name: /^next$/i }).click();
  for (let i = 0; i < 12; i++) {
    const adds = page.getByRole("button", { name: /add a point to/i });
    if (await adds.count() === 0) break;
    await adds.first().click();
  }
  await page.getByRole("button", { name: /^next$/i }).click();
  await page.getByPlaceholder("Tap to type").fill("Atlas Explorer");
  await page.getByRole("button", { name: /that's me/i }).click();
  await page.getByRole("button", { name: /^Ready to play$/i }).click();
}

for (const mode of ["travel", "party"] as const) {
  test(`${mode}: real Map tab loads atlas, discoveries and routes, and remembers exploration`, async ({ page, browser }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let tv: Page | undefined;
    if (mode === "party") {
      tv = await browser.newPage();
      await tv.goto("/");
      await tv.getByRole("button", { name: /want to host/i }).click();
      await tv.getByText("Party Mode", { exact: true }).click();
      await tv.getByRole("button", { name: /open the lobby here/i }).click();
      await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
      const code = new URL(tv.url()).pathname.split("/").pop()!;
      await page.goto("/");
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
    } else {
      await page.goto("/");
      await page.getByRole("button", { name: /want to host/i }).click();
      await page.getByText("Phone Mode", { exact: true }).click();
      await page.getByPlaceholder("Type your name").fill("Atlas Explorer");
      await page.getByRole("button", { name: /start a game/i }).click();
    }
    try {
      await expect(page).toHaveURL(/\/p\/[A-Z]{4}$/);
      await makeHero(page);
      await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
      await page.getByRole("button", { name: /begin the adventure/i }).click();
      await expect(page.locator(".player__scroll:visible .player__task-entry, .player__prompt:visible .prompt__title")
        .filter({ hasText: /Your turn|What do you do/i }).first()).toBeVisible();
      const tray = page.getByRole("navigation", { name: "What to look at" });
      await tray.getByRole("button", { name: /^Map$/ }).click();
      await expect(page.getByRole("button", { name: /^Atlas$/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Read about The Sunward Fields" })).toBeVisible();
      await page.getByRole("button", { name: "Enchanted Woods", exact: true }).click();
      const closer = page.getByRole("button", { name: "Closer", exact: true });
      while (await closer.isEnabled()) await closer.click();
      await expect(page.locator('[data-patch="northwest"]')).toBeAttached();
      await expect(page.locator('[data-route="route.northern_river_bridge"]')).toBeAttached();
      const viewport = page.locator(".atlas__viewport");
      await viewport.evaluate((view) => view.scrollTo({ left: 180, top: 220 }));
      await expect.poll(() => viewport.evaluate((view) => Math.round(view.scrollTop))).toBe(220);
      // Allow the browser's scroll event to save the navigation center.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await tray.getByRole("button", { name: /^You$/ }).click();
      await tray.getByRole("button", { name: /^Map$/ }).click();
      await expect(page.getByRole("button", { name: "Enchanted Woods", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Closer", exact: true })).toBeDisabled();
      await expect.poll(() => viewport.evaluate((view) => Math.round(view.scrollTop))).toBeCloseTo(220, -1);
      await page.getByRole("button", { name: "Story trail", exact: true }).click();
      await expect(page.locator(".trail")).toBeVisible();
      await page.getByRole("button", { name: "Atlas", exact: true }).click();
      await expect(page.getByRole("button", { name: "Closer", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Whole realm", exact: true }).click();
      await page.getByRole("button", { name: "Read about The Sunward Fields" }).click();
      await expect(page.getByRole("heading", { name: "The Sunward Fields", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back to map", exact: true }).click();
      await page.waitForFunction(() => {
        const view = document.querySelector(".atlas__viewport")!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLImageElement>(".atlas__tile")].filter((tile) => {
          const box = tile.getBoundingClientRect();
          return box.left < view.right && box.right > view.left && box.top < view.bottom && box.bottom > view.top;
        }).every((tile) => tile.complete && tile.naturalWidth > 0);
      });
      await page.screenshot({ path: `test-results/atlas-in-app-${mode}.png` });
    } finally {
      await tv?.close();
    }
  });
}
