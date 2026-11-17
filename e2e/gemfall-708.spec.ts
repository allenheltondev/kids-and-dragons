import { expect, test, type Page } from "@playwright/test";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { roomState } from "./room-state";
import { API } from "./api";
import { haulNeeded, haulTarget, type RunState } from "@kad/shared";

test.use({ actionTimeout: 15_000 });

const controls = (page: Page) => page.getByRole("region", { name: "Interaction controls" });
async function task(page: Page) {
  await page.bringToFront();
  const welcome = page.getByRole("button", { name: "Got it", exact: true });
  if (await welcome.isVisible()) await welcome.click();
  // New questions (and a reload into one) open the turn controls automatically.
  // Switching to You here races that navigation after PLAYTEST_GOTO: the task
  // entry can disappear between finding it and Playwright's actionability check.
  await expect(controls(page)).toBeVisible();
}
// These are separate browser contexts representing separate devices. Foreground
// the device being operated so Chromium supplies animation frames for scrolling
// and Playwright's stability checks, even after the TV or another phone was used.
async function tap(page: Page, name: string | RegExp) {
  await page.bringToFront();
  await controls(page).getByRole("button", { name, exact: typeof name === "string" }).click();
}
async function setPull(page: Page, power: number) {
  await page.bringToFront();
  const slider = controls(page).getByRole("slider", { name: "Effort" });
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await slider.click({ position: { x: 8 + (box.width - 16) * power, y: box.height / 2 } });
  await tap(page, "Set my effort");
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
    for (const row of el.querySelectorAll(".skill-scene, .skill-route, .skill-reading, .skill-gauge, .skill-team, .skill-feedback, .skill-strain, .rift-field, .rift-progress, .rift-read, .rift-time, .rift-feedback, .gem-field, .gem-reading, .gem-force, .gem-team")) {
      if (!row.getClientRects().length) continue;
      const r = row.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) problems.push(`${row.className}: ${Math.round(r.top)}–${Math.round(r.bottom)} outside ${Math.round(b.top)}–${Math.round(b.bottom)}`);
    }
    return problems;
  })).toEqual([]);
  await expect(page.getByTestId("chapter-goal")).toBeVisible();
}

test("7L: friends recover a slipping table on phones and TV", async ({ browser }, info) => {
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
    for (const page of [one.page, two.page]) await task(page);
    await expect.poll(async () => await controls(one.page).getByRole("button", { name: /ready/ }).count() + await controls(two.page).getByRole("button", { name: /ready/ }).count()).toBe(1);
    const lead = await controls(one.page).getByRole("button", { name: /ready/ }).count() ? one.page : two.page;
    await tap(lead, /ready/);
    return lead;
  };
  try {
    await Promise.all([one.page, two.page, tv.page].map(page => onAir(page)));
    const hp = (await state()).party.map(p => p.hp);
    let lead = await ready();
    for (const [phone, side] of [[one.page, "left"], [two.page, "right"]] as const) for (let n = 0; n < 2; n++) await tap(phone, `Lift ${side} end`);
    await tap(lead, "Take a careful step");
    await expect.poll(progress).toBe(1);
    await tap(lead, "Take a careful step");
    await expect(controls(one.page)).toContainText("The left end dips");
    expect((await state()).prompt).toMatchObject({ challenge: { progress: 1, strain: .2 } });
    await two.page.reload();
    await onAir(two.page); await task(two.page);
    await expect(controls(two.page)).toContainText("The left end dips");
    await expect(tv.page.getByText("Where you left off", { exact: true })).toBeHidden({ timeout: 20_000 });
    await tvFits(tv.page);
    await controls(one.page).locator(".rift-field, .gem-field").scrollIntoViewIfNeeded();
    await expect(controls(one.page).locator("img.rift-beam__painting")).toHaveJSProperty("naturalWidth", 512);
    await one.page.screenshot({ path: info.outputPath("table-phone-320.png") });
    await tv.page.screenshot({ path: info.outputPath("table-tv.png") });
    await tap(one.page, "Lift left end");
    await tap(lead, "Take a careful step");
    await expect.poll(progress).toBe(2);
    for (let n = 0; n < 2; n++) await tap(one.page, "Ease left end");
    await tap(lead, "Take a careful step");
    await tap(lead, "See what happens next");
    await expect.poll(async () => (await state()).sceneId).toBe("choice_the_rule");
    expect((await state()).party.map(p => p.hp)).toEqual(hp);

  } finally { await Promise.all([one.context, two.context, tv.context].map(context => context.close())); }
});

test("7L: friends compensate their wagon pulls on phones and TV", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const table = await seedTable({ campaignId: "gemfall", mode: "party", tv: true, chapterId: "gemfall-07l", sceneId: "interaction_tether_team", heroes: [
    { name: "Aster", species: "kitsune", class: "songkeeper" }, { name: "Fern", species: "unicorn", class: "thornguard" },
  ] });
  const one = await openPhone(browser, table.phones[0]!, { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const two = await openPhone(browser, table.phones[1]!, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tv = await openTv(browser, table);
  const state = () => roomState<RunState>(one.page, table.code);
  const progress = async () => { const p = (await state()).prompt; return p?.kind === "interaction" ? p.challenge?.progress : undefined; };
  const ready = async () => {
    for (const page of [one.page, two.page]) await task(page);
    await expect.poll(async () => await controls(one.page).getByRole("button", { name: /ready/ }).count() + await controls(two.page).getByRole("button", { name: /ready/ }).count()).toBe(1);
    const lead = await controls(one.page).getByRole("button", { name: /ready/ }).count() ? one.page : two.page;
    await tap(lead, /ready/);
    return lead;
  };
  try {
    await Promise.all([one.page, two.page, tv.page].map(page => onAir(page)));
    const lead = await ready();
    await expect(controls(lead)).toHaveClass(/game--active/);
    const attempt = (await state()).prompt;
    if (attempt?.kind !== "interaction") throw Error("Expected the shared wagon pull");
    const help = controls(lead).locator("details.game__help");
    await help.locator("summary").click();
    await help.getByRole("button", { name: "Start this attempt again", exact: true }).click();
    await expect.poll(async () => (await state()).prompt).toMatchObject({ phase: "ready", attempt: attempt.attempt + 1 });
    await expect(controls(lead)).toHaveClass(/game--ready/);
    const readyHelp = controls(lead).locator("details.game__help");
    if (!await readyHelp.getByRole("checkbox", { name: /Relaxed play/ }).isVisible()) await readyHelp.locator("summary").click();
    await readyHelp.getByRole("checkbox", { name: /Relaxed play/ }).check();
    await ready();
    await expect.poll(async () => (await state()).prompt).toMatchObject({ phase: "active", relaxed: true });
    await setPull(one.page, 0);
    await expect(controls(two.page).locator(".gem-force__safe")).toHaveCount(0);
    await expect(controls(two.page)).toContainText("Aster must revise their 0% effort");
    await expect(controls(two.page).locator(".gem-force")).toHaveAttribute("aria-label", /no safe effort/);
    await controls(one.page).getByRole("slider", { name: "Effort", exact: true }).fill("30");
    await tap(one.page, "Revise my effort");
    await expect(controls(two.page).locator(".gem-force__safe")).toHaveCount(1);
    await expect(controls(two.page)).not.toContainText("must revise their 0% effort");
    await expect(controls(one.page).getByRole("button", { name: "Your effort is set" })).toBeDisabled();
    const shared = (await state()).prompt;
    if (shared?.kind !== "interaction") throw Error("Expected the shared wagon pull");
    const needed = haulNeeded(shared, shared.playerIds, table.phones[1]!.playerId);
    expect(needed).toBeGreaterThan(haulTarget(shared));
    await expect(controls(two.page).getByRole("img", { name: /Effort .*; safe effort/ })).toHaveAttribute("aria-label", `Effort 20 percent; safe effort ${Math.round(needed * 100)} percent`);
    await two.page.screenshot({ path: info.outputPath("wagon-compensation-phone.png") });
    await setPull(two.page, .5);
    await expect.poll(progress).toBe(1);
    for (const phone of [one.page, two.page]) await setPull(phone, 1);
    await expect(controls(one.page)).toContainText("The cords strain");
    expect((await state()).prompt).toMatchObject({ challenge: { progress: 1 } });
    await two.page.reload(); await onAir(two.page); await task(two.page);
    await expect(controls(two.page)).toContainText("The cords strain");
    for (const page of [one.page, two.page, tv.page]) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => { document.documentElement.dataset.motion = "reduced"; });
    }
    await expect(controls(one.page).locator(".skill-rope-drag")).toHaveCount(0);
    await controls(one.page).locator(".rift-field, .gem-field").scrollIntoViewIfNeeded();
    await one.page.screenshot({ path: info.outputPath("wagon-phone-320.png") });
    await tv.page.evaluate(async () => { document.documentElement.dataset.text = "largest"; await document.fonts.ready; });
    await tv.page.screenshot({ path: info.outputPath("wagon-tv-largest.png") });
    await tvFits(tv.page);
    expect(await tv.page.getByRole("region", { name: "Story interaction" }).getByRole("button").count()).toBe(0);
    for (const power of [.7, .5]) {
      for (const phone of [one.page, two.page]) await setPull(phone, power);
    }
    await tap(lead, "See what happens next");
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
    await tap(phone.page, /ready/);
    const aim = controls(phone.page).getByRole("slider", { name: "Crossing moment" });
    await aim.press("Home");
    await tap(phone.page, "Dash!");
    await expect(controls(phone.page)).toContainText("Too soon");
    await tap(phone.page, "Dash!");
    await tap(phone.page, "Dash!");
    await tap(phone.page, "See what happens next");
    await expect.poll(async () => (await state()).sceneId).toBe("scene_box_crawlers");
    expect((await state()).party[0]!.hp).toBe(hp - 1);
    await jump(phone.page, "interaction_tether_team"); await task(phone.page);
    await tap(phone.page, /ready/);
    await setPull(phone.page, 1);
    await expect(controls(phone.page)).toContainText("The cords strain");
    await setPull(phone.page, 1);
    await tap(phone.page, "See what happens next");
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
