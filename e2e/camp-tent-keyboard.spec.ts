import { test, expect } from "@playwright/test";
import { onAir, openPhone, seedTable } from "./seed";

test("tent dialog traps keyboard focus with the shelf closed and open", async ({ browser }) => {
  test.setTimeout(90_000);
  const table = await seedTable({ mode: "travel", heroes: [{ name: "Pip", species: "unicorn" }], camp: { real: true, grownBy: ["gemfall"] } });
  const phone = await openPhone(browser, table.phones[0]!);
  const page = phone.page;
  try {
    await onAir(page);
    await page.getByRole("button", { name: "You", exact: true }).click();
    await page.locator('[data-testid="camp-button"]:visible').first().click();
    await page.getByRole("tab", { name: "Play", exact: true }).click();
    await page.getByRole("dialog").getByTestId("tent-button").click();
    const dialog = page.getByRole("dialog");
    const room = dialog.getByRole("region", { name: "Pip's tent" });
    await expect(room).toBeVisible();
    const summary = room.locator("summary");
    const close = dialog.getByRole("button", { name: "Done" });
    for (const expanded of [false, true]) {
      if (expanded) await summary.click();
      const last = expanded ? room.getByRole("button").last() : summary;
      await last.focus();
      await page.keyboard.press("Tab");
      await expect(close, await page.evaluate(() => document.activeElement?.outerHTML ?? "none")).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(last).toBeFocused();
      // Walk the entire cycle, including the native summary and painted SVGs.
      for (let step = 0; step < 35; step++) {
        await page.keyboard.press("Tab");
        await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      }
      await room.getByRole("heading").focus();
      await page.keyboard.press("Shift+Tab");
      await expect(last).toBeFocused();
    }
  } finally { await phone.context.close(); }
});
