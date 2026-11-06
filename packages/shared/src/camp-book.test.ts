/** The book's field-by-field kit merge (#629; docs/camp.md §7). */

import { describe, expect, it } from "vitest";
import { bookFieldNames, bookFieldProblem, bookKitChanges, bookKitProblem, mergeBookKit, parseBookKitChanges, type BookKitState } from "./camp-book.js";

const RULES = {
  styles: [{ id: "rolled" }, { id: "quilted" }],
  tents: [{ id: "rolled", group: "catalog" }, { id: "quilted", group: "catalog" }, { id: "mythic", group: "milestone" }],
  decorations: [{ id: "deco_a", group: "catalog" }, { id: "deco_b", group: "catalog" }, { id: "deco_c", group: "catalog" }, { id: "deco_star", group: "find" }],
};
const kit = (over: Partial<BookKitState> = {}): BookKitState => ({ style: null, tent: null, color: null, slots: [null, null], buddy: null, ...over });
const check = (friends: string[] = ["bun"]) => (base: BookKitState, next: BookKitState) => bookKitProblem(RULES, [], base, next, friends);
const field = (state: BookKitState, f: Parameters<typeof bookFieldProblem>[3], value: string | null) => bookFieldProblem(RULES, [], state, f, value, ["bun"]);

describe("mergeBookKit", () => {
  it("applies every field over what the server has now: the device wins", () => {
    // Queued on a phone over an unpicked kit; meanwhile a table picked her tent.
    const queued = bookKitChanges(kit(), kit({ tent: "quilted", color: "rose" }));
    expect(queued).toEqual([{ field: "tent", before: null, after: "quilted" }, { field: "color", before: null, after: "rose" }]);
    const merged = mergeBookKit(kit({ tent: "rolled" }), queued, check());
    expect(merged).toMatchObject({ applied: ["tent", "color"], refused: [], state: { tent: "quilted", color: "rose" } });
  });

  it("counts a field already at the picked value as applied, and skips what the table's rule refuses", () => {
    const merged = mergeBookKit(
      kit({ color: "rose" }),
      [
        { field: "color", before: null, after: "rose" },
        { field: "tent", before: null, after: "mythic" }, // a milestone she has not unlocked
        { field: "slot0", before: null, after: "deco_star" }, // a find she has not found
        { field: "buddy", before: null, after: "duckling" }, // a friend this crew lacks
        { field: "style", before: null, after: "quilted" },
      ],
      check(),
    );
    expect(merged).toMatchObject({ applied: ["style", "color"], refused: ["tent", "slot0", "buddy"], state: { style: "quilted", tent: null, slots: [null, null], buddy: null } });
  });

  it("moves a decoration between spots: the slots are checked as one arrangement", () => {
    const merged = mergeBookKit(kit({ slots: [null, "deco_a"] }), [
      { field: "slot0", before: null, after: "deco_a" },
      { field: "slot1", before: "deco_a", after: null },
    ], check());
    expect(merged).toMatchObject({ applied: ["slot0", "slot1"], refused: [], state: { slots: ["deco_a", null] } });
  });

  it("applies a queued swap of two hung decorations, as the direct write would (#656)", () => {
    const stored = kit({ slots: ["deco_a", "deco_b"] });
    const queued = bookKitChanges(stored, kit({ slots: ["deco_b", "deco_a"] }));
    expect(queued).toEqual([{ field: "slot0", before: "deco_a", after: "deco_b" }, { field: "slot1", before: "deco_b", after: "deco_a" }]);
    const merged = mergeBookKit(stored, queued, check());
    expect(merged).toMatchObject({ applied: ["slot0", "slot1"], refused: [], state: { slots: ["deco_b", "deco_a"] } });
    // The direct write checks the same final arrangement, and allows it.
    expect(check()(stored, merged.state)).toBeNull();
  });

  it("applies a three-slot rotation, and keeps a slot the queue did not touch", () => {
    const stored = kit({ slots: ["deco_a", "deco_b", "deco_c"] });
    const rotated = mergeBookKit(stored, bookKitChanges(stored, kit({ slots: ["deco_c", "deco_a", "deco_b"] })), check());
    expect(rotated).toMatchObject({ applied: ["slot0", "slot1", "slot2"], refused: [], state: { slots: ["deco_c", "deco_a", "deco_b"] } });
    // Queued slot0 takes deco_b while slot1, untouched by the queue, still holds it: slot0 keeps what is stored.
    const clash = mergeBookKit(stored, [{ field: "slot0", before: "deco_a", after: "deco_b" }], check());
    expect(clash).toMatchObject({ applied: [], refused: ["slot0"], state: { slots: ["deco_a", "deco_b", "deco_c"] } });
  });

  it("refuses a locked piece in a swap and applies the rest of the swap validly", () => {
    const stored = kit({ slots: ["deco_a", "deco_b", null] });
    const merged = mergeBookKit(stored, [
      { field: "slot0", before: "deco_a", after: "deco_b" },
      { field: "slot1", before: "deco_b", after: "deco_a" },
      { field: "slot2", before: null, after: "deco_star" }, // a find she has not found
    ], check());
    expect(merged).toMatchObject({ applied: ["slot0", "slot1"], refused: ["slot2"], state: { slots: ["deco_b", "deco_a", null] } });
    expect(check()(stored, merged.state)).toBeNull();
    // A locked piece whose slot was half of a swap: that slot keeps what is stored, and so must its partner.
    const half = mergeBookKit(kit({ slots: ["deco_a", "deco_b"] }), [
      { field: "slot0", before: "deco_a", after: "deco_b" },
      { field: "slot1", before: "deco_b", after: "deco_star" },
    ], check());
    expect(half).toMatchObject({ applied: [], refused: ["slot0", "slot1"], state: { slots: ["deco_a", "deco_b"] } });
  });

  it("never unsets a style or fills a slot the kit does not have", () => {
    expect(field(kit({ style: "rolled" }), "style", null)).toMatch(/always picked/);
    expect(field(kit(), "slot2", "deco_a")).toMatch(/not on this kit/);
    expect(check()(kit({ style: "rolled" }), kit())).toMatch(/always picked/);
  });
});

describe("parseBookKitChanges", () => {
  it("reads each field once, with string-or-null values", () => {
    expect(parseBookKitChanges([{ field: "color", before: null, after: "rose" }])).toEqual([{ field: "color", before: null, after: "rose" }]);
    expect(parseBookKitChanges([])).toBeNull();
    expect(parseBookKitChanges([{ field: "hat", before: null, after: "x" }])).toBeNull();
    expect(parseBookKitChanges([{ field: "color", before: 1, after: "x" }])).toBeNull();
    expect(parseBookKitChanges([{ field: "color", before: null, after: "a" }, { field: "color", before: null, after: "b" }])).toBeNull();
  });
});

describe("bookFieldNames", () => {
  it("says fields as a kid would", () => {
    expect(bookFieldNames(["tent"])).toBe("tent");
    expect(bookFieldNames(["style", "slot0", "slot1", "buddy"])).toBe("bedroll, decorations and buddy");
  });
});
