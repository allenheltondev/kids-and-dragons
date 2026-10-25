// @vitest-environment jsdom
/**
 * "It's your turn" on the installed app (#466): when the Account screen's
 * switch shows, what flipping it asks and sends, and what turning it off
 * lets go of. The worker's half is sw/sw.test.ts; the whole path, in a real
 * production build, is e2e/push.spec.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PushSwitch } from "./PushSwitch";
import { keyBytes, pushStatus, sameKey, subscriptionBody, turnOffPush, turnOnPush, type PushEnv } from "./push";

const KEY = "BNbxGYNMhEIi9zrneh7mqV4oUanjLUK3m-mYZBc62frMKrEoMk88r3Lk596T0ck9xlT-aok0-qiaiG9Dbzm9vY0";

const here: PushEnv = { supported: true, installed: true, permission: "default", personal: true };

describe("when the switch shows", () => {
  const on = { enabled: true as const, publicKey: KEY };

  it("only in the installed app, on a kid's own phone, with a server that sends pushes", () => {
    expect(pushStatus(here, on, false)).toBe("off");
    expect(pushStatus({ ...here, installed: false }, on, false)).toBe("hidden");
    expect(pushStatus({ ...here, supported: false }, on, false)).toBe("hidden");
    expect(pushStatus({ ...here, personal: false }, on, false)).toBe("hidden");
    expect(pushStatus(here, { enabled: false }, false)).toBe("hidden");
    expect(pushStatus(here, null, false)).toBe("hidden");
  });

  it("is on only with permission and a subscription, and says when the phone said no", () => {
    expect(pushStatus({ ...here, permission: "granted" }, on, true)).toBe("on");
    expect(pushStatus({ ...here, permission: "granted" }, on, false)).toBe("off");
    expect(pushStatus({ ...here, permission: "default" }, on, true)).toBe("off");
    expect(pushStatus({ ...here, permission: "denied" }, on, false)).toBe("blocked");
  });
});

describe("keys and bodies", () => {
  it("decodes a base64url VAPID key into its 65 bytes", () => {
    const bytes = keyBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it("knows a subscription made with another key", () => {
    const made = (key: string) => ({ options: { applicationServerKey: keyBytes(key).buffer } }) as unknown as PushSubscription;
    expect(sameKey(made(KEY), KEY)).toBe(true);
    expect(sameKey(made(`${KEY.slice(0, -2)}AA`), KEY)).toBe(false);
  });

  it("sends the server the endpoint and keys, and nothing else", () => {
    const subscription = {
      toJSON: () => ({ endpoint: "https://push.example/1", expirationTime: null, keys: { p256dh: "pub", auth: "sec" } }),
    } as unknown as PushSubscription;
    expect(subscriptionBody(subscription)).toEqual({ endpoint: "https://push.example/1", keys: { p256dh: "pub", auth: "sec" } });
    expect(subscriptionBody({ toJSON: () => ({ endpoint: "https://push.example/1" }) } as unknown as PushSubscription)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The browser, faked
// ---------------------------------------------------------------------------

interface FakeBrowser {
  permission: NotificationPermission;
  answer: NotificationPermission;
  subscription: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn>; toJSON: () => unknown; options: unknown } | null;
  subscribe: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  calls: { path: string; body: unknown; token: string | null }[];
}

function fakeBrowser(options: { serverOn?: boolean; installed?: boolean; failSubscribe?: boolean } = {}): FakeBrowser {
  const browser: FakeBrowser = {
    permission: "default",
    answer: "granted",
    subscription: null,
    subscribe: vi.fn(),
    requestPermission: vi.fn(),
    fetch: vi.fn(),
    calls: [],
  };
  const made = () => {
    const subscription = {
      endpoint: "https://push.example/me",
      options: { applicationServerKey: keyBytes(KEY).buffer },
      toJSON: () => ({ endpoint: "https://push.example/me", keys: { p256dh: "pub", auth: "sec" } }),
      unsubscribe: vi.fn(async () => {
        browser.subscription = null;
        return true;
      }),
    };
    browser.subscription = subscription;
    return subscription;
  };
  browser.subscribe.mockImplementation(async () => made());
  browser.requestPermission.mockImplementation(async () => {
    browser.permission = browser.answer;
    return browser.answer;
  });
  const pushManager = { getSubscription: async () => browser.subscription, subscribe: browser.subscribe };
  vi.stubGlobal("Notification", {
    get permission() {
      return browser.permission;
    },
    requestPermission: browser.requestPermission,
  });
  vi.stubGlobal("PushManager", function PushManager() {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  window.matchMedia = ((query: string) => ({ matches: options.installed !== false && query.includes("standalone") })) as typeof window.matchMedia;
  browser.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    browser.calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined, token: headers["x-kad-device-token"] ?? null });
    if (path === "/api/push/key") {
      return new Response(JSON.stringify(options.serverOn === false ? { enabled: false } : { enabled: true, publicKey: KEY }));
    }
    if (path === "/api/push/subscribe" && options.failSubscribe) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ ok: true }));
  });
  vi.stubGlobal("fetch", browser.fetch);
  return browser;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("kad.device", JSON.stringify({ householdId: "h_1", playerId: "p_1", displayName: "", deviceToken: "dev-token" }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("turning it on and off", () => {
  it("asks once, subscribes with the key and userVisibleOnly, and tells the server by the device token", async () => {
    const browser = fakeBrowser();
    expect(await turnOnPush(KEY, "dev-token")).toBe("on");
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) });
    expect(browser.calls).toEqual([
      { path: "/api/push/subscribe", body: { endpoint: "https://push.example/me", keys: { p256dh: "pub", auth: "sec" } }, token: "dev-token" },
    ]);
  });

  it("subscribes nothing when the grown-up says no, or waves the prompt away", async () => {
    const browser = fakeBrowser();
    browser.answer = "denied";
    expect(await turnOnPush(KEY, "dev-token")).toBe("blocked");
    browser.permission = "default";
    browser.answer = "default";
    expect(await turnOnPush(KEY, "dev-token")).toBe("dismissed");
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(browser.calls).toEqual([]);
  });

  it("takes the subscription back when the server never heard of it", async () => {
    const browser = fakeBrowser({ failSubscribe: true });
    expect(await turnOnPush(KEY, "dev-token")).toBe("failed");
    expect(browser.subscription).toBeNull();
  });

  it("lets go here and tells the server when it goes off", async () => {
    const browser = fakeBrowser();
    await turnOnPush(KEY, "dev-token");
    const held = browser.subscription;
    await turnOffPush("dev-token");
    expect(held?.unsubscribe).toHaveBeenCalled();
    expect(browser.calls.at(-1)).toMatchObject({ path: "/api/push/unsubscribe", token: "dev-token" });
  });
});

describe("the switch on the Account screen", () => {
  it("never asks for permission just by showing", async () => {
    const browser = fakeBrowser();
    render(<PushSwitch />);
    expect(await screen.findByRole("switch", { name: /their turn/i })).toHaveProperty("ariaChecked", "false");
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(screen.getByText(/It’s your turn in Kids & Dragons/)).toBeTruthy();
  });

  it("asks when flipped on, and shows on", async () => {
    const browser = fakeBrowser();
    render(<PushSwitch />);
    const toggle = await screen.findByRole("switch");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("switch")).getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(browser.calls.at(-1)?.path).toBe("/api/push/unsubscribe");
  });

  it("says where to go when the phone has said no", async () => {
    const browser = fakeBrowser();
    browser.permission = "denied";
    render(<PushSwitch />);
    expect(await screen.findByText(/in this phone's settings/)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("draws nothing in a tab, on a family tablet, or when the server sends no pushes", async () => {
    fakeBrowser({ installed: false });
    const { container, unmount } = render(<PushSwitch />);
    await act(async () => undefined);
    expect(container.innerHTML).toBe("");
    unmount();

    fakeBrowser({ serverOn: false });
    const second = render(<PushSwitch />);
    await act(async () => undefined);
    expect(second.container.innerHTML).toBe("");
    second.unmount();

    const browser = fakeBrowser();
    localStorage.setItem("kad.shared", JSON.stringify({ householdId: "h_1", token: "t" }));
    const third = render(<PushSwitch />);
    await act(async () => undefined);
    expect(third.container.innerHTML).toBe("");
    expect(browser.calls).toEqual([]);
  });
});
