import { describe, expect, it } from "vitest";
import { RELOAD_GUARD_MS, UPDATE_CHECK_MS, isCalm, mayReload, shouldReload, updateDue, type CalmInputs } from "./calm";

const calm: CalmInputs = { visible: true, synced: true, picking: false, inFight: false, keepsakeOpen: false, pairing: false };

describe("isCalm", () => {
  it("is calm when nothing is going on", () => {
    expect(isCalm(calm)).toBe(true);
  });
  it.each(["visible", "synced"] as const)("is not calm when %s is false", (key) => {
    expect(isCalm({ ...calm, [key]: false })).toBe(false);
  });
  it.each(["picking", "inFight", "keepsakeOpen", "pairing"] as const)("is not calm when %s", (key) => {
    expect(isCalm({ ...calm, [key]: true })).toBe(false);
  });
});

describe("mayReload", () => {
  it("allows the first reload", () => expect(mayReload(null, 1000)).toBe(true));
  it("refuses a second close behind the first", () => expect(mayReload(1000, 1000 + RELOAD_GUARD_MS - 1)).toBe(false));
  it("allows one after the guard", () => expect(mayReload(1000, 1000 + RELOAD_GUARD_MS)).toBe(true));
  it("ignores a stamp from the future (a clock that moved)", () => expect(mayReload(5000, 1000)).toBe(true));
});

describe("updateDue", () => {
  it("is due the first time and after the interval, not between", () => {
    expect(updateDue(null, 0)).toBe(true);
    expect(updateDue(0, UPDATE_CHECK_MS - 1)).toBe(false);
    expect(updateDue(0, UPDATE_CHECK_MS)).toBe(true);
  });
});

describe("shouldReload", () => {
  it("waits for an update to be pending", () => expect(shouldReload(false, calm, null, 0)).toBe(false));
  it("never reloads mid-decision or unsynced", () => {
    expect(shouldReload(true, { ...calm, picking: true }, null, 0)).toBe(false);
    expect(shouldReload(true, { ...calm, synced: false }, null, 0)).toBe(false);
  });
  it("reloads once at a calm moment", () => {
    expect(shouldReload(true, calm, null, 0)).toBe(true);
    expect(shouldReload(true, calm, 0, 1000)).toBe(false);
  });
});
