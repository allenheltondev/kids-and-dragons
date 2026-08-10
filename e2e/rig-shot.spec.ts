/**
 * Scratch spec: put real rigs on a TV-sized screen and photograph them.
 *
 * Not a regression test — there is nothing here to assert that the unit tests
 * do not already pin. It exists because the 1400 restage moved two things no
 * test can see: the size a character is drawn at (the old rigs were built at
 * 90% and stood 73px low) and the anchor the client hangs a rig from
 * (art-paths RIG_ANCHOR_Y, 0.879 -> 0.777). Both are "looks right" questions.
 */

import { test, expect, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;

async function createCharacter(page: Page, species: string, name: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(species, "i") }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page
    .locator(".creation-choice, .creation-card, button")
    .filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i })
    .first()
    .click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  for (let i = 0; i < 12; i++) {
    const adds = page.getByRole("button", { name: /add a point to/i });
    if ((await adds.count()) === 0) break;
    await adds.first().click(TAP);
  }
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  const fieldsets = page.locator(".creation-fieldset");
  await fieldsets.nth(0).locator(".creation-swatch").first().click(TAP);
  await fieldsets.nth(1).locator(".creation-swatch").first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
}

test("photograph the party on a TV", async ({ browser }) => {
  test.setTimeout(300_000);

  // One context per phone. Sharing a context shares identity, so the second
  // "phone" just re-opens the first player's session.
  const contexts: { close(): Promise<void> }[] = [];
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    contexts.push(ctx);
    return ctx.newPage();
  };
  const host = await phone();
  await host.goto("/");
  await host.fill('input[placeholder="Type your name"]', "Allen");
  await host.getByText("Travel Mode").click();
  await host.getByRole("button", { name: /start a game/i }).click();
  await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
  const code = new URL(host.url()).pathname.split("/").pop()!;

  const others = [await phone(), await phone()];
  for (const [i, page] of others.entries()) {
    await page.goto("/");
    await page.fill('input[placeholder="Type your name"]', ["Sam", "Rosie"][i]!);
    await page.getByLabel(/room code/i).fill(code);
    await page.getByRole("button", { name: /join a game/i }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${code}$`));
  }

  const cast: [Page, string, string][] = [
    [host, "unicorn", "Sparklehoof"],
    [others[0]!, "manticore", "Thornlash"],
    [others[1]!, "griffin", "Skyclaw"],
  ];
  for (const [page, species, name] of cast) await createCharacter(page, species, name);

  // The TV attaches on the room code alone (spec §2.1).
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`/tv/${code}`);
  for (const [, , name] of cast) {
    await expect(tv.getByText(name).first()).toBeVisible({ timeout: 30_000 });
  }
  // Let the rigs load and settle into idle before the shutter.
  await tv.waitForTimeout(6_000);
  await tv.screenshot({ path: "art/review/tv-lineup.png" });

  await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
  await tvCtx.close();
});
