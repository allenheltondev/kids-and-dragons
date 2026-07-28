import { describe, expect, it } from "vitest";

import {
  addItem,
  addQuestItem,
  freeSlots,
  hasItem,
  removeItem,
  swapItem,
  useConsumable,
  usedSlots,
} from "./inventory.js";
import { INVENTORY_SLOTS } from "./types/domain.js";
import type { InventoryEntry } from "./types/domain.js";
import { makeItems } from "./test-fixtures.js";

const items = makeItems();

/** Six trinkets — a full bag. */
const FULL: InventoryEntry[] = [
  { itemId: "river_charm", kind: "trinket" },
  { itemId: "emberglass_shard", kind: "trinket" },
  { itemId: "oak_token", kind: "trinket" },
  { itemId: "pebble", kind: "trinket" },
  { itemId: "acorn", kind: "trinket" },
  { itemId: "feather", kind: "trinket" },
];

describe("the six-slot rule (spec §9.1)", () => {
  it("has exactly six slots", () => {
    expect(INVENTORY_SLOTS).toBe(6);
    expect(FULL).toHaveLength(INVENTORY_SLOTS);
    expect(usedSlots(FULL)).toBe(6);
    expect(freeSlots(FULL)).toBe(0);
  });

  it("adds while there is room", () => {
    const result = addItem(FULL.slice(0, 5), "ribbon", items);
    expect(result.status).toBe("added");
    if (result.status !== "added") return;
    expect(result.inventory).toHaveLength(6);
    expect(hasItem(result.inventory, "ribbon")).toBe(true);
  });

  it("asks to swap rather than silently dropping the seventh item", () => {
    const result = addItem(FULL, "ribbon", items);
    expect(result).toEqual({ status: "needs_swap", incomingItemId: "ribbon" });
  });

  it("never mutates the inventory it was handed", () => {
    const before = [...FULL];
    addItem(FULL, "ribbon", items);
    addItem(FULL.slice(0, 2), "ribbon", items);
    expect(FULL).toEqual(before);
  });

  it("swaps one out for one in and stays at six", () => {
    const next = swapItem(FULL, "ribbon", "pebble", items);
    expect(next).toHaveLength(6);
    expect(hasItem(next, "ribbon")).toBe(true);
    expect(hasItem(next, "pebble")).toBe(false);
  });

  it("refuses to drop something that isn't held", () => {
    expect(() => swapItem(FULL, "ribbon", "thimble", items)).toThrow(/not held/);
  });

  it("rejects unknown item ids loudly — the catalog is validated in CI", () => {
    expect(() => addItem([], "no_such_thing", items)).toThrow(/unknown itemId/);
  });
});

describe("quest items are slot-free (spec §9.2)", () => {
  it("reports quest instead of consuming a slot, even from a full bag", () => {
    expect(addItem(FULL, "rusted_key", items)).toEqual({ status: "quest" });
    expect(addItem([], "rusted_key", items)).toEqual({ status: "quest" });
  });

  it("tracks them on a separate list that never overflows", () => {
    let quest: string[] = [];
    for (const id of ["rusted_key", "torn_map_east", "rusted_key"]) {
      quest = addQuestItem(quest, id);
    }
    // Idempotent: two branches granting the same key yield one key.
    expect(quest).toEqual(["rusted_key", "torn_map_east"]);
  });

  it("cannot be swapped into a slot", () => {
    expect(() => swapItem(FULL, "rusted_key", "pebble", items)).toThrow(/never occupies a slot/);
  });
});

describe("removeItem", () => {
  it("removes one copy and leaves the rest", () => {
    const inv: InventoryEntry[] = [
      { itemId: "pebble", kind: "trinket" },
      { itemId: "pebble", kind: "trinket" },
    ];
    expect(removeItem(inv, "pebble")).toHaveLength(1);
  });

  it("is a no-op for something not held", () => {
    expect(removeItem(FULL, "ribbon")).toEqual(FULL);
  });
});

describe("useConsumable", () => {
  const withDraught: InventoryEntry[] = [
    { itemId: "sunbloom_draught", kind: "consumable" },
    { itemId: "river_charm", kind: "trinket" },
  ];

  it("returns the effect and frees the slot", () => {
    const result = useConsumable(withDraught, "sunbloom_draught", items);
    expect(result.status).toBe("used");
    if (result.status !== "used") return;
    expect(result.effect).toEqual({ type: "heal", amount: 4 });
    expect(result.inventory).toHaveLength(1);
    expect(hasItem(result.inventory, "sunbloom_draught")).toBe(false);
  });

  it("reports rather than throwing when the item isn't held — this is a player tap", () => {
    expect(useConsumable(withDraught, "firecracker", items)).toEqual({ status: "not_held" });
  });

  it("refuses trinkets, which are always on", () => {
    expect(useConsumable(withDraught, "river_charm", items)).toEqual({
      status: "not_consumable",
    });
  });
});
