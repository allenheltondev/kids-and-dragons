/**
 * Visual review tool for the Gemfall chapter 01/02 art pilot, not a normal CI test.
 *
 * Run with `npx playwright test -c playwright.cast-review.config.ts e2e/gemfall-art-shot.spec.ts`.
 * It seeds the real Gemfall campaign, closes chapter 01 through the playtest
 * jump, then photographs chapter 02 on its actual TV and phone surfaces.
 */
import { expect, test, type BrowserContextOptions } from "@playwright/test";
import type { ClientIntent, RunState } from "../packages/shared/src/index";
import type { SeedResponse, SeededPhone } from "../packages/server/src/dev-seed";
import { onAir } from "./seed";

const BASE_URL = process.env.KAD_E2E_BASE_URL ?? "http://localhost:5183";
const API = process.env.KAD_E2E_API ?? "http://localhost:8793";
const SHOTS = "docs/review/gemfall-01-02-pilot";

type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;
function stored(entries: Record<string, unknown>): StorageState {
  return { cookies: [], origins: [{ origin: new URL(BASE_URL).origin, localStorage: Object.entries(entries).map(([name, value]) => ({ name, value: JSON.stringify(value) })) }] };
}
function phoneStorage(phone: SeededPhone): StorageState {
  return stored({
    "kad.device": { householdId: phone.householdId, playerId: phone.playerId, displayName: phone.displayName, deviceToken: phone.deviceToken },
    [`kad.session.${phone.session.roomCode}`]: { ...phone.session, savedAt: Date.now() },
  });
}
function tvStorage(table: SeedResponse): StorageState {
  const tv = table.tv;
  if (!tv) throw new Error("The review table needs a TV");
  return stored({ "kad.device": { householdId: tv.householdId, playerId: tv.playerId, displayName: "", deviceToken: tv.deviceToken, screenOnly: true } });
}

async function send(page: import("@playwright/test").Page, code: string, intent: ClientIntent): Promise<void> {
  const session = await page.evaluate((room) => JSON.parse(localStorage.getItem(`kad.session.${room}`) ?? "null") as { playerId: string; sessionToken: string }, code);
  for (let retry = 0; retry < 5; retry++) {
    const stateResponse = await fetch(`${API}/api/state?code=${code}`, { headers: { authorization: `Bearer ${session.sessionToken}` } });
    if (!stateResponse.ok) throw new Error(`Reading review table state failed: ${stateResponse.status}`);
    const { state } = await stateResponse.json() as { state: RunState };
    const actionResponse = await fetch(`${API}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.sessionToken}` },
      body: JSON.stringify({ runId: state.runId, seq: state.seq, playerId: session.playerId, intent }),
    });
    const result = await actionResponse.json() as { ok: boolean; error?: { code: string; message: string } };
    if (result.ok) return;
    if (result.error?.code !== "STALE_SEQ") throw new Error(`${intent.type}: ${result.error?.message ?? "action failed"}`);
  }
  throw new Error(`${intent.type} lost the state sequence race repeatedly`);
}

test("photograph Gemfall chapter 02 art and relaxed tracking on TV and phone", async ({ browser }) => {
  test.setTimeout(240_000);
  const seeded = await fetch(`${API}/api/dev/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "party", tv: true, campaignId: "gemfall", begin: true, sceneId: "rest_northbound",
      heroes: [{ name: "Aster", species: "unicorn", class: "songkeeper", stats: { might: 0, quick: 0, clever: 0, heart: 3 } }],
    }),
  });
  if (!seeded.ok) throw new Error(`Seeding Gemfall failed: ${seeded.status} ${await seeded.text()}`);
  const table = await seeded.json() as SeedResponse;
  const code = table.code;
  const contexts: { close(): Promise<void> }[] = [];
  try {
    const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState: tvStorage(table) });
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: phoneStorage(table.phones[0]!) });
    contexts.push(tvContext, phoneContext);
    const tv = await tvContext.newPage();
    const phone = await phoneContext.newPage();
    await Promise.all([tv.goto(`/tv/${code}`), phone.goto(`/p/${code}`)]);
    await Promise.all([onAir(tv), onAir(phone)]);
    await phone.getByRole("button", { name: "You", exact: true }).click();

    await send(phone, code, { type: "ADVANCE" });
    await send(phone, code, { type: "READY", ready: true });
    await send(phone, code, { type: "CONTINUE_CAMPAIGN", campaignId: "gemfall" });
    await send(phone, code, { type: "PLAYTEST_GOTO", sceneId: "interaction_jackalope_hats" });
    const phoneControls = phone.getByRole("region", { name: "Interaction controls" });
    const tvWorld = tv.getByRole("region", { name: "Story interaction" });
    await expect(phoneControls.getByLabel("Relaxed play")).toBeVisible();
    await phoneControls.getByLabel("Relaxed play").check();
    await phoneControls.getByRole("button", { name: "We’re ready" }).click();
    await expect(tvWorld.locator(".painted-cover__glow")).toBeVisible();
    await expect(tvWorld.locator(".painted-cover__peek")).toHaveCount(0);
    await expect(phoneControls.locator(".painted-cover__glow")).toBeVisible();
    const glow = phoneControls.locator(".painted-cover__glow");
    const front = phoneControls.locator(".painted-cover__front").first();
    const [glowZ, frontZ, glowBox, frontBox] = await Promise.all([
      glow.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      front.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      glow.boundingBox(),
      front.boundingBox(),
    ]);
    expect(glowZ).toBeGreaterThan(frontZ);
    expect(glowBox).not.toBeNull();
    expect(frontBox).not.toBeNull();
    expect(glowBox!.width).toBeGreaterThan(frontBox!.width);
    await expect(phoneControls.getByRole("button", { name: /Lift the hat:/ })).toHaveCount(3);
    const hatChoice = phoneControls.getByRole("button", { name: "Lift the hat: Left hat" });
    await hatChoice.scrollIntoViewIfNeeded();
    const hatChoiceBox = await hatChoice.boundingBox();
    expect(hatChoiceBox).not.toBeNull();
    expect(hatChoiceBox!.y).toBeGreaterThanOrEqual(0);
    expect(hatChoiceBox!.y + hatChoiceBox!.height).toBeLessThan(844 - 80);
    await tv.screenshot({ path: `${SHOTS}/chapter02-hats-relaxed-tv.png` });
    await phone.screenshot({ path: `${SHOTS}/chapter02-hats-relaxed-phone.png`, fullPage: true });

    await send(phone, code, { type: "PLAYTEST_GOTO", sceneId: "interaction_egg_baskets" });
    const readyButton = phoneControls.getByRole("button", { name: "We’re ready" });
    await expect(readyButton).toBeVisible();
    const basket = phoneControls.locator('.interaction-art__main[src="/assets/story-props/prop_egg_basket.webp"]');
    await expect(basket).toBeVisible();
    await basket.evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      if (!image.complete || image.naturalWidth === 0) throw new Error("Egg-basket prop did not decode");
    });
    const basketBox = await basket.boundingBox();
    expect(basketBox).not.toBeNull();
    expect(basketBox!.width).toBeGreaterThan(80);
    expect(basketBox!.height).toBeGreaterThan(80);
    const basketArt = basket.locator("xpath=ancestor::div[contains(@class,'interaction-art')]");
    const basketHero = await basketArt.locator(".interaction-art__hero").boundingBox();
    expect(basketHero).not.toBeNull();
    expect(basketBox!.x).toBeGreaterThan(basketHero!.x + basketHero!.width);
    const helpButton = phoneControls.getByRole("button", { name: "Take a helping hand" });
    await expect(readyButton).toBeInViewport();
    await expect(helpButton).toBeInViewport();
    await phone.screenshot({ path: `${SHOTS}/chapter02-egg-basket-phone.png`, fullPage: true });
    await readyButton.click();
    await expect(phoneControls.getByRole("button", { name: /basket/ })).toBeVisible();
    await expect(helpButton).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  }
});
