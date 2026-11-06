/** The book's field-by-field kit merge (#629; docs/camp.md §7). */

import { describe, expect, it } from "vitest";
import { bookFieldNames, bookFieldProblem, bookKitChanges, mergeBookKit, parseBookKitChanges, type BookKitState } from "./camp-book.js";

const RULES = {
  styles: [{ id: "rolled" }, { id: "quilted" }],
  tents: [{ id: "rolled", group: "catalog" }, { id: "quilted", group: "catalog" }, { id: "mythic", group: "milestone" }],
  decorations: [{ id: "deco_a", group: "catalog" }, { id: "deco_b", group: "catalog" }, { id: "deco_star", group: "find" }],
};
const kit = (over: Partial<BookKitState> = {}): BookKitState => ({ style: null, tent: null, color: null, slots: [null, null], buddy: null, ...over });
const check = (friends: string[] = ["bun"]) => (state: BookKitState, field: Parameters<typeof bookFieldProblem>[3], value: string | null) =>
  bookFieldProblem(RULES, [], state, field, value, friends);

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

  it("empties slots first, so a decoration moved between spots never meets itself", () => {
    const merged = mergeBookKit(kit({ slots: [null, "deco_a"] }), [
      { field: "slot0", before: null, after: "deco_a" },
      { field: "slot1", before: "deco_a", after: null },
    ], check());
    expect(merged).toMatchObject({ applied: ["slot1", "slot0"], refused: [], state: { slots: ["deco_a", null] } });
  });

  it("never unsets a style or fills a slot the kit does not have", () => {
    expect(check()(kit({ style: "rolled" }), "style", null)).toMatch(/always picked/);
    expect(check()(kit(), "slot2", "deco_a")).toMatch(/not on this kit/);
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
