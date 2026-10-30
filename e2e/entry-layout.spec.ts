import { test, expect } from "@playwright/test";
import { seedTable, openPhone, openTv, onAir } from "./seed";

test("wide entry screens use both sides and phones put lobby privacy below navigation", async ({ browser, page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Host a game", exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/reviews/crew-identity/home-landscape.png" });
  const masthead = await page.locator(".home__masthead").boundingBox();
  const joining = await page.locator(".home__card--join").boundingBox();
  expect(masthead!.x + masthead!.width).toBeLessThan(joining!.x);
  await page.getByRole("button", { name: "Host a game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open the lobby here" })).toBeVisible();
  await page.screenshot({ path: "docs/reviews/crew-identity/host-landscape.png" });
  const modes = await page.locator(".home__mode").all();
  expect((await modes[0]!.boundingBox())!.y).toBe((await modes[1]!.boundingBox())!.y);

  const table = await seedTable({ mode: "party", tv: true, heroes: [
    { name: "Pip", species: "unicorn" }, { name: "Bo", species: "griffin" },
    { name: "Fern", species: "dragonling" }, { name: "Moss", species: "bigfoot" },
  ] });
  const tv = await openTv(browser, table);
  const phone = await openPhone(browser, table.phones[0]!);
  try {
    await Promise.all([onAir(tv.page), onAir(phone.page)]);
    const join = await tv.page.locator(".lobby__join").boundingBox();
    const party = await tv.page.locator(".lobby__party").boundingBox();
    expect(join!.x + join!.width).toBeLessThan(party!.x);
    await tv.page.screenshot({ path: "docs/reviews/crew-identity/lobby-landscape.png" });
    const footer = phone.page.locator(".kad-phone-frame > .privacy-footer");
    await expect(footer).toBeVisible();
    const bottom = await footer.boundingBox();
    const tray = await phone.page.getByRole("navigation", { name: "What to look at" }).boundingBox();
    expect(bottom!.y).toBeGreaterThanOrEqual(tray!.y + tray!.height - 1);
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(844);
    await phone.page.screenshot({ path: "docs/reviews/crew-identity/lobby-phone-footer.png" });
    await tv.page.getByRole("button", { name: "Room", exact: true }).click();
    await tv.page.getByRole("button", { name: "New players? Start a new crew" }).click();
    await expect(phone.page.getByText(/Make a new hero for The Otter Crew/)).toBeVisible();
    await expect(footer).toHaveCount(0);
  } finally {
    await tv.context.close();
    await phone.context.close();
  }
});

for (const mode of ["party", "travel"] as const) {
  test(`${mode} phone footer stays below the tray in the lobby and leaves gameplay`, async ({ browser }) => {
    for (const begin of [false, true]) {
      const table = await seedTable({ mode, begin, heroes: [{ name: "Pip", species: "unicorn" }] });
      const phone = await openPhone(browser, table.phones[0]!);
      try {
        await onAir(phone.page);
        const footer = phone.page.locator(".kad-phone-frame > .privacy-footer");
        if (begin) await expect(footer).toHaveCount(0);
        else {
          await expect(footer).toBeVisible();
          const strip = await footer.boundingBox();
          const tray = await phone.page.getByRole("navigation", { name: "What to look at" }).boundingBox();
          expect(strip!.y).toBeGreaterThanOrEqual(tray!.y + tray!.height - 1);
          await phone.page.setViewportSize({ width: 844, height: 390 });
          await expect(footer).toBeVisible();
          expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
      } finally { await phone.context.close(); }
    }
  });
}
