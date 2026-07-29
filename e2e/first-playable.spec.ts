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

  // Appearance: a colour and an accent, both deliberate taps — nothing is
  // preselected, so "Next" stays inert until the choice is actually made.
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
async function serverState(code: string): Promise<{ phase: string; xpEarned: number }> {
  const response = await fetch(`http://localhost:8787/api/state?code=${code}`);
  const body = (await response.json()) as { state: { phase: string; xpEarned: number } };
  return body.state;
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
    if (heroes.some((hero) => label.includes(hero))) continue;
    fresh.push(option);
  }
  if (fresh.length === 0) return false;

  await fresh[0]!.click().catch(() => {});
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
    // which is a deliberate trade (spec §2.2).
    for (const page of phones) {
      for (const hero of heroes) {
        await expect(page.getByText(hero).first()).toBeVisible({ timeout: 15_000 });
      }
    }

    // A hard refresh recovers on any surface (architecture §4.3).
    await host.reload();
    for (const hero of heroes) {
      await expect(host.getByText(hero).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test("three players take a chapter from the lobby to the end", async ({ browser }) => {
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

    // Play it the way a table does: whoever the game is asking, answers.
    // The route through the chapter depends on real dice, so the number of
    // turns varies from run to run.
    let quiet = 0;
    for (let turn = 0; turn < 60; turn++) {
      const state = await serverState(code);
      if (state.phase === "chapter_complete") break;

      let acted = false;
      for (const page of phones) {
        const roll = page.getByRole("button", { name: /^roll/i });
        if ((await roll.count()) > 0 && (await roll.first().isVisible().catch(() => false))) {
          await roll.first().click();
          // The roll is the centrepiece and takes its ~1.5s (spec §2.2).
          await page.waitForTimeout(2600);
          acted = true;
          continue;
        }
        if (await answerPrompt(page, heroes)) acted = true;
      }

      // A quiet turn is normal — a roll is animating, or a patch is in flight.
      // Several in a row means the game is genuinely stuck waiting on nobody,
      // which is the thing worth failing on.
      quiet = acted ? 0 : quiet + 1;
      if (quiet > 0) await host.waitForTimeout(1_200);
      expect(quiet, `stuck at ${state.phase}: nobody has anything to tap`).toBeLessThan(4);
    }

    const final = await serverState(code);
    expect(final.phase).toBe("chapter_complete");
    // XP is awarded per chapter, not per enemy — exploring counts (spec §8.1).
    expect(final.xpEarned).toBeGreaterThan(0);
    await expect(host.getByText(/\b\d+\b/).first()).toBeVisible();
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
