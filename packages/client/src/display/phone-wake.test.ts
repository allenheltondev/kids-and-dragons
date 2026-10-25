import { describe, expect, it } from "vitest";
import { shouldHoldPhoneWake, type PhoneWakeInput } from "./phone-wake";

const inRoom: PhoneWakeInput = {
  route: { name: "player", code: "ABCD" },
  connection: "open",
  playerId: "p_1",
  sharedDevice: false,
};

describe("shouldHoldPhoneWake", () => {
  it("holds in an open room", () => {
    expect(shouldHoldPhoneWake(inRoom)).toBe(true);
  });

  it("holds while reconnecting, so a blip does not dim the phone", () => {
    expect(shouldHoldPhoneWake({ ...inRoom, connection: "reconnecting" })).toBe(true);
  });

  it("does not hold before connecting, when idle or on error", () => {
    for (const connection of ["idle", "connecting", "error", "lost"] as const) {
      expect(shouldHoldPhoneWake({ ...inRoom, connection })).toBe(false);
    }
  });

  it("does not hold off the player route", () => {
    expect(shouldHoldPhoneWake({ ...inRoom, route: { name: "home" } as PhoneWakeInput["route"] })).toBe(false);
    expect(shouldHoldPhoneWake({ ...inRoom, route: { name: "journal" } as unknown as PhoneWakeInput["route"] })).toBe(false);
  });

  it("does not hold without a room code", () => {
    expect(shouldHoldPhoneWake({ ...inRoom, route: { name: "player", code: "" } })).toBe(false);
  });

  it("lets a shared tablet that is only watching sleep", () => {
    expect(shouldHoldPhoneWake({ ...inRoom, sharedDevice: true, playerId: "" })).toBe(false);
  });

  it("holds on a shared tablet once a player is seated", () => {
    expect(shouldHoldPhoneWake({ ...inRoom, sharedDevice: true })).toBe(true);
  });

  it("holds on a personal phone still making its hero", () => {
    expect(shouldHoldPhoneWake({ ...inRoom, playerId: "" })).toBe(true);
  });
});
