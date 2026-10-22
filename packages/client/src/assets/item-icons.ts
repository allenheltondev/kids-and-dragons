import type { ItemCatalog } from "@kad/shared";

/** Display-only overrides: the authored item catalog and Gemfall stay pinned. */
export const FACET_ICON_IDS = new Set([
  "facet_barge", "facet_caravan", "facet_clerks", "facet_confiscated",
  "facet_depot", "facet_drakes_rate", "facet_ember", "facet_ford",
  "facet_glade", "facet_harvest", "facet_keystone", "facet_pride",
  "facet_table", "facet_unassigned",
]);

/** Applied once when content loads, so every inventory/help/offer uses the same art. */
export function withItemIcons(items: ItemCatalog): ItemCatalog {
  return Object.fromEntries(Object.entries(items).map(([id, item]) => [
    id, FACET_ICON_IDS.has(id) ? { ...item, icon: id } : item,
  ]));
}
