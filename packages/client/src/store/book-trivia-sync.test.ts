/**
 * The quiz's answers on their way to the server (docs/trivia.md §6.2): queued
 * on the phone first, tied to its binding, so an answer counts at once and
 * outlives the book closing; sent with the phone's device token; kept with no
 * signal and sent when it returns; dropped unsent when the binding is
 * refused; and on a family tablet, sent with the seat's session straight away.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTriviaRecord, type JournalResponse, type JournalTriviaResponse, type TriviaAnswer, type TriviaBank, type TriviaRecord } from "@kad/shared";
import { answerTrivia, bookTriviaStatus, flushTriviaQueue, mergeServerTrivia, pendingTriviaAnswers, resetBookTriviaSync, TRIVIA_LOST_NOTE } from "./book-trivia-sync";
import { useGameStore } from "./index";
import { TRIVIA_QUEUE_KEY, dropTriviaQueue, enqueueTriviaAnswer, hasQueuedTriviaAnswers, loadTriviaQueue, withQueuedTrivia } from "./trivia-queue";
import { defaultStorage, saveIdentity } from "./persistence";
import { loadSavedJournal, saveJournal } from "./journal-db";

const BANK: TriviaBank = [
  {
    id: "creature.bone_crawler.shell",
    entry: "creature.bone_crawler",
    ask: "What does a bone crawler build its shell from?",
    answer: "Old fossil pieces",
    wrong: ["River pebbles", "Broken pots", "Dragon scales", "Woven seaweed", "Acorn caps"],
    also: [],
    link: "entry",
  },
];
const FOUND = { "creature.bone_crawler": { firstFoundBy: "p_1", foundAt: "2026-11-01T00:00:00.000Z" } };
const OPTIONS = ["River pebbles", "Old fossil pieces", "Broken pots", "Dragon scales"];

function answer(over: Partial<TriviaAnswer> = {}): TriviaAnswer {
  return { questionId: "creature.bone_crawler.shell", optionsShown: OPTIONS, picked: "Old fossil pieces", at: "2026-11-17T10:00:00.000Z", round: "r_1", ...over };
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const MASTERED: TriviaRecord = { ...emptyTriviaRecord(), mastered: { "creature.bone_crawler.shell": { at: "2026-11-17T10:00:00.000Z", firstTry: true } } };
const RESPONSE: JournalTriviaResponse = {
  trivia: MASTERED,
  verdicts: [{ questionId: "creature.bone_crawler.shell", at: "2026-11-17T10:00:00.000Z", verdict: "counted" }],
  granted: [],
  badges: [],
};

const sent: { url: string; headers: Record<string, string>; body: { answers: TriviaAnswer[] } }[] = [];
function serve(answerWith: () => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as { answers: TriviaAnswer[] } });
    return answerWith();
  });
}

beforeEach(() => {
  saveIdentity({ householdId: "h_1", playerId: "p_1", displayName: "Ada", deviceToken: "dev_1" } as Parameters<typeof saveIdentity>[0]);
  dropTriviaQueue();
  resetBookTriviaSync();
  sent.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useGameStore.setState({ session: null });
});

describe("the quiz's queue", () => {
  it("keeps answers for the binding they were made with, and none for another", () => {
    enqueueTriviaAnswer("dev_1", answer());
    expect(loadTriviaQueue("dev_1")).toMatchObject([answer()]);
    expect(hasQueuedTriviaAnswers()).toBe(true);
    // A phone re-adopted by somebody else never sends her answers.
    expect(loadTriviaQueue("dev_2")).toEqual([]);
    expect(defaultStorage().getItem(TRIVIA_QUEUE_KEY)).toBeNull();
  });

  it("marks queued answers over the server's record by the server's rules", () => {
    const shown = withQueuedTrivia(undefined, [answer({ picked: "River pebbles" }), answer({ round: "r_2", at: "2026-11-17T11:00:00.000Z" })], BANK, FOUND);
    expect(shown.mastered["creature.bone_crawler.shell"]).toEqual({ at: "2026-11-17T11:00:00.000Z", firstTry: false });
    expect(shown.missed).toEqual({});
    // A page the household has not found: refused here as it would be there.
    expect(withQueuedTrivia(undefined, [answer()], BANK, {}).mastered).toEqual({});
    // Before the bank is here, the server's record as it is.
    expect(withQueuedTrivia(MASTERED, [answer({ picked: "River pebbles" })], null, FOUND)).toEqual(MASTERED);
  });

  it("merges the server's answer over the book's copy, never taking a mastery back", () => {
    const later: TriviaRecord = { ...emptyTriviaRecord(), rungs: [10] };
    expect(mergeServerTrivia(MASTERED, later)).toEqual({ ...MASTERED, rungs: [10] });
    expect(mergeServerTrivia(undefined, later)).toEqual(later);
  });
});

describe("sending the quiz's answers", () => {
  it("sends an answer made with a signal straight away, with the phone's device token, and saves what came back", async () => {
    const book: JournalResponse = { heroes: [], fieldGuide: FOUND, finders: {}, whereabouts: null };
    await saveJournal({ deviceToken: "dev_1", savedAt: "2026-11-17T09:00:00.000Z", journal: book });
    serve(() => reply(200, RESPONSE));
    const applied: TriviaRecord[] = [];
    await answerTrivia(answer(), (record) => applied.push(record));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("/api/journal/trivia");
    expect(sent[0]!.headers["x-kad-device-token"]).toBe("dev_1");
    expect(sent[0]!.body).toEqual({ answers: [answer()] });
    expect(applied).toEqual([MASTERED]);
    expect(loadTriviaQueue("dev_1")).toEqual([]);
    expect((await loadSavedJournal("dev_1"))?.journal.trivia).toEqual(MASTERED);
  });

  it("with no signal keeps the answers queued, and sends them all when the signal returns", async () => {
    serve(() => Promise.reject(new TypeError("Failed to fetch")));
    await answerTrivia(answer({ picked: "River pebbles" }), () => undefined);
    await answerTrivia(answer({ round: "r_2" }), () => undefined);
    expect(bookTriviaStatus().offline).toBe(true);
    expect(loadTriviaQueue("dev_1")).toHaveLength(2);

    serve(() => reply(200, RESPONSE));
    await flushTriviaQueue(() => undefined);
    expect(sent.at(-1)!.body.answers.map((a) => a.picked)).toEqual(["River pebbles", "Old fossil pieces"]);
    expect(loadTriviaQueue("dev_1")).toEqual([]);
    expect(bookTriviaStatus()).toEqual({ offline: false, notes: [] });
  });

  it("drops the queue unsent when the binding is refused", async () => {
    enqueueTriviaAnswer("dev_1", answer());
    serve(() => reply(401, { error: "Unknown device" }));
    await flushTriviaQueue(() => undefined);
    expect(hasQueuedTriviaAnswers()).toBe(false);
  });

  it("lets go of a batch the server can never take, and says so", async () => {
    enqueueTriviaAnswer("dev_1", answer());
    serve(() => reply(400, { error: "Bad answers" }));
    await flushTriviaQueue(() => undefined);
    expect(hasQueuedTriviaAnswers()).toBe(false);
    expect(bookTriviaStatus().notes).toEqual([TRIVIA_LOST_NOTE]);
  });

  it("keeps the answers when the server is busy", async () => {
    enqueueTriviaAnswer("dev_1", answer());
    serve(() => reply(503, { error: "Busy" }));
    await flushTriviaQueue(() => undefined);
    expect(loadTriviaQueue("dev_1")).toHaveLength(1);
    expect(bookTriviaStatus().offline).toBe(true);
  });

  it("on a family tablet sends with the seat's session, keeping nothing on the tablet", async () => {
    saveIdentity({ householdId: "h_1", playerId: null, displayName: "", deviceToken: null } as unknown as Parameters<typeof saveIdentity>[0]);
    useGameStore.setState({ session: { runId: "r_1", roomCode: "WXYZ", playerId: "p_2", mode: "party", sessionToken: "seat_2" } });
    let release: () => void = () => undefined;
    serve(() => new Promise<Response>((resolve) => { release = () => resolve(reply(200, RESPONSE)); }));
    const applied: TriviaRecord[] = [];
    const done = answerTrivia(answer(), (record) => applied.push(record));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // Shown from memory while it is on its way.
    expect(pendingTriviaAnswers()).toHaveLength(1);
    expect(sent[0]!.headers["authorization"]).toBe("Bearer seat_2");
    expect(sent[0]!.headers["x-kad-device-token"]).toBeUndefined();
    release();
    await done;
    expect(applied).toEqual([MASTERED]);
    expect(pendingTriviaAnswers()).toEqual([]);
    expect(hasQueuedTriviaAnswers()).toBe(false);
  });
});
