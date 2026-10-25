/**
 * "It's your turn" on the installed app (#466): asking, subscribing and
 * letting go, for the switch on the Account screen.
 *
 * Asked only there, only when the grown-up flips the switch, and only in the
 * installed app: never on first launch, never in a tab. On an iPhone a push
 * reaches only a Home Screen app, which is the install we ask for anyway; in
 * a Chromium tab it would work, but a tab is not where a family plays from
 * the sofa, and one ask in the one place is easier to explain than two.
 *
 * Lazy: only `PushSwitch` loads this, from the Account screen's own chunk.
 * The server's half is `handlers/push.ts`; the worker's is `sw/sw.ts`.
 */

import type { PushKeyResponse, PushSubscribeRequest } from "@kad/shared";
import { request } from "../sync/client";

/** What the switch can say. */
export type PushStatus =
  /** No push here: an old browser, a tab rather than the app, or a server that sends none. */
  | "hidden"
  /** The grown-up said no in the browser's own prompt; only Settings can undo that. */
  | "blocked"
  | "off"
  | "on";

/** The parts of the browser the decision reads, so it is a test. */
export interface PushEnv {
  supported: boolean;
  installed: boolean;
  permission: NotificationPermission;
  /** This phone belongs to a kid: it has a player's device token, and it is not a family tablet. */
  personal: boolean;
}

/** Whether the switch shows, and how. Pure. */
export function pushStatus(env: PushEnv, server: PushKeyResponse | null, subscribed: boolean): PushStatus {
  if (!env.supported || !env.installed || !env.personal || !server?.enabled) return "hidden";
  if (env.permission === "denied") return "blocked";
  return env.permission === "granted" && subscribed ? "on" : "off";
}

/** Web Push in this browser at all: a worker, a push manager and notifications. */
export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** A base64url VAPID key as the bytes `pushManager.subscribe` takes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Whether a subscription was made with this key (a rotated key needs a new one). */
export function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true;
  const mine = keyBytes(publicKey);
  const theirs = new Uint8Array(key);
  return theirs.length === mine.length && theirs.every((byte, i) => byte === mine[i]);
}

/** The body the server reads: `PushSubscription.toJSON()`, narrowed. `null` if the browser gave less. */
export function subscriptionBody(subscription: PushSubscription): PushSubscribeRequest | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

// ---------------------------------------------------------------------------
// The browser and the server
// ---------------------------------------------------------------------------

/** What the server says: on, and its key, or off. A server that cannot be reached is off. */
export async function fetchPushKey(): Promise<PushKeyResponse | null> {
  try {
    return await request<PushKeyResponse>("/api/push/key");
  } catch {
    return null;
  }
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!pushSupported()) return undefined;
  // `ready` never settles without a worker (a dev build): give up after a moment.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
  ]);
}

/** This phone's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    return (await (await registration())?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

function post(path: string, deviceToken: string, body?: unknown): Promise<unknown> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kad-device-token": deviceToken },
    body: JSON.stringify(body ?? {}),
  });
}

/** Tell the server about a subscription this phone already holds, so the two agree. */
export async function syncSubscription(subscription: PushSubscription, deviceToken: string): Promise<void> {
  const body = subscriptionBody(subscription);
  if (body) await post("/api/push/subscribe", deviceToken, body);
}

export type TurnOnResult = "on" | "blocked" | "dismissed" | "failed";

/**
 * The grown-up flipped the switch on: ask (the browser's own prompt, the only
 * time we do), subscribe, and tell the server. Never throws.
 */
export async function turnOnPush(publicKey: string, deviceToken: string): Promise<TurnOnResult> {
  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "denied") return "blocked";
    if (permission !== "granted") return "dismissed";
    const ready = await registration();
    if (!ready) return "failed";
    let subscription = await ready.pushManager.getSubscription();
    if (subscription && !sameKey(subscription, publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    try {
      await syncSubscription(subscription, deviceToken);
    } catch {
      // The server never heard: take it back, so the switch and the server agree.
      await subscription.unsubscribe().catch(() => false);
      return "failed";
    }
    return "on";
  } catch {
    return "failed";
  }
}

/** The switch went off: let go here and tell the server. Never throws. */
export async function turnOffPush(deviceToken: string): Promise<void> {
  const subscription = await currentSubscription();
  await subscription?.unsubscribe().catch(() => false);
  await post("/api/push/unsubscribe", deviceToken).catch(() => undefined);
}
