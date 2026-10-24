/**
 * The adventure book with no signal — on a reload, and in a new tab — against
 * a production build, where the service worker lives
 * (playwright.prod.config.ts; `npm run e2e:prod`).
 *
 * The review that asked for this was exact about the gap: going offline in a
 * tab that already had everything loaded proves nothing, because the page,
 * its code, the content and the map painting were all already in memory. So:
 * play a little, open the book once with a signal, then drop the network and
 * *reload*, and open it again in a fresh tab — and the hero, the map's
 * painting, the Story page and the Field Guide must all still be there.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { startCountingProxy, type CountingProxy } from "./counting-proxy";

const TAP = { timeout: 20_000 } as const;
const BOOK = /open your book/i;
const HERO = "Moonbeam";

/** True once the service worker controls the page. */
async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
}

/**
 * Whether the worker has kept `url` in any of its caches — under any
 * fingerprint, since art is saved as `path?v=<fingerprint>`.
 */
async function kept(page: Page, url: string): Promise<boolean> {
  return page.evaluate(async (target) => (await caches.match(target, { ignoreSearch: true })) !== undefined, url);
}

/** At least one map image actually drawn — a broken image has no natural width. */
async function paintingShown(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>("img.atlas__painting, img.atlas__tile")].some(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
}

async function studyTheBook(page: Page): Promise<void> {
  const tray = page.getByRole("navigation", { name: "What to look at" });
  await expect(page.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);

  await tray.getByRole("button", { name: "Map" }).click(TAP);
  await expect(page.getByText(/^Last seen in /)).toBeVisible(TAP);
  await expect.poll(() => paintingShown(page), { timeout: 20_000 }).toBe(true);

  // The Story page (#358) is its own chunk, and the saved copy carries its words.
  // It is the hero's own, so it opens from the Hero page.
  await tray.getByRole("button", { name: "Hero" }).click(TAP);
  await page.getByRole("navigation", { name: "About you" }).getByRole("button", { name: "Story" }).click(TAP);
  await expect(page.getByRole("heading", { name: "The story so far" })).toBeVisible(TAP);
  await expect(page.getByText(/no story yet/i)).toBeVisible(TAP);

  await tray.getByRole("button", { name: "Guide" }).click(TAP);
  const guide = page.getByRole("region", { name: "Field Guide" });
  await expect(guide.getByText(/^[1-9]\d* of \d+ found$/)).toBeVisible(TAP);
  // Open the find itself, whichever section it is in.
  for (const tab of await guide.getByRole("tab").all()) {
    await tab.click(TAP);
    const found = guide.locator("button.field-guide__card:not([disabled])");
    if ((await found.count()) === 0) continue;
    await found.first().click(TAP);
    await expect(guide.getByTestId("guide-detail")).toBeVisible(TAP);
    return;
  }
  throw new Error("the guide says something is found, but no section shows it");
}

/**
 * No signal, for real: the page offline and the server unreachable. Taking the
 * page offline alone is not enough (counting-proxy.ts `down`): a service
 * worker's own fetches can still get through Playwright's offline switch.
 */
async function noSignal(context: BrowserContext, proxy: CountingProxy, page: Page): Promise<void> {
  proxy.configure({ down: true });
  await context.setOffline(true);
  // Proof: a picture nothing saved, which the worker would fetch itself,
  // fails outright rather than coming back as the server's 404.
  const reached = await page.evaluate(() =>
    fetch(`/assets/never-saved-${String(Date.now())}.png`).then(() => true, () => false),
  );
  expect(reached, "the worker could still reach the server").toBe(false);
}

test("the adventure book opens on a reload and in a new tab with no signal", async ({ browser, baseURL }) => {
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();

  // --- Online: the worker installs, a little play, the book opened once ---
  await phone.goto("/");
  await controlled(phone);

  await phone.getByRole("button", { name: /host a game/i }).click();
  await phone.getByText("Phone Mode").click();
  await phone.getByLabel(/adventurer name/i).fill("Ada");
  await phone.getByRole("button", { name: /^start a game$/i }).click();
  await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
  await createCharacter(phone, "unicorn", HERO);
  await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);
  await expect(phone.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);

  await phone.goto("/");
  await phone.getByRole("button", { name: BOOK }).click(TAP);
  await studyTheBook(phone);

  // The book saved its art while it had a signal (sw/warm.ts).
  const painting = await phone.evaluate(async () => {
    const world = (await (await fetch("/content/world.json")).json()) as { image: { src: string } };
    return world.image.src;
  });
  await expect.poll(() => kept(phone, painting), { timeout: 30_000 }).toBe(true);

  // --- No signal: a reload ---
  await noSignal(context, proxy, phone);
  await phone.reload();
  await expect(phone.getByText(/no signal/i).first()).toBeVisible(TAP);
  await studyTheBook(phone);

  // --- No signal: a fresh tab, straight to the book ---
  const tab = await context.newPage();
  await tab.goto("/journal");
  await expect(tab.getByText(/no signal/i)).toBeVisible(TAP);
  await studyTheBook(tab);

  await context.close();
  await proxy.close();
});

test("the book saves its art even when it opens before the worker has taken over", async ({ browser, baseURL }) => {
  // The worker's script is held back a few seconds, so the book is certainly
  // open before any worker controls the page — on a fast machine the race is
  // otherwise won by the worker, and the test would prove nothing. The book
  // waits up to a minute for one (warm.ts `controlled`).
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173", {
    delay: (path) => (path === "/sw.js" ? 5_000 : 0),
  });
  // A phone that played before it had a worker: an identity, and no worker yet.
  const earlier = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
    baseURL: proxy.url,
  });
  const before = await earlier.newPage();
  await before.goto("/");
  await before.getByRole("button", { name: /host a game/i }).click();
  await before.getByText("Phone Mode").click();
  await before.getByLabel(/adventurer name/i).fill("Ada");
  await before.getByRole("button", { name: /^start a game$/i }).click();
  await expect(before).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
  await createCharacter(before, "unicorn", HERO);
  await before.getByRole("button", { name: /begin the adventure/i }).click(TAP);
  await expect(before.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
  const identity = await earlier.storageState({ indexedDB: true });
  await earlier.close();

  // Its first visit with a worker goes straight to the book, which is open —
  // and wants its art saved — before any worker controls the page.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: identity,
    baseURL: proxy.url,
  });
  const phone = await context.newPage();
  try {
    await phone.goto("/journal");
    await expect(phone.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);
    expect(
      await phone.evaluate(() => navigator.serviceWorker.controller === null),
      "a worker already controlled the page, so this did not test the race",
    ).toBe(true);

    const painting = await phone.evaluate(async () => {
      const world = (await (await fetch("/content/world.json")).json()) as { image: { src: string } };
      return world.image.src;
    });
    await expect.poll(() => kept(phone, painting), { timeout: 60_000 }).toBe(true);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("a tab left open across a deploy can still open the book", async ({ browser, baseURL }) => {
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    // A tab on this build, which has never opened the book: its code for the
    // book is a chunk it has not imported yet.
    await phone.goto("/");
    await controlled(phone);
    await expect
      .poll(() => phone.evaluate(async () => (await caches.match("/__kad/bundle-list")) !== undefined), { timeout: 20_000 })
      .toBe(true);

    // The deploy: a new worker whose build lists none of this build's code,
    // and a bucket that no longer has it (scripts/deploy.sh syncs `--delete`).
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
    // This is the tab that stays on the old build: one that is not calm enough
    // to move onto the new one yet (sw/calm.ts). The reload itself, at the next
    // calm moment, is worker-update.spec's case; here it is held back the way
    // a reload a moment ago holds it back, so the old tab can be watched.
    await phone.evaluate(() => sessionStorage.setItem("kad-update-reload", String(Date.now())));
    await phone.evaluate(async () => {
      const taken = new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      await (await navigator.serviceWorker.getRegistration())?.update();
      await taken;
    });
    // The new worker has recorded its own (empty) list: it has finished taking over.
    await expect
      .poll(() => phone.evaluate(async () => (await (await caches.match("/__kad/bundle-list"))?.json()) as unknown), { timeout: 20_000 })
      .toEqual([]);

    // The old tab opens the book for the first time, importing the old build's chunk.
    await phone.evaluate(() => {
      history.pushState(null, "", "/journal");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(phone.getByText(/your adventure book is empty/i)).toBeVisible(TAP);
    await expect(phone.getByText(/couldn.t open/i)).toHaveCount(0);
  } finally {
    await context.close();
    await proxy.close();
  }
});

/** Host Phone Mode, make the hero, start the chapter: a phone that has played. */
async function playALittle(page: Page): Promise<void> {
  await page.getByRole("button", { name: /host a game/i }).click();
  await page.getByText("Phone Mode").click();
  await page.getByLabel(/adventurer name/i).fill("Ada");
  await page.getByRole("button", { name: /^start a game$/i }).click();
  await expect(page).toHaveURL(/\/p\/[A-Z0-9]{4}$/);
  await createCharacter(page, "unicorn", HERO);
  await page.getByRole("button", { name: /begin the adventure/i }).click(TAP);
  await expect(page.getByRole("button", { name: /begin the adventure/i })).toHaveCount(0, TAP);
}

/** The map painting's URL, from the world key. */
async function paintingUrl(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const world = (await (await fetch("/content/world.json")).json()) as { image: { src: string } };
    return world.image.src;
  });
}

test("a deploy whose content an edge has not caught up with never takes over", async ({ browser, baseURL }) => {
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    await phone.goto("/");
    await controlled(phone);
    await playALittle(phone);
    await phone.goto("/");
    await phone.getByRole("button", { name: BOOK }).click(TAP);
    await studyTheBook(phone);

    // The deploy: its file index gives the Field Guide a new fingerprint, but
    // the edge still serves the old bytes. (The index URL gains a query so
    // the new worker fetches it rather than reading the old build's copy.)
    const worker = await phone.evaluate(async () => (await fetch("/sw.js")).text());
    const index = /const __KAD_FILE_INDEX__ = "([^"]+)";/.exec(worker)?.[1];
    expect(index, "sw.js names no file index").toBeTruthy();
    proxy.configure({
      rewrite: (path) =>
        path === "/sw.js"
          ? (text) =>
              text.replace(
                `const __KAD_FILE_INDEX__ = "${index!}";`,
                `const __KAD_FILE_INDEX__ = "${index!}?deploy=2";`,
              )
          : path === index
            ? (text) => JSON.stringify({ ...(JSON.parse(text) as object), "/content/field-guide.json": "ffffffffffffffff" })
            : path === "/"
              ? // The deploy's page: its own entry script, as every build's
                // is, and marked so the offline app can be told apart.
                (text) =>
                  text
                    .replace("<head>", "<head><!-- deploy 2 -->")
                    .replace(/(<script\b[^>]*\bsrc=")\/bundle\/[^"]+\.js"/, '$1/bundle/deploy-2.js"')
              : undefined,
    });
    proxy.reset();
    const after = await phone.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update().catch(() => undefined);
      // Long enough to install (or fail to); a takeover would be over by then.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return { waiting: registration?.waiting !== null, installing: registration?.installing !== null };
    });
    expect(proxy.report().bundle.requests, "the new worker never asked for its file index").toBeGreaterThan(0);
    expect(after).toEqual({ waiting: false, installing: false });

    // Still online, the phone opens the app and the old worker is handed the
    // deploy's page. It must not keep it: its scripts are not this build's.
    await phone.goto("/");
    expect(await phone.content(), "the deploy's page was not served").toContain("deploy 2");
    await phone.waitForTimeout(1_000);

    // The old worker is still in charge, with all its copies: the book opens
    // with no signal, Field Guide and all.
    await noSignal(context, proxy, phone);
    await phone.goto("/journal");
    // The failed install's page was never made the offline app.
    expect(await phone.content(), "the failed deploy's page became the offline app").not.toContain("deploy 2");
    await expect(phone.getByText(/no signal/i).first()).toBeVisible(TAP);
    await studyTheBook(phone);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("pictures an earlier worker saved survive the upgrade to this one", async ({ browser, baseURL }) => {
  // #224's worker kept the book's pictures in `kad-image-v1`. The new
  // worker's script is held back so that cache can be put in place first,
  // exactly as the earlier worker would have left it.
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173", {
    delay: (path) => (path === "/sw.js" ? 5_000 : 0),
  });
  // A phone that has played and opened its book (so it has a saved journal),
  // before this worker existed.
  const earlier = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", baseURL: proxy.url });
  const before = await earlier.newPage();
  await before.goto("/");
  await playALittle(before);
  await before.goto("/");
  await before.getByRole("button", { name: BOOK }).click(TAP);
  await expect(before.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);
  // The saved journal lives in IndexedDB now (#458), so it has to travel too.
  const identity = await earlier.storageState({ indexedDB: true });
  await earlier.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: identity, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    await phone.goto("/");
    const painting = await paintingUrl(phone);
    await phone.evaluate(async (url) => {
      const legacy = await caches.open("kad-image-v1");
      await legacy.put(url, await fetch(url));
    }, painting);
    expect(await phone.evaluate(() => navigator.serviceWorker.controller === null), "the worker arrived before the old cache was in place").toBe(true);

    await controlled(phone);
    // Adopted into the fingerprinted cache, and the old cache is gone.
    await expect.poll(() => phone.evaluate(() => caches.has("kad-image-v1")), { timeout: 20_000 }).toBe(false);
    expect(await kept(phone, painting)).toBe(true);

    // And the book, opened with no signal, still has its map.
    await noSignal(context, proxy, phone);
    await phone.goto("/journal");
    await expect(phone.getByText(/no signal/i).first()).toBeVisible(TAP);
    await phone.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "Map" }).click(TAP);
    await expect.poll(() => paintingShown(phone), { timeout: 20_000 }).toBe(true);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("Data Saver skips guessing ahead, not the book's offline art", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  });
  const phone = await context.newPage();
  try {
    await phone.goto("/");
    await controlled(phone);
    await playALittle(phone);
    await phone.goto("/");
    await phone.getByRole("button", { name: BOOK }).click(TAP);
    // Only the hero is looked at; the map and the guide are never opened.
    await expect(phone.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);
    const painting = await paintingUrl(phone);
    await expect.poll(() => kept(phone, painting), { timeout: 30_000 }).toBe(true);
  } finally {
    await context.close();
  }
});

test("an upgrade with many saved pictures takes over promptly, keeping them all", async ({ browser, baseURL }) => {
  // #224's worker could keep up to 400 pictures. Adopting them one pause at a
  // time held the new worker's takeover for minutes; it must be a batch.
  // No worker until the old cache is in place: putting 60 pictures takes a
  // while, and the worker would otherwise arrive partway through.
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173", { gone: (path) => path === "/sw.js" });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  try {
    // The build's file index, read straight from the server: the proxy is withholding sw.js.
    const worker = await (await fetch(`${baseURL ?? "http://localhost:4173"}/sw.js`)).text();
    const index = /const __KAD_FILE_INDEX__ = "([^"]+)";/.exec(worker)?.[1] ?? "";
    await phone.goto("/");
    const pictures = await phone.evaluate(async (index) => {
      const files = (await (await fetch(index)).json()) as Record<string, string>;
      const chosen = Object.keys(files).filter((path) => /^\/assets\/(?:characters|character-rigs)\/.*\.(?:png|webp)$/.test(path)).slice(0, 60);
      const legacy = await caches.open("kad-image-v1");
      for (const path of chosen) await legacy.put(path, await fetch(path));
      return chosen;
    }, index);
    expect(pictures).toHaveLength(60);
    expect(await phone.evaluate(() => navigator.serviceWorker.controller === null), "the worker arrived before the old cache was in place").toBe(true);

    proxy.configure({});
    const started = Date.now();
    await phone.reload();
    await controlled(phone);
    await expect.poll(() => phone.evaluate(() => caches.has("kad-image-v1")), { timeout: 60_000 }).toBe(false);
    const took = Date.now() - started;
    // Install and adoption together, on a fast local network.
    expect(took, `taking over took ${String(took)}ms`).toBeLessThan(15_000);
    for (const path of pictures) expect(await kept(phone, path), `${path} was lost in the upgrade`).toBe(true);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("a page load on a network that hangs opens the saved book within a few seconds", async ({ browser, baseURL }) => {
  // A captive portal or one bar of signal: the page's request is not refused,
  // it is held. The worker waits about three seconds (policy.ts
  // `SW_SHELL_TIMEOUT_MS`), then shows the saved app (#454).
  const proxy = await startCountingProxy(baseURL ?? "http://localhost:4173");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: proxy.url });
  const phone = await context.newPage();
  const errors: string[] = [];
  phone.on("pageerror", (error) => errors.push(error.message));
  try {
    await phone.goto("/");
    await controlled(phone);
    await playALittle(phone);
    // The saved app is in place (activate made the staged page the saved one).
    await expect
      .poll(() => phone.evaluate(async () => (await (await caches.open("kad-shell-v1")).match("/")) !== undefined), { timeout: 20_000 })
      .toBe(true);

    // Every page load now stalls far longer than the worker waits.
    proxy.configure({ delay: (path) => (path === "/" || path === "/journal" || /^\/p\//.test(path) ? 20_000 : 0) });
    const started = Date.now();
    await phone.goto("/journal", { timeout: 15_000 });
    await expect(phone.getByRole("region", { name: `${HERO}'s character sheet` })).toBeVisible(TAP);
    const took = Date.now() - started;
    expect(took, `the book took ${String(took)}ms behind a hung network`).toBeLessThan(10_000);
    expect(errors, "the page threw while the network hung").toEqual([]);
  } finally {
    await context.close();
    await proxy.close();
  }
});
