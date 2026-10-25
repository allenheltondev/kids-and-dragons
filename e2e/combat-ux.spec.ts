import { test, expect } from "@playwright/test";
import { beginEncounter, parseBoard } from "../packages/shared/src/index";
import { readFileSync } from "node:fs";
import { createCharacter } from "./characters";

test("review combat decisions on phone and tablet", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /host a game/i }).click();
  await page.getByText("Phone Mode", { exact: true }).click();
  await page.getByLabel("Your adventurer name").fill("Combat review");
  await page.getByRole("button", { name: /^start a game$/i }).click();
  await createCharacter(page, "unicorn", "Moonbeam");
  await page.getByRole("button", { name: /begin the adventure/i }).click();
  await expect(page.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0);
  const fixture = await page.evaluate(async () => {
    const modulePath = "/src/store/index.ts";
    const { useGameStore } = await import(modulePath);
    const store = useGameStore.getState();
    await store.loadChapter(store.state.chapterId);
    return { state: store.state, rules: store.rules, abilities: store.abilities };
  });
  const hero = { ...fixture.state.party[0].character, stats: { ...fixture.state.party[0].character.stats, quick: 99 } };
  const spec = { id: "wisp", name: "Bramblewisp", hp: 6, guard: 11, quick: 3, steps: 5, attack: 3, art: "enemies/will_o_wisp" };
  const encounter = beginEncounter({
    board: parseBoard(["..........", "...##.....", "..........", "..........", "..........", "......##..", "..........", ".........."]),
    party: [{ character: hero, at: { x: 3, y: 3 } }],
    enemies: [{ spec, at: { x: 4, y: 3 } }, { spec, at: { x: 4, y: 4 } }, { spec, at: { x: 3, y: 4 } }],
  }, { rules: fixture.rules, abilities: fixture.abilities, rng: { next: () => 0.5 } });
  const state = { ...fixture.state, sceneId: "encounter_bramblewisps", sceneType: "encounter", narration: "Three wisps want to play a very energetic game of tag.", prompt: null, encounter };
  const cases = [{ width: 390, height: 844, text: "normal" }, { width: 320, height: 720, text: "normal" }, { width: 1024, height: 768, text: "normal" }, { width: 390, height: 844, text: "largest" }];
  for (const viewport of cases) {
    await page.setViewportSize(viewport);
    await page.evaluate(async ({ state, text }) => {
      if (text === "normal") delete document.documentElement.dataset.text;
      else document.documentElement.dataset.text = text;
      const modulePath = "/src/store/index.ts";
      (await import(modulePath)).useGameStore.setState({ state, synced: true, send: async () => false });
      const navigation = "/src/store/player-navigation.ts";
      (await import(navigation)).setPlayerSection("turn");
    }, { state, text: viewport.text });
    await expect(page.locator(".combat__grid")).toBeVisible();
    await expect(page.getByLabel("Your turn budget")).toContainText("4 steps");
    await expect(page.getByLabel("Your turn budget")).toContainText("1 action");
    const hint = page.locator(".combat__hint .combat__line");
    expect(await hint.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`after-${viewport.width}-${viewport.text}.png`) });
    const firstAction = page.locator(".combat__actions button").first();
    await expect(firstAction).toBeInViewport({ ratio: 0.9 });
    const board = await page.locator(".combat__grid").boundingBox();
    expect(board!.width).toBeGreaterThanOrEqual(220);
    await page.screenshot({ path: testInfo.outputPath(`after-${viewport.width}-${viewport.text}.png`) });
    console.info(viewport, await page.locator(".combat").evaluate(el => ({
      hint: el.querySelector(".combat__hint")?.textContent,
      hpFont: getComputedStyle(el.querySelector(".combat__cell-hp")!).fontSize,
      hintClipped: [...el.querySelectorAll<HTMLElement>(".combat__hint .combat__line")].some(e => e.scrollWidth > e.clientWidth),
      brokenImages: [...el.querySelectorAll<HTMLImageElement>("img")].filter(i => i.complete && !i.naturalWidth).map(i => i.src),
      summaries: [...el.querySelectorAll<HTMLElement>(".combat__actions .choice__sub")].map(e => ({ clipped: e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight + 1, whiteSpace: getComputedStyle(e).whiteSpace })),
    })));
    if (viewport.width === 390 && viewport.text === "normal") {
      await page.getByRole("button", { name: "Enlarge battle map" }).click();
      const enlarged = page.getByRole("dialog", { name: "Enlarged battle map" });
      await expect(enlarged).toBeVisible();
      const move = enlarged.locator("[data-move-tile]").first();
      const bounds = await move.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath("enlarged-map.png") });
      await page.keyboard.press("Escape");
      await expect(enlarged).not.toBeVisible();
      await expect(page.getByRole("button", { name: "Enlarge battle map" })).toBeFocused();
      await page.getByRole("button", { name: "Enlarge battle map" }).click();
      await enlarged.locator("[data-move-tile]").first().click();
      await expect(enlarged).not.toBeVisible();

      await page.locator(".combat__roster summary").click();
      await expect(page.getByRole("list", { name: "Fighter details" })).toContainText("Guard 11");
      await expect(page.getByRole("list", { name: "Fighter details" })).toContainText("6/6 hearts");
      await page.screenshot({ path: testInfo.outputPath("after-roster.png") });
      await page.locator(".combat__roster summary").click();
      await page.locator(".combat__actions button").filter({ hasText: /^Attack/ }).click();
      await expect(page.locator(".combat__targets")).toBeVisible();
      await expect(page.locator("[data-aim-target]")).toHaveCount(3);
      await expect(page.locator(".combat__targets")).toContainText("Guard 11");
      await page.screenshot({ path: testInfo.outputPath("after-targets.png") });
      await page.getByRole("button", { name: "Change", exact: true }).click();
    }
  }

  const finale = JSON.parse(readFileSync("content/chapters/riftlight-finale.json", "utf8"));
  const practice = JSON.parse(readFileSync("content/chapters/first-steps-01.json", "utf8"));
  const environment = {
    ...practice.scenes.encounter_bun.environment, ...finale.scenes.fight_standard.environment,
    hazards: [...finale.scenes.fight_standard.environment.hazards,
      { id: "fire", kind: "fire", label: "Warm coals", tiles: [{ x: 1, y: 1 }], damage: 1 },
      { id: "thorns", kind: "thorns", label: "Thorn patch", tiles: [{ x: 2, y: 1 }], damage: 1 }],
    objectives: [...finale.scenes.fight_standard.environment.objectives,
      { id: "hold", kind: "hold", label: "Hold the stones", tiles: [{ x: 7, y: 1 }], rounds: 2 }],
  };
  const complex = beginEncounter({
    board: parseBoard(Array(8).fill("..........")),
    party: [{ character: hero, at: { x: 3, y: 3 } }],
    enemies: [{ spec, at: { x: 4, y: 3 } }], environment,
  }, { rules: fixture.rules, abilities: fixture.abilities, rng: { next: () => 0.5 } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async ({ state, complex }) => {
    delete document.documentElement.dataset.text;
    const modulePath = "/src/store/index.ts";
    (await import(modulePath)).useGameStore.setState({ state: { ...state, encounter: complex }, synced: true });
  }, { state, complex });
  await expect(page.getByRole("list", { name: "The rift", exact: true })).toContainText("Bun");
  await expect(page.getByRole("list", { name: "The rift", exact: true })).toContainText("fight is won");
  const painted = page.locator(".combat__feature img");
  await expect(painted).toHaveCount(9);
  await expect.poll(() => painted.evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.getByRole("button", { name: "Enlarge battle map" }).click();
  await page.screenshot({ path: testInfo.outputPath("environment-enlarged.png") });
  await page.getByRole("button", { name: "Close map" }).click();
  await page.screenshot({ path: testInfo.outputPath("environment.png") });
  const waiting = { ...encounter, openingOrder: ["wisp#1", ...encounter.openingOrder.filter(id => id !== "wisp#1")] };
  await page.evaluate(async ({ state, waiting }) => {
    const modulePath = "/src/store/index.ts";
    (await import(modulePath)).useGameStore.setState({ state: { ...state, encounter: waiting } });
    const navigation = "/src/store/player-navigation.ts";
    (await import(navigation)).setPlayerSection("turn");
  }, { state, waiting });
  await expect(page.locator(".combat__waiting")).toContainText("Bramblewisp 1");
  await expect(page.locator("[data-move-tile]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("waiting.png") });
  const boss = { ...encounter, combatants: encounter.combatants.map(c => c.id === "wisp#1" ? { ...c, name: "Corvane" } : c) };
  await page.evaluate(async ({ state, boss }) => {
    const modulePath = "/src/store/index.ts";
    const { useGameStore } = await import(modulePath);
    const chapter = useGameStore.getState().chapter;
    useGameStore.setState({ chapter: { ...chapter, scenes: { ...chapter.scenes, [state.sceneId]: { type: "encounter", enemies: [{ id: "wisp", art: "cast/deep-ice-figure" }] } } }, state: { ...state, encounter: boss } });
  }, { state, boss });
  const bossArt = page.locator('.combat__cell-art[src="/assets/cast/deep-ice-figure/assembled.png"]').first();
  await expect(bossArt).toBeVisible();
  await expect.poll(() => bossArt.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("corvane.png") });

  await page.evaluate(async (heroId) => {
    const modulePath = "/src/store/index.ts";
    (await import(modulePath)).useGameStore.setState({ presentation: { seq: 500000, presentation: { kind: "COMBAT_SEQUENCE", events: [
      { type: "roll", roll: { characterId: heroId, die: 14, mod: 3, total: 17, tn: 11, result: "hit", stat: "might" }, targetId: "wisp#1", tier: "solid" },
      { type: "damage", actorId: "wisp#1", amount: 3, hp: 3 },
    ] } } });
  }, hero.id);
  await expect(page.getByRole("group", { name: "What just happened" })).toContainText("Solid hit");
  await page.evaluate(async () => {
    const modulePath = "/src/store/index.ts";
    const { useGameStore } = await import(modulePath);
    const state = useGameStore.getState().state;
    useGameStore.setState({ state: { ...state, encounter: { ...state.encounter, round: 2 } } });
  });
  await page.getByLabel("Read the full combat result").click();
  await expect(page.locator(".combat__result-text")).toBeVisible();
  await expect(page.locator(".combat__result-text")).toContainText("17 vs Guard 11");
  await page.screenshot({ path: testInfo.outputPath("result.png") });
  await page.getByRole("button", { name: "Enlarge battle map" }).click();
  for (const [index, kind] of ["damage", "heal", "bonus", "evaded", "freed"].entries()) {
    await page.evaluate(async ({ kind, heroId, index }) => {
      const modulePath = "/src/store/index.ts";
      const event = kind === "freed" ? { type: kind, byId: heroId }
        : kind === "evaded" ? { type: kind, actorId: heroId, byId: "wisp#1" }
        : kind === "bonus" ? { type: kind, actorId: heroId, amount: 2 }
        : { type: kind, actorId: heroId, amount: 2, hp: 8 };
      (await import(modulePath)).useGameStore.setState({ presentation: { seq: 500001 + index, presentation: { kind: "COMBAT_SEQUENCE", events: [event] } } });
    }, { kind, heroId: hero.id, index });
    const effect = page.locator(".combat__feedback");
    await expect(effect).toBeVisible();
    await expect(page.locator(".combat__effect")).toHaveCSS("animation-name", "none");
    if (kind === "damage" || kind === "bonus" || kind === "freed") {
      const reaction = page.locator(".combat__reaction-art");
      await expect.poll(() => reaction.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`feedback-${kind}.png`) });
    await expect(effect).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Close map" }).click();

  // Motion enabled uses the sheet instead of the reduced-motion still.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(async heroId => {
    delete document.documentElement.dataset.motion;
    const modulePath = "/src/store/index.ts";
    (await import(modulePath)).useGameStore.setState({ presentation: { seq: 500010, presentation: { kind: "COMBAT_SEQUENCE", events: [
      { type: "damage", actorId: heroId, amount: 1, hp: 9 },
    ] } } });
  }, hero.id);
  await expect(page.locator(".combat__effect")).toHaveCSS("animation-name", "combat-effect");
  await expect(page.locator(".combat__feedback")).toHaveCount(0);

  // Render the real shared board as well as the phone's DOM grid.
  await page.setViewportSize({ width: 1024, height: 800 });
  const markerCount = await page.evaluate(async ({ complex, hero }) => {
    const source = await (await fetch("/src/world/board.ts")).text();
    const pixiUrl = source.match(/from ["']([^"']*pixi[^"']*)["']/)?.[1];
    if (!pixiUrl) throw new Error("Vite did not resolve Pixi");
    const { Application } = await import(pixiUrl);
    const modulePath = "/src/world/board.ts";
    const { createBoardLayer } = await import(modulePath);
    const app = new Application();
    await app.init({ width: 1024, height: 800, background: "#171329" });
    const host = document.createElement("div");
    host.id = "combat-art-review";
    host.style.cssText = "position:fixed;inset:0;z-index:99999";
    host.appendChild(app.canvas);
    document.body.appendChild(host);
    const board = createBoardLayer();
    board.container.position.set(48, 48);
    board.container.scale.set(0.7);
    app.stage.addChild(board.container);
    board.update({ encounter: complex, biome: null, enemyArt: { wisp: "enemies/will_o_wisp" }, party: [{ character: hero, playerId: hero.ownerPlayerId, hp: 10, down: false, connected: true, ready: true }] });
    app.ticker.add(() => board.tick(1 / 60));
    // All marker URLs were decoded by the phone above. Wait for Pixi's texture
    // loads and redraws too, rather than taking a picture of their fallbacks.
    for (let attempt = 0; attempt < 100; attempt++) {
      const environment = board.container.getChildByLabel("environment");
      const count = environment?.children.filter((child: { label: string }) => child.label?.startsWith("combat-marker:")).length ?? 0;
      if (count === 9) return count;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return 0;
  }, { complex, hero });
  expect(markerCount).toBe(9);
  await page.screenshot({ path: testInfo.outputPath("shared-board-art.png") });

});
