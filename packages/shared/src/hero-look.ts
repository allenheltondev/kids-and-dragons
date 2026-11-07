/**
 * Hero looks (docs/hero-looks.md §3, §6, §7): the pure rules the server
 * writes by and the screens offer by.
 *
 * One look per hero (`Character.look`), edited from two places exactly as her
 * kit is (§3.2; camp-book.ts):
 *
 *   - **At the table**, `LOOK_EDIT` names the look's `revision`; a look changed
 *     since (from the book, another phone) refuses it as stale.
 *   - **From the book**, field by field, the device winning: each field a book
 *     change names takes its pick over whatever is stored by then
 *     (`mergeBookLook`), and the queue sends them oldest first, so the last
 *     choice for each field stands.
 *
 * Either way the server checks every look named is hers (a starter, or one she
 * holds a receipt for) and, for a colour, one of her species' own (§7.1).
 *
 * Where to add a field (#666 brings the Color shelf for `coat`): the field is
 * already in `LookEdit`, `BOOK_LOOK_FIELDS` and the stored shape, and
 * `lookEditProblem` already checks it against the catalog's coats; a coat
 * with no catalog entry is simply refused until then.
 */

import type { Character, SpeciesId } from "./types/domain.js";
import type { HeroLook, HeroLookView, LookCatalog, LookUnlock } from "./types/look.js";
import { LOOK_VERSION } from "./types/look.js";

/** The longest title the catalog may have, in characters: what the nameplate collision tests are run at (§7.3). */
export const TITLE_MAX_CHARS = 20;

/** The frame a hero with no choice wears: today's look (§7.2). */
export const PLAIN_NAMEPLATE = "plain";

/** A look nothing has been chosen on yet: as painted, the plain plate, no title. */
export function emptyLook(): HeroLook {
  return { v: LOOK_VERSION, revision: 0, coat: null, nameplate: null, title: null, unlocked: {} };
}

/** Her look as stored, or an empty one. Read it this way, never off the row directly. */
export function readLook(character: Pick<Character, "look">): HeroLook {
  return character.look ?? emptyLook();
}

/** What the screens draw and edit: the look, less the receipts. */
export function lookView(look: HeroLook): HeroLookView {
  return {
    revision: look.revision,
    coat: look.coat,
    nameplate: look.nameplate,
    title: look.title,
    unlocked: Object.keys(look.unlocked).sort(),
  };
}

/** Every starter in the catalog: free for every hero, never stored (§6). */
export function starterLooks(catalog: LookCatalog): Set<string> {
  const out = new Set<string>();
  for (const list of [catalog.coats, catalog.nameplates, catalog.titles]) {
    for (const entry of list) if (entry.unlock.from === "starter") out.add(entry.id);
  }
  return out;
}

/** Whether a look is hers: a starter, or one she holds a receipt for. */
export function holdsLook(catalog: LookCatalog, unlocked: readonly string[], id: string): boolean {
  return starterLooks(catalog).has(id) || unlocked.includes(id);
}

/** What a look edit may change. Absent: unchanged. Null: back to as painted, the plain plate, no title. */
export interface LookEdit {
  coat?: string | null;
  nameplate?: string | null;
  title?: string | null;
}

/** One thing a kid picks for her look, as the book queues it (§3.2). */
export type BookLookField = "coat" | "nameplate" | "title";

/** Every look field, in the order they are applied. */
export const BOOK_LOOK_FIELDS: readonly BookLookField[] = ["coat", "nameplate", "title"];

export function isBookLookField(value: unknown): value is BookLookField {
  return typeof value === "string" && (BOOK_LOOK_FIELDS as readonly string[]).includes(value);
}

/**
 * Why `edit` cannot be made to a look holding `unlocked`, or null when it can:
 * each id must be in the catalog and hers to wear, and a coat must be one of
 * her species' own. Null for "as painted", "plain" and "no title" is always
 * fine.
 */
export function lookEditProblem(
  catalog: LookCatalog,
  unlocked: readonly string[],
  edit: LookEdit,
  species: SpeciesId,
): string | null {
  const held = (id: string): boolean => holdsLook(catalog, unlocked, id);
  if (edit.coat !== undefined && edit.coat !== null) {
    const coat = catalog.coats.find((c) => c.id === edit.coat);
    if (!coat) return `no such color "${edit.coat}"`;
    if (!coat.species.includes(species)) return `"${edit.coat}" is not one of her colors`;
    if (!held(coat.id)) return `"${edit.coat}" is not hers yet`;
  }
  if (edit.nameplate !== undefined && edit.nameplate !== null) {
    const frame = catalog.nameplates.find((n) => n.id === edit.nameplate);
    if (!frame) return `no such nameplate "${edit.nameplate}"`;
    if (!held(frame.id)) return `the ${frame.name} nameplate is not hers yet`;
  }
  if (edit.title !== undefined && edit.title !== null) {
    const title = catalog.titles.find((t) => t.id === edit.title);
    if (!title) return `no such title "${edit.title}"`;
    if (!held(title.id)) return `"${title.text}" is not hers yet`;
  }
  return null;
}

/** The look with an edit made. Never bumps `revision`: the write does. */
export function withLookEdit(look: HeroLook, edit: LookEdit): HeroLook {
  return {
    ...look,
    ...(edit.coat !== undefined ? { coat: edit.coat } : {}),
    ...(edit.nameplate !== undefined ? { nameplate: edit.nameplate } : {}),
    ...(edit.title !== undefined ? { title: edit.title } : {}),
  };
}

/** Whether an edit changes anything on this look. */
export function lookEditChanges(look: Pick<HeroLook, BookLookField>, edit: LookEdit): boolean {
  return BOOK_LOOK_FIELDS.some((f) => edit[f] !== undefined && edit[f] !== look[f]);
}

/**
 * Whether a `LOOK_EDIT` from a phone has the shape its type says: a hero id,
 * a whole-number revision, and short ids or nulls where looks go. Null when
 * it does; otherwise the field that does not.
 */
export function lookIntentProblem(intent: Record<string, unknown>): string | null {
  const id = (v: unknown): boolean => typeof v === "string" && v.length > 0 && v.length <= 64;
  if (!id(intent["characterId"])) return "characterId";
  const revision = intent["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return "revision";
  for (const field of BOOK_LOOK_FIELDS) {
    const value = intent[field];
    if (value !== undefined && value !== null && !id(value)) return field;
  }
  if (!BOOK_LOOK_FIELDS.some((f) => intent[f] !== undefined)) return "nothing to change";
  return null;
}

/** One book change to a look field: what it was made over, and the pick. */
export interface BookLookChange {
  field: BookLookField;
  before: string | null;
  after: string | null;
}

/** What applying a book change to a look did, field by field. */
export interface BookLookMerge {
  look: HeroLook;
  /** Applied (or already so), in `BOOK_LOOK_FIELDS` order. */
  applied: BookLookField[];
  /** Not hers to pick: skipped, keeping what is stored. */
  refused: BookLookField[];
}

/**
 * Apply book changes to the look as it stands now (§3.2): every field takes
 * its pick over whatever is stored, the device winning, and a pick that is
 * not hers (`check`, `lookEditProblem` for that one field) is skipped.
 */
export function mergeBookLook(
  current: HeroLook,
  changes: readonly BookLookChange[],
  check: (edit: LookEdit) => string | null,
): BookLookMerge {
  let look = current;
  const applied = new Set<BookLookField>();
  const refused = new Set<BookLookField>();
  for (const change of changes) {
    const edit: LookEdit = { [change.field]: change.after };
    if (look[change.field] !== change.after && check(edit) !== null) {
      refused.add(change.field);
      continue;
    }
    look = withLookEdit(look, edit);
    applied.add(change.field);
  }
  const order = (fields: Set<BookLookField>) => BOOK_LOOK_FIELDS.filter((f) => fields.has(f));
  return { look, applied: order(applied), refused: order(refused) };
}

/** A look view with book changes laid on top, oldest first: what the book shows while they are queued. */
export function withBookLookChanges(view: HeroLookView, changes: readonly BookLookChange[]): HeroLookView {
  let out = view;
  for (const change of changes) out = { ...out, [change.field]: change.after };
  return out;
}

/** A title's words, or null for none (or one the catalog no longer has). */
export function lookTitleText(catalog: Pick<LookCatalog, "titles">, id: string | null | undefined): string | null {
  if (!id) return null;
  return catalog.titles.find((t) => t.id === id)?.text ?? null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** A stored look that cannot be read. */
export class StoredLookError extends Error {
  override name = "StoredLookError";
}

const LOOK_STEPS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** Storage → domain for `Character.look`, which carries its own `v`. */
export function migrateLook(data: unknown): HeroLook {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new StoredLookError("look: stored value is not an object");
  let raw = data as Record<string, unknown>;
  const version = typeof raw["v"] === "number" ? raw["v"] : 0;
  if (version > LOOK_VERSION) throw new StoredLookError(`look: stored at v${version}, this build understands up to v${LOOK_VERSION}`);
  for (let v = version; v < LOOK_VERSION; v++) {
    const step = LOOK_STEPS[v];
    // v0 is a look written before it was versioned: the same shape.
    if (step) raw = step(raw);
  }
  const nullable = (key: string): string | null => {
    const value = raw[key] ?? null;
    if (value !== null && (typeof value !== "string" || value.length === 0)) throw new StoredLookError(`look.${key}: expected an id or null`);
    return value as string | null;
  };
  const revision = raw["revision"] ?? 0;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) throw new StoredLookError("look.revision: expected a whole number");
  const unlockedRaw = raw["unlocked"] ?? {};
  if (typeof unlockedRaw !== "object" || unlockedRaw === null || Array.isArray(unlockedRaw)) throw new StoredLookError("look.unlocked: expected a map");
  const unlocked: Record<string, LookUnlock> = {};
  for (const [id, value] of Object.entries(unlockedRaw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) throw new StoredLookError(`look.unlocked.${id}: expected a receipt`);
    const r = value as Record<string, unknown>;
    if (r["from"] !== "starter" && r["from"] !== "found" && r["from"] !== "milestone") throw new StoredLookError(`look.unlocked.${id}.from`);
    unlocked[id] = {
      from: r["from"],
      ...(typeof r["rewardId"] === "string" ? { rewardId: r["rewardId"] } : {}),
      ...(typeof r["at"] === "string" ? { at: r["at"] } : {}),
      ...(typeof r["source"] === "string" ? { source: r["source"] } : {}),
    };
  }
  return { v: LOOK_VERSION, revision, coat: nullable("coat"), nameplate: nullable("nameplate"), title: nullable("title"), unlocked };
}
