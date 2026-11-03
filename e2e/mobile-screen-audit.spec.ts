import { test, expect } from "@playwright/test";
import { seedTable, openPhone, onAir } from "./seed";

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
 test(`phone screen audit ${viewport.width}`, async ({ browser }, info) => {
  const table = await seedTable({ mode: "travel", heroes: [{ name: "Pip", species: "unicorn" }] });
  const { context, page } = await openPhone(browser, table.phones[0]!, { viewport });
  try {
   await onAir(page);
   for (const name of ["World", "You", "Map", "Guide"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
    const scrolling = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main *, .kad-surface *")].filter(el => {
     const box = el.getBoundingClientRect();
     return box.width && box.height && /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 2;
    }).map(el => `${el.className}: ${el.clientHeight}/${el.scrollHeight}`));
    expect(scrolling, `${name} should fit without scrolling`).toEqual([]);
    if (name === "You") {
      const picker = page.getByRole("combobox", { name: "Your page" });
      await picker.focus();
      await picker.press("Home");
      await picker.press("ArrowDown");
      await expect(picker).toHaveValue("stats");
      await expect(page.getByRole("button", { name: "Your stats", exact: true })).toBeVisible();
      await picker.press("Home");
      await expect(picker).toHaveValue("bag");
      await expect(page.getByRole("button", { name: /^Your things/ })).toBeVisible();

      for (const section of ["stats", "party", "token", "room", "bag"]) {
        await page.getByRole("combobox", { name: "Your page" }).selectOption(section);
        expect(await page.locator(".player__scroll").evaluate(el => el.scrollHeight <= el.clientHeight + 1), section).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
   }
  } finally { await context.close(); }
 });
}
test("home and hosting fit a short phone", async ({ page }, info) => {
 await page.setViewportSize({ width: 360, height: 640 });
 await page.goto("/");
 for (const state of ["join", "host"]) {
  if (state === "host") await page.getByRole("button", { name: /^Host a game$/i }).click();
  await page.screenshot({ path: info.outputPath(`${state}.png`) });
  expect(await page.locator(".home").evaluate(el => el.scrollHeight <= innerHeight + 1 && el.getBoundingClientRect().bottom <= innerHeight + 1), state).toBe(true);
 }
});
