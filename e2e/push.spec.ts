/**
 * "It's your turn" on the installed app (#466), against a production build:
 * the one place the service worker exists (playwright.prod.config.ts).
 *
 * The whole client half, in a real Chromium: the Account screen's switch in
 * the installed app, the browser's notification permission, the subscription
 * reaching the server, a push arriving at the registered worker and showing
 * the notice in the fixed words, and the switch letting go again.
 *
 * Two things are stood in for, because a test cannot have them:
 *
 * - **The browser's push service.** Headless Chromium has none to subscribe
 *   to, so `PushManager.subscribe` is stubbed before the page loads to hand
 *   back a subscription shaped as a real one is. The push itself is delivered
 *   to the worker through DevTools (`ServiceWorker.deliverPushMessage`), the
 *   same door the DevTools "Push" button uses.
 * - **The server's push service.** The dev server runs with `KAD_PUSH=record`
 *   (playwright.prod.config.ts): it hands out a key and keeps what it would
 *   send for `GET /api/dev/push` rather than sending it anywhere.
 *
 * Whether a real iPhone's Home Screen app and an installed Android app buzz
 * with the phone locked is device QA (docs/pwa-device-qa.md), not something
 * Chromium can show. "Installed" is emulated as install-guidance.spec does.
 */

import { test, expect, type Page } from "@playwright/test";

const TAP = { timeout: 20_000 } as const;
const BODY = "It's your turn in Kids & Dragons";
const SWITCH = /tell this phone when it.s their turn/i;
const ENDPOINT = "https://push.example/e2e-subscription";

/** Before any page script: an installed app, and a push manager that subscribes without a push service. */
function installedWithStubbedPush(endpoint: string): void {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string): MediaQueryList => {
    if (!/display-mode:\s*standalone/.test(query)) return original(query);
    const quiet = (): void => undefined;
    return {
      matches: true,
      media: query,
      onchange: null,
      addEventListener: quiet,
      removeEventListener: quiet,
      addListener: quiet,
      removeListener: quiet,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };

  // A P-256 public key and an auth secret, base64url, as a browser's would be.
  const p256dh = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
  const auth = "tBHItJI5svbpez7KI4CCXg";
  // Kept across a reload, as a real browser keeps its subscription.
  const KEPT = "e2e.push-subscribed";
  const make = (options: PushSubscriptionOptionsInit | undefined): PushSubscription =>
    ({
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: options?.userVisibleOnly ?? false, applicationServerKey: (options?.applicationServerKey as ArrayBuffer) ?? null },
      getKey: () => null,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEPT);
        return true;
      },
    }) as unknown as PushSubscription;
  const asked: PushSubscriptionOptionsInit[] = [];
  (window as unknown as { pushAsked: PushSubscriptionOptionsInit[] }).pushAsked = asked;
  PushManager.prototype.subscribe = async function subscribe(options?: PushSubscriptionOptionsInit) {
    asked.push({ userVisibleOnly: options?.userVisibleOnly ?? false });
    localStorage.setItem(KEPT, "1");
    return make(options);
  };
  PushManager.prototype.getSubscription = async function getSubscription() {
    return localStorage.getItem(KEPT) === "1" ? make(undefined) : null;
  };
}

async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
}

async function deviceToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("kad.device");
    return raw ? ((JSON.parse(raw) as { deviceToken?: string }).deviceToken ?? "") : "";
  });
}

interface DevPush {
  subscriptions: { endpoint: string; keys: { p256dh: string; auth: string } }[];
  sent: unknown[];
}

test("the installed app's switch subscribes, the worker shows the turn, and the switch lets go", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = baseURL ?? "http://localhost:4173";
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.grantPermissions(["notifications"], { origin });
  await context.addInitScript(installedWithStubbedPush, ENDPOINT);
  const phone = await context.newPage();
  const errors: string[] = [];
  phone.on("pageerror", (e) => errors.push(e.message));

  try {
    // --- A kid's own phone: the installed app, a fresh start, a room hosted from it ---
    await phone.goto("/");
    await phone.getByRole("button", { name: /start fresh/i }).click(TAP);
    await phone.getByRole("button", { name: /host a game/i }).click(TAP);
    await phone.getByText("Phone Mode").click();
    await phone.getByLabel(/adventurer name/i).fill("Ada");
    await phone.getByRole("button", { name: /^start a game$/i }).click();
    await expect(phone).toHaveURL(/\/p\/[A-Z0-9]{4}$/, TAP);
    const code = new URL(phone.url()).pathname.split("/").pop() ?? "";
    await expect.poll(() => deviceToken(phone), TAP).not.toBe("");
    const token = await deviceToken(phone);
    await controlled(phone);

    const server = async (): Promise<DevPush> => {
      const response = await phone.request.get("/api/dev/push", { headers: { "x-kad-device-token": token } });
      expect(response.ok()).toBe(true);
      return (await response.json()) as DevPush;
    };
    // What the server holds is read by polling throughout: anything it does
    // about a push happens after its response (the push sender's job, #466).
    await expect.poll(async () => (await server()).subscriptions, TAP).toEqual([]);

    // --- The grown-up's place: Account. Showing the switch asks nothing ---
    await phone.goto("/account");
    const toggle = phone.getByRole("switch", { name: SWITCH });
    await expect(toggle).toBeVisible(TAP);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(phone.getByText(/It’s your turn in Kids & Dragons/)).toBeVisible();

    // --- Flipped on: subscribed, visibly, and the server has it by this phone's token ---
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", TAP);
    expect(await phone.evaluate(() => (window as unknown as { pushAsked: unknown[] }).pushAsked)).toEqual([{ userVisibleOnly: true }]);
    await expect.poll(async () => (await server()).subscriptions.map((s) => s.endpoint), TAP).toEqual([ENDPOINT]);

    // --- A push reaches the registered worker, and the notice says only the sentence ---
    const cdp = await context.newCDPSession(phone);
    const registrations: { registrationId: string; scopeURL: string; isDeleted?: boolean }[] = [];
    cdp.on("ServiceWorker.workerRegistrationUpdated", (event: { registrations: typeof registrations }) => {
      registrations.push(...event.registrations);
    });
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => registrations.filter((r) => !r.isDeleted && r.scopeURL.startsWith(origin)).length, TAP).toBeGreaterThan(0);
    const registrationId = registrations.find((r) => !r.isDeleted && r.scopeURL.startsWith(origin))!.registrationId;
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId,
      // Words of its own, which the worker must never show (#320).
      data: JSON.stringify({ title: "Ada's turn!", body: "Ada, roll for the troll", url: `/p/${code}` }),
    });

    type Shown = { title: string; body: string; tag: string; data: { url?: string } };
    const shown = (): Promise<Shown[]> =>
      phone.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return (await registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data as { url?: string } }));
      });
    await expect.poll(async () => (await shown()).length, TAP).toBe(1);
    expect(await shown()).toEqual([{ title: "Kids & Dragons", body: BODY, tag: "kad-turn", data: { url: `/p/${code}` } }]);

    // A second turn replaces the first rather than stacking.
    await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: JSON.stringify({ url: `/p/${code}` }) });
    await expect.poll(async () => (await shown()).length, TAP).toBe(1);

    // --- Flipped off: let go here, and the server forgets this phone ---
    await phone.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true", TAP);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", TAP);
    await expect.poll(async () => (await server()).subscriptions, TAP).toEqual([]);

    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a tab is never offered the switch", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const tab = await context.newPage();
  try {
    await tab.goto("/");
    await tab.getByRole("button", { name: /host a game/i }).click(TAP);
    await tab.getByText("Phone Mode").click();
    await tab.getByLabel(/adventurer name/i).fill("Ada");
    await tab.getByRole("button", { name: /^start a game$/i }).click();
    await expect(tab).toHaveURL(/\/p\/[A-Z0-9]{4}$/, TAP);
    await expect.poll(() => deviceToken(tab), TAP).not.toBe("");
    await tab.goto("/account");
    await expect(tab.getByRole("heading", { name: /accounts and devices/i })).toBeVisible(TAP);
    await expect(tab.getByRole("switch", { name: SWITCH })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
