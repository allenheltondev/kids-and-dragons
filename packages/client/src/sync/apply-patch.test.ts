/**
 * The whole point of applyPatchShared is what it does NOT copy: a patch to one
 * character's HP must leave every other subtree reference-identical, or every
 * selector in the app re-fires on every server message. So these tests assert
 * identity, not just value.
 */

import { describe, expect, it } from "vitest";
import type { Operation } from "fast-json-patch";
import { applyPatchShared } from "./apply-patch";
import { makeMember, makeState } from "../testing/fixtures";

describe("applyPatchShared", () => {
  it("replaces only the spine of the touched path and shares everything else", () => {
    const before = makeState({
      party: [makeMember(), makeMember({ playerId: "p_2" })],
      narration: "unchanged",
    });

    const after = applyPatchShared(before, [
      { op: "replace", path: "/party/0/hp", value: 3 },
    ] as Operation[]);

    // Value applied…
    expect(after.party[0]?.hp).toBe(3);
    // …the spine is new…
    expect(after).not.toBe(before);
    expect(after.party).not.toBe(before.party);
    expect(after.party[0]).not.toBe(before.party[0]);
    // …and everything off the path kept its identity.
    expect(after.party[1]).toBe(before.party[1]);
    expect(after.party[0]?.character).toBe(before.party[0]?.character);
    expect(after.narration).toBe(before.narration);
    expect(after.flags).toBe(before.flags);
  });

  it("never mutates the original document", () => {
    const before = makeState();
    applyPatchShared(before, [
      { op: "replace", path: "/party/0/hp", value: 1 },
      { op: "replace", path: "/narration", value: "changed" },
    ] as Operation[]);

    expect(before.party[0]?.hp).toBe(10);
    expect(before.narration).toBe("");
  });

  it("shares one copy of a container across two ops on the same path", () => {
    const before = makeState();
    const after = applyPatchShared(before, [
      { op: "replace", path: "/party/0/hp", value: 4 },
      { op: "replace", path: "/party/0/down", value: true },
    ] as Operation[]);

    // Both writes landed — the second op must not re-clone party[0] from the
    // original and drop the first.
    expect(after.party[0]?.hp).toBe(4);
    expect(after.party[0]?.down).toBe(true);
  });

  it("adds to and removes from arrays without touching siblings", () => {
    const doc = { list: [{ id: "a" }, { id: "b" }], other: { keep: true } };

    const added = applyPatchShared(doc, [
      { op: "add", path: "/list/1", value: { id: "new" } },
    ] as Operation[]);
    expect(added.list.map((e) => e.id)).toEqual(["a", "new", "b"]);
    expect(added.list[0]).toBe(doc.list[0]);
    expect(added.list[2]).toBe(doc.list[1]);
    expect(added.other).toBe(doc.other);

    const appended = applyPatchShared(doc, [
      { op: "add", path: "/list/-", value: { id: "tail" } },
    ] as Operation[]);
    expect(appended.list.map((e) => e.id)).toEqual(["a", "b", "tail"]);

    const removed = applyPatchShared(doc, [{ op: "remove", path: "/list/0" }] as Operation[]);
    expect(removed.list.map((e) => e.id)).toEqual(["b"]);
    expect(removed.list[0]).toBe(doc.list[0 + 1]);
    expect(removed.other).toBe(doc.other);
  });

  it("handles nested objects", () => {
    const doc = { a: { b: { c: 1 }, d: { keep: 1 } }, e: [1, 2] };
    const after = applyPatchShared(doc, [
      { op: "replace", path: "/a/b/c", value: 2 },
    ] as Operation[]);

    expect(after.a.b.c).toBe(2);
    expect(after.a).not.toBe(doc.a);
    expect(after.a.b).not.toBe(doc.a.b);
    expect(after.a.d).toBe(doc.a.d);
    expect(after.e).toBe(doc.e);
    expect(doc.a.b.c).toBe(1);
  });

  it("decodes escaped JSON-pointer segments (~0 and ~1)", () => {
    const doc = {
      "we/ird": { "til~de": { value: 0 } },
      plain: { keep: true },
    };
    const after = applyPatchShared(doc, [
      { op: "replace", path: "/we~1ird/til~0de/value", value: 9 },
    ] as Operation[]);

    expect(after["we/ird"]["til~de"].value).toBe(9);
    expect(after["we/ird"]).not.toBe(doc["we/ird"]);
    expect(after.plain).toBe(doc.plain);
    expect(doc["we/ird"]["til~de"].value).toBe(0);
  });

  it("supports move and copy without aliasing the original", () => {
    const doc = { from: { list: [1, 2] }, to: { list: [] as number[] }, other: { keep: 1 } };
    const after = applyPatchShared(doc, [
      { op: "move", from: "/from/list/0", path: "/to/list/0" },
    ] as Operation[]);

    expect(after.from.list).toEqual([2]);
    expect(after.to.list).toEqual([1]);
    expect(doc.from.list).toEqual([1, 2]);
    expect(doc.to.list).toEqual([]);
    expect(after.other).toBe(doc.other);
  });

  it("replaces the whole document on a root path", () => {
    const doc = { a: 1 };
    const after = applyPatchShared(doc, [
      { op: "replace", path: "", value: { a: 2 } },
    ] as Operation[]);
    expect(after).toEqual({ a: 2 });
    expect(doc.a).toBe(1);
  });
});
