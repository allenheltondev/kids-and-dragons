import { describe, expect, it } from "vitest";
import { idleOpenRoom, memberHome, OPEN_ROOM_IDLE_MS, sameHome } from "./visitors.js";

const AT = "2026-10-18T18:00:00.000Z";
const T = Date.parse(AT);

describe("rooms open to visitors (#249)", () => {
  it("puts a member's hero in the room's household unless it says otherwise", () => {
    expect(memberHome({}, "h_room")).toBe("h_room");
    expect(memberHome({ homeHouseholdId: "h_visit" }, "h_room")).toBe("h_visit");
  });

  it("lets items pass only between heroes of one household", () => {
    expect(sameHome({}, {})).toBe(true);
    expect(sameHome({ homeHouseholdId: "h_visit" }, { homeHouseholdId: "h_visit" })).toBe(true);
    expect(sameHome({}, { homeHouseholdId: "h_visit" })).toBe(false);
    expect(sameHome({ homeHouseholdId: "h_a" }, { homeHouseholdId: "h_b" })).toBe(false);
  });

  it("calls an open room idle once nothing has happened for the idle window", () => {
    const open = { visitorCode: "ABCDEF", updatedAt: AT };
    expect(idleOpenRoom(open, T + OPEN_ROOM_IDLE_MS - 1)).toBe(false);
    expect(idleOpenRoom(open, T + OPEN_ROOM_IDLE_MS)).toBe(true);
    // A room that was never opened keeps its six hours, and a closed one is closed.
    expect(idleOpenRoom({ updatedAt: AT }, T + OPEN_ROOM_IDLE_MS * 10)).toBe(false);
    expect(idleOpenRoom({ ...open, closed: true }, T + OPEN_ROOM_IDLE_MS * 10)).toBe(false);
  });
});
