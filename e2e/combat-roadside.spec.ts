import { test, expect, type Page } from "@playwright/test";
import { committedAttacks, currentActorId, legalMoves, positionOf, stepsBetween, type ClientIntent, type RunState } from "../packages/shared/src/index";
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

for (const sceneId of ["encounter_wolves", "encounter_mimic_plank", "encounter_crabs"]) {
  test(`${sceneId}: friends complete the alternative to attacking on real phones and TV`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    const ford = sceneId === "encounter_crabs";
    const table = await seedTable({ mode: "party", tv: true, chapterId: ford ? "gemfall-03c" : "gemfall-02", sceneId, heroes: [
      { name: "Aster", species: "kitsune", class: "songkeeper", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
      { name: "Fern", species: "unicorn", class: "thornguard", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
    ] });
    const phones = [];
    const display = await openTv(browser, table, { recordVideo: { dir: info.outputPath("video"), size: { width: 1280, height: 720 } } });
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
      if (sceneId === "encounter_mimic_plank") {
        expect(state.encounter!.combatants.filter(c => c.side === "enemy").every(c => c.windupAttack?.presentation === "slam")).toBe(true);
        await expect(display.page.getByLabel("Battle plan")).toContainText(/plank slap/i);
      }
      const owner = (s: RunState) => s.party.findIndex(m => m.character.id === currentActorId(s.encounter!));
      const active = phones[owner(state)].page;
      for (const surface of [{ width: 320, height: 720, text: "normal" }, { width: 390, height: 844, text: "largest" }]) {
        await active.setViewportSize(surface);
        await active.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, surface.text);
        await expect(active.locator(".combat__grid")).toBeVisible();
        await active.screenshot({ path: info.outputPath(`layout-${surface.width}-${surface.text}.png`) });
        const metrics = await active.locator(".combat").evaluate(el => [...el.children].map(child => ({ name: child.className, height: child.getBoundingClientRect().height })));
        await expect.poll(() => active.locator(".player__prompt").evaluate(el => ({ fits: el.scrollHeight <= el.clientHeight + 1, content: el.scrollHeight, height: el.clientHeight })), { message: JSON.stringify({ surface, metrics }) }).toMatchObject({ fits: true });
        await expect(active.locator(".combat__actions button").first()).toBeInViewport({ ratio: .9 });
        await active.screenshot({ path: info.outputPath(`phone-${surface.width}-${surface.text}.png`) });
      }
      await active.setViewportSize({ width: 390, height: 844 });
      await active.evaluate(() => { delete document.documentElement.dataset.text; });
      for (const text of ["normal", "largest"]) {
        await display.page.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, text);
        const panel = display.page.locator(".fight-log");
        await expect(panel).toContainText(ford ? "Ford current" : sceneId === "encounter_wolves" ? "Wagon stuck" : "Far bank");
        await expect.poll(() => panel.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        await display.page.screenshot({ path: info.outputPath(`tv-${text}.png`) });
      }
      await display.page.evaluate(() => { delete document.documentElement.dataset.text; });
      await display.page.emulateMedia({ reducedMotion: "no-preference" });
      let movedThroughUi = false;
      let handedOff = false;
      let sawCrossing = false;
      const defenders = new Set<string>();
      for (let turn = 0; state.encounter && turn < 24; turn++) {
        const page = phones[owner(state)].page;
        const encounter = state.encounter;
        const targets = sceneId === "encounter_mimic_plank" ? [{ x: 6, y: 2 }, { x: 6, y: 3 }] : [{ x: 3, y: 2 }];
        const distance = (p: { x: number; y: number }) => Math.min(...targets.map(t => stepsBetween(p, t)));
        const moves = legalMoves(encounter).filter(tile => !ford || tile.x !== 2 || tile.y !== 3);
        const tile = ford && turn === 0
          ? legalMoves(encounter).find(tile => tile.x === 2 && tile.y === 3)
          : moves.sort((a, b) => distance(a) - distance(b))[0];
        if (ford && turn === 0) expect(tile).toBeDefined();
        const actorId = currentActorId(encounter)!;
        const atPost = sceneId === "encounter_wolves" && distance(positionOf(encounter, actorId)!) === 0;
        let yielding = false;
        if (atPost) defenders.add(actorId);
        if (atPost && encounter.environment?.objectives?.[0] === 1 && !handedOff) {
          // Draw the wolves toward the right flank, leaving the shield open
          // for the friend approaching from the left. Retreating behind that
          // friend instead can let a wolf occupy the post.
          const retreat = [...legalMoves(encounter)].filter(p => distance(p) === 2).sort((a, b) => b.x - a.x)[0]!;
          await action(page, table.code, { type: "MOVE", to: { x: retreat.x, y: retreat.y } });
          handedOff = yielding = true;
          await expect(display.page.locator(".wagon-defense")).toHaveAttribute("data-progress", "1");
          await expect(display.page.locator(".wagon-defense")).toContainText("Stand on the shield");
          await display.page.screenshot({ path: info.outputPath("wagon-vulnerable.png") });
        }
        if (!yielding && tile && distance(tile) < distance(positionOf(encounter, actorId)!)) {
          if (!movedThroughUi) {
            const seq = state.seq;
            await page.getByRole("button", { name: new RegExp(`^Move to column ${tile.x + 1}, row ${tile.y + 1}(?=:| —|$)`) }).click();
            await expect.poll(async () => (await roomState<RunState>(page, table.code)).seq).toBeGreaterThan(seq);
            movedThroughUi = true;
          } else await action(page, table.code, { type: "MOVE", to: { x: tile.x, y: tile.y } });
          if (sceneId === "encounter_wolves" && distance(tile) === 0) defenders.add(actorId);
        }
        await action(page, table.code, { type: "END_TURN" });
        state = await roomState<RunState>(page, table.code);
        if (sceneId === "encounter_mimic_plank" && state.encounter?.combatants.some(c => c.escaped) && !sawCrossing) {
          await expect(display.page.getByLabel("Friends across")).toContainText("1/2 across");
          await display.page.screenshot({ path: info.outputPath("crossing-progress.png") });
          sawCrossing = true;
        }
        if (ford && turn === 0) {
          expect(positionOf(state.encounter!, actorId)!.x).toBeLessThan(2);
          await expect(display.page.locator(".rift-status__caption")).toContainText("Ford current");
          await display.page.screenshot({ path: info.outputPath("ford-current.png") });
        }
        if (turn === 1 && state.encounter) {
          await page.reload();
          await onAir(page);
          expect((await roomState<RunState>(page, table.code)).encounter?.environment).toEqual(state.encounter.environment);
          if (sceneId === "encounter_wolves") await expect(display.page.locator(".wagon-defense")).toHaveAttribute("data-progress", "1");
          await display.page.screenshot({ path: info.outputPath("tv-in-play.png") });
        }
      }
      expect(movedThroughUi).toBe(true);
      expect(state.encounter).toBeNull();
      expect(state.sceneId).toBe(ford ? "scene_crabs_cleared" : sceneId === "encounter_wolves" ? "scene_plank_bridge" : "scene_mimic_passed");
      expect(state.narration).toContain(ford ? "river charm" : sceneId === "encounter_wolves" ? "out of reach" : "last friend");
      if (ford) {
        await expect(display.page.getByText(/drover gives you a river charm/i)).toBeVisible();
        const charm = display.page.locator('.story-art-layer img[src$="/pickup-river-charm.webp"]');
        await expect(charm).toBeVisible();
        await expect.poll(() => charm.evaluate(el => {
          const box = el.getBoundingClientRect();
          return box.top >= document.querySelector(".narration__head")!.getBoundingClientRect().bottom
            && box.bottom <= document.querySelector(".narration__plate")!.getBoundingClientRect().top;
        })).toBe(true);
        await display.page.screenshot({ path: info.outputPath("ford-clear.png") });
      }
      if (sceneId === "encounter_mimic_plank") {
        expect(sawCrossing).toBe(true);
        await expect(display.page.locator("[data-crossing-clear]")).toBeVisible();
        await expect(display.page.getByTestId("rank-up-moment")).toHaveCount(0);
        await expect.poll(() => display.page.locator("[data-crossing-clear] img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
        await expect(display.page.locator("[data-crossing-clear]")).toBeVisible();
        await expect.poll(() => display.page.locator("[data-crossing-clear]").evaluate(el => {
          const box = el.getBoundingClientRect();
          return box.top >= document.querySelector(".narration__head")!.getBoundingClientRect().bottom && box.bottom <= document.querySelector(".narration__plate")!.getBoundingClientRect().top;
        })).toBe(true);
        await display.page.screenshot({ path: info.outputPath("crossing-clear.png") });
      }
      if (sceneId === "encounter_wolves") {
        expect(handedOff).toBe(true);
        expect(defenders.size).toBe(2);
        await expect(display.page.locator("[data-wagon-clear]")).toBeVisible();
        await display.page.screenshot({ path: info.outputPath("wagon-clear.png") });
        for (const text of ["largest", "normal"]) {
          await display.page.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, text);
          await expect.poll(() => display.page.locator("[data-wagon-clear]").evaluate(el => {
            const box = el.getBoundingClientRect();
            return box.height > 0 && box.top >= document.querySelector(".narration__head")!.getBoundingClientRect().bottom && box.bottom <= document.querySelector(".narration__plate")!.getBoundingClientRect().top;
          })).toBe(true);
          await display.page.screenshot({ path: info.outputPath(`wagon-clear-${text}.png`) });
        }
      }
    } finally {
      for (const phone of phones) await phone.context.close();
      await display.context.close();
    }
  });
}

const roadFights = [
  { sceneId: "encounter_wolves", chapterId: "gemfall-03c", cue: "Big campfire", outcome: "escaped", destination: "scene_campfire_play" },
  { sceneId: "encounter_drakes", chapterId: "gemfall-03c", cue: "Right the wagon", outcome: "victory", destination: "end_forded" },
  { sceneId: "encounter_boxes", chapterId: "gemfall-04c", cue: "Inky mud", outcome: "timedOut", destination: "scene_boxes_sulking" },
] as const;

for (const fight of roadFights) {
  test(`ford road batch: ${fight.sceneId} plays through on phone and TV`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    const wolves = fight.sceneId === "encounter_wolves";
    const drakes = fight.sceneId === "encounter_drakes";
    const table = await seedTable({ mode: "party", tv: true, chapterId: fight.chapterId, sceneId: fight.sceneId, heroes: [
      { name: "Aster", species: "kitsune", class: "songkeeper", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
      { name: "Fern", species: "unicorn", class: "thornguard", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
    ] });
    const phones = [];
    const display = await openTv(browser, table, { recordVideo: { dir: info.outputPath("video"), size: { width: 1280, height: 720 } } });
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
      const active = () => phones[state.party.findIndex(m => m.character.id === currentActorId(state.encounter!))].page;
      const opening = active();
      for (const surface of [{ width: 320, height: 720, text: "normal" }, { width: 390, height: 844, text: "largest" }]) {
        await opening.setViewportSize(surface);
        await opening.evaluate(text => { if (text === "normal") delete document.documentElement.dataset.text; else document.documentElement.dataset.text = text; }, surface.text);
        await expect(opening.locator(".combat__grid")).toBeVisible();
        await expect(opening.locator(".combat__actions button").first()).toBeInViewport({ ratio: .9 });
        await opening.screenshot({ path: info.outputPath(`phone-${surface.width}.png`) });
      }
      await opening.setViewportSize({ width: 390, height: 844 });
      await opening.evaluate(() => { delete document.documentElement.dataset.text; });
      const panel = display.page.locator(".fight-log");
      await expect(panel).toContainText(fight.cue);
      await display.page.evaluate(() => { document.documentElement.dataset.text = "largest"; });
      await expect.poll(() => panel.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await display.page.screenshot({ path: info.outputPath("tv-largest.png") });
      await display.page.evaluate(() => { delete document.documentElement.dataset.text; });

      let movedThroughUi = false;
      let sawInk = false;
      let sawWarning = false;
      for (let turn = 0; state.encounter && turn < 24; turn++) {
        const page = active();
        const encounter = state.encounter;
        const actorId = currentActorId(encounter)!;
        const at = positionOf(encounter, actorId)!;
        const warnings = committedAttacks(encounter);
        if (warnings.length && !sawWarning) {
          await expect(display.page.getByLabel("Battle plan")).toContainText(/tail sweep/i);
          await display.page.screenshot({ path: info.outputPath("tail-sweep.png") });
          sawWarning = true;
        }
        const danger = warnings.flatMap(w => w.tiles);
        const enemies = encounter.combatants.filter(c => c.side === "enemy" && !c.down).map(c => positionOf(encounter, c.id)!);
        const ink = (p: { x: number; y: number }) => p.x === 2 && (p.y === 2 || p.y === 3);
        const score = (p: { x: number; y: number }) => wolves
          ? stepsBetween(p, { x: 6, y: 2 })
          : drakes ? Number(danger.some(t => t.x === p.x && t.y === p.y)) * 10 + stepsBetween(p, { x: 4, y: 2 })
          : Number(ink(p)) * 10 - Math.min(...enemies.map(enemy => stepsBetween(p, enemy)));
        const moves = [...legalMoves(encounter)];
        const tile = turn === 0 && !wolves && !drakes ? moves.find(ink) : moves.sort((a, b) => score(a) - score(b))[0];
        if (tile && (score(tile) < score(at) || (turn === 0 && ink(tile)))) {
          if (!movedThroughUi) {
            await page.getByRole("button", { name: new RegExp(`^Move to column ${tile.x + 1}, row ${tile.y + 1}(?=:| —|$)`) }).click();
            await expect.poll(async () => (await roomState<RunState>(page, table.code)).seq).toBeGreaterThan(state.seq);
            movedThroughUi = true;
          } else {
            await action(page, table.code, { type: "MOVE", to: { x: tile.x, y: tile.y } });
          }
        }
        await action(page, table.code, { type: "END_TURN" });
        state = await roomState<RunState>(page, table.code);
        if (turn === 0 && !wolves && !drakes) {
          await expect(display.page.locator(".rift-status__caption")).toContainText("Inky mud");
          await display.page.screenshot({ path: info.outputPath("ink-stop.png") });
          sawInk = true;
        }
      }
      expect(movedThroughUi).toBe(true);
      if (!wolves && !drakes) expect(sawInk).toBe(true);
      expect(state.lastEncounter).toMatchObject({ sceneId: fight.sceneId, outcome: fight.outcome, destination: fight.destination });
      const outcomeText = wolves ? "You bring supper to the big fire" : drakes ? "The wagon lurches upright" : "The last stamp disappears";
      await expect(display.page.getByText(new RegExp(outcomeText))).toBeVisible({ timeout: 60_000 });
      await display.page.screenshot({ path: info.outputPath("outcome.png") });
    } finally {
      for (const phone of phones) await phone.context.close();
      await display.context.close();
    }
  });
}
