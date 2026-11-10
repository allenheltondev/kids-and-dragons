/**
 * Leaving a device, on the client. What matters is the order (the server is
 * asked before the device forgets), and that a refusal leaves the device
 * exactly as it was.
 */

import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../sync/client";
import { leaveThisDevice, standingOfThisDevice, type LeaveDeps } from "./leave-device";
import {
  ACCOUNT_RECORD_KEY,
  DEVICE_IDENTITY_KEY,
  SAVED_JOURNAL_KEY,
  SHARED_DEVICE_KEY,
  type KeyValueStorage,
} from "./persistence";

function memory(initial: Record<string, string> = {}): KeyValueStorage & Pick<Storage, "key" | "length"> {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

const ADA = JSON.stringify({ householdId: "h_1", playerId: "p_ada", displayName: "Ada", deviceToken: "tok_ada" });
const STANDING = { displayName: "Ada", kept: true, canLeave: true };

function deps(overrides: Partial<LeaveDeps> = {}, stored: Record<string, string> = { [DEVICE_IDENTITY_KEY]: ADA }) {
  const storage = memory({
    ...stored,
    [SAVED_JOURNAL_KEY]: "{}",
    [ACCOUNT_RECORD_KEY]: JSON.stringify({ householdId: "h_1", email: "mum@example.com", claimedAt: "2026-01-01" }),
    "kad.session.ABCD": "{}",
  });
  const tab = memory({ "kad.session.WXYZ": "{}" });
  const api = { deviceStanding: vi.fn(async () => STANDING), leaveDevice: vi.fn(async () => {}) };
  const clearBook = vi.fn(async () => {});
  return { storage, tab, api, clearBook, ...overrides } as LeaveDeps & {
    api: { deviceStanding: ReturnType<typeof vi.fn>; leaveDevice: ReturnType<typeof vi.fn> };
    clearBook: ReturnType<typeof vi.fn>;
  };
}

describe("what this device may offer", () => {
  it("asks the server with the device's own token", async () => {
    const d = deps();
    expect(await standingOfThisDevice(d)).toEqual(STANDING);
    expect(d.api.deviceStanding).toHaveBeenCalledWith("tok_ada");
  });

  it("offers nothing on a device that is nobody, without asking", async () => {
    const d = deps({}, {});
    expect(await standingOfThisDevice(d)).toBeNull();
    expect(d.api.deviceStanding).not.toHaveBeenCalled();
  });

  it("offers nothing on a family tablet: a grown-up forgets those", async () => {
    const d = deps({}, { [DEVICE_IDENTITY_KEY]: ADA, [SHARED_DEVICE_KEY]: JSON.stringify({ token: "s", householdId: "h_1" }) });
    expect(await standingOfThisDevice(d)).toBeNull();
    expect(d.api.deviceStanding).not.toHaveBeenCalled();
  });

  it("offers nothing when the server cannot be asked, rather than guess", async () => {
    const d = deps();
    d.api.deviceStanding.mockRejectedValue(new Error("offline"));
    expect(await standingOfThisDevice(d)).toBeNull();
  });
});

describe("leaving this device", () => {
  it("tells the server, then forgets who it was, its book, the sign-in and every room", async () => {
    const d = deps();
    await leaveThisDevice(d);

    expect(d.api.leaveDevice).toHaveBeenCalledWith("tok_ada");
    for (const key of [DEVICE_IDENTITY_KEY, SAVED_JOURNAL_KEY, ACCOUNT_RECORD_KEY, "kad.session.ABCD"]) {
      expect(d.storage.getItem(key), key).toBeNull();
    }
    expect(d.tab.getItem("kad.session.WXYZ")).toBeNull();
    expect(d.clearBook).toHaveBeenCalledTimes(1);
  });

  it("forgets nothing when the server refuses, and passes on what it said", async () => {
    const d = deps();
    d.api.leaveDevice.mockRejectedValue(new ApiError(409, "Ada’s heroes are only on this device.", "ILLEGAL"));

    await expect(leaveThisDevice(d)).rejects.toThrow("only on this device");

    expect(d.storage.getItem(DEVICE_IDENTITY_KEY)).toBe(ADA);
    expect(d.storage.getItem(ACCOUNT_RECORD_KEY)).not.toBeNull();
    expect(d.clearBook).not.toHaveBeenCalled();
  });

  it("forgets nothing when the server cannot be reached", async () => {
    const d = deps();
    d.api.leaveDevice.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(leaveThisDevice(d)).rejects.toThrow();
    expect(d.storage.getItem(DEVICE_IDENTITY_KEY)).toBe(ADA);
  });

  it("carries on when the server already counts this device as nobody", async () => {
    const d = deps();
    d.api.leaveDevice.mockRejectedValue(new ApiError(401, "This device isn't anybody.", "FORBIDDEN"));
    await leaveThisDevice(d);
    expect(d.storage.getItem(DEVICE_IDENTITY_KEY)).toBeNull();
    expect(d.clearBook).toHaveBeenCalledTimes(1);
  });
});
