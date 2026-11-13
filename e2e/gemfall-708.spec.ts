import { expect, test, type Page } from "@playwright/test";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";
import { API } from "./api";
import { pullNeeded, pullTarget, type RunState } from "@kad/shared";

test.use({ actionTimeout: 15_000 });

const controls = (page: Page) => page.getByRole("region", { name: "Interaction controls" });
async function task(page: Page) {
  await page.getByRole("button", { name: "You", exact: true }).click();
  const welcome = page.getByRole("button", { name: "Got it", exact: true });
  if (await welcome.isVisible()) await welcome.click();
  await openPlayerTask(page);
}
async function setPull(page: Page, power: number) {
  const slider = controls(page).getByRole("slider", { name: "Pull strength" });
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await slider.click({ position: { x: 8 + (box.width - 16) * power, y: box.height / 2 } });
  await controls(page).getByRole("button", { name: "Set my pull", exact: true }).click();
}
async function jump(page: Page, sceneId: string) {
  await page.evaluate(async sceneId => {
    const path = "/src/store/index.ts";
    await (await import(path)).useGameStore.getState().send({ type: "PLAYTEST_GOTO", sceneId });
  }, sceneId);
}
async function tvFits(page: Page) {
  const board = page.getByRole("region", { name: "Story interaction" }).locator(".game__board");
  await expect.poll(() => board.evaluate(el => {
    const b = el.getBoundingClientRect();
    const problems = el.scrollHeight > el.clientHeight + 1 ? [`board scrolls: ${el.scrollHeight}/${el.clientHeight}`] : [];
    for (const row of el.querySelectorAll(".skill-scene, .skill-route, .skill-reading, .skill-gauge, .skill-team, .skill-feedback, .skill-strain")) {
      const r = row.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) problems.push(`${row.className}: ${Math.round(r.top)}–${Math.round(r.bottom)} outside ${Math.round(b.top)}–${Math.round(b.bottom)}`);
    }
    return problems;
  })).toEqual([]);
  await expect(page.getByTestId("chapter-goal")).toBeVisible();
}

test("7L: friends recover a slipping table and compensate their wagon pulls on phones and TV", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const table = await seedTable({ campaignId: "gemfall", mode: "party", tv: true, chapterId: "gemfall-07l", sceneId: "interaction_set_table", heroes: [
    { name: "Aster", species: "kitsune", class: "songkeeper" }, { name: "Fern", species: "unicorn", class: "thornguard" },
  ] });
  const one = await openPhone(browser, table.phones[0]!, { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const two = await openPhone(browser, table.phones[1]!, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tv = await openTv(browser, table);
  const state = () => roomState<RunState>(one.page, table.code);
  const progress = async () => { const p = (await state()).prompt; return p?.kind === "interaction" ? p.challenge?.progress : undefined; };
  const ready = async () => {
    await Promise.all([one.page, two.page].map(task));
    await expect.poll(async () => await controls(one.page).getByRole("button", { name: /ready/ }).count() + await controls(two.page).getByRole("button", { name: /ready/ }).count()).toBe(1);
    const lead = await controls(one.page).getByRole("button", { name: /ready/ }).count() ? one.page : two.page;
    await controls(lead).getByRole("button", { name: /ready/ }).click();
    return lead;
  };
  try {
    await Promise.all([one.page, two.page, tv.page].map(page => onAir(page)));
    const hp = (await state()).party.map(p => p.hp);
    let lead = await ready();
    for (const phone of [one.page, two.page]) for (let n = 0; n < 2; n++) await controls(phone).getByRole("button", { name: "Lift my side", exact: true }).click();
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click();
    await expect.poll(progress).toBe(1);
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click();
    await expect(controls(one.page)).toContainText("The load dips");
    expect((await state()).prompt).toMatchObject({ challenge: { progress: 1, strain: .3 } });
    await two.page.reload();
    await onAir(two.page); await task(two.page);
    await expect(controls(two.page)).toContainText("The load dips");
    await expect(tv.page.getByText("Where you left off", { exact: true })).toBeHidden({ timeout: 20_000 });
    await tvFits(tv.page);
    await controls(one.page).locator(".skill-scene").scrollIntoViewIfNeeded();
    await expect(controls(one.page).locator("img.skill-scene__object")).toHaveJSProperty("naturalWidth", 512);
    await one.page.screenshot({ path: info.outputPath("table-phone-320.png") });
    await tv.page.screenshot({ path: info.outputPath("table-tv.png") });
    for (const phone of [one.page, two.page]) await controls(phone).getByRole("button", { name: "Lift my side", exact: true }).click();
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click();
    await expect.poll(progress).toBe(2);
    for (const phone of [one.page, two.page]) for (let n = 0; n < 2; n++) await controls(phone).getByRole("button", { name: "Lower my side", exact: true }).click();
    await controls(lead).getByRole("button", { name: "Take a careful step" }).click();
    await controls(lead).getByRole("button", { name: "See what happens next" }).click();
    await expect.poll(async () => (await state()).sceneId).toBe("choice_the_rule");
    expect((await state()).party.map(p => p.hp)).toEqual(hp);

    await jump(one.page, "interaction_tether_team");
    lead = await ready();
    await setPull(one.page, .3);
    await expect(controls(one.page).getByRole("button", { name: "Waiting for the team" })).toBeDisabled();
    const shared = (await state()).prompt;
    if (shared?.kind !== "interaction") throw Error("Expected the shared wagon pull");
    const needed = pullNeeded(shared, shared.playerIds);
    expect(needed).toBeGreaterThan(pullTarget(shared));
    await expect(controls(two.page).getByRole("img", { name: /Safe pull:/ })).toHaveAttribute("aria-label", `Safe pull: ${Math.round((needed - .13) * 100)} to ${Math.round((needed + .13) * 100)} percent`);
    await two.page.screenshot({ path: info.outputPath("wagon-compensation-phone.png") });
    await setPull(two.page, .5);
    await expect.poll(progress).toBe(1);
    for (const phone of [one.page, two.page]) await setPull(phone, 1);
    await expect(controls(one.page)).toContainText("A sharp jerk");
    expect((await state()).prompt).toMatchObject({ challenge: { progress: 1 } });
    await two.page.reload(); await onAir(two.page); await task(two.page);
    await expect(controls(two.page)).toContainText("A sharp jerk");
    for (const page of [one.page, two.page, tv.page]) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => { document.documentElement.dataset.motion = "reduced"; });
    }
    await expect(controls(one.page).locator(".skill-rope-drag")).toHaveCount(0);
    await controls(one.page).locator(".skill-scene").scrollIntoViewIfNeeded();
    await one.page.screenshot({ path: info.outputPath("wagon-phone-320.png") });
    await tv.page.evaluate(async () => { document.documentElement.dataset.text = "largest"; await document.fonts.ready; });
    await tv.page.screenshot({ path: info.outputPath("wagon-tv-largest.png") });
    await tvFits(tv.page);
    expect(await tv.page.getByRole("region", { name: "Story interaction" }).getByRole("button").count()).toBe(0);
    for (const power of [.7, .5]) {
      for (const phone of [one.page, two.page]) await setPull(phone, power);
    }
    await controls(lead).getByRole("button", { name: "See what happens next" }).click();
    await expect.poll(async () => (await state()).sceneId).toBe("scene_tether_holds");
    expect((await state()).flags.clock_steady).toBe(true);
    expect((await state()).party.some(p => p.character.questItems.includes("facet_caravan"))).toBe(true);
    await tv.page.screenshot({ path: info.outputPath("wagon-earned-stone.png") });
    for (const phone of [one.page, two.page]) expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.all([one.context, two.context, tv.context].map(context => context.close())); }
});

test("7L: rough box dashes cost health and a failed wagon brace withholds the stone", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const table = await seedTable({ campaignId: "gemfall", mode: "party", tv: true, chapterId: "gemfall-07l", sceneId: "interaction_box_slide", heroes: [{ name: "Aster", species: "kitsune" }] });
  const phone = await openPhone(browser, table.phones[0]!, { viewport: { width: 390, height: 640 } });
  const tv = await openTv(browser, table);
  const state = () => roomState<RunState>(phone.page, table.code);
  try {
    await Promise.all([phone.page, tv.page].map(page => onAir(page))); await task(phone.page);
    await phone.page.emulateMedia({ reducedMotion: "reduce" });
    await phone.page.evaluate(() => { document.documentElement.dataset.motion = "reduced"; });
    const hp = (await state()).party[0]!.hp;
    await controls(phone.page).getByRole("button", { name: /ready/ }).click();
    const aim = controls(phone.page).getByRole("slider", { name: "Aim at the gold" });
    await aim.press("Home");
    await controls(phone.page).getByRole("button", { name: "Dash!", exact: true }).click();
    await expect(controls(phone.page)).toContainText("A rough landing");
    await controls(phone.page).getByRole("button", { name: "Dash!", exact: true }).click();
    await controls(phone.page).getByRole("button", { name: "See what happens next" }).click();
    await expect.poll(async () => (await state()).sceneId).toBe("scene_box_crawlers");
    expect((await state()).party[0]!.hp).toBe(hp - 1);
    await jump(phone.page, "interaction_tether_team"); await task(phone.page);
    await controls(phone.page).getByRole("button", { name: /ready/ }).click();
    await setPull(phone.page, 1);
    await expect(controls(phone.page)).toContainText("A sharp jerk");
    await setPull(phone.page, 1);
    await controls(phone.page).getByRole("button", { name: "See what happens next" }).click();
    await expect.poll(async () => (await state()).sceneId).toBe("scene_tether_slips");
    expect((await state()).flags.clock_late).toBe(true);
    expect((await state()).party.some(p => p.character.questItems.includes("facet_caravan"))).toBe(false);
    await tv.page.screenshot({ path: info.outputPath("wagon-late-without-stone.png") });
  } finally { await Promise.all([phone.context, tv.context].map(context => context.close())); }
});

test("7L: four friends and the brace feedback fit the largest-text TV", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const table = await seedTable({ campaignId: "gemfall", mode: "party", tv: true, chapterId: "gemfall-07l", sceneId: "interaction_tether_team", heroes: [
    { name: "Aster", species: "kitsune" }, { name: "Fern", species: "unicorn" },
    { name: "Briar", species: "bigfoot" }, { name: "Lark", species: "dragonling" },
  ] });
  const tv = await openTv(browser, table);
  try {
    await onAir(tv.page);
    // This case measures four-seat TV layout; the preceding case drives real phones.
    const stateFor = async () => {
      const response = await tv.page.request.get(`${API}/api/state?code=${table.code}`, {
        headers: { authorization: `Bearer ${table.phones[0]!.session.sessionToken}` },
      });
      return (await response.json()).state as RunState;
    };
    const send = async (playerId: string, action: object) => {
      const state = await stateFor();
      if (state.prompt?.kind !== "interaction") throw Error("Expected the brace");
      const seat = table.phones.find(p => p.playerId === playerId)!;
      const response = await tv.page.request.post(`${API}/api/action`, {
        headers: { authorization: `Bearer ${seat.session.sessionToken}` },
        data: { runId: state.runId, seq: state.seq, playerId, intent: { type: "INTERACT",
          openedSeq: state.prompt.openedSeq, attempt: state.prompt.attempt, ...action } },
      });
      expect((await response.json()).ok).toBe(true);
    };
    const state = await stateFor();
    if (state.prompt?.kind !== "interaction") throw Error("Expected the brace");
    await send(state.prompt.actorId!, { action: "start", relaxed: false, rulesVersion: 2 });
    for (const seat of table.phones) await send(seat.playerId, { action: "commit", round: 0, position: .4 });
    await expect(tv.page.locator(".skill-game")).toContainText("Weight shifts: pull higher");
    for (const seat of table.phones) await send(seat.playerId, { action: "commit", round: 1, position: 1 });
    await expect(tv.page.locator(".skill-game")).toContainText("A sharp jerk");
    await tv.page.evaluate(async () => { document.documentElement.dataset.text = "largest"; await document.fonts.ready; });
    await tv.page.screenshot({ path: info.outputPath("wagon-four-tv-largest.png") });
    await tvFits(tv.page);
    await expect(tv.page.locator(".skill-team li")).toHaveCount(4);
    // System UI fonts differ across TV computers. Exercise a wider fallback too.
    await tv.page.evaluate(() => document.documentElement.style.setProperty("--kad-font-ui", "Verdana, sans-serif"));
    await tvFits(tv.page);
  } finally { await tv.context.close(); }
});
