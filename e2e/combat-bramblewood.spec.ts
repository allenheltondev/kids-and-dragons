import { expect, test } from "@playwright/test";
import { committedAttacks, currentActorId, legalActions, legalMoves, positionOf, stepsBetween, type ClientIntent, type RulesContent, type RunState } from "../packages/shared/src/index";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { roomState } from "./room-state";
import { API } from "./api";
import { combatPaintReady } from "./combat-paint";
import type { Page } from "@playwright/test";
import fs from "node:fs";
const abilitiesFile = JSON.parse(fs.readFileSync(new URL("../content/abilities.json", import.meta.url), "utf8"));
const rulesFile = JSON.parse(fs.readFileSync(new URL("../content/rules.json", import.meta.url), "utf8"));

async function action(page: Page, code: string, intent: ClientIntent) {
  const session = await page.evaluate(code => JSON.parse(localStorage.getItem(`kad.session.${code}`)!), code);
  for (let retry = 0; retry < 5; retry++) {
    const state = await roomState<RunState>(page, code);
    const response = await page.request.post(`${API}/api/action`, { headers: { authorization: `Bearer ${session.sessionToken}` }, data: { runId: state.runId, seq: state.seq, playerId: session.playerId, intent } });
    const result = await response.json();
    if (result.ok) return;
    if (result.error?.code !== "STALE_SEQ") throw Error(JSON.stringify(result));
  }
  throw Error("Repeated stale action");
}

test("Bramblewood tag: leave sparks, interrupt a wisp, and win the jar on phone and TV", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const table = await seedTable({ mode: "party", tv: true, dice: 20, chapterId: "bramblewood-01", sceneId: "encounter_bramblewisps", heroes: [
    { name: "Aster", species: "kitsune", class: "starweaver", stats: { might: 0, quick: 2, clever: 1, heart: 0 } },
    { name: "Fern", species: "unicorn", class: "thornguard", stats: { might: 3, quick: 0, clever: 0, heart: 0 } },
  ] });
  const display = await openTv(browser, table, process.env.KAD_COMBAT_VIDEO === "off" ? {} : { recordVideo: { dir: info.outputPath("video"), size: { width: 1280, height: 720 } } });
  const phones: Awaited<ReturnType<typeof openPhone>>[] = [];
  try {
    for (const seat of table.phones) {
      const phone = await openPhone(browser, seat);
      phones.push(phone);
      await onAir(phone.page);
      await action(phone.page, table.code, { type: "READY", ready: true });
      await phone.page.evaluate(async () => { const path = "/src/store/player-navigation.ts"; (await import(path)).setPlayerSection("turn"); });
    }
    await onAir(display.page);
    await combatPaintReady(display.page, "bramblewood-01", "encounter_bramblewisps");
    let state = await roomState<RunState>(phones[0].page, table.code);
    const active = () => phones[state.party.findIndex(p => p.character.id === currentActorId(state.encounter!))].page;
    const opening = active();
    for (const surface of [{ width: 320, height: 720, text: "normal" }, { width: 390, height: 844, text: "largest" }]) {
      await opening.setViewportSize(surface);
      await opening.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, surface.text);
      await expect(opening.locator(".combat__grid")).toBeVisible();
      await expect(opening.locator(".combat__actions button").first()).toBeInViewport({ ratio: .9 });
      await opening.screenshot({ path: info.outputPath(`phone-${surface.width}.png`) });
    }
    await opening.evaluate(() => { delete document.documentElement.dataset.text; });
    const panel = display.page.locator(".fight-log");
    await expect(panel).toContainText("Thorn shortcut");
    await display.page.evaluate(async () => {
      document.documentElement.dataset.text = "largest";
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await document.fonts.ready;
    });
    await display.page.screenshot({ path: info.outputPath("tv-largest.png") });
    await expect.poll(() => panel.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await expect.poll(() => panel.evaluate(el => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll(".rift-status__clock, .rift-status__lines, .fight-log__plan")].every(row => {
        const b = row.getBoundingClientRect();
        return b.top >= box.top && b.bottom <= box.bottom;
      });
    })).toBe(true);
    await display.page.evaluate(() => { delete document.documentElement.dataset.text; });
    let moved = false, interrupted = false, warned = false, reloaded = false;
    const abilities = abilitiesFile.abilities as unknown as Parameters<typeof legalActions>[1]["abilities"];
    for (let turn = 0; state.encounter && turn < 50; turn++) {
      const e = state.encounter, actor = currentActorId(e)!, page = active();
      const dangers = committedAttacks(e).flatMap(w => w.tiles);
      if (dangers.length) {
        warned = true;
        await expect(display.page.getByLabel("Battle plan")).toContainText(/marked ground|marks the nearest/i);
      }
      const foes = e.combatants.filter(f => f.side === "enemy" && !f.down).map(f => positionOf(e, f.id)!);
      const thorn = (p: { x: number; y: number }) => (p.x === 3 && p.y === 3) || (p.x === 5 && p.y === 4);
      const score = (p: { x: number; y: number }) => Math.max(0, Math.min(...foes.map(f => stepsBetween(f, p))) - 1) + 20 * Number(dangers.some(t => t.x === p.x && t.y === p.y)) + 30 * Number(thorn(p));
      const tile = [...legalMoves(e)].sort((a, b) => score(a) - score(b))[0];
      if (tile && score(tile) < score(positionOf(e, actor)!)) {
        if (!moved) {
          await expect.poll(() => page.evaluate(async () => { const p = "/src/store/index.ts"; return (await import(p)).useGameStore.getState().state?.seq ?? -1; })).toBeGreaterThanOrEqual(state.seq);
          await page.getByRole("button", { name: new RegExp(`^Move to column ${tile.x + 1}, row ${tile.y + 1}(?=:| —|$)`) }).click();
          await expect.poll(async () => (await roomState<RunState>(page, table.code)).seq).toBeGreaterThan(state.seq);
          moved = true;
        } else await action(page, table.code, { type: "MOVE", to: tile });
      }
      state = await roomState<RunState>(page, table.code);
      if (!interrupted && e.combatants.find(f => f.id === actor)?.actions.includes("fox_fire")) {
        const target = committedAttacks(state.encounter!)[0];
        if (target && stepsBetween(positionOf(state.encounter!, actor)!, positionOf(state.encounter!, target.actorId)!) <= 6) {
          const before = state.seq;
          await expect.poll(() => page.evaluate(async () => { const p = "/src/store/index.ts"; return (await import(p)).useGameStore.getState().state?.seq ?? -1; })).toBeGreaterThanOrEqual(before);
          await page.getByRole("button", { name: /^Fox Fire/ }).click();
          await page.locator(".combat__targets button").filter({ hasText: `Bramblewisp ${target.actorId.split("#")[1]}` }).click();
          await expect.poll(async () => (await roomState<RunState>(page, table.code)).seq).toBeGreaterThan(before);
          await expect.poll(async () => (await roomState<RunState>(page, table.code)).encounter?.combatants.find(f => f.id === target.actorId)?.windup ?? null).toBeNull();
          interrupted = true;
          state = await roomState<RunState>(page, table.code);
          await display.page.screenshot({ path: info.outputPath("tag-interrupted.png") });
          if (!state.encounter || currentActorId(state.encounter) !== actor) continue;
        }
      }
      const choices = legalActions(state.encounter!, { rules: rulesFile as unknown as RulesContent, abilities, rng: { next: () => .999 } });
      const burst = choices.find(a => a.abilityId === "burst" && a.tiles.length);
      const positions = state.encounter!.combatants.filter(f => f.side === "enemy" && !f.down).map(f => positionOf(state.encounter!, f.id)!);
      const caught = (p: { x: number; y: number }) => positions.filter(t => t.x >= p.x && t.x < p.x + 2 && t.y >= p.y && t.y < p.y + 2).length;
      const aim = burst ? [...burst.tiles].sort((a, b) => caught(b) - caught(a))[0] : undefined;
      const attack = choices.find(a => a.abilityId === "attack" && a.targets.length);
      if (aim || attack) {
        await action(page, table.code, aim ? { type: "COMBAT_ACTION", abilityId: "burst", targetTile: aim } : { type: "COMBAT_ACTION", abilityId: "attack", targetId: attack!.targets[0]! });
        state = await roomState<RunState>(page, table.code);
      }
      if (state.encounter && currentActorId(state.encounter) === actor) await action(page, table.code, { type: "END_TURN" });
      state = await roomState<RunState>(page, table.code);
      if (!reloaded && turn >= 1 && state.encounter) {
        await page.reload();
        await onAir(page);
        await expect.poll(() => page.evaluate(async () => { const p = "/src/store/index.ts"; return (await import(p)).useGameStore.getState().state?.encounter; })).toEqual(state.encounter);
        await Promise.all([display.page, ...phones.map(p => p.page)].map(p => p.emulateMedia({ reducedMotion: "reduce" })));
        reloaded = true;
      }
    }
    expect({ moved, warned, interrupted, reloaded }).toEqual({ moved: true, warned: true, interrupted: true, reloaded: true });
    expect(state.lastEncounter).toMatchObject({ outcome: "victory", destination: "scene_wisp_friends" });
    await expect(display.page.getByText(/Tagged, all three, fair and square/)).toBeVisible({ timeout: 60_000 });
    await display.page.screenshot({ path: info.outputPath("outcome.png") });
  } finally {
    await Promise.all([...phones.map(p => p.page.close()), display.page.close()]);
    await Promise.all([...phones.map(p => p.context.close()), display.context.close()]);
  }
});
