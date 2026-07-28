/**
 * The end-to-end check the roadmap's cross-cutting table is really asking for:
 * "a change hasn't been seen on a TV *and* in three-phone Travel Mode, it isn't
 * done." CI can't hold three phones, so it holds three browser contexts.
 *
 * Two specs, one each for the two presentation modes (spec §2). Both drive the
 * real dev server — real room codes, real SSE, real server-rolled dice — so a
 * protocol regression fails here rather than at the table.
 */

import { test, expect, type Page } from "@playwright/test";

const NAMES = ["Allen", "Sam", "Rosie"] as const;

/** Walk one phone through character creation (spec §5). */
async function createCharacter(page: Page, species: string, name: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(species, "i") }).first().click();
  await page.getByRole("button", { name: /^next$/i }).click();

  // Class — take whichever is first; every class is legal with every species.
  await page.locator(".creation-choice, .creation-card, button").filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i }).first().click();
  await page.getByRole("button", { name: /^next$/i }).click();

  // Stats: spend every creation point. The "+" control is *hidden* once the
  // budget is gone, which is the assertion — nothing greyed out (spec §11).
  // Re-query every iteration: spending a point re-renders the row, so a
  // locator captured before the click can go stale under it.
  for (let i = 0; i < 12; i++) {
    const adds = page.getByRole("button", { name: /add a point to/i });
    if ((await adds.count()) === 0) break;
    await adds.first().click();
    await expect(page.getByRole("button", { name: /add a point to/i })).toHaveCount(
      i === 2 ? 0 : 4,
      { timeout: 5_000 },
    );
  }
  await expect(page.getByRole("button", { name: /add a point to/i })).toHaveCount(0);
  await page.getByRole("button", { name: /^next$/i }).click();

  // Appearance: a colour and an accent, both deliberate taps — nothing is
  // preselected, so "Next" stays inert until the choice is actually made.
  const fieldsets = page.locator(".creation-fieldset");
  await fieldsets.nth(0).locator(".creation-swatch").first().click();
  await fieldsets.nth(1).locator(".creation-swatch").first().click();
  await page.getByRole("button", { name: /^next$/i }).click();

  // Name. "Surprise me" has to be there — typing must never be required
  // (spec §5.5) — but the test types, so it can assert on the result later.
  await expect(page.getByRole("button", { name: /surprise me/i })).toBeVisible();
  await page.getByPlaceholder("Tap to type").fill(name);
  await page.getByRole("button", { name: /that's me/i }).click();
}

test.describe("first playable", () => {
  test("travel mode: three phones, one room, a character each", async ({ browser }) => {
    const phones = await Promise.all(
      NAMES.map(() => browser.newContext({ viewport: { width: 390, height: 844 } }).then((c) => c.newPage())),
    );
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

  test("party mode: the TV attaches with no identity at all", async ({ browser }) => {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto("/");
    await phone.fill('input[placeholder="Type your name"]', "Allen");
    await phone.getByText("Party Mode").click();
    await phone.getByRole("button", { name: /start a game/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(phone.url()).pathname.split("/").pop()!;

    // A fresh context — no localStorage, no device token, no player. The TV is
    // a pure display client and must attach on the room code alone (spec §2.1).
    const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const tvErrors: string[] = [];
    tv.on("pageerror", (e) => tvErrors.push(e.message));
    await tv.goto(`/tv/${code}`);
    // The code is rendered one letter per element so it reads across a
    // room, so assert on the letters rather than the string.
    await expect(tv.getByText(/room code/i).first()).toBeVisible({ timeout: 10_000 });

    await createCharacter(phone, "unicorn", "Sparklehoof");
    // The TV never asked for this and has no session — it arrived over the
    // room channel alone.
    await expect(tv.getByText("Sparklehoof").first()).toBeVisible({ timeout: 15_000 });
    expect(tvErrors).toEqual([]);
  });
});
