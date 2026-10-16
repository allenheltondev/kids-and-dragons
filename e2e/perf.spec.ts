/**
 * What a phone downloads — on its first evening, and on every evening after.
 *
 * Against a production build (playwright.prod.config.ts), where the service
 * worker lives, through a counting proxy (counting-proxy.ts) that sees every
 * byte, the worker's own fetches included. Two visits:
 *
 *   first     a fresh phone hosts Phone Mode, makes a hero, starts the chapter
 *   repeat    the same phone reloads straight away, back into the same room
 *   evening   the same again with the browser's HTTP cache emptied first —
 *             what a phone looks like the next evening, when art's 5-minute
 *             max-age has long run out and iOS has evicted the big files.
 *             Only the HTTP cache: the service worker's saved files stay.
 *
 * The later visits are the ones a cache exists for: every picture, rig, song
 * and content file they need was downloaded the first time, and nothing has
 * changed since. Round trips are counted as well as bytes, because a phone
 * pays for each one in latency even when the answer is "not modified". The report is written to `test-results/perf/` and
 * printed, so a change to caching comes with numbers rather than a feeling.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";
import { formatReport, startCountingProxy, type Report } from "./counting-proxy";

const TAP = { timeout: 20_000 } as const;
const HERO = "Moonbeam";

async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
}

/** How long the rigs and pictures on screen took to arrive, as the page saw it. */
async function artTimings(page: Page): Promise<{ url: string; ms: number }[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => /\/assets\/.*\.(?:riv|webp|png)$/.test(new URL(entry.name).pathname))
      .map((entry) => ({ url: new URL(entry.name).pathname, ms: Math.round(entry.duration) })),
  );
}

function bodiesOf(report: Report, kinds: (keyof Report)[]): number {
  return kinds.reduce((sum, kind) => sum + report[kind].bodies, 0);
}

type Scene = { art?: string; choices?: { goto: string }[] } & Record<string, unknown>;

/** The art of the scenes one step on from `id` — what a test waits to see saved. */
function artAhead(scenes: Record<string, Scene>, id: string): string[] {
  const scene = scenes[id];
  const next = [
    ...(scene?.choices ?? []).map((choice) => choice.goto),
    ...(["onSuccess", "onFailure", "onVictory", "onDefeat"] as const).map((key) => (scene?.[key] as { goto?: string } | undefined)?.goto),
  ].filter((to): to is string => typeof to === "string");
  return [...new Set(next.map((to) => scenes[to]?.art).filter((art): art is string => !!art?.startsWith("scenes/")))].map(
    (art) => `/assets/${art}.webp`,
  );
}

/**
 * Reads on through the story, answering every prompt on `phone`, until the
 * current scene's next steps have art of their own; returns that art. Nobody
 * has been there yet, so a saved copy can only have been fetched ahead.
 */
async function readOnUntilArtAhead(phone: Page, code: string): Promise<string[]> {
  const where = async () =>
    phone.evaluate(async (room) => {
      const { state } = (await (await fetch(`/api/state?code=${room}`)).json()) as {
        state: { chapterId: string | null; sceneId: string | null };
      };
      return state;
    }, code);
  const chapterOf = (id: string) =>
    phone.evaluate(async (chapterId) => (await (await fetch(`/content/chapters/${chapterId}.json`)).json()) as {
      scenes: Record<string, Scene>;
    }, id);

  for (let step = 0; step < 8; step += 1) {
    await expect.poll(async () => (await where()).sceneId, { timeout: 20_000 }).not.toBeNull();
    const { chapterId, sceneId } = await where();
    const expected = artAhead((await chapterOf(chapterId!)).scenes, sceneId!);
    if (expected.length > 0) return expected;
    // Select, then confirm (spec §11). The confirm can take a moment to
    // appear, so it is waited for rather than tried once — and it never
    // stops gently animating, so Playwright's "stable" check is skipped
    // once it is visible and enabled.
    await openPlayerTask(phone);
    const confirm = phone.getByRole("button", { name: /do it!|yes, do that/i }).first();
    await phone.locator(".prompt button").filter({ hasNotText: /do it!|yes, do that|wait, not yet|change/i }).first().click(TAP);
    await expect(confirm).toBeEnabled(TAP);
    await confirm.click({ ...TAP, force: true });
    await expect.poll(async () => (await where()).sceneId, { timeout: 20_000 }).not.toBe(sceneId);
  }
  return [];
}

test("later visits download none of the art, rigs, audio or content a phone already has", async ({ browser, baseURL }) => {
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    // --- First visit ---
    await phone.goto("/");
    await controlled(phone);
    await phone.getByRole("button", { name: /want to host/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/your name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    await createCharacter(phone, "unicorn", HERO);
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
    // The world pane is where the art is: look at it, as a player would.
    await phone.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "World" }).click(TAP);
    await proxy.settled();
    const first = proxy.report();

    // --- Repeat visit ---
    proxy.reset();
    await phone.reload();
    await phone.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "World" }).click(TAP);
    await proxy.settled();
    const repeat = proxy.report();

    // --- The next evening ---
    proxy.reset();
    const cdp = await context.newCDPSession(phone);
    await cdp.send("Network.clearBrowserCache");
    await phone.reload();
    await phone.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "World" }).click(TAP);
    await proxy.settled();
    const evening = proxy.report();
    const timings = await artTimings(phone);

    mkdirSync("test-results/perf", { recursive: true });
    writeFileSync("test-results/perf/visits.json", JSON.stringify({ first, repeat, evening, eveningArtTimings: timings }, null, 2));
    console.log([formatReport("first visit", first), formatReport("repeat visit", repeat), formatReport("next evening", evening)].join("\n"));
    console.log(`next-evening art timings (ms): ${timings.map((t) => `${t.url.split("/").slice(-3).join("/")} ${t.ms}`).join(", ")}`);

    // The first visit really did load the heavy things, or the rest proves nothing.
    expect(first.rig.bodies, "the first visit loaded no rig").toBeGreaterThan(0);
    expect(first.art.bodies, "the first visit loaded no art").toBeGreaterThan(0);

    // Later visits: none of it again. Before the fingerprinted cache, the next
    // evening re-downloaded ~3.8MB in 41 round trips (art 1.9MB, the rig
    // 0.9MB, audio 0.8MB, content 0.1MB) — every byte of it already on the phone.
    for (const [name, visit] of [["repeat", repeat], ["next evening", evening]] as const) {
      expect(bodiesOf(visit, ["bundle", "content", "rig", "audio"]), `${name}: re-downloaded code, content, a rig or audio`).toBe(0);
      // Browsers fetch the favicon outside any service worker; nothing else may come down.
      const art = visit.art.downloaded.filter((path) => path !== "/favicon.ico");
      expect(art, `${name}: re-downloaded art`).toEqual([]);
    }
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("bytes that do not match their fingerprint are served, but never saved", async ({ browser, baseURL }) => {
  // The backdrop of the Exchange, where Gemfall's first chapter is set, as a
  // CDN edge that has not caught up with the deploy would serve it.
  const BACKDROP = "/assets/biomes/exchange/bg.webp";
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173", { tamper: (path) => path === BACKDROP });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    await phone.goto("/");
    await controlled(phone);
    const saved = (path: string) => phone.evaluate(async (target) => (await caches.match(target, { ignoreSearch: true })) !== undefined, path);
    const fetched = (path: string) =>
      phone.evaluate(async (target) => {
        const response = await fetch(target);
        return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
      }, path);

    // An honest file is saved…
    const honest = "/assets/biomes/exchange/tiles.png";
    expect((await fetched(honest)).ok).toBe(true);
    await expect.poll(() => saved(honest), { timeout: 10_000 }).toBe(true);

    // …a tampered one still reaches the page, but is not kept…
    const first = await fetched(BACKDROP);
    expect(first.ok).toBe(true);
    await proxy.settled(1_000);
    expect(await saved(BACKDROP)).toBe(false);

    // …so the next ask goes back to the network rather than trusting it (a
    // conditional request may come back "not modified", which is fine: the
    // point is that the worker did not answer it from a saved copy).
    proxy.reset();
    await fetched(BACKDROP);
    expect(proxy.report().art.requests).toBeGreaterThan(0);
    expect(await saved(BACKDROP)).toBe(false);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("the Rive runtime arrives while the phone is idle, before any rig needs it", async ({ page }) => {
  // Left out of install (≈2MB the book never uses); asked for once the page
  // is idle (sw/register.ts), so the first character on stage does not wait.
  await page.goto("/");
  await controlled(page);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const bundle = await caches.open("kad-bundle-v1");
          return (await bundle.keys()).some((request) => request.url.endsWith(".wasm"));
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
});

test("the scenes ahead are on a phone showing the world before the party reaches them", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL });
  const phone = await context.newPage();
  try {
    await phone.goto("/");
    await controlled(phone);
    await phone.getByRole("button", { name: /want to host/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/your name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    const code = new URL(phone.url()).pathname.split("/").pop()!;
    await createCharacter(phone, "unicorn", HERO);
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);

    const expected = await readOnUntilArtAhead(phone, code);
    expect(expected.length, "no scene within reach has art of its own").toBeGreaterThan(0);

    // Looking at the world (the only screen in Phone Mode draws it when shown)…
    // The scene's prompt turns the phone to its controls when it arrives, so
    // the tap is repeated until the world stays up.
    const world = phone.getByRole("button", { name: /^world$/i });
    await expect(async () => {
      await world.click({ timeout: 2_000 });
      await expect(world).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass(TAP);
    // …nobody has gone there yet, and its art is already saved.
    for (const url of expected) {
      await expect
        .poll(() => phone.evaluate(async (target) => (await caches.match(target, { ignoreSearch: true })) !== undefined, url), {
          timeout: 20_000,
          message: `${url} was not fetched ahead`,
        })
        .toBe(true);
    }
  } finally {
    await context.close();
  }
});

test("a Party Mode phone with its controls up fetches nothing ahead; the TV does", async ({ browser, baseURL }) => {
  const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, baseURL });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL });
  const tv = await tvContext.newPage();
  const phone = await phoneContext.newPage();
  try {
    await tv.goto("/");
    await controlled(tv);
    await tv.getByRole("button", { name: /want to host/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z0-9]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    await phone.goto("/");
    await controlled(phone);
    await phone.getByLabel(/room code/i).fill(code);
    await phone.getByRole("button", { name: /join a game/i }).click();
    await expect(phone).toHaveURL(new RegExp(`/p/${code}$`));
    await createCharacter(phone, "unicorn", HERO);
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);

    // Read on, answering on the phone, until the story's next steps have art.
    const ahead = await readOnUntilArtAhead(phone, code);
    expect(ahead.length, "no scene within reach has art of its own").toBeGreaterThan(0);
    /** How many of those pictures `page` has saved. */
    const saved = (page: Page) =>
      page.evaluate(
        async (urls) =>
          (await Promise.all(urls.map(async (url) => (await caches.match(url, { ignoreSearch: true })) !== undefined))).filter(Boolean)
            .length,
        ahead,
      );

    // The TV draws the world, so it fetches ahead…
    await expect.poll(() => saved(tv), { timeout: 30_000 }).toBe(ahead.length);
    // …and the phone, showing its controls with the world mounted behind them, does not.
    await phone.waitForTimeout(5_000);
    expect(await saved(phone), "the phone fetched ahead for a world it is not showing").toBe(0);
  } finally {
    await tvContext.close();
    await phoneContext.close();
  }
});
