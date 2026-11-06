/**
 * A kid's own kit and buddy, changed from the adventure book (docs/camp.md §7,
 * §12.6; #629): the pure rules the server merges by and the book's offline
 * queue records with.
 *
 * The book edits field by field. A field is one thing a kid picks: the tent,
 * the bedroll and pack (`style`), the color, each decoration slot, and the
 * buddy in one crew's camp. Every change says what it was made over
 * (`before`), so a change queued on a phone with no signal can be sent later
 * and applied only where the server still has that value
 * (`mergeBookKit`): a field somebody else changed in the meantime (at a
 * table, on the kid's other phone) keeps the newer value, and every field
 * nobody touched applies. Online, the book sends the same changes with the
 * kit's revision instead, and the server applies them the way the table does
 * (`KIT_EDIT`): all of them, or none if the kit has moved on.
 *
 * Whatever is sent, the server checks each field with the table's own rule
 * (`kitEditProblem`), so the book can never pick a piece the hero does not
 * have or a friend the crew lacks.
 */

import { kitEditProblem, MAX_KIT_SLOTS, type KitEdit, type KitRules } from "./camp-edit.js";
import type { HeroKit } from "./types/camp.js";

/** One thing a kid picks for her kit (§4.5), or her buddy in one crew's camp (§4.4). */
export type BookKitField = "style" | "tent" | "color" | "slot0" | "slot1" | "slot2" | "buddy";

/** Every field, in the order they are applied: the kit, then the buddy. */
export const BOOK_KIT_FIELDS: readonly BookKitField[] = ["style", "tent", "color", "slot0", "slot1", "slot2", "buddy"];

/** One field changed: the value it was made over, and the value picked. */
export interface BookKitChange {
  field: BookKitField;
  before: string | null;
  after: string | null;
}

/** A kit as the book edits it: its fields, with the buddy for one crew's camp. */
export interface BookKitState {
  style: string | null;
  tent: string | null;
  color: string | null;
  slots: (string | null)[];
  buddy: string | null;
}

export function isBookKitField(value: unknown): value is BookKitField {
  return typeof value === "string" && (BOOK_KIT_FIELDS as readonly string[]).includes(value);
}

/** The slot a slot field names, or null for a field that is not a slot. */
export function slotIndex(field: BookKitField): number | null {
  return field.startsWith("slot") ? Number(field.slice(4)) : null;
}

/** A stored kit as the book edits it, with her buddy in the camp `key` names (`campKey`). */
export function bookKitState(kit: Pick<HeroKit, "style" | "tent" | "color" | "slots"> & { buddies?: Readonly<Record<string, string>> }, key?: string): BookKitState {
  return {
    style: kit.style,
    tent: kit.tent,
    color: kit.color,
    slots: [...kit.slots],
    buddy: key !== undefined ? kit.buddies?.[key] ?? null : null,
  };
}

/** A field's value. A slot the kit does not have reads as empty. */
export function bookKitValue(state: BookKitState, field: BookKitField): string | null {
  const slot = slotIndex(field);
  if (slot !== null) return state.slots[slot] ?? null;
  return state[field as "style" | "tent" | "color" | "buddy"];
}

/** The state with one field set. A slot past the kit's last is not there to set, and is left alone. */
export function withBookKitValue(state: BookKitState, field: BookKitField, value: string | null): BookKitState {
  const slot = slotIndex(field);
  if (slot === null) return { ...state, [field]: value };
  if (slot >= state.slots.length) return state;
  const slots = [...state.slots];
  slots[slot] = value;
  return { ...state, slots };
}

/** The fields that differ between two states, each with the value it replaced. */
export function bookKitChanges(before: BookKitState, after: BookKitState): BookKitChange[] {
  const out: BookKitChange[] = [];
  for (const field of BOOK_KIT_FIELDS) {
    const was = bookKitValue(before, field);
    const now = bookKitValue(after, field);
    if (was !== now) out.push({ field, before: was, after: now });
  }
  return out;
}

/**
 * The table's `KIT_EDIT` for `state` over `base`: every field that differs,
 * slots as one list. What the server checks with `kitEditProblem`.
 */
export function bookKitEdit(base: BookKitState, state: BookKitState): KitEdit {
  const edit: KitEdit = {};
  if (state.style !== base.style && state.style !== null) edit.style = state.style;
  if (state.tent !== base.tent && state.tent !== null) edit.tent = state.tent;
  if (state.color !== base.color) edit.color = state.color;
  if (state.slots.some((s, i) => s !== (base.slots[i] ?? null))) edit.slots = [...state.slots];
  if (state.buddy !== base.buddy) edit.buddy = state.buddy;
  return edit;
}

/**
 * Why one field cannot take a value on this kit, or null when it can: the
 * table's rule (`kitEditProblem`) for that field alone. A style or tent is
 * never unset, and a slot the kit does not have cannot be filled.
 */
export function bookFieldProblem(
  rules: KitRules,
  unlocked: readonly string[],
  state: BookKitState,
  field: BookKitField,
  value: string | null,
  friends: readonly string[],
): string | null {
  if ((field === "style" || field === "tent") && value === null) return `a ${field} is always picked`;
  const slot = slotIndex(field);
  if (slot !== null && (slot >= state.slots.length || slot >= MAX_KIT_SLOTS)) return "that decoration spot is not on this kit";
  const next = withBookKitValue(state, field, value);
  return kitEditProblem(rules, unlocked, bookKitEdit(state, next), friends);
}

/** What a merge did, field by field. */
export interface BookKitMerge {
  state: BookKitState;
  /** Applied (or already so). */
  applied: BookKitField[];
  /** Changed elsewhere since the change was made: the newer value stays. */
  kept: BookKitField[];
  /** Not hers to pick (a locked piece, a friend this crew lacks): skipped. */
  refused: BookKitField[];
}

/**
 * Apply queued changes to the kit as it stands now, field by field (§7): a
 * change applies only where the field still has the value it was made over;
 * a field already at the picked value counts as applied; anything the table's
 * rule refuses is skipped. Emptied slots go first, so a decoration moved from
 * one spot to another never meets itself.
 */
export function mergeBookKit(
  current: BookKitState,
  changes: readonly BookKitChange[],
  check: (state: BookKitState, field: BookKitField, value: string | null) => string | null,
): BookKitMerge {
  const order = [...changes].sort((a, b) => rank(a) - rank(b));
  let state = current;
  const applied: BookKitField[] = [];
  const kept: BookKitField[] = [];
  const refused: BookKitField[] = [];
  for (const change of order) {
    const now = bookKitValue(state, change.field);
    if (now === change.after) {
      applied.push(change.field);
      continue;
    }
    if (now !== change.before) {
      kept.push(change.field);
      continue;
    }
    if (check(state, change.field, change.after) !== null) {
      refused.push(change.field);
      continue;
    }
    state = withBookKitValue(state, change.field, change.after);
    applied.push(change.field);
  }
  return { state, applied, kept, refused };
}

function rank(change: BookKitChange): number {
  const slot = slotIndex(change.field);
  return (slot !== null && change.after === null ? 0 : 1) * 10 + BOOK_KIT_FIELDS.indexOf(change.field);
}

/** Changes as a request carries them: well formed, each field once, or null. */
export function parseBookKitChanges(raw: unknown): BookKitChange[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > BOOK_KIT_FIELDS.length) return null;
  const seen = new Set<BookKitField>();
  const out: BookKitChange[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { field, before, after } = item as Record<string, unknown>;
    if (!isBookKitField(field) || seen.has(field)) return null;
    const value = (v: unknown): v is string | null => v === null || (typeof v === "string" && v.length > 0 && v.length <= 64);
    if (!value(before) || !value(after)) return null;
    seen.add(field);
    out.push({ field, before, after });
  }
  return out;
}

/** A kid's words for fields: "tent", "tent and color", "tent, color and buddy". */
export function bookFieldNames(fields: readonly BookKitField[]): string {
  const names: string[] = [];
  for (const field of fields) {
    const name = slotIndex(field) !== null ? "decorations" : field === "style" ? "bedroll" : field;
    if (!names.includes(name)) names.push(name);
  }
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}
