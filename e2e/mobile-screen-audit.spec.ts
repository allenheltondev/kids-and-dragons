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
      // Everything at once (no picker, no folds): the stats, everyone, the token and the bag.
      await expect(page.getByRole("combobox")).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Your stats" })).toBeVisible();
      await expect(page.getByRole("list", { name: "Everyone" })).toBeVisible();
      await expect(page.locator(".you__token")).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Your things/ })).toBeVisible();
      const fits = () => page.locator(".player__you").evaluate(el => el.scrollHeight <= el.clientHeight + 1);
      expect(await fits(), "You").toBe(true);
      // Room settings stand in for the bag, and fit too.
      const room = page.locator(".you__room");
      await room.click();
      await expect(page.locator(".player__room-settings")).toBeVisible();
      expect(await fits(), "Room settings").toBe(true);
      await room.click();
      await expect(page.getByRole("heading", { name: /^Your things/ })).toBeVisible();
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
