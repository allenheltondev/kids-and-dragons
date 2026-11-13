import { test, expect, type Page } from "@playwright/test";
import type { InteractionPrompt, RunState } from "../packages/shared/src/index";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";

test.use({ actionTimeout: 15_000, trace: process.env.CI ? "retain-on-failure" : "off" });

for (const height of [720, 640]) {
  test(`a long bridge cue leaves the full relay visible on a ${height}p TV`, async ({ browser }) => {
    const table = await seedTable({ mode: "party", tv: true, chapterId: "gemfall-02", sceneId: "interaction_bridge_load", heroes: [
      { name: "Moonlightbramble", species: "unicorn" }, { name: "Emberwingfeather", species: "griffin" },
      { name: "Skyclawthunderer", species: "dragonling" }, { name: "Whisperwillow", species: "bigfoot" },
    ] });
    const tv = await openTv(browser, table, { viewport: { width: 1280, height } });
    const phone = await openPhone(browser, table.phones[0]!, { viewport: { width: 360, height: 640 } });
    try {
      await Promise.all([onAir(tv.page), onAir(phone.page)]);
      await phone.page.getByRole("button", { name: "You", exact: true }).click();
      await openPlayerTask(phone.page);
      await phone.page.getByRole("button", { name: "We’re ready" }).click();
      await expect(tv.page.locator(".game--relay.game--active")).toBeVisible();
      await expect(tv.page.locator(".game--tv .game__edge").filter({ hasText: "Careful:" })).toBeVisible();
      await expect(tv.page.locator(".game--tv .game__cue")).toBeHidden();
      await tv.page.evaluate(() => document.fonts.ready);
      await expect.poll(async () => tv.page.evaluate(() => {
        const board = document.querySelector(".game--tv .game__board")!.getBoundingClientRect();
        const stage = document.querySelector(".relay-world__stage")!.getBoundingClientRect();
        const labels = [...document.querySelectorAll(".relay-world__hero > strong")].map(el => el.getBoundingClientRect());
        return stage.top >= board.top && stage.bottom <= board.bottom + 1 && labels.length === 4 &&
          labels.every(label => label.top >= board.top && label.bottom <= board.bottom + 1);
      })).toBe(true);
    } finally { await Promise.all([phone.context.close(), tv.context.close()]); }
  });
}

test("an edged memory game keeps its knack visible on a 720p TV", async ({ browser }) => {
  const table = await seedTable({ mode: "party", tv: true, chapterId: "riftlight-whale-road", sceneId: "sing_road", heroes: [
    { name: "Willow", species: "kitsune" },
  ] });
  const tv = await openTv(browser, table, { viewport: { width: 1280, height: 720 } });
  const phone = await openPhone(browser, table.phones[0]!);
  try {
    await Promise.all([onAir(tv.page), onAir(phone.page)]);
    await phone.page.getByRole("button", { name: "You", exact: true }).click();
    await openPlayerTask(phone.page);
    await phone.page.getByRole("button", { name: "We’re ready" }).click();
    await expect(tv.page.locator(".game--memory.game--active")).toBeVisible();
    await expect(tv.page.locator(".game--tv .game__edge").filter({ hasText: "Strong here!" })).toBeVisible();
    await expect(tv.page.locator(".game--tv .game__cue")).toBeHidden();
    await expect.poll(() => tv.page.evaluate(() => {
      const board = document.querySelector(".game--tv .game__board")!.getBoundingClientRect();
      const pattern = document.querySelector(".game--tv .skill-mechanism")!.getBoundingClientRect();
      return pattern.top >= board.top && pattern.bottom <= board.bottom + 1;
    })).toBe(true);
  } finally { await Promise.all([phone.context.close(), tv.context.close()]); }
});

test("relay throws change the next flight and a dropped delivery can be saved", async ({ browser }, info) => {
  const table = await seedTable({ mode: "party", tv: true, chapterId: "first-steps-01", sceneId: "interaction_spark", heroes: [
    { name: "Aster", species: "unicorn" }, { name: "Fern", species: "griffin" },
  ] });
  const tv = await openTv(browser, table);
  const one = await openPhone(browser, table.phones[0]!);
  const two = await openPhone(browser, table.phones[1]!, { viewport: { width: 360, height: 640 } });
  const controls = (page: Page) => page.getByRole("region", { name: "Interaction controls" });
  const prompt = async () => (await roomState<RunState>(one.page, table.code)).prompt as InteractionPrompt;
  try {
    await Promise.all([onAir(tv.page), onAir(one.page), onAir(two.page)]);
    for (const phone of [one.page, two.page]) {
      await phone.getByRole("button", { name: "You", exact: true }).click();
      await openPlayerTask(phone);
    }
    await controls(one.page).getByRole("button", { name: "We’re ready" }).click();
    // Let the first object fall: the pickup must use a chance instead of being a guaranteed catch.
    await expect(controls(one.page).locator(".relay-skill")).toHaveAttribute("data-ground", "true");
    const firstStage = controls(one.page).getByRole("button", { name: "Catch the starlight", exact: true });
    await firstStage.click();
    await expect.poll(async () => (await prompt()).caughtBy).toBe(table.phones[0]!.playerId);
    expect((await prompt()).relay).toMatchObject({ chances: 2, saves: 1 });
    await expect(controls(one.page).locator('.relay-skill__grip > img')).toHaveJSProperty("naturalWidth", 512);
    await expect(controls(one.page).locator('.relay-skill__recipient')).toHaveAttribute("src", /griffin.*assembled\.png$/);
    const boardBox = await tv.page.locator(".game__board").boundingBox();
    const heroBox = await tv.page.locator(".relay-world__hero > img").first().boundingBox();
    expect(heroBox!.y).toBeGreaterThanOrEqual(boardBox!.y);
    expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(boardBox!.y + boardBox!.height);
    await one.page.screenshot({ path: info.outputPath("phone-aim.png") });
    await tv.page.screenshot({ path: info.outputPath("tv-route.png") });

    // Aim deliberately away from the target. This changes the next phone's landing and catch window.
    await controls(one.page).getByText("Use aim controls and buttons", { exact: true }).click();
    await controls(one.page).getByRole("slider", { name: "Direction" }).fill("-1");
    await controls(one.page).getByRole("slider", { name: "Strength" }).fill("0.1");
    await controls(one.page).getByRole("button", { name: "Throw to Fern" }).click();
    await expect.poll(async () => (await prompt()).relay?.flight.quality).toBe("wild");
    expect((await prompt()).relay?.flight.landing).toBe(0.16);
    // A late pickup at the actual left-hand landing saves the wild throw, at the cost of one chance.
    await expect(controls(two.page).locator(".relay-skill")).toHaveAttribute("data-ground", "true");
    const secondStage = controls(two.page).getByRole("button", { name: "Catch the starlight", exact: true });
    const box = await secondStage.boundingBox();
    await secondStage.click({ position: { x: box!.width * 0.16, y: box!.height * 0.82 } });
    await expect.poll(async () => (await prompt()).caughtBy).toBe(table.phones[1]!.playerId);
    expect((await prompt()).relay).toMatchObject({ chances: 1, saves: 2 });
    await two.page.screenshot({ path: info.outputPath("phone-saved.png") });
    // Finish with an actual swipe into the home target; a tap on this surface cannot throw.
    const throwStage = controls(two.page).getByRole("button", { name: "Throw the starlight", exact: true });
    await throwStage.scrollIntoViewIfNeeded();
    const throwBox = await throwStage.boundingBox();
    const x = throwBox!.x + throwBox!.width * 0.5, y = throwBox!.y + throwBox!.height * 0.68;
    await two.page.mouse.move(x, y);
    await two.page.mouse.down();
    await two.page.mouse.move(x - throwBox!.width * 0.22, y - throwBox!.height * 0.448, { steps: 8 });
    await two.page.mouse.up();
    await expect.poll(async () => (await prompt()).outcome).toBe("success");
    expect((await prompt()).relay).toMatchObject({ chances: 1, cleanPasses: 1 });
    await expect(controls(two.page).getByRole("button", { name: "See what happens next" })).toBeVisible();
    const finalBoard = await tv.page.locator(".game__board").boundingBox();
    for (const name of await tv.page.locator(".relay-world__hero > strong").all()) {
      const nameBox = await name.boundingBox();
      expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(finalBoard!.y + finalBoard!.height);
    }
    expect(await two.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await tv.page.screenshot({ path: info.outputPath("tv-delivered.png") });
  } finally { await Promise.all([one.context.close(), two.context.close(), tv.context.close()]); }
});
