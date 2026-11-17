/**
 * The adventure book's queue of Field Guide quiz answers (docs/trivia.md §6.2).
 *
 * The quiz works in the car, so every answer is written here first, before
 * anything is sent: it counts on the phone at once and survives the book
 * being closed, the phone locking or the signal dropping. book-trivia-sync.ts
 * sends what is queued to `POST /api/journal/trivia`, where the server
 * decides what counts, and takes each answer off once it has landed.
 *
 * Kept exactly the way the book's kit edits are (kit-queue.ts): in the phone's
 * own storage, beside the binding it is sent with, and tied to that binding's
 * device token. Read with another token, or once the binding is revoked
 * (`dropTriviaQueue`), it is gone unsent. When storage will not take a write
 * (out of quota, a private window), it is kept in memory for as long as the
 * page is open (`triviaQueueUnsaved`).
 *
 * It only holds; book-trivia-sync.ts sends.
 */

import { markAnswer, readTriviaRecord, type FoundEntries, type TriviaAnswer, type TriviaBank, type TriviaRecord } from "@kad/shared";
import { defaultStorage, type KeyValueStorage } from "./persistence";

export const TRIVIA_QUEUE_KEY = "kad.triviaQueue";

/** One queued answer, with an id so a send that lands removes exactly it. */
export interface QueuedTriviaAnswer extends TriviaAnswer {
  id: string;
}

interface StoredQueue {
  deviceToken: string;
  entries: QueuedTriviaAnswer[];
}

const listeners = new Set<() => void>();

/** The queue as this page last wrote it, when the phone's storage would not take it. */
let unsaved: StoredQueue | null = null;

/** Whether something queued is kept only in this page's memory. */
export function triviaQueueUnsaved(): boolean {
  return unsaved !== null && unsaved.entries.length > 0;
}

/** Hear the queue change: an answer queued, a send landing, the queue dropped. */
export function onTriviaQueue(listener: () => void): () => void {
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
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error("this phone has no storage to keep it in");
      },
      removeItem: () => undefined,
    };
  }
}

function wellFormed(entry: unknown): entry is QueuedTriviaAnswer {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Partial<QueuedTriviaAnswer>;
  return (
    typeof e.id === "string" &&
    typeof e.questionId === "string" &&
    typeof e.picked === "string" &&
    typeof e.at === "string" &&
    typeof e.round === "string" &&
    Array.isArray(e.optionsShown) &&
    e.optionsShown.every((o) => typeof o === "string")
  );
}

/** The queued answers for `deviceToken`'s binding, oldest first. A queue kept for another binding is dropped. */
export function loadTriviaQueue(deviceToken: string | null, storage?: KeyValueStorage): QueuedTriviaAnswer[] {
  if (unsaved !== null) {
    if (deviceToken !== null && unsaved.deviceToken === deviceToken) return unsaved.entries.map((e) => ({ ...e, optionsShown: [...e.optionsShown] }));
    unsaved = null;
  }
  const ls = safe(storage);
  let raw: string | null = null;
  try {
    raw = ls.getItem(TRIVIA_QUEUE_KEY);
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
  // Another binding's answers (a re-adopted phone, a kid moved off it): never sent with this one.
  dropTriviaQueue(ls);
  return [];
}

function saveTriviaQueue(deviceToken: string, entries: readonly QueuedTriviaAnswer[], storage?: KeyValueStorage): void {
  const ls = safe(storage);
  try {
    if (entries.length === 0) ls.removeItem(TRIVIA_QUEUE_KEY);
    else ls.setItem(TRIVIA_QUEUE_KEY, JSON.stringify({ deviceToken, entries: [...entries] } satisfies StoredQueue));
    unsaved = null;
  } catch {
    unsaved = { deviceToken, entries: entries.map((e) => ({ ...e, optionsShown: [...e.optionsShown] })) };
  }
  changed();
}

/** Whether any answer waits to be sent, read cheaply (no token needed). */
export function hasQueuedTriviaAnswers(storage?: KeyValueStorage): boolean {
  if (unsaved !== null) return unsaved.entries.length > 0;
  try {
    return safe(storage).getItem(TRIVIA_QUEUE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Forget every queued answer, unsent: the binding is revoked, or the phone is somebody else's now. */
export function dropTriviaQueue(storage?: KeyValueStorage): void {
  unsaved = null;
  try {
    safe(storage).removeItem(TRIVIA_QUEUE_KEY);
  } catch {
    /* nothing kept, nothing to drop */
  }
  changed();
}

let sequence = 0;
const newId = (): string => `tq_${Date.now().toString(36)}_${(sequence++).toString(36)}`;

/** Queue one answer, last. */
export function enqueueTriviaAnswer(deviceToken: string, answer: TriviaAnswer, storage?: KeyValueStorage): QueuedTriviaAnswer[] {
  const entries = [...loadTriviaQueue(deviceToken, storage), { ...answer, optionsShown: [...answer.optionsShown], id: newId() }];
  saveTriviaQueue(deviceToken, entries, storage);
  return entries;
}

/** Take answers off the queue (their send landed, or can never land). */
export function removeQueuedTriviaAnswers(deviceToken: string, ids: readonly string[], storage?: KeyValueStorage): void {
  const gone = new Set(ids);
  saveTriviaQueue(deviceToken, loadTriviaQueue(deviceToken, storage).filter((e) => !gone.has(e.id)), storage);
}

/** The answer as the server is sent it: the queue's id stays on the phone. */
export function triviaAnswerOf(entry: QueuedTriviaAnswer | TriviaAnswer): TriviaAnswer {
  return { questionId: entry.questionId, optionsShown: [...entry.optionsShown], picked: entry.picked, at: entry.at, round: entry.round };
}

/**
 * Her quiz as the book shows it: the server's record (read tolerantly, so a
 * book from before the quiz is an empty one), with every answer still waiting
 * to be sent marked over it, oldest first, by the same rules the server uses
 * (shared trivia.ts `markAnswer`). An answer the rules refuse changes nothing
 * here either, so what the phone shows is what the server will say.
 */
export function withQueuedTrivia(
  record: TriviaRecord | null | undefined,
  answers: readonly TriviaAnswer[],
  bank: TriviaBank | null,
  found: FoundEntries,
): TriviaRecord {
  let out = readTriviaRecord(record ?? null);
  if (!bank) return out;
  for (const answer of answers) {
    const marked = markAnswer(out, answer, bank, found);
    if (marked.ok) out = marked.record;
  }
  return out;
}
