import { describe, expect, it, vi } from "vitest";
import {
  loadAccount,
  loadIdentity,
  loadPlayerDeviceToken,
  saveAccount,
  saveIdentity,
  type KeyValueStorage,
} from "./persistence";
import { normalizePairingInput, pairingFromSearch, pairingUrl } from "../router";
import { pairThisDevice } from "./pairing";

function memory(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const bound = { deviceToken: "tok_new", householdId: "h_ada", playerId: "p_ada", displayName: "Ada" };

describe("pairing links", () => {
  it("round-trips a code through the link a QR carries", () => {
    const url = new URL(pairingUrl("https://play.example", "ABCDEFGH"));
    expect(url.origin).toBe("https://play.example");
    expect(pairingFromSearch(url.search)).toBe("ABCDEFGH");
  });

  it("reads a code however it was typed, and nothing from a link without one", () => {
    expect(normalizePairingInput("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizePairingInput("ABCD EFGH JKLM")).toBe("ABCDEFGH");
    expect(pairingFromSearch("?pair=abcd-efgh")).toBe("ABCDEFGH");
    expect(pairingFromSearch("?pair=")).toBeNull();
    expect(pairingFromSearch("?other=1")).toBeNull();
  });
});

describe("pairing this device", () => {
  it("keeps the binding it was given, as her", async () => {
    const storage = memory();
    const api = { redeemPairingCode: vi.fn(async () => bound) };

    expect(await pairThisDevice("ABCDEFGH", { api, storage })).toEqual({ displayName: "Ada" });

    expect(api.redeemPairingCode).toHaveBeenCalledWith("ABCDEFGH", undefined);
    expect(loadPlayerDeviceToken(storage)).toBe("tok_new");
    expect(loadIdentity(storage)).toMatchObject({ householdId: "h_ada", playerId: "p_ada", displayName: "Ada" });
  });

  it("hands over the binding it already held, and replaces it", async () => {
    const storage = memory();
    saveIdentity({ householdId: "h_old", playerId: "p_old", displayName: "Rue", deviceToken: "tok_old" }, storage);
    const api = { redeemPairingCode: vi.fn(async () => bound) };

    await pairThisDevice("ABCDEFGH", { api, storage });

    expect(api.redeemPairingCode).toHaveBeenCalledWith("ABCDEFGH", "tok_old");
    expect(loadPlayerDeviceToken(storage)).toBe("tok_new");
  });

  it("stops being a screen, and leaves a grown-up's sign-in only where it still applies", async () => {
    const storage = memory();
    saveIdentity({ householdId: "h_tv", playerId: "p_tv", displayName: "", deviceToken: "tok_tv", screenOnly: true }, storage);
    saveAccount({ householdId: "h_other", email: "a@example.com", claimedAt: "" }, storage);
    const api = { redeemPairingCode: vi.fn(async () => bound) };

    await pairThisDevice("ABCDEFGH", { api, storage });

    expect(loadPlayerDeviceToken(storage)).toBe("tok_new");
    expect(loadAccount(storage)).toBeNull();
  });

  it("changes nothing when the code is refused", async () => {
    const storage = memory();
    saveIdentity({ householdId: "h_old", playerId: "p_old", displayName: "Rue", deviceToken: "tok_old" }, storage);
    const api = { redeemPairingCode: vi.fn(async () => { throw new Error("That code didn't work."); }) };

    await expect(pairThisDevice("ABCDEFGH", { api, storage })).rejects.toThrow("That code didn't work.");
    expect(loadPlayerDeviceToken(storage)).toBe("tok_old");
  });
});
