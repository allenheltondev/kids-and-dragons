import { describe, expect, it } from "vitest";
import { FRIENDS_OUT, campKey, campKeyOf, friendRotation, friendsOut, withOuting } from "./camp-friends.js";

const at = (day: number): string => `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`;

describe("the friends out (docs/camp.md §4.4, §12.5, §13.1; #624)", () => {
  it("rotates the friends who have been out least first, then the newest, then by id", () => {
    const friends = {
      bun: { at: at(1), outs: 3 },
      mosshorn: { at: at(2), outs: 1 },
      duckling: { at: at(3), outs: 1 },
      kid_goat: { at: at(3), outs: 1 },
      newt: { at: at(5) },
    };
    expect(friendRotation(friends)).toEqual(["newt", "duckling", "kid_goat", "mosshorn", "bun"]);
  });

  it("a buddy is always out while its hero is seated, and the other seats rotate", () => {
    const rotation = ["a", "b", "c", "d", "e", "f"];
    // Nobody has a buddy: every seat rotates.
    expect(friendsOut(rotation, [undefined, undefined])).toEqual(["a", "b", "c", "d"]);
    // A buddy late in the rotation is out anyway, and the spare seats keep the order.
    expect(friendsOut(rotation, ["f", undefined])).toEqual(["f", "a", "b", "c"]);
    // Four heroes, four buddies: every kid gets exactly one say.
    expect(friendsOut(rotation, ["f", "e", "d", "c"])).toEqual(["f", "e", "d", "c"]);
    // Two heroes share a buddy: it is out once, and the spare seat rotates.
    expect(friendsOut(rotation, ["e", "e", undefined])).toEqual(["e", "a", "b", "c"]);
    // A solo player with a buddy sees the buddy plus three rotating friends.
    expect(friendsOut(rotation, ["d"])).toEqual(["d", "a", "b", "c"]);
    // A buddy this crew does not have (another crew's) is ignored.
    expect(friendsOut(rotation, ["stranger"])).toEqual(["a", "b", "c", "d"]);
  });

  it("never puts out more than four, and fewer friends than seats are all out", () => {
    expect(FRIENDS_OUT).toBe(4);
    expect(friendsOut(["a", "b"], ["b"])).toEqual(["b", "a"]);
    expect(friendsOut([], [])).toEqual([]);
  });

  it("more than four new friends queue: each moment's outing brings out those not yet seen", () => {
    let friends: Record<string, { at: string; outs?: number }> = {};
    for (const [i, id] of ["f1", "f2", "f3", "f4", "f5", "f6"].entries()) friends[id] = { at: at(i + 1) };
    const first = friendsOut(friendRotation(friends), []);
    // The newest four first.
    expect(first).toEqual(["f6", "f5", "f4", "f3"]);
    friends = withOuting(friends, first);
    const second = friendsOut(friendRotation(friends), []);
    // The two still queued come out next, before anybody has a second turn.
    expect(second.slice(0, 2)).toEqual(["f2", "f1"]);
    friends = withOuting(friends, second);
    // Over the moments everybody is out about as often as everybody else.
    for (let i = 0; i < 9; i++) friends = withOuting(friends, friendsOut(friendRotation(friends), []));
    const outs = Object.values(friends).map((f) => f.outs ?? 0);
    expect(Math.max(...outs) - Math.min(...outs)).toBeLessThanOrEqual(1);
  });

  it("the rotation is the same on every read, whatever order the record lists them in", () => {
    const a = { x: { at: at(1) }, y: { at: at(1) }, z: { at: at(1) } };
    const b = { z: { at: at(1) }, x: { at: at(1) }, y: { at: at(1) } };
    expect(friendRotation(a)).toEqual(friendRotation(b));
  });

  it("keys a buddy by the camp it applies in", () => {
    expect(campKey("h_1")).toBe("h_1");
    expect(campKey("h_1", null)).toBe("h_1");
    expect(campKey("h_1", "cw_2")).toBe("h_1#cw_2");
    expect(campKeyOf("h_1#cw_2", "h_1")).toBe(true);
    expect(campKeyOf("h_1", "h_1")).toBe(true);
    expect(campKeyOf("h_10", "h_1")).toBe(false);
  });

  it("an outing for nobody it knows changes nothing", () => {
    const friends = { a: { at: at(1) } };
    expect(withOuting(friends, ["b"])).toBe(friends);
    expect(withOuting(friends, ["a"])).toEqual({ a: { at: at(1), outs: 1 } });
  });
});
