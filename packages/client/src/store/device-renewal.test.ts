/**
 * A phone keeps the device token the server renews, and a sign-in record for
 * a household the phone no longer plays in stops saying "Signed in".
 *
 * Both are the playtest report "my old heroes were gone from my phone and I
 * had to make a new one, though I was signed in". The server renews a device
 * token once it is past halfway (architecture §4.5) and sends the new one as
 * `x-kad-device-token`, but the phone never kept it, so every token died 30
 * days after it was first issued however often it played. The next join then
 * made the phone a new player in a new household, and the old sign-in record
 * hid the sign-in that would have found its heroes again.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../sync/client";
import type { Api } from "../sync/client";
import { createKeepsakeStore, type KeepsakeDeps } from "./keepsake";
import {
  defaultStorage,
  deviceTokenClaims,
  keepRenewedDeviceToken,
  loadAccount,
  loadIdentity,
  saveAccount,
  saveIdentity,
  type KeyValueStorage,
} from "./persistence";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Shaped like the server's HS256 device token (`token-identity.ts`); the signature is never read here. */
function deviceToken(claims: { sub: string; hh: string; pid?: string; iat?: number; aud?: string }): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ aud: "device", pid: "p_1", iat: 1, exp: 2_000_000_000, ...claims }),
  );
  return `${header}.${payload}.${b64url("signature")}`;
}

const OLD = deviceToken({ sub: "d_phone", hh: "h_home", iat: 1 });
const RENEWED = deviceToken({ sub: "d_phone", hh: "h_home", iat: 2 });

function playerOn(storage: KeyValueStorage, token: string, householdId = "h_home"): void {
  saveIdentity({ householdId, playerId: "p_1", displayName: "Ada", deviceToken: token }, storage);
}

describe("reading a device token's claims", () => {
  it("names the binding and its household", () => {
    expect(deviceTokenClaims(OLD)).toEqual({ deviceId: "d_phone", householdId: "h_home" });
  });

  it("answers null for anything that is not a personal device token", () => {
    expect(deviceTokenClaims("dev-device.abc")).toBeNull();
    expect(deviceTokenClaims("not a token")).toBeNull();
    expect(deviceTokenClaims("a.!!!.c")).toBeNull();
    expect(deviceTokenClaims(deviceToken({ sub: "d_tab", hh: "h_home", aud: "shared" }))).toBeNull();
  });
});

describe("keeping a renewed token", () => {
  it("replaces the token of the binding it renews, and nothing else", () => {
    const storage = memoryStorage();
    playerOn(storage, OLD);
    expect(keepRenewedDeviceToken(RENEWED, storage)).toBe(true);
    expect(loadIdentity(storage)).toEqual({
      householdId: "h_home",
      playerId: "p_1",
      displayName: "Ada",
      deviceToken: RENEWED,
    });
  });

  it("never puts back a binding the device has moved off since the request left", () => {
    const storage = memoryStorage();
    const paired = deviceToken({ sub: "d_paired", hh: "h_other" });
    playerOn(storage, paired, "h_other");
    expect(keepRenewedDeviceToken(RENEWED, storage)).toBe(false);
    expect(loadIdentity(storage).deviceToken).toBe(paired);
  });

  it("makes nobody out of a device that is nobody", () => {
    const storage = memoryStorage();
    expect(keepRenewedDeviceToken(RENEWED, storage)).toBe(false);
    expect(storage.getItem("kad.device")).toBeNull();
  });

  it("leaves a token it cannot read alone", () => {
    const storage = memoryStorage();
    playerOn(storage, "dev-device.opaque");
    expect(keepRenewedDeviceToken(RENEWED, storage)).toBe(false);
    expect(loadIdentity(storage).deviceToken).toBe("dev-device.opaque");
  });
});

describe("the request funnel keeps the renewal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    defaultStorage().removeItem("kad.device");
  });

  function answering(headers: Record<string, string>): typeof fetch {
    return (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", ...headers },
      })) as typeof fetch;
  }

  it("saves the token a response renews, so the phone outlives its first 30 days", async () => {
    playerOn(defaultStorage(), OLD);
    vi.stubGlobal("fetch", answering({ "x-kad-device-token": RENEWED }));
    await request("/api/room/ABCD/join", { method: "POST", body: "{}" });
    expect(loadIdentity(defaultStorage()).deviceToken).toBe(RENEWED);
  });

  it("changes nothing when no renewal comes back", async () => {
    playerOn(defaultStorage(), OLD);
    vi.stubGlobal("fetch", answering({}));
    await request("/api/journal");
    expect(loadIdentity(defaultStorage()).deviceToken).toBe(OLD);
  });
});

describe("a sign-in record for another household", () => {
  const ACCOUNT = { householdId: "h_home", email: "grown@up.test", claimedAt: "2026-10-12T00:00:00.000Z" };

  it("is this device's while its token names that household", () => {
    const storage = memoryStorage();
    playerOn(storage, OLD);
    saveAccount(ACCOUNT, storage);
    expect(loadAccount(storage)).toEqual(ACCOUNT);
  });

  it("reads as no record once a join has made the phone somebody in another household", () => {
    const storage = memoryStorage();
    playerOn(storage, OLD);
    saveAccount(ACCOUNT, storage);
    // The old token ran out; the join bound the phone as a new player in a new guest household.
    playerOn(storage, deviceToken({ sub: "d_new", hh: "h_guest" }), "h_guest");
    expect(loadAccount(storage)).toBeNull();
    // Kept on disk, not deleted: it is simply not this device's any more.
    expect(storage.getItem("kad.account")).not.toBeNull();
  });

  it("is trusted as before where the token cannot be read, or there is none", () => {
    const opaque = memoryStorage();
    playerOn(opaque, "dev-device.opaque");
    saveAccount(ACCOUNT, opaque);
    expect(loadAccount(opaque)).toEqual(ACCOUNT);

    const none = memoryStorage();
    saveAccount(ACCOUNT, none);
    expect(loadAccount(none)).toEqual(ACCOUNT);
  });
});

describe("the home screen's sign-in", () => {
  function keepsake(storage: KeyValueStorage) {
    const api = {
      fetchConfig: vi.fn(async () => ({ region: "us-east-1", auth: { userPoolId: "pool", clientId: "client" } })),
      probeDevAuth: vi.fn(async () => false),
    } as unknown as Api;
    const deps: KeepsakeDeps = { api, storage, organizer: { begin: vi.fn(async () => undefined), end: vi.fn() } };
    return createKeepsakeStore(deps);
  }

  it("is offered again once the phone plays somewhere its sign-in does not", async () => {
    const storage = memoryStorage();
    playerOn(storage, OLD);
    saveAccount({ householdId: "h_home", email: "grown@up.test", claimedAt: "" }, storage);
    const store = keepsake(storage);
    await store.getState().check();
    expect(store.getState().account?.householdId).toBe("h_home");

    // Same page life: a join replaced the binding with one in a new household.
    playerOn(storage, deviceToken({ sub: "d_new", hh: "h_guest" }), "h_guest");
    await store.getState().check();
    expect(store.getState().account).toBeNull();
  });
});
