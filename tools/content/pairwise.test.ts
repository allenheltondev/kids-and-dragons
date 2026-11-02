import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";

type Row = Record<string, unknown>;
const product = (axes: Record<string, unknown[]>): Row[] =>
  Object.entries(axes).reduce<Row[]>(
    (rows, [key, values]) => rows.flatMap((row) => values.map((value) => ({ ...row, [key]: value }))),
    [{}],
  );
const seen = (rows: Row[], keys: string[]) => new Set(rows.map((row) => keys.map((k) => `${k}=${JSON.stringify(row[k])}`).join("|")));

describe("pairwise", () => {
  const axes = { a: [1, 2, 3], b: ["x", "y"], c: [true, false], d: [10, 20, 30, 40] };
  const all = product(axes);
  const keys = Object.keys(axes);

  // `KAD_FULL_MATRIX=1 npm test` sets this for the whole run. These tests assert the reduction, so each
  // starts with it unset (and the one that wants it set sets it itself), and the inherited value is put back.
  const inherited = process.env.KAD_FULL_MATRIX;
  beforeEach(() => { delete process.env.KAD_FULL_MATRIX; });
  afterEach(() => {
    if (inherited === undefined) delete process.env.KAD_FULL_MATRIX;
    else process.env.KAD_FULL_MATRIX = inherited;
  });

  it("keeps every pair of values from any two axes, in far fewer rows than the product", () => {
    const picked = pairwise(all, keys);
    expect(picked.length).toBeLessThan(all.length / 2);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const pair = [keys[i]!, keys[j]!];
      expect(seen(picked, pair), pair.join("+")).toEqual(seen(all, pair));
    }
  });

  it("keeps every combination of the axes named in `together`", () => {
    const picked = pairwise(all, keys, { together: [["a", "b", "c"]] });
    expect(seen(picked, ["a", "b", "c"])).toEqual(seen(all, ["a", "b", "c"]));
  });

  it("only picks rows it was given, so axes that constrain each other stay valid", () => {
    const valid = all.filter((row) => !(row.a === 1 && row.b === "x"));
    const picked = pairwise(valid, keys);
    for (const row of picked) expect(valid).toContain(row);
    expect(picked.some((row) => row.a === 1 && row.b === "x")).toBe(false);
    expect(seen(picked, ["a", "b"])).toEqual(seen(valid, ["a", "b"]));
  });

  it("is deterministic", () => {
    expect(pairwise(all, keys)).toEqual(pairwise(all, keys));
  });

  it("never selects nothing from a non-empty list: one axis keeps every value, none keeps a row", () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 2 }];
    expect(seen(pairwise(rows, ["a"]), ["a"])).toEqual(seen(rows, ["a"]));
    expect(pairwise(rows, [])).toHaveLength(1);
    expect(pairwise([], ["a"])).toEqual([]);
  });

  it("returns every row when KAD_FULL_MATRIX is set", () => {
    process.env.KAD_FULL_MATRIX = "1";
    expect(pairwise(all, keys)).toHaveLength(all.length);
  });
});
