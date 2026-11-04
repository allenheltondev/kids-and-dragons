import { test, expect, type Page } from "@playwright/test";
import { currentActorId, legalMoves, positionOf, stepsBetween, type ClientIntent, type RunState } from "../packages/shared/src/index";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { roomState } from "./room-state";
import { API } from "./api";

async function action(page: Page, code: string, intent: ClientIntent) {
  const session = await page.evaluate(room => JSON.parse(localStorage.getItem(`kad.session.${room}`)!), code);
  for (let retry = 0; retry < 5; retry++) {
    const state = await roomState<RunState>(page, code);
    const response = await page.request.post(`${API}/api/action`, { headers: { authorization: `Bearer ${session.sessionToken}` },
      data: { runId: state.runId, seq: state.seq, playerId: session.playerId, intent } });
    const result = await response.json();
    if (result.ok) return;
    if (result.error?.code !== "STALE_SEQ") throw Error(JSON.stringify(result));
  }
  throw Error("Repeated stale actions");
}

for (const sceneId of ["encounter_wolves", "encounter_mimic_plank"]) {
  test(`${sceneId}: friends complete the alternative to attacking on real phones and TV`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    const table = await seedTable({ mode: "party", tv: true, chapterId: "gemfall-02", sceneId, heroes: [
      { name: "Aster", species: "kitsune", class: "songkeeper", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
      { name: "Fern", species: "unicorn", class: "thornguard", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
    ] });
    const phones = [];
    const display = await openTv(browser, table);
    try {
      for (const seat of table.phones) {
        const phone = await openPhone(browser, seat);
        phones.push(phone);
        await onAir(phone.page);
        await action(phone.page, table.code, { type: "READY", ready: true });
        await phone.page.evaluate(async () => { const path = "/src/store/player-navigation.ts"; (await import(path)).setPlayerSection("turn"); });
        await phone.page.emulateMedia({ reducedMotion: "reduce" });
      }
      await onAir(display.page);
      await display.page.emulateMedia({ reducedMotion: "reduce" });
      let state = await roomState<RunState>(phones[0].page, table.code);
      const owner = (s: RunState) => s.party.findIndex(m => m.character.id === currentActorId(s.encounter!));
      const active = phones[owner(state)].page;
      for (const surface of [{ width: 320, height: 720, text: "normal" }, { width: 390, height: 844, text: "largest" }]) {
        await active.setViewportSize(surface);
        await active.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, surface.text);
        await expect(active.locator(".combat__grid")).toBeVisible();
        await expect.poll(() => active.locator(".player__prompt").evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        await expect(active.locator(".combat__actions button").first()).toBeInViewport({ ratio: .9 });
        await active.screenshot({ path: info.outputPath(`phone-${surface.width}-${surface.text}.png`) });
      }
      await active.setViewportSize({ width: 390, height: 844 });
      await active.evaluate(() => { delete document.documentElement.dataset.text; });
      for (const text of ["normal", "largest"]) {
        await display.page.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, text);
        const panel = display.page.locator(".fight-log");
        await expect(panel).toContainText(sceneId === "encounter_wolves" ? "Keep the wagon lane clear" : "Far bank");
        await expect.poll(() => panel.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        await display.page.screenshot({ path: info.outputPath(`tv-${text}.png`) });
      }
      await display.page.evaluate(() => { delete document.documentElement.dataset.text; });
      let movedThroughUi = false;
      for (let turn = 0; state.encounter && turn < 24; turn++) {
        const page = phones[owner(state)].page;
        const encounter = state.encounter;
        const targets = sceneId === "encounter_wolves" ? [{ x: 3, y: 2 }] : [{ x: 6, y: 2 }, { x: 6, y: 3 }];
        const distance = (p: { x: number; y: number }) => Math.min(...targets.map(t => stepsBetween(p, t)));
        const tile = [...legalMoves(encounter)].sort((a, b) => distance(a) - distance(b))[0];
        if (tile && distance(tile) < distance(positionOf(encounter, currentActorId(encounter)!)!)) {
          if (!movedThroughUi) {
            const seq = state.seq;
            await page.getByRole("button", { name: new RegExp(`^Move to column ${tile.x + 1}, row ${tile.y + 1}(?=:| —|$)`) }).click();
            await expect.poll(async () => (await roomState<RunState>(page, table.code)).seq).toBeGreaterThan(seq);
            movedThroughUi = true;
          } else await action(page, table.code, { type: "MOVE", to: { x: tile.x, y: tile.y } });
        }
        await action(page, table.code, { type: "END_TURN" });
        state = await roomState<RunState>(page, table.code);
        if (turn === 1 && state.encounter) {
          await page.reload();
          await onAir(page);
          expect((await roomState<RunState>(page, table.code)).encounter?.environment).toEqual(state.encounter.environment);
          await display.page.screenshot({ path: info.outputPath("tv-in-play.png") });
        }
      }
      expect(movedThroughUi).toBe(true);
      expect(state.encounter).toBeNull();
      expect(state.sceneId).toBe(sceneId === "encounter_wolves" ? "scene_plank_bridge" : "scene_mimic_passed");
      expect(state.narration).toContain(sceneId === "encounter_wolves" ? "out of reach" : "last friend");
    } finally {
      for (const phone of phones) await phone.context.close();
      await display.context.close();
    }
  });
}
