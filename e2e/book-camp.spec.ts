/**
 * The adventure book's Camp tray, with and without a signal (#629; docs/camp.md
 * §7, §13.1).
 *
 * A phone reads its book once with a signal, then loses it: the book opens
 * from its saved copy on a reload, the kid changes her kit, the book says it
 * is saved on this phone, and the change survives the book being closed and
 * opened again. When the signal comes back the change lands on the server.
 * And when somebody else changed the same field meanwhile (her hero's player
 * at a table), the newer value stays, the rest of her change still lands, and
 * the book says so in a short note.
 *
 * The suite runs on the Vite dev server, which has no service worker, so "no
 * signal" is the server being unreachable from the page (every `/api` request
 * fails, as it does in a car) and the browser offline once the page has what it
 * needs; the worker's side, the book opening on a reload with no network at
 * all, is offline.spec.ts's (playwright.prod.config.ts).
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import type { JournalKit, JournalResponse } from "../packages/shared/src/index";
import { API } from "./api";
import { phoneStorage, seedTable, type SeededPhone } from "./seed";

const TAP = { timeout: 20_000 } as const;
const HERO = "Moonbeam";

async function seedBook(): Promise<SeededPhone> {
  const table = await seedTable({
    mode: "travel",
    ready: false,
    heroes: [{ name: HERO, species: "unicorn", class: "songkeeper" }],
    camp: {
      real: true,
      grownBy: ["gemfall"],
      owned: ["find_noodle_awning", "find_picnic_blanket", "shop_lantern_string"],
      placed: { awning: "find_noodle_awning", lanterns: "shop_lantern_string", friends_corner: "find_picnic_blanket" },
      friends: ["duckling", "bun"],
    },
  });
  return table.phones[0]!;
}

async function journalOf(phone: SeededPhone): Promise<JournalResponse> {
  const response = await fetch(`${API}/api/journal`, { headers: { "x-kad-device-token": phone.deviceToken } });
  expect(response.ok).toBe(true);
  return (await response.json()) as JournalResponse;
}

async function serverKit(phone: SeededPhone): Promise<JournalKit> {
  const journal = await journalOf(phone);
  return journal.camp!.kits[journal.heroes[0]!.id]!;
}

/** A table's kit edit for her hero, as her phone in the room sends it (`KIT_EDIT`). */
async function tableEdit(phone: SeededPhone, change: Record<string, unknown>): Promise<void> {
  const heroId = (await journalOf(phone)).heroes[0]!.id;
  const stateResponse = await fetch(`${API}/api/state?code=${phone.session.roomCode}`, { headers: { authorization: `Bearer ${phone.session.sessionToken}` } });
  const { state } = (await stateResponse.json()) as { state: { runId: string; seq: number; kits?: Record<string, { revision: number }> } };
  const response = await fetch(`${API}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${phone.session.sessionToken}` },
    body: JSON.stringify({
      runId: state.runId,
      playerId: phone.session.playerId,
      seq: state.seq,
      intent: { type: "KIT_EDIT", characterId: heroId, revision: (await serverKit(phone)).revision, ...change },
    }),
  });
  expect(response.ok, await response.clone().text()).toBe(true);
}

async function openBook(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/journal");
  await expect(page.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);
  return page;
}

async function openCamp(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Camp" }).click(TAP);
  await expect(page.getByRole("heading", { name: "The first crew's camp" })).toBeVisible(TAP);
}

/** No signal: the server unreachable from the page. */
async function noSignal(context: BrowserContext): Promise<void> {
  await context.route("**/api/**", (route) => route.abort("internetdisconnected"));
}

/** The signal back: the server reachable, and the browser's `online` heard. */
async function signalBack(context: BrowserContext): Promise<void> {
  await context.unroute("**/api/**");
  await context.setOffline(true);
  await context.setOffline(false);
}

test.describe("the book's Camp tray", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("opens offline after an online read, keeps a queued kit change through a reload, and sends it when the signal returns", async ({ browser }) => {
    test.setTimeout(120_000);
    const phone = await seedBook();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: phoneStorage(phone) });
    open.push(context);

    // --- Online: the book is read once and saved ---
    let page = await openBook(context);
    await openCamp(page);
    await expect(page.getByTestId("book-camp-synced")).toHaveText(/^Synced at /);
    const pieces = page.getByTestId("book-camp-pieces");
    await expect(pieces.getByText("Found at the Exchange Rift")).toBeVisible();
    await expect(pieces.getByText("Bought with Dash Cash")).toBeVisible();
    const friends = page.getByTestId("book-camp-friends");
    await expect(friends.getByText("Met at the Ashspan Bridge")).toBeVisible();
    await friends.getByRole("button", { name: "Say hi to Duckling" }).click();
    await expect(page.getByTestId("book-camp-said")).toHaveText(/duckling/i);
    // The crew's camp is look-only: no shared spot, no Undo, no shop here.
    await expect(page.getByTestId("camp-shared")).toHaveCount(0);

    // --- No signal: a reload opens the saved book, and a change queues ---
    await noSignal(context);
    await page.reload();
    await expect(page.getByText(/no signal/i).first()).toBeVisible(TAP);
    await openCamp(page);
    await expect(page.getByTestId("book-camp-synced")).toHaveText(/^Last synced /);
    await context.setOffline(true);
    const kit = page.getByTestId("kit-editor");
    await kit.getByRole("button", { name: "Blue" }).click();
    await expect(page.getByTestId("book-camp-queued")).toHaveText("Saved on this phone, will share when you're back online.");
    await expect(kit.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect((await serverKit(phone)).color).toBeNull();

    // --- Closed and opened again, still with no signal: the change is still there ---
    await context.setOffline(false);
    await page.close();
    page = await openBook(context);
    await openCamp(page);
    await expect(page.getByTestId("kit-editor").getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("book-camp-queued")).toBeVisible(TAP);

    // --- The signal returns: it lands ---
    await signalBack(context);
    await expect.poll(async () => (await serverKit(phone)).color, { timeout: 20_000 }).toBe("meadow");
    await expect(page.getByTestId("book-camp-queued")).toHaveCount(0, TAP);
    await expect(page.getByTestId("book-camp-note")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("kad.kitQueue"))).toBeNull();
  });

  test("a field changed at a table meanwhile keeps the newer value, the rest lands, and the book says so", async ({ browser }) => {
    test.setTimeout(120_000);
    const phone = await seedBook();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: phoneStorage(phone) });
    open.push(context);
    const page = await openBook(context);
    await openCamp(page);

    await noSignal(context);
    await context.setOffline(true);
    const kit = page.getByTestId("kit-editor");
    await kit.locator('[data-tent="patched"]').click();
    await kit.getByRole("button", { name: "Orange" }).click();
    await expect(page.getByTestId("book-camp-queued")).toBeVisible(TAP);

    // Meanwhile, at the table: her tent.
    await tableEdit(phone, { tent: "quilted" });

    await signalBack(context);
    const note = page.getByTestId("book-camp-note");
    await expect(note).toContainText("Your tent changed on another screen while you were away, so the newer one stays.", TAP);
    await expect.poll(async () => (await serverKit(phone)).color, { timeout: 20_000 }).toBe("tide");
    expect((await serverKit(phone)).tent).toBe("quilted");
    // The book shows the kit as it now is.
    await expect(kit.locator('[data-tent="quilted"]')).toHaveAttribute("aria-pressed", "true");
    await expect(kit.getByRole("button", { name: "Orange" })).toHaveAttribute("aria-pressed", "true");
    await note.getByRole("button", { name: "OK" }).click();
    await expect(note).toHaveCount(0);
  });
});
