import { test, expect, type Page } from "@playwright/test";
import { committedAttacks, currentActorId, legalMoves, stepsBetween, type ClientIntent, type RunState } from "../packages/shared/src/index";
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
  throw Error("Repeated stale combat actions");
}

test("the quay's committed burst survives refresh, can be interrupted, and friends secure the ferry", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const table = await seedTable({ mode: "party", tv: true, chapterId: "gemfall-01", sceneId: "encounter_quay_wisps", heroes: [
    { name: "Aster", species: "kitsune", class: "starweaver", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
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
    }
    await onAir(display.page);
    let state = await roomState<RunState>(phones[0].page, table.code);
    const owner = (s: RunState) => s.party.findIndex(m => m.character.id === currentActorId(s.encounter!));
    for (let i = 0; i < 10 && !committedAttacks(state.encounter!).length; i++) {
      await action(phones[owner(state)].page, table.code, { type: "END_TURN" });
      state = await roomState<RunState>(phones[0].page, table.code);
    }
    const locked = committedAttacks(state.encounter!)[0]!;
    expect(locked.tiles.length).toBeGreaterThan(0);
    const phone = phones[owner(state)].page;
    await expect(phone.locator(".combat__cell--danger").first()).toBeVisible();
    await expect(display.page.getByLabel("Battle plan")).toContainText("Marked ground bursts next turn");
    for (const viewport of [{ width: 390, height: 844, text: "normal" }, { width: 320, height: 720, text: "normal" }, { width: 390, height: 844, text: "largest" }]) {
      await phone.setViewportSize(viewport);
      await phone.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, viewport.text);
      const pane = phone.locator(".player__prompt");
      await phone.screenshot({ path: info.outputPath(`quay-${viewport.width}-${viewport.text}.png`) });
      const metrics = await phone.locator(".combat").evaluate(el => [...el.children].map(child => ({ name: child.className, height: child.getBoundingClientRect().height })));
      await expect.poll(() => pane.evaluate(el => el.scrollHeight <= el.clientHeight + 1), { message: JSON.stringify({ viewport, metrics }) }).toBe(true);
      await expect(phone.locator(".combat__actions button").first()).toBeInViewport({ ratio: .9 });
      await phone.screenshot({ path: info.outputPath(`quay-${viewport.width}-${viewport.text}.png`) });
    }
    await phone.evaluate(() => { delete document.documentElement.dataset.text; });
    await phone.screenshot({ path: info.outputPath("quay-phone.png") });
    await display.page.screenshot({ path: info.outputPath("quay-tv.png") });
    await phone.reload();
    await onAir(phone);
    expect(committedAttacks((await roomState<RunState>(phone, table.code)).encounter!)[0]!.tiles).toEqual(locked.tiles);
    // The kitsune gets a response turn before this same charger can release.
    state = await roomState<RunState>(phone, table.code);
    for (let i = 0; i < 3 && owner(state) !== 0; i++) {
      await action(phones[owner(state)].page, table.code, { type: "END_TURN" });
      state = await roomState<RunState>(phone, table.code);
    }
    await phones[0].page.setViewportSize({ width: 390, height: 844 });
    await expect(phones[0].page.getByRole("button", { name: /^Fox Fire/ })).toBeVisible();
    await phones[0].page.evaluate(() => { document.documentElement.dataset.text = "largest"; });
    await expect.poll(() => phones[0].page.locator(".player__prompt").evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await phones[0].page.screenshot({ path: info.outputPath("quay-interrupt-largest.png") });
    await phones[0].page.getByRole("button", { name: /^Fox Fire/ }).click();
    await expect.poll(() => phones[0].page.locator(".player__prompt").evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await phones[0].page.locator(".combat__targets button").filter({ hasText: "Spark Lantern 1" }).click();
    await phones[0].page.evaluate(() => { delete document.documentElement.dataset.text; });
    await expect.poll(async () => committedAttacks((await roomState<RunState>(phone, table.code)).encounter!)).toEqual([]);
    state = await roomState<RunState>(phone, table.code);
    const helpers = new Set<string>();
    for (let i = 0; i < 18 && state.encounter; i++) {
      const index = owner(state), device = phones[index].page;
      const objective = state.encounter.environment!.spec.objectives![0]!;
      if (objective.kind !== "close") throw Error("The ferry uses a helping objective");
      const candidates = [...legalMoves(state.encounter)].sort((a, b) => stepsBetween(a, objective.at!) - stepsBetween(b, objective.at!));
      if (candidates[0]) await action(device, table.code, { type: "MOVE", to: { x: candidates[0].x, y: candidates[0].y } });
      await action(device, table.code, { type: "END_TURN" });
      const next = await roomState<RunState>(phone, table.code);
      if (!next.encounter || (next.encounter.environment!.objectives?.[0] ?? 0) > (state.encounter.environment!.objectives?.[0] ?? 0)) helpers.add(table.phones[index].name);
      state = next;
    }
    expect(state.encounter).toBeNull();
    expect(state.sceneId).toBe("scene_quay_wisps_shooed");
    expect(state.flags.secured_ferry).toBe(true);
    expect(state.narration).toContain("Your knot holds");
    expect(helpers.size).toBe(2);
  } finally {
    for (const phone of phones) await phone.context.close();
    await display.context.close();
  }
});
