import { openPlayerTask } from "./player-navigation";
/**
 * The Field Guide at the table (epic #101, launch #112).
 *
 * One phone and a TV, the way a household first meets the guide: play into a
 * fight, the creature lands in the book — a toast on the phone, a banner on the
 * TV — and the player opens the guide *mid-combat* from the tray, reads the
 * entry, comes back to the fight and takes the turn. The guide is local
 * navigation, so the fight must not notice it was ever open.
 *
 * The road to the fight is the playtest drawer's "Jump to a scene" (dev
 * server only), not a walk: what is under test is the guide, and the chapter
 * walk already has its own spec (first-playable). The jump enters
 * `encounter_bramblewisps` like any other step, so it discovers the fight's
 * creature — the bestiary's `will_o_wisp`, "Will-o'-Wisp" in the guide.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;
const WISP = /Will-o'-Wisp/;

interface Encounter {
  round: number;
  turnIndex: number;
  actionTaken: boolean;
  order: string[];
  openingOrder: string[];
  combatants: { id: string; side: string; down: boolean; name: string }[];
}

async function encounterOf(code: string): Promise<Encounter | null> {
  const response = await fetch(`http://localhost:8787/api/state?code=${code}`);
  const body = (await response.json()) as { state: { encounter?: Encounter | null } };
  return body.state.encounter ?? null;
}

/** Is the server waiting on our hero right now? */
function heroUp(enc: Encounter | null, hero: string): boolean {
  if (!enc) return false;
  const order = enc.round === 1 ? enc.openingOrder : enc.order;
  const active = enc.combatants.find((c) => c.id === order[enc.turnIndex]);
  return active?.side === "party" && active.name === hero;
}

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
  await expect(page.getByRole("button", { name: /add a point to/i })).toHaveCount(0);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
  await page.getByRole("button", { name: /^Ready to play$/i }).click(TAP);
}

/** End the hero's turn through the combat card, as a player would. */
async function endTurn(page: Page): Promise<void> {
  await openPlayerTask(page);
  await page.locator(".combat__end").first().click({ timeout: 5_000 }).catch(() => {});
  await page.getByRole("button", { name: /do it!/i }).click({ timeout: 5_000 }).catch(() => {});
}

test.describe("the Field Guide", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function client(browser: Browser, width: number, height: number): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    open.push(context);
    return context.newPage();
  }

  test("a fight's creature lands in the book, and the guide opens mid-combat from the tray", async ({ browser }) => {
    test.setTimeout(300_000);
    const HERO = "Moonbeam";
    const FRIEND = "Skyclaw";

    // --- A TV opens the room; one phone joins and makes a hero ---
    const tv = await client(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /want to host/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    // Two phones: the toast waits politely while it is your turn, so a phone
    // is free to celebrate while a friend holds the turn — the table's
    // ordinary rhythm. `phone` is the reader; `friend` just plays.
    const phone = await client(browser, 390, 844);
    const friend = await client(browser, 390, 844);
    for (const page of [phone, friend]) {
      await page.goto("/");
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${code}$`));
    }

    // The tray carries the guide from the first screen on.
    const tray = phone.getByRole("navigation", { name: "What to look at" });
    await expect(tray.getByRole("button", { name: /^Guide$/ })).toBeVisible();

    await createCharacter(phone, "unicorn", HERO);
    await createCharacter(friend, "griffin", FRIEND);
    for (const page of [phone, friend]) {
      await openPlayerTask(page);
      await page.getByRole("button", { name: /i'm ready/i }).click(TAP);
      await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
    }
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);

    // --- Into the fight ---
    const toast = phone.getByRole("status").filter({ hasText: "New in your Field Guide" }).filter({ hasText: WISP });
    const banner = tv.getByRole("status").filter({ hasText: "New in the Field Guide" }).filter({ hasText: WISP });
    // Both are live moments that come and go on their own clock (5s), so the
    // watch starts before the jump rather than after it.
    let toastShown = false;
    const toastSeen = toast.waitFor({ state: "visible", timeout: 150_000 }).then(() => (toastShown = true), () => false);
    const bannerSeen = banner.waitFor({ state: "visible", timeout: 150_000 }).then(() => true, () => false);

    await phone.getByRole("button", { name: /^Playtest/ }).click(TAP);
    await phone.getByRole("button", { name: /encounter_bramblewisps/ }).click(TAP);
    await phone.getByRole("button", { name: /^close$/i }).click(TAP);

    // An encounter waits on a ready-up before the board goes up.
    await expect
      .poll(async () => {
        for (const page of [phone, friend]) {
          if (await encounterOf(code)) return true;
          if (await page.getByRole("button", { name: /wait, not yet/i }).isVisible().catch(() => false)) continue;
          await openPlayerTask(page);
          await page.getByRole("button", { name: /i'm ready/i }).click({ timeout: 3_000 }).catch(() => {});
        }
        return Boolean(await encounterOf(code));
      }, { timeout: 60_000 })
      .toBe(true);

    // The TV celebrates the find at its first quiet moment.
    expect(await bannerSeen, "the TV never showed the Field Guide banner").toBe(true);

    // The phone celebrates once it owes the table nothing: if the fight opens
    // on our turn, hand it over, and the toast arrives on the friend's.
    await expect
      .poll(async () => {
        if (toastShown) return true;
        if (heroUp(await encounterOf(code), HERO)) await endTurn(phone);
        return toastShown;
      }, { timeout: 90_000, intervals: [1_000] })
      .toBe(true);
    expect(await toastSeen, "the phone never showed the Field Guide toast").toBe(true);
    expect(await encounterOf(code), "the fight should still be on").not.toBeNull();

    // --- Open the guide from the tray, mid-combat ---
    await tray.getByRole("button", { name: /^Guide$/ }).click(TAP);
    const guide = phone.getByRole("region", { name: "Field Guide" });
    await expect(guide).toBeVisible();
    await expect(tray.getByRole("button", { name: /^Guide$/ })).toHaveAttribute("aria-pressed", "true");
    await guide.getByRole("tab", { name: "Creatures" }).click(TAP);
    await guide.getByRole("button", { name: WISP }).click(TAP);
    await expect(guide.getByRole("heading", { name: WISP })).toBeVisible();
    await expect(guide.getByRole("heading", { name: "Story", exact: true })).toBeVisible();
    await expect(guide.getByText(/tangle in marsh magic/)).toBeVisible();
    await expect(guide.getByRole("heading", { name: "Likes", exact: true })).toBeVisible();
    expect(await encounterOf(code), "reading the guide must not end the fight").not.toBeNull();

    // --- Back to the fight, and take the turn ---
    await tray.getByRole("button", { name: /^You$/ }).click(TAP);
    await expect(guide).toBeHidden();
    // The friend finishes their turn; ours comes round.
    await expect
      .poll(async () => {
        const enc = await encounterOf(code);
        if (heroUp(enc, FRIEND)) await endTurn(friend);
        return heroUp(await encounterOf(code), HERO);
      }, { timeout: 90_000, intervals: [1_000] })
      .toBe(true);
    await phone.getByRole("button", { name: /^Your turn$/ }).click(TAP);
    const before = await encounterOf(code);
    expect(before).not.toBeNull();
    await phone.locator(".combat__end").first().click(TAP);
    await phone.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect
      .poll(async () => {
        const now = await encounterOf(code);
        return now === null || now.round !== before!.round || now.turnIndex !== before!.turnIndex;
      }, { timeout: 30_000 })
      .toBe(true);
  });
});
