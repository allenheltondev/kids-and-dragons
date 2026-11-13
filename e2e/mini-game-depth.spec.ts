import { test, expect, type Page } from "@playwright/test";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { roomState } from "./room-state";
import type { RunState } from "@kad/shared";

const controls = (page: Page) => page.getByRole("region", { name: "Interaction controls" });
test.use({ actionTimeout: 15_000, trace: process.env.CI ? "retain-on-failure" : "off" });
test("shifting loads and shared effort survive mistakes, refresh, and short phone screens", async ({ browser }, info) => {
  const table = await seedTable({ mode: "party", tv: true, chapterId: "first-steps-01", sceneId: "interaction_balance", heroes: [
    { name: "Aster", species: "unicorn" }, { name: "Fern", species: "griffin" },
  ] });
  const one = await openPhone(browser, table.phones[0]!, { viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
  const two = await openPhone(browser, table.phones[1]!, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tv = await openTv(browser, table);
  try {
    await Promise.all([one.page, two.page, tv.page].map(page => onAir(page)));
    for (const phone of [one.page, two.page]) {
      const gotIt = phone.getByRole("button", { name: "Got it", exact: true });
      await phone.getByRole("button", { name: "You", exact: true }).click();
      if (await gotIt.isVisible()) await gotIt.click();
      const turn = phone.getByRole("button", { name: "Your turn", exact: true });
      if (await turn.isVisible()) await turn.click();
    }
    const readyLead = async () => {
      const start = (page: Page) => controls(page).getByRole("button", { name: /ready/ });
      await expect.poll(async () => await start(one.page).count() + await start(two.page).count()).toBe(1);
      return await start(one.page).count() ? one.page : two.page;
    };
    let lead = await readyLead();
    // A friend's controls must show the new round before another lift is sent.
    // Otherwise a delayed patch can make a valid-looking tap carry the old round.
    const roundOnBoth = async (round: number) => {
      for (const page of [one.page, two.page]) await expect.poll(() => page.evaluate(async () => {
        const path = "/src/store/index.ts";
        const prompt = (await import(path)).useGameStore.getState().state?.prompt;
        return prompt?.kind === "interaction" ? prompt.challenge?.round : undefined;
      })).toBe(round);
    };
    await controls(lead).getByRole("button", { name: /ready/ }).click();
    for (const phone of [one.page, two.page]) for (let n = 0; n < 2; n++) await controls(phone).getByRole("button", { name: "Lift my side", exact: true }).click();
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click();
    await roundOnBoth(1);
    await expect(controls(two.page)).toContainText("The load leans away. Lift higher");
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click(); // deliberately under-lift
    await roundOnBoth(2);
    await expect(controls(one.page).getByText(/The load dips/)).toBeVisible();
    expect((await roomState<RunState>(one.page, table.code)).prompt).toMatchObject({ challenge: { progress: 1, strain: 0.3 } });
    await two.page.reload();
    const gotIt = two.page.getByRole("button", { name: "Got it", exact: true });
    if (await gotIt.isVisible()) await gotIt.click();
    await expect(controls(two.page).getByText(/The load dips/)).toBeVisible();
    await controls(one.page).locator(".skill-scene").scrollIntoViewIfNeeded();
    const welcome = one.page.getByRole("button", { name: "Got it", exact: true });
    if (await welcome.isVisible()) await welcome.click();
    await one.page.screenshot({ path: info.outputPath("balance-short-phone.png") });
    await tv.page.screenshot({ path: info.outputPath("balance-tv.png") });
    await expect(controls(one.page).locator(".skill-scene__object")).toHaveJSProperty("naturalWidth", 512);
    for (const phone of [one.page, two.page]) await controls(phone).getByRole("button", { name: "Lift my side", exact: true }).click();
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click();
    await roundOnBoth(3);
    for (const phone of [one.page, two.page]) for (let n = 0; n < 2; n++) await controls(phone).getByRole("button", { name: "Lower my side", exact: true }).click();
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click();
    await expect(controls(one.page).getByRole("button", { name: "See what happens next" })).toBeVisible();
    expect(await tv.page.getByRole("region", { name: "Story interaction" }).getByRole("button").count()).toBe(0);
    for (const phone of [one.page, two.page]) expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await one.page.evaluate(async () => {
      const path = "/src/store/index.ts";
      const { useGameStore } = await import(/* @vite-ignore */ path);
      await useGameStore.getState().send({ type: "PLAYTEST_GOTO", sceneId: "interaction_roots" });
    });
    lead = await readyLead();
    await controls(lead).getByRole("button", { name: /ready/ }).click();
    const setPull = async (phone: Page, power: number) => {
      const slider = controls(phone).getByRole("slider", { name: "Pull strength" });
      await slider.scrollIntoViewIfNeeded();
      const box = (await slider.boundingBox())!;
      await slider.click({ position: { x: 8 + (box.width - 16) * power, y: box.height / 2 } });
      await controls(phone).getByRole("button", { name: "Set my pull" }).click();
    };
    await setPull(one.page, 0);
    await setPull(two.page, 0);
    await expect(controls(one.page).getByText(/Not enough support/)).toBeVisible();
    expect((await roomState<RunState>(one.page, table.code)).prompt).toMatchObject({ challenge: { progress: 0, strain: 0 } });
    // The gesture measures distance: dragging down to 40% is a real input, not a button alias.
    const rope = controls(one.page).locator(".skill-rope-drag");
    await rope.scrollIntoViewIfNeeded();
    const box = (await rope.boundingBox())!;
    await one.page.mouse.move(box.x + box.width / 3, box.y + 8);
    await one.page.mouse.down();
    await one.page.mouse.move(box.x + box.width / 3, box.y + 8 + box.height * 0.8 * 0.4, { steps: 6 });
    await one.page.mouse.up();
    await expect(controls(one.page).getByRole("button", { name: "Waiting for the team" })).toBeDisabled();
    await setPull(two.page, 0.4);
    await expect(controls(one.page).getByText(/The weight shifts/)).toBeVisible();
    await controls(one.page).locator(".skill-scene").scrollIntoViewIfNeeded();
    await one.page.screenshot({ path: info.outputPath("cooperate-short-phone.png") });
    await tv.page.screenshot({ path: info.outputPath("cooperate-tv.png") });
    for (const power of [0.7, 0.5]) for (const phone of [one.page, two.page]) await setPull(phone, power);
    await expect(controls(one.page).getByRole("button", { name: "See what happens next" })).toBeVisible();
  } finally { await Promise.all([one.context, two.context, tv.context].map(context => context.close())); }
});

for (const kind of ["balance", "cooperate"] as const) test(`v1 wire inputs unblock a mixed-version ${kind} room`, async ({ browser }) => {
  const table = await seedTable({ mode: "party", tv: true, chapterId: "first-steps-01", sceneId: kind === "balance" ? "interaction_balance" : "interaction_roots",
    heroes: [{ name: "Aster", species: "unicorn" }, { name: "Fern", species: "griffin" }] });
  const one = await openPhone(browser, table.phones[0]!);
  const two = await openPhone(browser, table.phones[1]!);
  const tv = await openTv(browser, table);
  try {
    await Promise.all([one.page, two.page, tv.page].map(page => onAir(page)));
    for (const phone of [one.page, two.page]) {
      await phone.getByRole("button", { name: "You", exact: true }).click();
      const turn = phone.getByRole("button", { name: "Your turn", exact: true });
      if (await turn.isVisible()) await turn.click();
    }
    const ready = (page: Page) => controls(page).getByRole("button", { name: /ready/ });
    await expect.poll(async () => await ready(one.page).count() + await ready(two.page).count()).toBe(1);
    const lead = await ready(one.page).count() ? one.page : two.page;
    const older = lead === one.page ? two.page : one.page;
    await ready(lead).click();
    await expect(controls(lead).locator(".skill-game")).toBeVisible();
    if (kind === "balance") for (let i = 0; i < 2; i++) await controls(lead).getByRole("button", { name: "Lift my side", exact: true }).click();
    else await controls(lead).getByRole("button", { name: "Set my pull" }).click();
    // Send the actual pre-v2 wire shape; an old cached bundle has no round field or commit action.
    const accepted = await older.evaluate(async game => {
      const path = "/src/store/index.ts";
      const { useGameStore } = await import(/* @vite-ignore */ path);
      const store = useGameStore.getState();
      const p = store.state.prompt;
      return store.send({ type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt,
        ...(game === "balance" ? { action: "adjust", direction: "up" } : { action: "support", mode: "prop" }) });
    }, kind);
    expect(accepted).toBe(true);
    for (const phone of [one.page, two.page]) {
      await expect(controls(phone)).toContainText("Using earlier controls");
      await expect(controls(phone).locator(".skill-game")).toHaveCount(0);
    }
    await expect(tv.page.getByRole("region", { name: "Story interaction" })).toContainText("Using earlier controls");
    if (kind === "balance") await controls(older).getByRole("button", { name: "Lift my side", exact: true }).click();
    else await controls(lead).getByRole("button", { name: "Use a prop instead" }).click();
    await expect(controls(lead).getByRole("button", { name: "See what happens next" })).toBeVisible();
  } finally { await Promise.all([one.context, two.context, tv.context].map(context => context.close())); }
});
