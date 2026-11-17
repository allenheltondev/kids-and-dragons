/**
 * Sending the Field Guide quiz's answers (docs/trivia.md §6.2).
 *
 * The phone marks every answer on the spot, so the quiz works in the car, but
 * the server decides what counts. Every answer is queued first
 * (trivia-queue.ts), then sent here, a batch at a time, to
 * `POST /api/journal/trivia` with the phone's device token, as the book's
 * read and its kit edits are (book-kit-sync.ts). The server answers with her
 * record as it now stands, which goes into the open book (`ApplyTrivia`) and
 * the saved one (journal-db.ts), so the quiz opens offline as it now is.
 *
 * With no signal the answers stay queued, and are sent when the signal
 * returns (`flushTriviaQueue`, which the book runs as it opens and on the
 * browser's `online`). A refused binding (401) drops the queue unsent. A
 * batch the server can never take (a 4xx that is not "not now") is let go.
 *
 * A family tablet's picked kid has no device token, and nothing of hers is
 * kept on the tablet: her answer is sent with her room session straight away,
 * shown from memory until it lands (`pendingTriviaAnswers`), or not at all.
 */

import { mergeTriviaRecords, readTriviaRecord, type JournalTriviaRequest, type JournalTriviaResponse, type TriviaAnswer, type TriviaRecord } from "@kad/shared";
import { ApiError, request } from "../sync/client";
import { loadPlayerDeviceToken } from "./persistence";
import { useGameStore } from "./index";
import {
  dropTriviaQueue,
  enqueueTriviaAnswer,
  loadTriviaQueue,
  onTriviaQueue,
  removeQueuedTriviaAnswers,
  triviaAnswerOf,
  triviaQueueUnsaved,
} from "./trivia-queue";

/** Where the quiz's answers stand, for the quiz to say. */
export interface BookTriviaStatus {
  /** The last send found no signal: what is queued waits for one. */
  offline: boolean;
  /** Short, kid-readable notes about what a send did, until she closes them. */
  notes: string[];
}

let status: BookTriviaStatus = { offline: false, notes: [] };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Hear the queue, the pending answers or the status change. */
export function onBookTrivia(listener: () => void): () => void {
  listeners.add(listener);
  const off = onTriviaQueue(listener);
  return () => {
    listeners.delete(listener);
    off();
  };
}

export function bookTriviaStatus(): BookTriviaStatus {
  return status;
}

function setStatus(next: Partial<BookTriviaStatus>): void {
  status = { ...status, ...next };
  emit();
}

/** Close the notes. */
export function clearBookTriviaNotes(): void {
  if (status.notes.length > 0) setStatus({ notes: [] });
}

/** What the quiz says when an answer is kept only in memory and there is no signal to send it. */
export const TRIVIA_UNSAVED_NOTE = "This phone couldn't save your answers. They will count when you're back online, if the book stays open.";

/** What the quiz says when answers could never be saved. */
export const TRIVIA_LOST_NOTE = "Some of your answers could not be saved.";

function waitForSignal(): void {
  const note = triviaQueueUnsaved() && !status.notes.includes(TRIVIA_UNSAVED_NOTE);
  setStatus({ offline: true, ...(note ? { notes: [...status.notes, TRIVIA_UNSAVED_NOTE] } : {}) });
}

function noSignal(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError || (error instanceof ApiError && error.status === 0);
}

function send(body: JournalTriviaRequest, auth: { deviceToken: string } | { sessionToken: string }): Promise<JournalTriviaResponse> {
  return request<JournalTriviaResponse>("/api/journal/trivia", {
    method: "POST",
    headers: { "content-type": "application/json", ...("deviceToken" in auth ? { "x-kad-device-token": auth.deviceToken } : {}) },
    ...("sessionToken" in auth ? { token: auth.sessionToken } : {}),
    body: JSON.stringify(body),
  });
}

/** Where the record the server answered with goes: the open book's copy. */
export type ApplyTrivia = (record: TriviaRecord, response: JournalTriviaResponse) => void;

/**
 * The book's copy of her record with the server's answer laid over it: the
 * union (shared `mergeTriviaRecords`), so an answer that landed out of order
 * never takes anything back. A fresh read of the book replaces it outright.
 */
export function mergeServerTrivia(saved: TriviaRecord | null | undefined, answered: TriviaRecord): TriviaRecord {
  return mergeTriviaRecords(readTriviaRecord(saved ?? null), readTriviaRecord(answered));
}

/** Put the record the server answered with into the saved book, so the quiz opens offline as it now is. */
async function saveTrivia(deviceToken: string, record: TriviaRecord): Promise<void> {
  try {
    const db = await import("./journal-db");
    const saved = await db.loadSavedJournal(deviceToken);
    if (!saved) return;
    await db.saveJournal({ ...saved, journal: { ...saved.journal, trivia: mergeServerTrivia(saved.journal.trivia, record) } });
  } catch {
    /* the next read with a signal saves it */
  }
}

/** How many answers go in one send. */
export const TRIVIA_BATCH = 40;

/** A 4xx that says "not now" rather than "never". */
const RETRYABLE: ReadonlySet<number> = new Set([408, 425, 429]);

let running: Promise<void> | null = null;
let again = false;

/**
 * Send everything queued, oldest first, until the queue is empty, a send finds
 * no signal, or the server is not answering. One run at a time; asked again
 * while running, it runs once more after.
 */
export function flushTriviaQueue(apply: ApplyTrivia): Promise<void> {
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

async function drain(apply: ApplyTrivia): Promise<void> {
  const deviceToken = loadPlayerDeviceToken();
  if (!deviceToken) return;
  for (;;) {
    const batch = loadTriviaQueue(deviceToken).slice(0, TRIVIA_BATCH);
    if (batch.length === 0) {
      const notes = status.notes.filter((n) => n !== TRIVIA_UNSAVED_NOTE);
      if (status.offline || notes.length !== status.notes.length) setStatus({ offline: false, notes });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      waitForSignal();
      return;
    }
    const ids = batch.map((e) => e.id);
    try {
      const response = await send({ answers: batch.map(triviaAnswerOf) }, { deviceToken });
      removeQueuedTriviaAnswers(deviceToken, ids);
      apply(response.trivia, response);
      await saveTrivia(deviceToken, response.trivia);
      if (status.offline) setStatus({ offline: false });
    } catch (error) {
      if (noSignal(error)) {
        waitForSignal();
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        // The binding is gone: nothing here is hers to send.
        dropTriviaQueue();
        setStatus({ offline: false });
        return;
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !RETRYABLE.has(error.status)) {
        removeQueuedTriviaAnswers(deviceToken, ids);
        if (!status.notes.includes(TRIVIA_LOST_NOTE)) setStatus({ notes: [...status.notes, TRIVIA_LOST_NOTE] });
        continue;
      }
      setStatus({ offline: true });
      return;
    }
  }
}

/** A seat with no binding: answers sent but not yet answered, shown as if they had landed. */
let pending: readonly TriviaAnswer[] = [];
let chain: Promise<void> = Promise.resolve();

/** The answers a seat without a binding has sent and is waiting on. */
export function pendingTriviaAnswers(): readonly TriviaAnswer[] {
  return pending;
}

/**
 * The quiz's answer: queued (so it counts at once and outlives the book being
 * closed), then sent with whatever else is queued. A family tablet, with no
 * device token, sends it straight away with the picked kid's room session.
 */
export async function answerTrivia(answer: TriviaAnswer, apply: ApplyTrivia): Promise<void> {
  const deviceToken = loadPlayerDeviceToken();
  if (deviceToken) {
    enqueueTriviaAnswer(deviceToken, answer);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      waitForSignal();
      return;
    }
    await flushTriviaQueue(apply);
    return;
  }
  const sessionToken = useGameStore.getState().session?.sessionToken;
  if (!sessionToken) return;
  const entry = triviaAnswerOf(answer);
  pending = [...pending, entry];
  emit();
  const sent = chain.then(async () => {
    try {
      const response = await send({ answers: [entry] }, { sessionToken });
      apply(response.trivia, response);
    } catch {
      if (!status.notes.includes(TRIVIA_LOST_NOTE)) setStatus({ notes: [...status.notes, TRIVIA_LOST_NOTE] });
    } finally {
      pending = pending.filter((e) => e !== entry);
      emit();
    }
  });
  chain = sent.catch(() => undefined);
  await sent;
}

/** Every answer the book has made and the server has not yet answered: the phone's queue, or a tablet's sends in flight. */
export function unsentTriviaAnswers(): TriviaAnswer[] {
  return [...loadTriviaQueue(loadPlayerDeviceToken()), ...pending];
}

/** Test seam: forget the status and anything in flight. */
export function resetBookTriviaSync(): void {
  status = { offline: false, notes: [] };
  pending = [];
  chain = Promise.resolve();
  again = false;
}
