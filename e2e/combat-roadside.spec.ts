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
  { sceneId: "encounter_wolves", chapterId: "gemfall-03c", cue: "Big campfire", target: { x: 6, y: 2 }, outcome: "escaped", destination: "scene_campfire_play", text: "You bring supper to the big fire" },
  { sceneId: "encounter_drakes", chapterId: "gemfall-03c", cue: "Right the wagon", target: { x: 4, y: 2 }, outcome: "victory", destination: "end_forded", text: "The wagon lurches upright" },
  { sceneId: "encounter_boxes", chapterId: "gemfall-04c", cue: "Inky mud", target: null, outcome: "timedOut", destination: "scene_boxes_sulking", text: "The last stamp disappears" },
  { sceneId: "encounter_wisps", chapterId: "gemfall-05a", cue: "Free the mule", target: { x: 4, y: 2 }, outcome: "victory", destination: "scene_wisps_shooed", text: "Brask scoops their leftover glow" },
  { sceneId: "encounter_crabs", chapterId: "gemfall-05c", cue: "Boundary stone", target: { x: 6, y: 3 }, outcome: "escaped", destination: "scene_turned_back", text: "The last of you steps past the stone" },
  { sceneId: "encounter_crawlers", chapterId: "gemfall-05c", cue: "Guard the books", target: { x: 3, y: 2 }, outcome: "victory", destination: "scene_crawlers_shooed", text: "Ashby counts her books twice" },
  { sceneId: "encounter_crawlers", chapterId: "gemfall-06", cue: "Shut the cellar door", target: { x: 4, y: 2 }, outcome: "victory", destination: "scene_crawlers_home", text: "Pellam shuts the door" },
  { sceneId: "encounter_echoes", chapterId: "gemfall-07l", cue: "Ring the road bell", target: { x: 4, y: 3 }, outcome: "victory", destination: "scene_bend_crowds", text: "The echo hunter folds back" },
  { sceneId: "encounter_drake", chapterId: "gemfall-07r", cue: "Ledge path", target: { x: 6, y: 3 }, outcome: "escaped", destination: "scene_drake_drinks", text: "plunges its snout into the spring" },
  { sceneId: "encounter_gallery", chapterId: "gemfall-08", cue: "Guide the bones home", target: { x: 3, y: 2 }, outcome: "victory", destination: "rest_cool_gallery", text: "The bones sink back into the rock" },
  { sceneId: "encounter_dragon", chapterId: "gemfall-08", cue: "Stand by the witness stone", target: { x: 4, y: 2 }, outcome: "victory", destination: "scene_seal_cracks", text: "You fight like people who mean it" },
  { sceneId: "encounter_crabs", chapterId: "gemfall-08", cue: "Lower ledge", target: { x: 6, y: 3 }, outcome: "escaped", destination: "scene_crabs_passed", text: "The last of you climbs past the ledges" },
  { sceneId: "encounter_wolves", chapterId: "gemfall-04a", cue: "Keep the fire", target: { x: 3, y: 2 }, outcome: "victory", destination: "rest_wolf_fire", text: "The pack backs off into one glowing heap" },
  { sceneId: "encounter_echo", chapterId: "gemfall-04b", cue: "Quiet gap", target: { x: 6, y: 3 }, outcome: "escaped", destination: "scene_glade_heart", text: "Your last footfall fades beyond the gap" },
  { sceneId: "encounter_logs", chapterId: "gemfall-04b", cue: "Tie the crossing rope", target: { x: 4, y: 2 }, outcome: "victory", destination: "scene_logs_cleared", text: "Safe stepping stones appear" },
  { sceneId: "encounter_crawlers", chapterId: "gemfall-03a", cue: "Dry bank", target: { x: 6, y: 3 }, outcome: "escaped", destination: "rest_wet_end", text: "scrambles onto the dry bank" },
  { sceneId: "encounter_crabs", chapterId: "gemfall-03a", cue: "Guard the cart wheel", target: { x: 3, y: 2 }, outcome: "victory", destination: "scene_crabs_turned", text: "The soup seller hands you a warm bottle" },
  { sceneId: "encounter_mimic", chapterId: "gemfall-03b", cue: "Slip the mooring rope", target: { x: 4, y: 2 }, outcome: "victory", destination: "scene_act_closed", text: "The show is over" },
] as const;

for (const fight of roadFights) {
  test(`road fights: ${fight.chapterId} ${fight.sceneId} plays through on phone and TV`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    const boxes = fight.sceneId === "encounter_boxes";
    const brook = fight.sceneId === "encounter_logs";
    const wisps = fight.sceneId === "encounter_wisps";
    const marsh = fight.chapterId === "gemfall-03a" && fight.sceneId === "encounter_crawlers";
    const spring = fight.sceneId === "encounter_drake";
    const echo = fight.sceneId === "encounter_echoes" || fight.sceneId === "encounter_echo" || fight.sceneId === "encounter_mimic";
    const finale = fight.chapterId === "gemfall-08";
    const ledges = finale && fight.sceneId === "encounter_crabs";
    const dragon = fight.sceneId === "encounter_dragon";
    const support = finale || fight.sceneId === "encounter_crawlers" || fight.chapterId === "gemfall-04a";
    const table = await seedTable({ mode: "party", tv: true, chapterId: fight.chapterId, sceneId: fight.sceneId, heroes: [
      { name: "Aster", species: "kitsune", class: "songkeeper", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
      { name: "Fern", species: "unicorn", class: "thornguard", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
      ...(support ? [
        { name: "Briar", species: "kitsune", class: "songkeeper", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
        { name: "Lark", species: "unicorn", class: "songkeeper", stats: { might: 0, quick: 3, clever: 0, heart: 0 } },
      ] as const : []),
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
      const ledgeProgress = display.page.getByLabel("Friends past the ledges");
      if (ledges) await expect(ledgeProgress).toContainText("0/4 past the ledges");
      if (fight.chapterId === "gemfall-05c" && fight.sceneId === "encounter_crabs") {
        // Screen-reader progress must describe the same destination as the visible counter.
        await expect(display.page.getByLabel("Friends past the boundary")).toContainText("0/2 past the boundary");
      }
      await display.page.evaluate(() => { document.documentElement.dataset.text = "largest"; });
      await expect.poll(() => panel.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await display.page.screenshot({ path: info.outputPath("tv-largest.png") });
      await display.page.evaluate(() => { delete document.documentElement.dataset.text; });

      let movedThroughUi = false;
      let sawInk = false;
      let sawCurrent = false;
      let sawWarning = false;
      let sawSpring = false;
      let sawUpper = false;
      let sawLedgeProgress = false;
      for (let turn = 0; state.encounter && turn < 24; turn++) {
        const page = active();
        const encounter = state.encounter;
        const actorId = currentActorId(encounter)!;
        const at = positionOf(encounter, actorId)!;
        if (spring && !sawSpring && encounter.round >= 2) {
          expect(positionOf(encounter, "drake#1")).toEqual({ x: 5, y: 1 });
          expect(positionOf(encounter, "small#1")).toEqual({ x: 5, y: 4 });
          sawSpring = true;
        }
        if (ledges && !sawLedgeProgress && encounter.combatants.some(c => c.escaped)) {
          await expect(ledgeProgress).toContainText("1/4 past the ledges");
          sawLedgeProgress = true;
        }
        if (ledges && encounter.round >= 3 && !sawUpper) {
          // The turns above are ended through the API as fast as it answers,
          // while the TV plays the fight log back at reading pace, a few turns
          // behind. Give it time to reach round 3 before reading the ledges.
          await expect(panel).toContainText("Upper ledge is open", { timeout: 60_000 });
          await display.page.screenshot({ path: info.outputPath("upper-ledge.png") });
          sawUpper = true;
        }
        const warnings = committedAttacks(encounter);
        if (warnings.length && !sawWarning) {
          await expect(display.page.getByLabel("Battle plan")).toContainText(/marked ground/i);
          await display.page.screenshot({ path: info.outputPath("windup.png") });
          sawWarning = true;
        }
        const danger = warnings.flatMap(w => w.tiles);
        const enemies = encounter.combatants.filter(c => c.side === "enemy" && !c.down).map(c => positionOf(encounter, c.id)!);
        const ink = (p: { x: number; y: number }) => p.x === 2 && (p.y === 2 || p.y === 3);
        // Leave the early route on the board until it closes, then try the
        // longer climb so the recording shows the actual opening change.
        const goal = ledges ? encounter.round >= 3 ? { x: 6, y: 1 } : { x: 3, y: 2 } : fight.target;
        const score = (p: { x: number; y: number }) => goal
          ? Number(danger.some(t => t.x === p.x && t.y === p.y)) * 10 + (marsh ? Math.min(stepsBetween(p, goal), stepsBetween(p, { x: 6, y: 2 })) : stepsBetween(p, goal))
          : Number(ink(p)) * 10 - Math.min(...enemies.map(enemy => stepsBetween(p, enemy)));
        const moves = legalMoves(encounter).filter(p =>
          (!spring || p.x !== 5 || (p.y !== 1 && p.y !== 4)) &&
          (!brook || turn === 0 || p.x !== 2 || p.y !== 3) && (!marsh || p.x !== 3 || p.y !== 3));
        const runoff = (p: { x: number; y: number }) => p.x === 2 && p.y === 3;
        // Give the wisps an opening beat before committing anyone to the cart.
        const tile = (turn === 0 && wisps) || ((echo || dragon) && !sawWarning) ? undefined : turn === 0 && brook ? moves.find(runoff) : turn === 0 && boxes ? moves.find(ink)
          : moves.sort((a, b) => score(a) - score(b))[0];
        if (tile && (score(tile) < score(at) || (turn === 0 && ((boxes && ink(tile)) || (brook && runoff(tile)))))) {
          if (!movedThroughUi) {
            await page.getByRole("button", { name: new RegExp(`^Move to column ${tile.x + 1}, row ${tile.y + 1}(?=:| —|$)`) }).click();
            await expect.poll(async () => (await roomState<RunState>(page, table.code)).seq).toBeGreaterThan(state.seq);
            movedThroughUi = true;
          } else {
            await action(page, table.code, { type: "MOVE", to: { x: tile.x, y: tile.y } });
          }
        }
        if (support && encounter.combatants.find(c => c.id === actorId)?.actions.includes("rally")) {
          const injured = encounter.combatants.filter(c => c.side === "party" && !c.escaped && c.hp <= c.maxHp - 2)
            .sort((a, b) => a.hp - b.hp)[0];
          if (injured) {
            await action(page, table.code, { type: "COMBAT_ACTION", abilityId: "rally", targetId: injured.id });
            state = await roomState<RunState>(page, table.code);
            if (!state.encounter || currentActorId(state.encounter) !== actorId) continue;
          }
        }
        await action(page, table.code, { type: "END_TURN" });
        state = await roomState<RunState>(page, table.code);
        if (turn === 0 && brook) {
          expect(positionOf(state.encounter!, actorId)!.x).toBeLessThan(2);
          await expect(display.page.locator(".rift-status__caption")).toContainText("Brook current");
          await display.page.screenshot({ path: info.outputPath("brook-current.png") });
          sawCurrent = true;
        }
        if (turn === 0 && boxes) {
          await expect(display.page.locator(".rift-status__caption")).toContainText("Inky mud");
          await display.page.screenshot({ path: info.outputPath("ink-stop.png") });
          sawInk = true;
        }
      }
      expect(movedThroughUi).toBe(true);
      if (boxes) expect(sawInk).toBe(true);
      if (brook) expect(sawCurrent).toBe(true);
      if (wisps || echo || dragon) expect(sawWarning).toBe(true);
      if (spring) expect(sawSpring).toBe(true);
      if (ledges) {
        expect(sawUpper).toBe(true);
        expect(sawLedgeProgress).toBe(true);
      }
      expect(state.lastEncounter).toMatchObject({ sceneId: fight.sceneId, outcome: fight.outcome, destination: fight.destination });
      await expect(display.page.getByText(new RegExp(fight.text))).toBeVisible({ timeout: 60_000 });
      await display.page.screenshot({ path: info.outputPath("outcome.png") });
    } finally {
      for (const phone of phones) await phone.context.close();
      await display.context.close();
    }
  });
}
