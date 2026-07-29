/**
 * The read path for stored characters, shared by both repositories.
 *
 * It lives here rather than in either store because the contract suite runs one
 * set of tests against `MemoryRepository` and `DynamoRepository` both — so a
 * migration that only one of them applied would pass every test and then behave
 * differently in prod than it did on a laptop.
 */

import { migrateCharacter, type Character } from "@kad/shared";

/** The part of an item envelope this cares about. Both stores' items satisfy it. */
export interface StoredItem {
  data: unknown;
  /** Absent means a row written before versioning — v0. */
  v?: number;
}

/**
 * Migrates a whole partition of characters, dropping any that cannot be
 * repaired.
 *
 * Skip-and-log rather than throw, which is the opposite of `getCharacter()`'s
 * answer for the same problem, and deliberately so. Asking for one character by
 * id and getting a broken row back is a dead end — there is nothing to return
 * and the caller wanted *that* character. Listing a household's characters is a
 * different question: one unreadable row must not take the other two down with
 * it, because that is the difference between "Pip's sheet is missing" and "the
 * game will not start". It matches the rule `resolveCharacter()` already
 * follows — a stale save must not end the session at the table.
 */
export function readAll(items: readonly StoredItem[], householdId: string): Character[] {
  const characters: Character[] = [];
  for (const item of items) {
    try {
      characters.push(migrateCharacter(item.data, item.v));
    } catch (err) {
      // Loud in the logs, silent at the table. This is the one place a corrupt
      // character is survivable, so it is also the only warning anyone will
      // ever get that one exists.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[store] skipping unreadable character in ${householdId}: ${reason}`);
    }
  }
  return characters;
}
