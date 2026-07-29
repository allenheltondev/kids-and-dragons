import { describe, expect, it } from "vitest";
import { PresenceTracker } from "./presence-tracker.ts";

describe("PresenceTracker", () => {
  it("flips only on the edges", () => {
    const t = new PresenceTracker();
    expect(t.open("r1", "p1")).toBe(true); // nobody → somebody
    expect(t.open("r1", "p1")).toBe(false);
    expect(t.close("r1", "p1")).toBe(false);
    expect(t.close("r1", "p1")).toBe(true); // somebody → nobody
  });

  it("survives a refresh whose old stream closes last", () => {
    const t = new PresenceTracker();
    t.open("r1", "p1"); // the tab that is about to be replaced

    // A refresh: the new stream opens *before* the old one's close lands,
    // which is the ordering a plain close handler gets wrong.
    expect(t.open("r1", "p1")).toBe(false);
    expect(t.close("r1", "p1")).toBe(false);

    // Still here. Marking them away would let a ready-gate advance past a
    // player who is sitting right there.
    expect(t.count("r1", "p1")).toBe(1);
  });

  it("keeps players and runs apart", () => {
    const t = new PresenceTracker();
    t.open("r1", "p1");
    expect(t.open("r1", "p2")).toBe(true);
    expect(t.open("r2", "p1")).toBe(true);
    expect(t.close("r1", "p1")).toBe(true);
    expect(t.count("r1", "p2")).toBe(1);
    expect(t.count("r2", "p1")).toBe(1);
  });

  it("does not go negative when a close arrives without an open", () => {
    const t = new PresenceTracker();
    expect(t.close("r1", "ghost")).toBe(true);
    expect(t.count("r1", "ghost")).toBe(0);
  });
});
