/**
 * A deploy while a room is open (#413), against a production build: the one
 * place the service worker exists (playwright.prod.config.ts).
 *
 * The new build's worker takes over the open page at once (`skipWaiting` and
 * `clients.claim`, sw.ts). The page keeps running the build it loaded, whose
 * code the deploy has deleted from the bucket, and must neither go blank nor
 * stop answering: the worker keeps one build back (policy.ts
 * `swStaleBundles`), and the game's state never goes through it at all
 * (`/api` and `/events` pass straight by).
 *
 * The deploy is made by the proxy (counting-proxy.ts), exactly as offline.spec
 * makes one: a rewritten `sw.js` listing none of this build's code, and a
 * bucket that answers 404 for all of it.
 */

import { test, expect, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { startCountingProxy } from "./counting-proxy";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";

const TAP = { timeout: 20_000 } as const;

async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
}

test("a room keeps playing when a new build's worker takes over mid-game", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  const errors: string[] = [];
  phone.on("pageerror", (e) => errors.push(e.message));
  try {
    // --- A phone hosts a room, makes a hero and begins ---
    await phone.goto("/");
    await phone.getByRole("button", { name: /host a game/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/adventurer name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    const code = new URL(phone.url()).pathname.split("/").pop()!;
    await createCharacter(phone, "unicorn", "Moonbeam");
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
    await controlled(phone);
    // This build's worker has finished taking over: it recorded its code.
    await expect
      .poll(() => phone.evaluate(async () => (await caches.match("/__kad/bundle-list")) !== undefined), { timeout: 20_000 })
      .toBe(true);
    // Whatever the launch campaign opens on: a story question, read off the server.
    type Room = { seq: number; sceneId: string | null; prompt: { kind: string; options?: { label: string }[] } | null };
    const room = (): Promise<Room> => roomState<Room>(phone, code);
    await expect.poll(async () => (await room()).prompt?.kind, TAP).toBe("choice");
    const opening = await room();
    const answer = opening.prompt?.options?.[0]?.label ?? "";
    expect(answer).not.toBe("");

    // --- The deploy: a new worker, and none of this build's code left in the bucket ---
    proxy.configure({
      rewrite: (path) =>
        path === "/sw.js"
          ? (text) =>
              text
                .replace(/const __KAD_BUNDLE__ = \[[^\]]*\];/, "const __KAD_BUNDLE__ = [];")
                .replace(/const __KAD_PRECACHE__ = \[[^\]]*\];/, "const __KAD_PRECACHE__ = [];")
          : undefined,
      gone: (path) => path.startsWith("/bundle/"),
    });
    const before = await phone.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "");
    // This is the page that keeps running the old build under the new worker:
    // one not calm enough to reload yet (sw/calm.ts). The reload at the next
    // calm moment is the #456 case below; here it is held back the way a
    // reload a moment ago holds it back, so the old build can be watched.
    await phone.evaluate(() => sessionStorage.setItem("kad-update-reload", String(Date.now())));
    await phone.evaluate(async () => {
      const taken = new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      await (await navigator.serviceWorker.getRegistration())?.update();
      await taken;
    });
    // The new worker is in charge of this very page, with its own (empty) list.
    await expect
      .poll(() => phone.evaluate(async () => (await (await caches.match("/__kad/bundle-list"))?.json()) as unknown), { timeout: 20_000 })
      .toEqual([]);
    expect(await phone.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).toBe(before);

    // --- Not blank, and still the game ---
    expect(await phone.locator("#root > *").count()).toBeGreaterThan(0);
    await openPlayerTask(phone);
    const choices = phone.locator(".prompt .choice");
    await expect(choices.filter({ hasText: answer })).toBeEnabled(TAP);
    await expect(phone.getByText(/couldn.t (load|open)/i)).toHaveCount(0);

    // --- And it still plays: an answer reaches the server and the next scene arrives ---
    await choices.filter({ hasText: answer }).click(TAP);
    await phone.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect.poll(async () => (await room()).seq, TAP).toBeGreaterThan(opening.seq);
    // The page drew what the answer led to, not the question it answered.
    await expect(phone.locator(".prompt__title, .player__task-entry, .prompt .choice").first()).toBeVisible(TAP);
    await expect(phone.getByText(/couldn.t (load|open)/i)).toHaveCount(0);

    // The book, a chunk this page has not imported yet, still opens from the
    // build kept one back.
    await phone.evaluate(() => {
      history.pushState(null, "", "/journal");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(phone.locator(".journal")).toBeVisible(TAP);
    await expect(phone.getByText(/couldn.t open/i)).toHaveCount(0);

    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("the page moves onto the new build only once a half-made answer is confirmed (#456)", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    // --- Into a room, on a question, as in the case above ---
    await phone.goto("/");
    await phone.getByRole("button", { name: /host a game/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/adventurer name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    const code = new URL(phone.url()).pathname.split("/").pop()!;
    await createCharacter(phone, "unicorn", "Moonbeam");
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
    await controlled(phone);
    await expect
      .poll(() => phone.evaluate(async () => (await caches.match("/__kad/bundle-list")) !== undefined), { timeout: 20_000 })
      .toBe(true);
    type Room = { seq: number; prompt: { kind: string; options?: { label: string }[] } | null };
    const room = (): Promise<Room> => roomState<Room>(phone, code);
    await expect.poll(async () => (await room()).prompt?.kind, TAP).toBe("choice");
    const opening = await room();
    const answer = opening.prompt?.options?.[0]?.label ?? "";
    expect(answer).not.toBe("");
    await openPlayerTask(phone);
    const choices = phone.locator(".prompt .choice");
    await expect(choices.filter({ hasText: answer })).toBeEnabled(TAP);

    // Halfway through answering: picked, not yet confirmed. A reload would lose
    // the pick, so this is the moment the page must not move (sw/calm.ts).
    await choices.filter({ hasText: answer }).click(TAP);
    await expect(phone.getByRole("button", { name: /do it!/i })).toBeVisible(TAP);

    // A mark that only this load of the page carries: a reload loses it.
    await phone.evaluate(() => {
      (window as unknown as { __kadLoad: number }).__kadLoad = 1;
    });
    const entry = await phone.evaluate(() => document.querySelector("script[type=module][src]")?.getAttribute("src") ?? "");
    expect(entry).not.toBe("");

    // --- A deploy: a new worker takes over the page mid-answer ---
    proxy.configure({
      rewrite: (path) =>
        path === "/sw.js"
          ? (text) => text.replace(/const __KAD_PRECACHE__ = \[[^\]]*\];/, "const __KAD_PRECACHE__ = [];")
          : undefined,
    });
    await phone.evaluate(async () => {
      const taken = new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      await (await navigator.serviceWorker.getRegistration())?.update();
      await taken;
    });

    // --- Not mid-answer: the page stays, and so does the pick ---
    await phone.waitForTimeout(3_000);
    expect(await phone.evaluate(() => (window as unknown as { __kadLoad?: number }).__kadLoad)).toBe(1);
    await expect(phone.getByRole("button", { name: /do it!/i })).toBeVisible();

    // --- Confirmed: at the next calm moment the page reloads onto the new build ---
    await phone.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect
      .poll(() => phone.evaluate(() => (window as unknown as { __kadLoad?: number }).__kadLoad === undefined), { timeout: 60_000 })
      .toBe(true);

    // --- Same room, same hero, new build's entry script, still playing ---
    await expect(phone).toHaveURL(new RegExp(`/p/${code}$`));
    await expect(phone.locator("script[type=module][src]").first()).toHaveAttribute("src", entry);
    await expect.poll(async () => (await room()).seq, TAP).toBeGreaterThan(opening.seq);
    expect(await phone.locator("#root > *").count()).toBeGreaterThan(0);
    await expect(phone.getByText(/couldn.t (load|open)/i)).toHaveCount(0);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("an unfinished hero survives a worker takeover, and the page moves on once it is made (#456)", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    await phone.goto("/");
    await phone.getByRole("button", { name: /host a game/i }).click();
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/adventurer name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
    const code = new URL(phone.url()).pathname.split("/").pop()!;
    await controlled(phone);
    await expect
      .poll(() => phone.evaluate(async () => (await caches.match("/__kad/bundle-list")) !== undefined), { timeout: 20_000 })
      .toBe(true);

    // --- Halfway through making a hero: a species picked, the class step open ---
    await phone.getByRole("button", { name: /unicorn/i }).first().click(TAP);
    await phone.getByRole("button", { name: /^next$/i }).click(TAP);
    const classChoice = phone
      .locator(".creation-choice, .creation-card, button")
      .filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i })
      .first();
    await expect(classChoice).toBeVisible(TAP);
    await phone.evaluate(() => {
      (window as unknown as { __kadLoad: number }).__kadLoad = 1;
    });

    // --- A deploy: a new worker takes over mid-hero ---
    proxy.configure({
      rewrite: (path) =>
        path === "/sw.js"
          ? (text) => text.replace(/const __KAD_PRECACHE__ = \[[^\]]*\];/, "const __KAD_PRECACHE__ = [];")
          : undefined,
    });
    await phone.evaluate(async () => {
      const taken = new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      await (await navigator.serviceWorker.getRegistration())?.update();
      await taken;
    });

    // --- The draft is the page's alone: no reload while it is open ---
    await phone.waitForTimeout(3_000);
    expect(await phone.evaluate(() => (window as unknown as { __kadLoad?: number }).__kadLoad)).toBe(1);
    await expect(classChoice).toBeVisible();

    // --- The hero is finished: the page moves onto the new build and the hero is there ---
    await classChoice.click(TAP);
    await phone.getByRole("button", { name: /^next$/i }).click(TAP);
    for (let i = 0; i < 12; i++) {
      const adds = phone.getByRole("button", { name: /add a point to/i });
      if ((await adds.count()) === 0) break;
      await adds.first().click(TAP);
    }
    await phone.getByRole("button", { name: /^next$/i }).click(TAP);
    await phone.getByPlaceholder("Tap to type").fill("Moonbeam", TAP);
    // "That's me" is the hero: the draft is saved, the page is calm, and it reloads.
    await phone.getByRole("button", { name: /that's me/i }).click(TAP);
    // The reload can land mid-evaluate; a torn-down context is the reload happening, not a failure.
    await expect
      .poll(
        () => phone.evaluate(() => (window as unknown as { __kadLoad?: number }).__kadLoad === undefined).catch(() => false),
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect(phone).toHaveURL(new RegExp(`/p/${code}$`));
    await expect(phone.getByText("Moonbeam").first()).toBeVisible(TAP);
    await expect(phone.getByText(/couldn.t (load|open)/i)).toHaveCount(0);
  } finally {
    await context.close();
    await proxy.close();
  }
});

// A worker's install or activate failure reaches the crash reporter (#459). A
// real worker cannot be made to post one from here, so the page is handed the
// message the worker would send, through the same `navigator.serviceWorker`
// the listener (report/listen.ts) is attached to.
test("a worker's error message is reported as a kind of failure", async ({ page }) => {
  await page.goto("/");
  await controlled(page);

  const sent = page.waitForRequest((r) => r.url().endsWith("/api/client-error"));
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "kad:sw-error", stage: "install", message: "for Maya in room WXYZ", build: "abc123def456" },
      }),
    );
  });

  const request = await sent;
  const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
  expect(body).toMatchObject({ message: "Error: service worker install failed", stack: [] });
  expect(request.postData()).not.toMatch(/maya|WXYZ/i);
});
