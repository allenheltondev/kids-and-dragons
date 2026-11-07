/**
 * A kid's own kit and buddy, changed from the adventure book (docs/camp.md §7,
 * §12.6; #629): the pure rules the server applies by and the book's offline
 * queue records with.
 *
 * The book edits field by field. A field is one thing a kid picks: the tent,
 * the bedroll and pack (`style`), the color, each decoration slot, and the
 * buddy in one crew's camp. Each change records the value it was made over
 * (`before`), as the queue keeps it, but **the device wins** (decided, §11):
 * a kid's own kit is only ever edited on her one phone, so a change from the
 * book, sent straight away or long after from the queue, applies over whatever
 * the server has now, as most offline-first apps do (`mergeBookKit`).
 *
 * What is never waived is validity: the server checks each field with the
 * table's own rule (`kitEditProblem`), so the book can never pick a piece the
 * hero does not have or a friend the crew lacks.
 */

import { kitEditProblem, MAX_KIT_SLOTS, type KitEdit, type KitRules } from "./camp-edit.js";
import { BOOK_LOOK_FIELDS, isBookLookField, type BookLookChange, type BookLookField } from "./hero-look.js";
import type { HeroKit } from "./types/camp.js";

/** One thing a kid picks for her kit (§4.5), or her buddy in one crew's camp (§4.4). */
export type BookKitField = "style" | "tent" | "color" | "slot0" | "slot1" | "slot2" | "buddy";

/** Every field, in the order they are applied: the kit, then the buddy. */
export const BOOK_KIT_FIELDS: readonly BookKitField[] = ["style", "tent", "color", "slot0", "slot1", "slot2", "buddy"];

/**
 * Anything the book edits for one hero, wherever she goes: her kit's fields
 * and her look's (docs/hero-looks.md §3.2; #664). Both ride the same queue,
 * sender and endpoint; the look's fields are new change kinds beside the kit's.
 */
export type BookEditField = BookKitField | BookLookField;

/** Every field the book can send, kit then look: the most one request may carry. */
export const BOOK_EDIT_FIELDS: readonly BookEditField[] = [...BOOK_KIT_FIELDS, ...BOOK_LOOK_FIELDS];

/** One field changed: the value it was made over, and the value picked. */
export interface BookKitChange {
  field: BookEditField;
  before: string | null;
  after: string | null;
}

/** A change to one of her kit's fields (or her buddy). */
export type KitFieldChange = BookKitChange & { field: BookKitField };

/** Whether a change is to her kit (or buddy) rather than her look. */
export function isKitChange(change: BookKitChange): change is KitFieldChange {
  return isBookKitField(change.field);
}

/** Whether a change is to her look (docs/hero-looks.md §3.2). */
export function isLookChange(change: BookKitChange): change is BookLookChange {
  return isBookLookField(change.field);
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
export function bookKitChanges(before: BookKitState, after: BookKitState): KitFieldChange[] {
  const out: KitFieldChange[] = [];
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
 * Why a kit cannot go from `base` to `next`, or null when it can: the table's
 * rule (`kitEditProblem`) for whatever differs, slots as one arrangement. A
 * style or tent once picked is never unset. No difference is no problem.
 */
export function bookKitProblem(
  rules: KitRules,
  unlocked: readonly string[],
  base: BookKitState,
  next: BookKitState,
  friends: readonly string[],
): string | null {
  for (const field of ["style", "tent"] as const) if (next[field] === null && base[field] !== null) return `a ${field} is always picked`;
  const edit = bookKitEdit(base, next);
  return Object.keys(edit).length === 0 ? null : kitEditProblem(rules, unlocked, edit, friends);
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
  return bookKitProblem(rules, unlocked, state, withBookKitValue(state, field, value), friends);
}

/** What applying a book change did, field by field. */
export interface BookKitMerge {
  state: BookKitState;
  /** Applied (or already so), in `BOOK_KIT_FIELDS` order. */
  applied: BookKitField[];
  /** Not hers to pick (a locked piece, a friend this crew lacks, a piece hung twice): skipped, in `BOOK_KIT_FIELDS` order. */
  refused: BookKitField[];
}

/**
 * Apply a book change to the kit as it stands now: every field takes the
 * picked value, whatever the server has meanwhile (the device wins, §7, §11),
 * and anything the table's rule refuses is skipped, keeping what is stored.
 * `check` is that rule for a whole kit (`bookKitProblem`).
 *
 * The style, tent, color and buddy are checked one by one. The slots are
 * checked as one arrangement, as the table's `KIT_EDIT` checks them: every
 * queued slot laid over the stored ones, so a swap or a rotation of pieces
 * already hung lands whole (#656). Where that arrangement is not hers to
 * have, only the queued slots that cause it keep their stored value: first a
 * piece that is not hers to hang at all, then any piece hung twice by a queued
 * slot, until what is left is valid.
 */
export function mergeBookKit(
  current: BookKitState,
  all: readonly BookKitChange[],
  check: (base: BookKitState, next: BookKitState) => string | null,
): BookKitMerge {
  // Her look's fields are merged on their own (hero-look.ts `mergeBookLook`).
  const changes = all.filter(isKitChange);
  let state = current;
  const applied = new Set<BookKitField>();
  const refused = new Set<BookKitField>();
  for (const change of changes) {
    if (slotIndex(change.field) !== null) continue;
    const next = withBookKitValue(state, change.field, change.after);
    if (bookKitValue(state, change.field) !== change.after && check(state, next) !== null) {
      refused.add(change.field);
      continue;
    }
    state = next;
    applied.add(change.field);
  }

  // The slots: one arrangement, from every queued slot over the stored ones.
  const queued = new Map<number, KitFieldChange>();
  for (const change of changes) {
    const slot = slotIndex(change.field);
    if (slot === null) continue;
    if (slot < state.slots.length && slot < MAX_KIT_SLOTS) queued.set(slot, change);
    else refused.add(change.field);
  }
  const keep = (slot: number) => {
    refused.add(queued.get(slot)!.field);
    queued.delete(slot);
  };
  const empty = state.slots.map(() => null);
  // A piece that is not hers to hang anywhere.
  for (const [slot, change] of queued) {
    if (change.after === null || change.after === state.slots[slot]) continue;
    const alone = empty.map((_, i) => (i === slot ? change.after : null));
    if (check({ ...state, slots: empty }, { ...state, slots: alone }) !== null) keep(slot);
  }
  const arranged = () => state.slots.map((piece, i) => (queued.has(i) ? queued.get(i)!.after : piece));
  for (;;) {
    const slots = arranged();
    if (check(state, { ...state, slots }) === null) break;
    // A piece hung twice: the queued slots that hang it keep what is stored. Nothing else to blame: none of them apply.
    const hung = slots.filter((p): p is string => p !== null);
    const twice = [...queued.keys()].filter((i) => slots[i] !== null && hung.filter((p) => p === slots[i]).length > 1);
    const blamed = twice.length > 0 ? twice : [...queued.keys()];
    if (blamed.length === 0) break;
    for (const slot of blamed) keep(slot);
  }
  if (queued.size > 0) {
    state = { ...state, slots: arranged() };
    for (const change of queued.values()) applied.add(change.field);
  }
  const order = (fields: Set<BookKitField>) => BOOK_KIT_FIELDS.filter((f) => fields.has(f));
  return { state, applied: order(applied), refused: order(refused) };
}

/** Changes as a request carries them: well formed, each field once, or null. */
export function parseBookKitChanges(raw: unknown): BookKitChange[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > BOOK_EDIT_FIELDS.length) return null;
  const seen = new Set<BookEditField>();
  const out: BookKitChange[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { field, before, after } = item as Record<string, unknown>;
    if (!(isBookKitField(field) || isBookLookField(field)) || seen.has(field)) return null;
    const value = (v: unknown): v is string | null => v === null || (typeof v === "string" && v.length > 0 && v.length <= 64);
    if (!value(before) || !value(after)) return null;
    seen.add(field);
    out.push({ field, before, after });
  }
  return out;
}

/** A kid's words for fields: "tent", "tent and color", "tent, color and buddy". */
export function bookFieldNames(fields: readonly BookEditField[]): string {
  const names: string[] = [];
  for (const field of fields) {
    const name = isBookLookField(field)
      ? field === "coat"
        ? "hero color"
        : field
      : slotIndex(field) !== null
        ? "decorations"
        : field === "style"
          ? "bedroll"
          : field;
    if (!names.includes(name)) names.push(name);
  }
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}
