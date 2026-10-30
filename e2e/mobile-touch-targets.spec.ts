import { test, expect, type Locator } from "@playwright/test";

async function fullTouchTargets(controls: Locator) {
  await expect(controls.first()).toBeVisible();
  const small = await controls.evaluateAll((elements) => elements.flatMap((el) => {
    const box = el.getBoundingClientRect();
    return box.width && box.height && (box.width < 44 || box.height < 44)
      ? [{ label: el.textContent?.trim(), width: box.width, height: box.height }] : [];
  }));
  expect(small).toEqual([]);
}

for (const viewport of [{ width: 320, height: 720 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
  test(`secondary navigation has full touch targets at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await fullTouchTargets(page.locator(".home__link:visible"));
    await page.goto("/guide");
    // The words are fetched, so wait for the page itself before asking what is on it.
    await expect(page.locator(".guide__title")).toBeVisible();
    // Narrower than 62em the contents fold away behind a button, which is a touch target too.
    const toggle = page.locator(".guide__contents-toggle");
    if (await toggle.isVisible()) {
      await fullTouchTargets(toggle);
      await toggle.click();
    }
    await fullTouchTargets(page.locator(".guide__contents .guide__link"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Field Guide sections remain easy to tap on a small phone and tablet", async ({ page }) => {
  const { createCharacter } = await import("./characters");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: /host a game/i }).click();
  await page.getByText("Phone Mode", { exact: true }).click();
  await page.getByLabel("Your adventurer name").fill("Explorer");
  await page.getByRole("button", { name: /^start a game$/i }).click();
  await createCharacter(page, "unicorn", "Moonbeam");
  await page.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: /^Guide$/ }).click();
  for (const viewport of [{ width: 320, height: 720 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await fullTouchTargets(page.locator(".field-guide__tab"));
    await expect(page.locator(".field-guide")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`field-guide-${viewport.width}.png`) });
  }
});
