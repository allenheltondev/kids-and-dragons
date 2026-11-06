/**
 * The book's offline queue of kit changes (#629; docs/camp.md §7): one entry per
 * hero (and per crew for a buddy), each field keeping the value it was first
 * made over; laid over the server's kit for display; kept for one binding
 * only, and dropped unsent for any other.
 */

import { describe, expect, it } from "vitest";
import type { JournalKit } from "@kad/shared";
import { dropKitQueue, enqueueKitChanges, hasQueuedKitChanges, KIT_QUEUE_KEY, loadKitQueue, removeQueuedKitChange, demoteQueuedKitChange, withQueuedKit } from "./kit-queue";
import type { KeyValueStorage } from "./persistence";

function memStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const KIT: JournalKit = { revision: 4, style: null, tent: null, color: null, slots: [null, null], unlocked: [], buddies: {} };

describe("the kit queue", () => {
  it("keeps each field's first value and its latest pick, and forgets a field changed back", () => {
    const ls = memStorage();
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }], direct: true }, ls);
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }, { field: "tent", before: null, after: "patched" }] }, ls);
    let [entry] = loadKitQueue("dev_1", ls);
    expect(entry!.changes).toEqual([
      { field: "color", before: null, after: "tide" },
      { field: "tent", before: null, after: "patched" },
    ]);
    // Changed again, it is no longer the one change sent straight away.
    expect(entry!.direct).toBeUndefined();
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: "tide", after: null }] }, ls);
    [entry] = loadKitQueue("dev_1", ls);
    expect(entry!.changes).toEqual([{ field: "tent", before: null, after: "patched" }]);
  });

  it("sends a change straight away only when it is all there is for her", () => {
    const ls = memStorage();
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }], direct: true }, ls);
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: "cw_1", changes: [{ field: "buddy", before: null, after: "bun" }], direct: true }, ls);
    const [kit, buddy] = loadKitQueue("dev_1", ls);
    expect(kit).toMatchObject({ direct: true });
    expect(buddy).toMatchObject({ crew: "cw_1", changes: [{ field: "buddy", after: "bun" }] });
    expect(buddy!.direct).toBeUndefined();
    demoteQueuedKitChange("dev_1", kit!.id, ls);
    expect(loadKitQueue("dev_1", ls)[0]!.direct).toBeUndefined();
  });

  it("never folds a change into the entry being sent", () => {
    const ls = memStorage();
    const [sending] = enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }] }, ls);
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }], busy: sending!.id }, ls);
    const entries = loadKitQueue("dev_1", ls);
    expect(entries.map((e) => e.changes)).toEqual([[{ field: "color", before: null, after: "rose" }], [{ field: "color", before: "rose", after: "tide" }]]);
    removeQueuedKitChange("dev_1", sending!.id, ls);
    expect(loadKitQueue("dev_1", ls)).toHaveLength(1);
  });

  it("shows the queued picks over the server's kit, a buddy in its own crew's camp", () => {
    const ls = memStorage();
    const entries = [
      ...enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "slot1", before: null, after: "deco_a" }] }, ls),
    ];
    const all = enqueueKitChanges("dev_1", { characterId: "c_1", crew: "cw_1", changes: [{ field: "buddy", before: null, after: "bun" }] }, ls);
    expect(entries).toHaveLength(1);
    const shown = withQueuedKit(KIT, "c_1", all);
    expect(shown).toMatchObject({ revision: 4, slots: [null, "deco_a"], buddies: { cw_1: "bun" } });
    expect(withQueuedKit(KIT, "c_2", all)).toEqual(KIT);
  });

  it("survives the book being closed: it is in the phone's storage, for its binding", () => {
    const ls = memStorage();
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }] }, ls);
    expect(hasQueuedKitChanges(ls)).toBe(true);
    expect(JSON.parse(ls.map.get(KIT_QUEUE_KEY)!)).toMatchObject({ deviceToken: "dev_1", entries: [{ characterId: "c_1" }] });
    expect(loadKitQueue("dev_1", ls)).toHaveLength(1);
  });

  it("is dropped unsent when read with another binding, or with none", () => {
    const ls = memStorage();
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }] }, ls);
    expect(loadKitQueue("dev_2", ls)).toEqual([]);
    expect(hasQueuedKitChanges(ls)).toBe(false);
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }] }, ls);
    expect(loadKitQueue(null, ls)).toEqual([]);
    expect(loadKitQueue("dev_1", ls)).toEqual([]);
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }] }, ls);
    dropKitQueue(ls);
    expect(loadKitQueue("dev_1", ls)).toEqual([]);
  });
});
