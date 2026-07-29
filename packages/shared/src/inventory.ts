/**
 * Inventory — spec §9.
 *
 * Six slots, no weight, no sorting, no bag-of-holding. The two rules worth
 * encoding are the ones a UI can quietly break:
 *
 *   1. A full bag never silently drops a grant. It returns `needs_swap`, and
 *      the caller owes the player one prompt: keep it and drop one, or leave it.
 *   2. Quest items cost zero slots (§9.2). A story gate must never be blocked
 *      because someone's bag was full, so they never even reach this module's
 *      slot arithmetic — `addItem` reports `quest` and the caller files them on
 *      `character.questItems`.
 */

import { INVENTORY_SLOTS } from "./types/domain.js";
import type { ItemCatalog, ItemDef, ItemEffect, InventoryEntry } from "./types/domain.js";

/** A character's slotted items. Quest items are tracked separately. */
export type Inventory = readonly InventoryEntry[];

export type AddItemResult =
  | { status: "added"; inventory: InventoryEntry[] }
  | { status: "needs_swap"; incomingItemId: string }
  | { status: "quest" };

export type UseConsumableResult =
  | { status: "used"; inventory: InventoryEntry[]; effect: ItemEffect }
  | { status: "not_held" }
  | { status: "not_consumable" };

function requireItem(catalog: ItemCatalog, itemId: string): ItemDef {
  const def = catalog[itemId];
  if (!def) throw new Error(`items.json: unknown itemId "${itemId}"`);
  return def;
}

/** How many of the six slots are in use. Quest items are never in `inv`. */
export function usedSlots(inv: Inventory): number {
  return inv.length;
}

export function freeSlots(inv: Inventory): number {
  return Math.max(0, INVENTORY_SLOTS - inv.length);
}

export function hasItem(inv: Inventory, itemId: string): boolean {
  return inv.some((e) => e.itemId === itemId);
}

/**
 * Never mutates `inv`. A `needs_swap` result has deliberately *not* applied
 * anything — the incoming item is still in the world until the player answers.
 */
export function addItem(
  inv: Inventory,
  itemId: string,
  catalog: ItemCatalog,
): AddItemResult {
  const def = requireItem(catalog, itemId);
  // §9.2: quest items are slot-free. They do not participate here at all.
  if (def.kind === "quest") return { status: "quest" };
  if (inv.length >= INVENTORY_SLOTS) {
    return { status: "needs_swap", incomingItemId: itemId };
  }
  return {
    status: "added",
    inventory: [...inv, { itemId, kind: def.kind }],
  };
}

/**
 * The answer to a `needs_swap` prompt: drop one, take the incoming. Passing a
 * `dropItemId` the character doesn't hold is a caller bug, not a player action.
 */
export function swapItem(
  inv: Inventory,
  incomingItemId: string,
  dropItemId: string,
  catalog: ItemCatalog,
): InventoryEntry[] {
  const def = requireItem(catalog, incomingItemId);
  if (def.kind === "quest") {
    throw new Error(
      `inventory: quest item "${incomingItemId}" never occupies a slot, so it cannot be swapped in`,
    );
  }
  if (!hasItem(inv, dropItemId)) {
    throw new Error(`inventory: cannot drop "${dropItemId}" — not held`);
  }
  const next = removeItem(inv, dropItemId);
  return [...next, { itemId: incomingItemId, kind: def.kind }];
}

/** Removes one copy. Unknown ids are a no-op — dropping twice isn't an error. */
export function removeItem(inv: Inventory, itemId: string): InventoryEntry[] {
  const index = inv.findIndex((e) => e.itemId === itemId);
  if (index < 0) return [...inv];
  return [...inv.slice(0, index), ...inv.slice(index + 1)];
}

/**
 * Consumables are single use (§9.2) — the entry is gone whether or not the
 * caller can act on the effect. Returns a status rather than throwing because
 * this one *is* reachable from a player tap.
 */
export function useConsumable(
  inv: Inventory,
  itemId: string,
  catalog: ItemCatalog,
): UseConsumableResult {
  if (!hasItem(inv, itemId)) return { status: "not_held" };
  const def = requireItem(catalog, itemId);
  if (def.kind !== "consumable" || !def.effect) return { status: "not_consumable" };
  return {
    status: "used",
    inventory: removeItem(inv, itemId),
    effect: def.effect,
  };
}

/**
 * Adds a quest item. Slot-free and idempotent: a chapter that grants the same
 * key down two branches must not produce two keys.
 */
export function addQuestItem(questItems: readonly string[], itemId: string): string[] {
  if (questItems.includes(itemId)) return [...questItems];
  return [...questItems, itemId];
}
