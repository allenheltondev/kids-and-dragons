/**
 * Sending the adventure book's kit and buddy changes (docs/camp.md §7; #629).
 *
 * Every change is queued first (kit-queue.ts), then sent here, one queued
 * entry at a time, to `POST /api/journal/kit` with the phone's device token,
 * as the book's read is authorised:
 *
 *   - an entry made with a signal over the kit the book showed, alone in the
 *     queue for her, goes with that kit's revision: the table's rule, all or
 *     nothing, and a kit changed elsewhere since applies none of it (`stale`);
 *   - anything else (queued with no signal, or whose first send never got
 *     there) merges field by field on the server, and what it kept from
 *     somewhere else comes back as a short note.
 *
 * With no signal the entry stays queued and the book says so ("Saved on this
 * phone"); it is sent when the signal returns (`flushKitQueue`, which the book
 * runs as it opens and on the browser's `online`). A refused binding (401)
 * drops the whole queue unsent. Every kit the server answers with is written
 * into the saved book (journal-db.ts), so it opens offline as it now is.
 *
 * A family tablet's picked kid has no device token, and nothing of hers is
 * kept on the tablet (store/index.ts `loadJournal`): her change is sent with
 * her room session straight away, or not at all.
 */

import { bookFieldNames, type BookKitChange, type BookKitRequest, type BookKitResponse, type JournalKit } from "@kad/shared";
import { ApiError, request } from "../sync/client";
import { loadPlayerDeviceToken } from "./persistence";
import { useGameStore } from "./index";
import {
  demoteQueuedKitChange,
  dropKitQueue,
  enqueueKitChanges,
  loadKitQueue,
  onKitQueue,
  removeQueuedKitChange,
  type QueuedKitChange,
} from "./kit-queue";

/** Where the book's kit edits stand, for the book to say. */
export interface BookKitStatus {
  /** The last send found no signal: what is queued waits for one. */
  offline: boolean;
  /** Short, kid-readable notes about what a send did, newest last, until she closes them. */
  notes: string[];
}

let status: BookKitStatus = { offline: false, notes: [] };
let busy: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Hear the queue or the status change. */
export function onBookKit(listener: () => void): () => void {
  listeners.add(listener);
  const off = onKitQueue(listener);
  return () => {
    listeners.delete(listener);
    off();
  };
}

export function bookKitStatus(): BookKitStatus {
  return status;
}

function setStatus(next: Partial<BookKitStatus>): void {
  status = { ...status, ...next };
  emit();
}

/** Close the notes. */
export function clearBookKitNotes(): void {
  if (status.notes.length > 0) setStatus({ notes: [] });
}

/** Note what a send did, if it needs saying. */
function noteOf(response: BookKitResponse): string | null {
  if (response.stale) return "Your kit changed on another screen, so here it is as it is now.";
  const kept = response.kept.length > 0 ? bookFieldNames(response.kept) : null;
  const refused = response.refused.length > 0 ? bookFieldNames(response.refused) : null;
  const lines: string[] = [];
  if (kept) lines.push(`Your ${kept} changed on another screen while you were away, so the newer ${response.kept.length > 1 ? "ones stay" : "one stays"}.`);
  if (refused) lines.push(`Your ${refused} pick could not be saved.`);
  return lines.length > 0 ? lines.join(" ") : null;
}

/** No signal: the fetch never got there, or the browser says it is offline. */
function noSignal(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError || (error instanceof ApiError && error.status === 0);
}

function bodyOf(entry: Pick<QueuedKitChange, "characterId" | "crew" | "revision"> & { changes: readonly BookKitChange[] }): BookKitRequest {
  return {
    characterId: entry.characterId,
    ...(entry.crew !== undefined ? { crew: entry.crew } : {}),
    ...(entry.revision !== undefined ? { revision: entry.revision } : { merge: true as const }),
    changes: [...entry.changes],
  };
}

function send(body: BookKitRequest, auth: { deviceToken: string } | { sessionToken: string }): Promise<BookKitResponse> {
  return request<BookKitResponse>("/api/journal/kit", {
    method: "POST",
    headers: { "content-type": "application/json", ...("deviceToken" in auth ? { "x-kad-device-token": auth.deviceToken } : {}) },
    ...("sessionToken" in auth ? { token: auth.sessionToken } : {}),
    body: JSON.stringify(body),
  });
}

/** Put the kit the server answered with into the saved book, so it opens offline as it now is. */
async function saveKit(deviceToken: string, characterId: string, kit: JournalKit): Promise<void> {
  try {
    const db = await import("./journal-db");
    const saved = await db.loadSavedJournal(deviceToken);
    if (!saved?.journal.camp) return;
    const camp = { ...saved.journal.camp, kits: { ...saved.journal.camp.kits, [characterId]: kit } };
    await db.saveJournal({ ...saved, journal: { ...saved.journal, camp } });
  } catch {
    /* the next read with a signal saves it */
  }
}

/** Where a kit the server answered with goes: the open book's copy. */
export type ApplyKit = (characterId: string, kit: JournalKit) => void;

let running: Promise<void> | null = null;
let again = false;

/**
 * Send everything queued, oldest first, until the queue is empty, a send finds
 * no signal, or the server is not answering. One run at a time; asked again
 * while running, it runs once more after.
 */
export function flushKitQueue(apply: ApplyKit): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await drain(apply);
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function drain(apply: ApplyKit): Promise<void> {
  const deviceToken = loadPlayerDeviceToken();
  if (!deviceToken) return;
  for (;;) {
    const entry = loadKitQueue(deviceToken)[0];
    if (!entry) {
      if (status.offline) setStatus({ offline: false });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      demoteQueuedKitChange(deviceToken, entry.id);
      setStatus({ offline: true });
      return;
    }
    busy = entry.id;
    try {
      const response = await send(bodyOf(entry), { deviceToken });
      removeQueuedKitChange(deviceToken, entry.id);
      apply(entry.characterId, response.kit);
      await saveKit(deviceToken, entry.characterId, response.kit);
      const note = noteOf(response);
      setStatus({ offline: false, notes: note ? [...status.notes, note] : status.notes });
    } catch (error) {
      if (noSignal(error)) {
        demoteQueuedKitChange(deviceToken, entry.id);
        setStatus({ offline: true });
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        // The binding is gone (revoked, or the kid moved off this phone): nothing here is hers to send.
        dropKitQueue();
        setStatus({ offline: false });
        return;
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== "STALE_DECISION") {
        // It can never land (not her hero any more, not a pick she has): let it go, and say so.
        removeQueuedKitChange(deviceToken, entry.id);
        setStatus({ notes: [...status.notes, "One of your changes could not be saved."] });
        continue;
      }
      // The server is busy or down: it waits, as it would with no signal.
      setStatus({ offline: true });
      return;
    } finally {
      busy = null;
    }
  }
}

/**
 * The book's edit: queue it (so it shows at once and outlives the book being
 * closed), then send what is queued. `revision` is the kit revision the book
 * showed. A tablet with no device token sends it straight away instead, with
 * the picked kid's room session; the answer is the kit as it now stands, or
 * an error to say.
 */
export async function editBookKit(
  input: { characterId: string; crew: string | null; changes: readonly BookKitChange[]; revision: number },
  apply: ApplyKit,
): Promise<void> {
  if (input.changes.length === 0) return;
  const deviceToken = loadPlayerDeviceToken();
  if (deviceToken) {
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    const { characterId, crew, changes, revision } = input;
    enqueueKitChanges(deviceToken, { characterId, crew, changes, ...(online ? { revision } : {}), busy });
    if (!online) setStatus({ offline: true });
    await flushKitQueue(apply);
    return;
  }
  const sessionToken = useGameStore.getState().session?.sessionToken;
  if (!sessionToken) throw new ApiError(401, "This phone is not signed in as anyone yet.");
  const response = await send(bodyOf(input), { sessionToken });
  apply(input.characterId, response.kit);
  const note = noteOf(response);
  if (note) setStatus({ notes: [...status.notes, note] });
}

/** Test seam: forget the status. */
export function resetBookKitSync(): void {
  status = { offline: false, notes: [] };
  busy = null;
  again = false;
}
