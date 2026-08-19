/**
 * The end-to-end check the roadmap's cross-cutting table is really asking for:
 * "a change hasn't been seen on a TV *and* in three-phone Travel Mode, it isn't
 * done." CI can't hold three phones, so it holds three browser contexts.
 *
 * Two specs, one each for the two presentation modes (spec §2). Both drive the
 * real dev server — real room codes, real SSE, real server-rolled dice — so a
 * protocol regression fails here rather than at the table.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";

const NAMES = ["Allen", "Sam", "Rosie"] as const;

/**
 * Walk one phone through character creation (spec §5).
 *
 * Every click carries an explicit timeout. Without one, Playwright's default
 * is the whole test budget, so a single unactionable control burns five
 * minutes and reports "test timed out" with no clue which step it died on.
 */
const TAP = { timeout: 20_000 } as const;

async function createCharacter(page: Page, species: string, name: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(species, "i") }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);

  // Class — take whichever is first; every class is legal with every species.
  await page.locator(".creation-choice, .creation-card, button").filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);

  // Stats: spend every creation point. The "+" control is *hidden* once the
  // budget is gone, which is the assertion — nothing greyed out (spec §11).
  // Re-query every iteration: spending a point re-renders the row, so a
  // locator captured before the click can go stale under it.
  for (let i = 0; i < 12; i++) {
    const adds = page.getByRole("button", { name: /add a point to/i });
    if ((await adds.count()) === 0) break;
    await adds.first().click(TAP);
    await expect(page.getByRole("button", { name: /add a point to/i })).toHaveCount(
      i === 2 ? 0 : 4,
      { timeout: 5_000 },
    );
  }
  await expect(page.getByRole("button", { name: /add a point to/i })).toHaveCount(0);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);

  // Appearance: a colour and an accent, both deliberate taps. Neither is
  // required — picking a species already applied a default, and the step
  // gates on nothing (CreationFlow `stepDone`) — so this is the "somebody
  // chose" path. nameplates.spec.ts walks past without touching them.
  const fieldsets = page.locator(".creation-fieldset");
  await fieldsets.nth(0).locator(".creation-swatch").first().click(TAP);
  await fieldsets.nth(1).locator(".creation-swatch").first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);

  // Name. "Surprise me" has to be there — typing must never be required
  // (spec §5.5) — but the test types, so it can assert on the result later.
  await expect(page.getByRole("button", { name: /surprise me/i })).toBeVisible();
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
}

/** The server's view, so the test asserts on authority rather than on pixels. */
async function serverState(
  code: string,
): Promise<{ phase: string; xpEarned: number; sceneId: string | null; encounter?: unknown }> {
  const response = await fetch(`http://localhost:8787/api/state?code=${code}`);
  const body = (await response.json()) as {
    state: { phase: string; xpEarned: number; sceneId: string | null; encounter?: unknown };
  };
  return body.state;
}

/**
 * Tap a specific choice, confirm it (spec §11: select, then "Do it!"), and
 * keep at it until the server actually stands where the choice leads. Used by
 * the combat test to route deterministically — the chapter-walk test keeps
 * its "whoever is asked, answers" randomness on purpose.
 *
 * The retry is not paranoia: a tap can land while the phone's patches are
 * held behind a presentation, in which case the intent is refused as stale
 * and the *game's* answer is "resync and tap again" (store `send()`). A test
 * that fire-and-forgets a single click asserts something the app never
 * promised.
 */
async function chooseUntil(page: Page, label: RegExp, done: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await done()) return;
    await page
      .locator(".prompt button")
      .filter({ hasText: label })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page
      .getByRole("button", { name: /do it!/i })
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForTimeout(700);
  }
  expect(await done(), `the tap on ${String(label)} never took`).toBe(true);
}

/**
 * Does this option's label carry one of the party's names?
 *
 * The question is "has somebody already voted for this", and the answer has to
 * be a **whole-word** match rather than a substring. `includes` looked
 * equivalent and was not: a hero called Bramble made every `Bramblewisp` in the
 * chapter read as a party member.
 *
 * That is not hypothetical. It is the ~1-in-10 e2e failure: the walk test names
 * its third hero Bramble, the fight it can route into is three Bramblewisps, and
 * so every attack target was skipped as "already voted". With no option left to
 * tap, the party stood in front of the wisps until the budget ran out — a fight
 * nobody could ever take a swing at, on a run that had done nothing wrong except
 * fail a check and end up in combat.
 *
 * `\b` is exactly the fix: `Bramble` matches `Bramble` and not `Bramblewisp`,
 * because there is no word boundary in the middle of a word.
 */
function labelNamesAHero(label: string, heroes: readonly string[]): boolean {
  return heroes.some((hero) => {
    const escaped = hero.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(label);
  });
}

/**
 * Take this phone's combat turn, if it has one.
 *
 * Combat is the one prompt the generic driver below cannot play. It taps the
 * first option it finds and hopes; a turn is *three* deliberate steps — pick an
 * action, pick a target, confirm — and each blind tap costs a loop iteration
 * plus its waits. The walk test's own note admits it: "a route through the
 * stream can land in real combat, which the generic driver plays one card at a
 * time."
 *
 * That is the ~1-in-10 CI failure. On the branch that reaches the bramblewisps
 * the fight takes so many iterations that the walk runs past its 300s budget
 * and dies as `Test timeout`, several rounds from the end. Given a longer
 * budget the same runs eventually wedge instead — same cause, later symptom.
 *
 * So combat gets driven properly: one turn per call, in the order the UI asks
 * for it, ending the turn when there is nothing worth doing. `End turn` is the
 * important fallback — a hero whose enemies are all out of reach has no legal
 * action at all, and passing lets the monsters close the distance on their own
 * turn rather than leaving three phones staring at each other.
 */
async function takeCombatTurn(page: Page): Promise<boolean> {
  const panel = page.locator(".prompt.combat");
  if ((await panel.count()) === 0) return false;
  // Only the phone actually on the clock has anything to do.
  if ((await panel.getByText(/Your turn,/i).count()) === 0) return false;

  // Up to three steps: action -> target -> confirm. Bounded rather than
  // `while (true)`, because a driver that cannot get out of a step should fail
  // the test loudly instead of spinning inside a helper.
  for (let step = 0; step < 3; step += 1) {
    const confirm = panel.getByRole("button", { name: /do it!|yes, do that/i });
    if (await confirm.first().isVisible().catch(() => false)) {
      await confirm.first().click().catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }

    const targets = panel.locator(".combat__targets button");
    if ((await targets.count()) > 0) {
      // First target, whoever it is — for Attack that is an enemy, for Help Up
      // it is the fallen friend, and the server only ever offers legal ones.
      await targets.first().click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(200);
      continue;
    }

    const cards = panel.locator(".prompt__options > li > button");
    const labels = await cards.allInnerTexts().catch(() => [] as string[]);
    /*
     * Priorities, in table order. **Help Up first**: §7.3 makes picking a
     * fallen friend up the beat of every fight, and it is also what keeps the
     * fight inside any budget at all — a driver that never helped anyone up
     * left the party fighting shorthanded, and a two-hero fight against three
     * wisps runs long enough to blow the whole test's budget on its own (a
     * captured run was at round 6 with a hero still on the floor). Attack
     * second because it is what ends a fight; End turn when nothing else is
     * offered, which is what an unreachable enemy looks like from here.
     */
    const help = labels.findIndex((label) => /help up/i.test(label));
    const attack = labels.findIndex((label) => /attack/i.test(label));
    const end = labels.findIndex((label) => /end turn/i.test(label));
    const pick = help >= 0 ? help : attack >= 0 ? attack : end;
    if (pick < 0) return false;
    await cards.nth(pick).click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(400);
  return true;
}

/**
 * Answer whatever this phone is being asked, if anything. Returns whether it
 * acted. Choices are select-then-confirm (spec §11), and an option already
 * carrying a voter's name is this player's own vote — tapping it again would
 * just re-cast it.
 */
async function answerPrompt(page: Page, heroes: readonly string[]): Promise<boolean> {
  const options = await page.locator(".prompt button").all();
  const fresh: typeof options = [];
  for (const option of options) {
    const label = (await option.innerText().catch(() => "")).trim();
    if (!label) continue;
    if (/do it!|yes, do that|wait, not yet|change/i.test(label)) continue;
    if (labelNamesAHero(label, heroes)) continue;
    fresh.push(option);
  }
  if (fresh.length === 0) return false;

  // Bounded, because the config sets no actionTimeout and Playwright's default
  // is *no limit*: one never-actionable button (a toast overlapping it, a
  // re-render mid-click) would otherwise hang the whole walk until the test
  // budget dies, with a stack trace pointing at whichever line came next.
  await fresh[0]!.click({ timeout: 5_000 }).catch(() => {});
  // The confirm can vanish under us — another player's answer can resolve the
  // prompt between the tap and the confirm. That is the game working, not a
  // failure, so a missed confirm is fine; the next turn re-reads the state.
  const confirm = page.getByRole("button", { name: /do it!|yes, do that/i });
  await confirm.first().click({ timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(600);
  return true;
}

/**
 * Contexts are closed at the end of every test. Playwright would otherwise
 * hold them until the worker exits, and each open phone keeps an SSE stream
 * to the dev server: by the third spec there are nine, all multiplexed through
 * one Vite proxy, and later tests start losing races against socket limits.
 */
test.describe("first playable", () => {
  const openContexts: { close(): Promise<void> }[] = [];

  async function phone(browser: Browser, width = 390, height = 844): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    openContexts.push(context);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("travel mode: three phones, one room, a character each", async ({ browser }) => {
    const phones = [await phone(browser), await phone(browser), await phone(browser)];
    const [host, ...others] = phones as [Page, Page, Page];

    await host.goto("/");
    await host.fill('input[placeholder="Type your name"]', NAMES[0]);
    await host.getByText("Travel Mode").click();
    await host.getByRole("button", { name: /start a game/i }).click();

    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(host.url()).pathname.split("/").pop()!;

    for (const [i, page] of others.entries()) {
      await page.goto("/");
      await page.fill('input[placeholder="Type your name"]', NAMES[i + 1]!);
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${code}$`));
    }

    const species = ["unicorn", "dragonling", "griffin"];
    const heroes = ["Sparklehoof", "Emberwing", "Skyclaw"];
    for (const [i, page] of phones.entries()) {
      await createCharacter(page, species[i]!, heroes[i]!);
    }

    // Every phone sees the whole party: Travel Mode has no private channel,
    // which is a deliberate trade (spec §2.2). The world is one tap away —
    // Travel Mode shows one surface at a time, and creating a character leaves
    // you on your own controls.
    for (const page of phones) {
      await page.getByRole("button", { name: /^world$/i }).click();
      for (const hero of heroes) {
        await expect(page.getByText(hero).first()).toBeVisible({ timeout: 15_000 });
      }
    }

    // A hard refresh recovers on any surface (architecture §4.3).
    await host.reload();
    await host.getByRole("button", { name: /^world$/i }).click();
    for (const hero of heroes) {
      await expect(host.getByText(hero).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test("travel mode: your turn comes to you, and the world is one tap back", async ({ browser }) => {
    const solo = await phone(browser);
    await solo.goto("/");
    await solo.fill('input[placeholder="Type your name"]', NAMES[0]);
    await solo.getByText("Travel Mode").click();
    await solo.getByRole("button", { name: /start a game/i }).click();
    await expect(solo).toHaveURL(/\/p\/[A-Z]{4}$/);

    // Creation is a turn: a phone with no character must not land on the world
    // with the only thing it can do hidden behind a toggle.
    await expect(solo.getByRole("button", { name: /unicorn/i }).first()).toBeVisible();
    await createCharacter(solo, "unicorn", "Sparklehoof");

    await solo.getByRole("button", { name: /i'm ready/i }).click();
    await solo.getByRole("button", { name: /begin the adventure/i }).click();

    // The scene opens a choice, so the controls come forward on their own...
    await expect(solo.getByRole("button", { name: /what do you do/i }).or(solo.locator(".prompt"))).toBeVisible();
    // ...carrying the question they are answers to.
    await expect(solo.locator(".player__echo")).toBeVisible();

    // ...and the world is one tap away for the art and the detail.
    await solo.getByRole("button", { name: /^world$/i }).click();
    await expect(solo.getByText(/the story/i).first()).toBeVisible();
    // Still your turn, and the tab says so without relying on colour.
    await expect(solo.locator(".kad-travel__nudge")).toBeVisible();
  });

  test("three players take a chapter from the lobby to the end", async ({ browser }) => {
    /*
     * 540s, the same number for the same reason as the bramblewisp fight test
     * below: a route through the stream lands this walk in the identical
     * fight, and that test's own measurement — "6-10 rounds when three novice
     * thornguards keep missing, ~30s of genuine presentation holds per round"
     * — is exactly why its comment says 300s "fits the median run, not the
     * tail". The walk was given the fight when it was ungated, and never the
     * budget that came with it: story routes finish in under a minute either
     * way, and fight routes need what fights need.
     */
    test.setTimeout(540_000);
    const phones = [await phone(browser), await phone(browser), await phone(browser)];
    const [host] = phones as [Page, ...Page[]];

    await host.goto("/");
    await host.fill('input[placeholder="Type your name"]', NAMES[0]);
    await host.getByText("Travel Mode").click();
    await host.getByRole("button", { name: /start a game/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(host.url()).pathname.split("/").pop()!;

    for (const [i, page] of phones.slice(1).entries()) {
      await page.goto("/");
      await page.fill('input[placeholder="Type your name"]', NAMES[i + 1]!);
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
    }

    // One of each so the chapter's species-gated choices are all reachable.
    const species = ["unicorn", "griffin", "bigfoot"];
    const heroes = ["Sparklehoof", "Skyclaw", "Bramble"];
    for (const [i, page] of phones.entries()) await createCharacter(page, species[i]!, heroes[i]!);

    for (const page of phones) {
      await page.getByRole("button", { name: /i'm ready/i }).click({ timeout: 20_000 });
      // Assert the tap actually took. A ready that silently fails to register
      // is the exact failure worth catching here, and without this the test
      // just hangs later with nothing to say about why.
      await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
    }
    await host.getByRole("button", { name: /begin the adventure/i }).click({ timeout: 20_000 });
    await expect(host.getByText(/the story|what do you do/i).first()).toBeVisible();

    /*
     * Play it the way a table does: whoever the game is asking, answers. The
     * route through the chapter depends on real dice, so the number of turns
     * varies from run to run.
     *
     * The state is re-read after *every* action, not once per turn. The
     * completion screen's own button is live — it takes the party back to the
     * lobby — so a phone tapping it is enough to move the run past
     * `chapter_complete` before the end of the turn.
     */
    let completed: { phase: string; xpEarned: number } | null = null;
    let quiet = 0;

    // 90 rather than 60: with the bramblewisp fight ungated, a route through
    // the stream can land in real combat, which the generic driver plays one
    // card at a time.
    for (let turn = 0; turn < 90 && completed === null; turn++) {
      let acted = false;

      for (const page of phones) {
        const roll = page.getByRole("button", { name: /^roll/i });
        if ((await roll.count()) > 0 && (await roll.first().isVisible().catch(() => false))) {
          await roll.first().click();
          // The roll is the centrepiece and takes its ~1.5s (spec §2.2).
          await page.waitForTimeout(2600);
          acted = true;
        } else if (await takeCombatTurn(page)) {
          acted = true;
        } else if (await answerPrompt(page, heroes)) {
          acted = true;
        } else {
          continue;
        }

        const state = await serverState(code);
        if (state.phase === "chapter_complete") {
          completed = state;
          break;
        }
      }

      // A quiet turn is normal — a roll is animating, or a patch is in flight.
      // Several in a row means the game is genuinely stuck waiting on nobody,
      // which is the thing worth failing on. The bound tolerates a full enemy
      // combat round: its COMBAT_SEQUENCE holds every phone's patch for up to
      // 4s (world/presentation.ts), which is three quiet passes on its own.
      quiet = acted ? 0 : quiet + 1;
      if (quiet > 0) await host.waitForTimeout(1_200);
      expect(quiet, "stuck: nobody has anything to tap").toBeLessThan(7);
    }

    expect(completed, "the chapter never finished").not.toBeNull();
    // XP is awarded per chapter, not per enemy — exploring counts (spec §8.1).
    expect(completed!.xpEarned).toBeGreaterThan(0);
  });

  test("three players fight the bramblewisps and the story carries on", async ({ browser }) => {
    // Three creations plus a real fight: a d20 fight §7.1 tunes to ~4 rounds
    // routinely runs 6–10 when three novice thornguards keep missing, and
    // every round costs ~30s of genuine presentation holds across three
    // phones. The default 300s budget fits the median run, not the tail.
    test.setTimeout(540_000);
    const phones = [await phone(browser), await phone(browser), await phone(browser)];
    const [host] = phones as [Page, ...Page[]];

    await host.goto("/");
    await host.fill('input[placeholder="Type your name"]', NAMES[0]);
    await host.getByText("Travel Mode").click();
    await host.getByRole("button", { name: /start a game/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(host.url()).pathname.split("/").pop()!;

    for (const [i, page] of phones.slice(1).entries()) {
      await page.goto("/");
      await page.fill('input[placeholder="Type your name"]', NAMES[i + 1]!);
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
    }

    // A bigfoot, so "Push the thorns aside" is on the menu and the route to
    // the fight needs no dice at all.
    const species = ["unicorn", "griffin", "bigfoot"];
    const heroes = ["Sparklehoof", "Skyclaw", "Bramble"];
    for (const [i, page] of phones.entries()) await createCharacter(page, species[i]!, heroes[i]!);

    for (const page of phones) {
      await page.getByRole("button", { name: /i'm ready/i }).click({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
    }
    await host.getByRole("button", { name: /begin the adventure/i }).click({ timeout: 20_000 });

    const at = (sceneId: string) => async () => (await serverState(code)).sceneId === sceneId;
    const heroOf = (page: Page): string => heroes[phones.indexOf(page)]!;

    /*
     * The deterministic road to the thicket — no checks, no dice:
     * hedge wall → first clearing → the fork (a real three-phone vote) →
     * the singing stream → "Chase them off", which goes straight to
     * encounter_bramblewisps.
     */
    await chooseUntil(host, /push the thorns aside/i, at("scene_first_clearing"));
    await chooseUntil(host, /head deeper into the wood/i, at("choice_point_path"));
    // The vote: each phone keeps confirming "stream" until either its vote is
    // what resolves the prompt or the party has already moved on.
    for (const page of phones) {
      await chooseUntil(page, /follow the singing stream/i, async () => {
        const s = await serverState(code);
        if (s.sceneId !== "choice_point_path") return true; // resolved
        return await page
          .locator(".prompt button")
          .filter({ hasText: /follow the singing stream/i })
          .getByText(heroOf(page))
          .isVisible()
          .catch(() => false);
      });
    }
    await expect.poll(async () => (await serverState(code)).sceneId).toBe("scene_singing_stream");
    await chooseUntil(host, /chase them off/i, at("encounter_bramblewisps"));

    const encounterOf = async () =>
      ((await serverState(code)).encounter ?? null) as {
        round: number;
        turnIndex: number;
        actionTaken: boolean;
        stepsLeft: number;
        order: string[];
        openingOrder: string[];
        combatants: { id: string; side: string; down: boolean; name: string }[];
      } | null;

    // An encounter waits on a ready-up before the board goes up (engine.ts) —
    // three phones have to swap to a combat UI first. Same tolerance as every
    // other tap: ready is confirmed by the button flipping, not by the click.
    for (const page of phones) {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await encounterOf()) break;
        const flipped = await page
          .getByRole("button", { name: /wait, not yet/i })
          .isVisible()
          .catch(() => false);
        if (flipped) break;
        await page.getByRole("button", { name: /i'm ready/i }).click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
    await expect.poll(async () => Boolean(await encounterOf()), { timeout: 30_000 }).toBe(true);

    /** Whose turn the *server* says it is — a party hero's name, or null
        while a monster (or nobody) holds the clock. */
    function activeHero(enc: NonNullable<Awaited<ReturnType<typeof encounterOf>>>): string | null {
      const order = enc.round === 1 ? enc.openingOrder : enc.order;
      const active = enc.combatants.find((c) => c.id === order[enc.turnIndex]);
      return active && active.side === "party" && !active.down ? active.name : null;
    }

    /** Attack if the card is offered: card → first target → "Do it!". Clicks
        are tolerant — a miss is retried by the next driver pass. */
    async function tryAttack(page: Page): Promise<boolean> {
      const card = page.locator(".combat .choice").filter({ hasText: /attack/i });
      if ((await card.count()) === 0) return false;
      await card.first().click({ timeout: 4_000 }).catch(() => {});
      await page.locator(".combat__targets button").first().click({ timeout: 4_000 }).catch(() => {});
      await page.getByRole("button", { name: /do it!/i }).click({ timeout: 4_000 }).catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }

    /** Step toward the wisps: the reachable tile furthest right, confirmed. */
    async function tryMove(page: Page): Promise<boolean> {
      const tiles = page.locator("button[data-move-tile]");
      const count = await tiles.count();
      if (count === 0) return false;
      let bestX = -1;
      let bestIndex = 0;
      for (let i = 0; i < count; i++) {
        const x = Number(await tiles.nth(i).getAttribute("data-x"));
        if (x > bestX) {
          bestX = x;
          bestIndex = i;
        }
      }
      await tiles.nth(bestIndex).click({ timeout: 4_000 }).catch(() => {});
      await page.getByRole("button", { name: /do it!/i }).click({ timeout: 4_000 }).catch(() => {});
      // The move's own COMBAT_SEQUENCE holds this phone's patch ~700ms
      // (world/presentation.ts); the attack re-check needs the fresh board.
      await page.waitForTimeout(1_000);
      return true;
    }

    /*
     * Play the fight through the phone UI, driving the phone the *server*
     * says is up (its own patches can trail the enemy round's COMBAT_SEQUENCE
     * hold by ~4s — world/presentation.ts — so we wait for its combat UI
     * before tapping): attack when a target is legal, otherwise step toward
     * the enemies and re-check, otherwise end the turn. Every click is
     * retry-tolerant; the server state is the only progress meter. Bounded —
     * a fight §7.1 tunes to ~4 rounds that is still running after 50 driver
     * passes has genuinely hung.
     */
    let over = false;
    for (let i = 0; i < 150 && !over; i++) {
      const enc = await encounterOf();
      if (!enc) {
        over = true;
        break;
      }
      const hero = activeHero(enc);
      if (!hero) {
        // Nobody can act this instant (a settle in flight); look again.
        await host.waitForTimeout(800);
        continue;
      }
      const page = phones[heroes.indexOf(hero)]!;
      const ready = await page
        .getByText(/your turn/i)
        .first()
        .waitFor({ state: "visible", timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      if (!ready) continue; // patches still draining; poll the server again

      const endTurn = async () => {
        await page
          .locator(".combat .choice")
          .filter({ hasText: /end turn/i })
          .first()
          .click({ timeout: 4_000 })
          .catch(() => {});
        await page.getByRole("button", { name: /do it!/i }).click({ timeout: 4_000 }).catch(() => {});
        await page.waitForTimeout(600);
      };

      if (enc.actionTaken) {
        // The one action is spent (§7.2); nothing is left but handing over.
        await endTurn();
        continue;
      }
      if (await tryAttack(page)) continue;
      if (enc.stepsLeft > 0 && (await tryMove(page)) && (await tryAttack(page))) continue;
      await endTurn();
    }

    // The fight ended and the story branched — victory or defeat both carry
    // on (spec §7.3); there is no game over to assert against.
    expect(over, "the encounter never resolved").toBe(true);
    const after = await serverState(code);
    expect(after.encounter ?? null).toBeNull();
    expect(after.sceneId).not.toBe("encounter_bramblewisps");
    expect(["scene_wisp_friends", "scene_bundled"]).toContain(after.sceneId);

    // And play keeps playing: both branch scenes end on a single choice that
    // walks to the shrine, which is the chapter's spine.
    await chooseUntil(host, /go where they are pointing|untie your laces/i, at("scene_shrine_hollow"));
  });

  test("scanning the lobby QR lands on a prefilled join", async ({ browser }) => {
    const host = await phone(browser);
    await host.goto("/");
    await host.fill('input[placeholder="Type your name"]', "Allen");
    await host.getByText("Travel Mode").click();
    await host.getByRole("button", { name: /start a game/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(host.url()).pathname.split("/").pop()!;

    // The QR encodes this URL, so scanning it is the same as opening it on a
    // phone that has never seen the app. Being asked to retype the code you
    // just scanned would make the QR pointless.
    const scanned = await phone(browser);
    await scanned.goto(`/p/${code}`);
    await expect(scanned.getByLabel(/room code/i)).toHaveValue(code);
  });

  test("party mode: the TV attaches with no identity at all", async ({ browser }) => {
    const controller = await phone(browser);
    await controller.goto("/");
    await controller.fill('input[placeholder="Type your name"]', "Allen");
    await controller.getByText("Party Mode").click();
    await controller.getByRole("button", { name: /start a game/i }).click();
    await expect(controller).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(controller.url()).pathname.split("/").pop()!;

    // A fresh context — no localStorage, no device token, no player. The TV is
    // a pure display client and must attach on the room code alone (spec §2.1).
    const tv = await phone(browser, 1280, 720);
    const tvErrors: string[] = [];
    tv.on("pageerror", (e) => tvErrors.push(e.message));
    await tv.goto(`/tv/${code}`);
    // The code is rendered one letter per element so it reads across a
    // room, so assert on the letters rather than the string.
    await expect(tv.getByText(/room code/i).first()).toBeVisible({ timeout: 10_000 });

    await createCharacter(controller, "unicorn", "Sparklehoof");
    // The TV never asked for this and has no session — it arrived over the
    // room channel alone.
    await expect(tv.getByText("Sparklehoof").first()).toBeVisible({ timeout: 15_000 });
    expect(tvErrors).toEqual([]);
  });
});
