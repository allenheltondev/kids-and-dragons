import { expect, test, type Page } from "@playwright/test";
import { skillAim, type RunState } from "@kad/shared";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";

test.use({ actionTimeout: 15_000 });

const controls = (page: Page) => page.getByRole("region", { name: "Interaction controls" });
async function task(page: Page) {
  await page.getByRole("button", { name: "You", exact: true }).click();
  const welcome = page.getByRole("button", { name: "Got it", exact: true });
  if (await welcome.isVisible()) await welcome.click();
  await openPlayerTask(page);
}
async function boardFits(page: Page) {
  await expect.poll(() => page.locator(".game--tv .game__board").evaluate(el => {
    const board = el.getBoundingClientRect();
    const scene = el.querySelector(".skill-scene")!.getBoundingClientRect();
    return el.scrollHeight <= el.clientHeight + 1 && scene.top >= board.top && scene.bottom <= board.bottom + 1;
  })).toBe(true);
}

for (const [chapterId, sceneId, next] of [
  ["gemfall-08", "interaction_chimney", "scene_overlook"],
  ["riftlight-frostfang-shore", "ladder_hold", "river_line"],
] as const) {
  test(`${chapterId}: climbing uses real timing controls, survives reload and applies a bruise only on continuation`, async ({ browser }, info) => {
    const table = await seedTable({ campaignId: chapterId.startsWith("gemfall") ? "gemfall" : "riftlight", mode: "party", tv: true, chapterId, sceneId, heroes: [{ name: "Aster", species: "kitsune" }] });
    const phone = await openPhone(browser, table.phones[0]!, { viewport: { width: 320, height: 640 }, reducedMotion: "reduce" });
    const tv = await openTv(browser, table, { viewport: { width: 1280, height: 720 } });
    const state = () => roomState<RunState>(phone.page, table.code);
    try {
      await Promise.all([onAir(phone.page), onAir(tv.page)]);
      await task(phone.page);
      const hp = (await state()).party[0]!.hp;
      await controls(phone.page).getByRole("button", { name: /ready/ }).click();
      await expect(controls(phone.page).getByRole("slider", { name: "Aim at the gold" })).toBeVisible();
      await boardFits(tv.page);
      await phone.page.screenshot({ path: info.outputPath("climb-phone-320.png") });
      await tv.page.screenshot({ path: info.outputPath("climb-tv.png") });
      let reloaded = false;
      for (let round = 0; round < 10; round++) {
        const before = await state(), p = before.prompt;
        if (p?.kind !== "interaction" || p.phase !== "active") break;
        const committedRound = p.challenge!.round;
        await expect(controls(phone.page).locator(".skill-game")).toHaveAttribute("data-round", String(committedRound));
        await controls(phone.page).getByRole("slider", { name: "Aim at the gold" }).fill("0");
        await controls(phone.page).getByRole("button", { name: p.spec.actionLabel, exact: true }).click();
        await expect.poll(async () => {
          const p = (await state()).prompt;
          return p?.kind === "interaction" && (p.phase === "result" || p.challenge!.round > committedRound);
        }).toBe(true);
        if (!reloaded) { await phone.page.reload(); await onAir(phone.page); await task(phone.page); reloaded = true; }
      }
      expect((await state()).prompt).toMatchObject({ phase: "result", outcome: "failure" });
      expect((await state()).party[0]!.hp).toBe(hp);
      await controls(phone.page).getByRole("button", { name: "See what happens next" }).click();
      await expect.poll(async () => (await state()).sceneId).toBe(next);
      expect((await state()).party[0]!.hp).toBe(hp - 1);
      await phone.page.evaluate(async sceneId => {
        const module = "/src/store/index.ts";
        await (await import(module)).useGameStore.getState().send({ type: "PLAYTEST_GOTO", sceneId });
      }, sceneId);
      await controls(phone.page).getByRole("button", { name: /ready/ }).click();
      await expect.poll(async () => {
        const p = (await state()).prompt;
        return p?.kind === "interaction" ? p.phase : undefined;
      }).toBe("active");
      for (let round = 0; round < 10; round++) {
        const p = (await state()).prompt;
        if (p?.kind !== "interaction" || p.phase !== "active") break;
        const committedRound = p.challenge!.round;
        await expect(controls(phone.page).locator(".skill-game")).toHaveAttribute("data-round", String(committedRound));
        await controls(phone.page).getByRole("slider", { name: "Aim at the gold" }).fill(String(skillAim(p).target * 100));
        await controls(phone.page).getByRole("button", { name: p.spec.actionLabel, exact: true }).click();
        await expect.poll(async () => {
          const p = (await state()).prompt;
          return p?.kind === "interaction" && (p.phase === "result" || p.challenge!.round > committedRound);
        }).toBe(true);
      }
      expect((await state()).prompt).toMatchObject({ phase: "result", outcome: "success" });
      await controls(phone.page).getByRole("button", { name: "See what happens next" }).click();
      await expect.poll(async () => (await state()).sceneId).toBe(next);
      expect((await state()).party[0]!.hp).toBe(hp - 1);
    } finally { await Promise.all([phone.context.close(), tv.context.close()]); }
  });
}

test("the crossing signal earns a visible flag-guided crossing through real memory controls", async ({ browser }) => {
  const table = await seedTable({ campaignId: "gemfall", mode: "party", chapterId: "gemfall-05a", sceneId: "interaction_crossing_signal", heroes: [{ name: "Fern", species: "unicorn" }] });
  const phone = await openPhone(browser, table.phones[0]!, { viewport: { width: 320, height: 640 }, reducedMotion: "reduce" });
  const state = () => roomState<RunState>(phone.page, table.code);
  try {
    await onAir(phone.page); await task(phone.page);
    await controls(phone.page).getByRole("button", { name: /ready/ }).click();
    for (const [index, label] of ["Wait", "Walk", "Wait"].entries()) {
      await controls(phone.page).locator(".skill-pads").getByRole("button", { name: label, exact: true }).click();
      await expect.poll(async () => {
        const p = (await state()).prompt;
        return p?.kind === "interaction" ? p.challenge?.arrangement.length : undefined;
      }).toBe(index + 1);
    }
    await controls(phone.page).getByRole("button", { name: "Repeat the signals", exact: true }).click();
    await controls(phone.page).getByRole("button", { name: "See what happens next" }).click();
    await expect.poll(async () => (await state()).flags.crossing_signal_known).toBe(true);
    await expect(phone.page.getByRole("button", { name: /Follow the warden's flags/ })).toBeVisible();
  } finally { await phone.context.close(); }
});
