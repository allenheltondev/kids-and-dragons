/**
 * The adventure book's queue of kit and buddy changes (docs/camp.md §7; #629).
 *
 * Every change a kid makes to her own kit in the book is written here first,
 * before anything is sent, so it shows at once and survives the book being
 * closed, the phone locking or the signal dropping in the car. Each change
 * records, field by field, the value it was made over (shared camp-book.ts
 * `BookKitChange`), which is what lets the server merge it field by field when
 * it is finally sent: a field somebody changed elsewhere meanwhile keeps the
 * newer value, and every other field applies.
 *
 * The queue is the phone's: kept in its own storage (localStorage, beside the
 * binding it is sent with, persistence.ts) and tied to that binding's device
 * token, as the saved book is (`SavedJournal.deviceToken`). Read with another
 * token, or once the binding is revoked (`dropKitQueue`), it is gone unsent.
 *
 * It only holds; book-camp-sync.ts sends.
 */

import { withBookKitValue, type BookKitChange, type BookKitState, type JournalKit } from "@kad/shared";
import { defaultStorage, type KeyValueStorage } from "./persistence";

export const KIT_QUEUE_KEY = "kad.kitQueue";

/** One hero's queued changes. A buddy change is for one crew's camp; the rest of the kit is the hero's anywhere. */
export interface QueuedKitChange {
  /** This entry, so a send that lands removes exactly it. */
  id: string;
  characterId: string;
  /** With a buddy change: the crew whose camp it is for (null, the first crew). Absent for the rest of the kit. */
  crew?: string | null;
  changes: BookKitChange[];
  /**
   * Made with a signal, over the kit revision the book showed and nothing else
   * queued for her: sent first with the table's revision check. Once a send of
   * it fails for want of a signal, it is merged field by field instead.
   */
  revision?: number;
  /** ISO, when it was first queued. */
  at: string;
}

interface StoredQueue {
  deviceToken: string;
  entries: QueuedKitChange[];
}

const listeners = new Set<() => void>();

/** Hear the queue change: an edit queued, a send landing, the queue dropped. */
export function onKitQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  for (const listener of listeners) listener();
}

function safe(storage?: KeyValueStorage): KeyValueStorage {
  try {
    return storage ?? defaultStorage();
  } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
}

/** The queued changes for `deviceToken`'s binding, oldest first. A queue kept for another binding is dropped. */
export function loadKitQueue(deviceToken: string | null, storage?: KeyValueStorage): QueuedKitChange[] {
  const ls = safe(storage);
  let raw: string | null = null;
  try {
    raw = ls.getItem(KIT_QUEUE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredQueue>;
    if (deviceToken !== null && parsed.deviceToken === deviceToken && Array.isArray(parsed.entries)) return parsed.entries.filter(wellFormed);
  } catch {
    /* unreadable: dropped below */
  }
  // Another binding's queue (a re-adopted phone, a kid moved off it): never sent with this one.
  dropKitQueue(ls);
  return [];
}

function wellFormed(entry: unknown): entry is QueuedKitChange {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Partial<QueuedKitChange>;
  return typeof e.id === "string" && typeof e.characterId === "string" && Array.isArray(e.changes) && e.changes.length > 0;
}

function saveKitQueue(deviceToken: string, entries: readonly QueuedKitChange[], storage?: KeyValueStorage): void {
  const ls = safe(storage);
  try {
    if (entries.length === 0) ls.removeItem(KIT_QUEUE_KEY);
    else ls.setItem(KIT_QUEUE_KEY, JSON.stringify({ deviceToken, entries: [...entries] } satisfies StoredQueue));
  } catch {
    /* out of quota: the change still shows this time, and is sent while the page is open */
  }
  changed();
}

/** Whether anything waits to be sent, read cheaply (no token needed). */
export function hasQueuedKitChanges(storage?: KeyValueStorage): boolean {
  try {
    return safe(storage).getItem(KIT_QUEUE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Forget every queued change, unsent: the binding is revoked, or the phone is somebody else's now. */
export function dropKitQueue(storage?: KeyValueStorage): void {
  try {
    safe(storage).removeItem(KIT_QUEUE_KEY);
  } catch {
    /* nothing kept, nothing to drop */
  }
  changed();
}

let sequence = 0;
const newId = (): string => `kq_${Date.now().toString(36)}_${(sequence++).toString(36)}`;

/**
 * Queue `changes` to one hero's kit. A buddy change goes in an entry for its
 * crew, the rest in one for the hero. A field already queued (and not being
 * sent right now, `busy`) keeps the value it was first made over and takes the
 * new pick; one changed back to where it started is no change at all.
 * `revision` is the kit revision the book showed, given when there is a
 * signal: it is kept only on an entry that is all there is for her.
 */
export function enqueueKitChanges(
  deviceToken: string,
  input: { characterId: string; crew: string | null; changes: readonly BookKitChange[]; revision?: number; busy?: string | null },
  storage?: KeyValueStorage,
): QueuedKitChange[] {
  const entries = loadKitQueue(deviceToken, storage).map((e) => ({ ...e, changes: [...e.changes] }));
  const groups: { crew?: string | null; changes: BookKitChange[] }[] = [
    { changes: input.changes.filter((c) => c.field !== "buddy") },
    { crew: input.crew, changes: input.changes.filter((c) => c.field === "buddy") },
  ];
  for (const group of groups) {
    if (group.changes.length === 0) continue;
    const sameKey = (e: QueuedKitChange) => e.characterId === input.characterId && ("crew" in group ? e.crew === group.crew : e.crew === undefined);
    const open = entries.find((e) => sameKey(e) && e.id !== input.busy);
    if (open) {
      for (const change of group.changes) {
        const at = open.changes.findIndex((c) => c.field === change.field);
        if (at < 0) open.changes.push(change);
        else open.changes[at] = { field: change.field, before: open.changes[at]!.before, after: change.after };
      }
      open.changes = open.changes.filter((c) => c.before !== c.after);
      // Changed again: merged with whatever else it meets, never a stale all-or-nothing.
      delete open.revision;
      continue;
    }
    const alone = !entries.some((e) => e.characterId === input.characterId);
    entries.push({
      id: newId(),
      characterId: input.characterId,
      ...("crew" in group ? { crew: group.crew ?? null } : {}),
      changes: group.changes,
      ...(alone && input.revision !== undefined ? { revision: input.revision } : {}),
      at: new Date().toISOString(),
    });
  }
  const kept = entries.filter((e) => e.changes.length > 0);
  saveKitQueue(deviceToken, kept, storage);
  return kept;
}

/** Take one entry off the queue (its send landed, or can never land). */
export function removeQueuedKitChange(deviceToken: string, id: string, storage?: KeyValueStorage): void {
  saveKitQueue(deviceToken, loadKitQueue(deviceToken, storage).filter((e) => e.id !== id), storage);
}

/** An entry's send failed for want of a signal: from now on it merges field by field. */
export function demoteQueuedKitChange(deviceToken: string, id: string, storage?: KeyValueStorage): void {
  const entries = loadKitQueue(deviceToken, storage);
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.revision === undefined) return;
  delete entry.revision;
  saveKitQueue(deviceToken, entries, storage);
}

/** A book kit as the book edits it, with her buddy in one crew's camp. */
export function journalKitState(kit: JournalKit, crew: string | null): BookKitState {
  return { style: kit.style, tent: kit.tent, color: kit.color, slots: [...kit.slots], buddy: kit.buddies[crew ?? ""] ?? null };
}

/**
 * The kit as the book shows it: the server's, with every queued change for
 * her laid on top, oldest first, so what she picked shows at once, offline
 * and after the book is closed and opened again.
 */
export function withQueuedKit(kit: JournalKit, characterId: string, entries: readonly QueuedKitChange[]): JournalKit {
  let out: JournalKit = { ...kit, slots: [...kit.slots], buddies: { ...kit.buddies } };
  for (const entry of entries) {
    if (entry.characterId !== characterId) continue;
    for (const change of entry.changes) {
      if (change.field === "buddy") {
        const key = entry.crew ?? "";
        const buddies = { ...out.buddies };
        if (change.after === null) delete buddies[key];
        else buddies[key] = change.after;
        out = { ...out, buddies };
        continue;
      }
      const state = withBookKitValue(journalKitState(out, null), change.field, change.after);
      out = { ...out, style: state.style, tent: state.tent, color: state.color, slots: state.slots };
    }
  }
  return out;
}
