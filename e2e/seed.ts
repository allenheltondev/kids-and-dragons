/**
 * A table already sitting down: a room with its heroes made and ready, in
 * one call to the dev server (`POST /api/dev/seed`, packages/server/src/dev-seed.ts),
 * and the browser storage each device would have kept had it done that itself.
 *
 * For specs that are about what happens at a table, not about getting to it.
 * Clicking a phone through hero creation costs about fifteen seconds a hero,
 * and the heaviest specs paid that for two or three phones before measuring
 * anything. The creation flow, the join form and the lobby keep specs of
 * their own (first-playable, phone-fit, drop-in's late joiner), which click.
 *
 * Every step on the server is the handler the real routes call, so a seeded
 * phone is the same player a clicked one is; it just opens at `/p/CODE` with
 * its session already saved, as after a refresh.
 */

import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import type { SeedRequest, SeedResponse, SeededPhone } from "../packages/server/src/dev-seed";
import { API } from "./api";

export type { SeedRequest, SeedResponse, SeededPhone };

const BASE_URL = process.env.KAD_E2E_BASE_URL ?? "http://localhost:5173";

/** The campaign playwright.config.ts pins the client to (`VITE_LAUNCH_CAMPAIGN`). */
export const LAUNCH_CAMPAIGN = "the-hollow-crown";

/** Open a room (or join `code`) with these heroes made, ready and, if asked, begun at a scene. */
export async function seedTable(request: Omit<SeedRequest, "campaignId"> & { campaignId?: string | null }): Promise<SeedResponse> {
  const response = await fetch(`${API}/api/dev/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId: LAUNCH_CAMPAIGN, ...request }),
  });
  const body = (await response.json()) as SeedResponse & { error?: { code: string; message: string } };
  if (!response.ok) throw new Error(`seeding a table: ${response.status} ${JSON.stringify(body.error)}`);
  return body;
}

export type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

const stored = (entries: Record<string, unknown>): StorageState => ({
  cookies: [],
  origins: [
    {
      origin: new URL(BASE_URL).origin,
      localStorage: Object.entries(entries).map(([name, value]) => ({ name, value: JSON.stringify(value) })),
    },
  ],
});

/** What a phone keeps once it is seated (client store/persistence.ts): its binding, and the room's session. */
export function phoneStorage(phone: SeededPhone): StorageState {
  return stored({
    "kad.device": {
      householdId: phone.householdId,
      playerId: phone.playerId,
      displayName: phone.displayName,
      deviceToken: phone.deviceToken,
    },
    [`kad.session.${phone.session.roomCode}`]: { ...phone.session, savedAt: Date.now() },
  });
}

/** What a TV that opened the room keeps: the binding that proves it is the host, and nothing seated. */
export function tvStorage(table: SeedResponse): StorageState {
  if (!table.tv) throw new Error("this table was not opened by a TV");
  return stored({
    "kad.device": {
      householdId: table.tv.householdId,
      playerId: table.tv.playerId,
      displayName: "",
      deviceToken: table.tv.deviceToken,
      screenOnly: true,
    },
  });
}

/** A seated phone, in a context of its own, on its room. `prepare` runs before the page opens (init scripts). */
export async function openPhone(
  browser: Browser,
  phone: SeededPhone,
  options: BrowserContextOptions = {},
  prepare?: (context: BrowserContext) => Promise<void>,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options, storageState: phoneStorage(phone) });
  await prepare?.(context);
  const page = await context.newPage();
  await page.goto(`/p/${phone.session.roomCode}`);
  return { context, page };
}

/** The TV that opened the table, in a context of its own, on its room. `prepare` as for a phone. */
export async function openTv(
  browser: Browser,
  table: SeedResponse,
  options: BrowserContextOptions = {},
  prepare?: (context: BrowserContext) => Promise<void>,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...options, storageState: tvStorage(table) });
  await prepare?.(context);
  const page = await context.newPage();
  await page.goto(`/tv/${table.code}`);
  return { context, page };
}

/**
 * Until this page's stream is open (the store's `connection`), so news the
 * server sends next (somebody arriving) reaches it, as it would have reached
 * a device that sat through a clicked setup. The dev server serves the store
 * by its module URL, which is the instance the app is using.
 */
export async function onAir(page: Page, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const connection = await page
      .evaluate(async () => {
        const path = "/src/store/index.ts";
        const { useGameStore } = (await import(/* @vite-ignore */ path)) as {
          useGameStore: { getState(): { connection: string; session: unknown } };
        };
        const state = useGameStore.getState();
        return state.session ? state.connection : "no session";
      })
      .catch(() => "loading");
    if (connection === "open") return;
    if (Date.now() > deadline) throw new Error(`${page.url()} never went on air (connection: ${connection})`);
    await page.waitForTimeout(100);
  }
}

/**
 * A seated phone opened on a lobby where its hero is ready: up to the lobby's
 * own card (Begin, "Wait, not yet"), where the creation flow's last tap,
 * "Ready to play", leaves a phone that made its hero by hand. A phone that
 * opens on its room lands on its sheet, with that same button at the foot.
 */
export async function toTheLobby(page: Page): Promise<void> {
  // A phone alone at its table can open on the world pane: the card is on yours.
  const you = page.getByRole("button", { name: "You", exact: true });
  await you.waitFor({ timeout: 20_000 });
  if ((await you.getAttribute("aria-pressed")) !== "true") await you.click({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Ready to play$/i }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: /wait, not yet/i }).waitFor({ timeout: 20_000 });
}
