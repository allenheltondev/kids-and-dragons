/**
 * What an item *does* — D7.
 *
 * The counterpart to `encounter.ts`, and split from it for the same reason:
 * `taxonomies.ts` should stay a map of what canon says a thing *is*, while the
 * blocks that make a thing playable live beside the rules they answer to.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBERS ARE HERE AND THE BANDS WERE NOT
 *
 * D9 kept enemy stats out of canon: canon names a band, `content/rules.json`
 * says what a band is worth, because retuning combat is a balance judgement
 * that should not require an edit to the world. Items go the other way. "The
 * Honeycake heals 2" is not a tuning knob you would sweep across the corpus —
 * it *is* what a honeycake is, the same way "burns unprotected hands" is what
 * a Crimson Shard is. There is no band to name and no table to name it in, so
 * the effect is authored on the item.
 *
 * ---------------------------------------------------------------------------
 * THIS MIRRORS `ItemDef` IN packages/shared, DELIBERATELY
 *
 * `ItemEffect` and `ItemPassive` are engine unions the game has read since
 * before canon existed. Restating them as Zod here is not duplication for its
 * own sake: `content/items.json` is now generated from canon, so this schema
 * is the thing that guarantees the projection is a valid `ItemCatalog` —
 * checked once at authoring time rather than discovered at load. The
 * projection asserts the two agree (`tools/canon/items.ts`), so a new effect
 * verb added to the engine and not here fails the build.
 */

import { z } from "zod";

/** Matches `ItemKind` in packages/shared. */
export const ItemKind = z.enum(["consumable", "trinket", "quest"]);
export type ItemKind = z.infer<typeof ItemKind>;

const StatId = z.enum(["might", "quick", "clever", "heart"]);

/** Immediate effect of using a consumable. Mirrors `ItemEffect`. */
export const ItemEffect = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("heal"), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal("rollBonus"), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal("damage"), amount: z.number().int().positive() }),
]);
export type ItemEffect = z.infer<typeof ItemEffect>;

/** Always-on effect of a trinket. Mirrors `ItemPassive`. */
export const ItemPassive = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("statBonus"),
    stat: StatId,
    amount: z.number().int().positive(),
  }),
  z.strictObject({ type: z.literal("stepBonus"), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal("maxHpBonus"), amount: z.number().int().positive() }),
  z.strictObject({
    type: z.literal("rerollOnes"),
    perEncounter: z.number().int().positive(),
  }),
]);
export type ItemPassive = z.infer<typeof ItemPassive>;

/**
 * The block that turns a lore entry into something a child can tap.
 *
 * Optional on `item`: the Crystal Heart is canon and is not in anybody's bag.
 * An item without `mechanics` simply does not project into
 * `content/items.json` — which is how canon holds "this exists in the world"
 * and "this exists in the game" as separate, honest claims.
 */
export const Mechanics = z.strictObject({
  kind: ItemKind,
  /** A glyph id from the client's icon table (`screens/icons.tsx`). */
  icon: z.string().min(1),
  /**
   * The sentence on the card, in the player's language — "Still warm. Heal 2
   * HP." Distinct from `short_description`, which is what the thing is; this
   * is what tapping it will do, and a seven-year-old is the audience.
   */
  text: z.string().min(1),
  effect: ItemEffect.optional(),
  passive: ItemPassive.optional(),
});
export type Mechanics = z.infer<typeof Mechanics>;

/**
 * The kind/effect/passive agreement, shared by canon items and chapter props.
 *
 * Stated once because both have to obey it: a consumable with nothing to do on
 * use is a wasted tap, and a trinket with an `effect` would sit in a slot doing
 * nothing forever, since `useConsumable` refuses anything that is not a
 * consumable.
 */
export function mechanicsProblems(m: Mechanics): string[] {
  const problems: string[] = [];
  if (m.kind === "consumable") {
    if (!m.effect) problems.push("a consumable needs an `effect` — using it must do something");
    if (m.passive) problems.push("a consumable cannot have a `passive`; it is gone after one use");
  }
  if (m.kind === "trinket") {
    if (!m.passive) problems.push("a trinket needs a `passive` — it is worn, not used");
    if (m.effect) problems.push("a trinket cannot have an `effect`; only consumables are used");
  }
  if (m.kind === "quest") {
    if (m.effect || m.passive) {
      problems.push("a quest item carries no mechanics — it opens doors, it does not heal");
    }
  }
  return problems;
}
