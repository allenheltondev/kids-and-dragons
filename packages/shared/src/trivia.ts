/**
 * The Field Guide quiz's rules (docs/trivia.md §4, §5, §6): which questions
 * are hers to be asked, drawing a round and its options, marking an answer,
 * merging two copies of her record, and the ladder.
 *
 * Pure and deterministic for a seed, like look-unlocks.ts, so the phone (which
 * marks answers on the spot, offline) and the server (which decides what
 * counts) run the same code. Node-runnable too (value imports by `.ts`), since
 * `content:validate` asks it for a question's picture.
 */

import { makeRng } from "./dice.ts";
import type { FieldGuide, FieldGuideEntry } from "./field-guide.js";
import type { Badge } from "./kid-profile.js";
import { TRIVIA_RECORD_VERSION } from "./types/trivia.ts";
import type { TriviaAnswer, TriviaBank, TriviaBankFile, TriviaLadder, TriviaMastery, TriviaMiss, TriviaQuestion, TriviaRecord, TriviaRung } from "./types/trivia.js";

/** A round's length (§4.1): about three or four minutes in the car. */
export const TRIVIA_ROUND_SIZE = 8;
/** Options shown per question (§1, decided): the answer and three wrong ones. */
export const TRIVIA_OPTIONS_SHOWN = 4;
/** How much likelier the newest find's questions are than the oldest's (§4.1: "a little more often"). */
export const TRIVIA_NEWEST_WEIGHT = 2;

/** The household's found Field Guide ids: a set, a list, or the book's `fieldGuide` map. */
export type FoundEntries = ReadonlySet<string> | readonly string[] | Readonly<Record<string, unknown>>;

function foundSet(found: FoundEntries): ReadonlySet<string> {
  if (found instanceof Set) return found;
  if (Array.isArray(found)) return new Set(found);
  return new Set(Object.keys(found));
}

/** Every bank file's questions as one bank, in the order given. */
export function triviaBankOf(files: readonly Pick<TriviaBankFile, "questions">[]): TriviaQuestion[] {
  return files.flatMap((f) => f.questions);
}

const indexes = new WeakMap<TriviaBank, ReadonlyMap<string, TriviaQuestion>>();

/** A question by id, or null. */
export function triviaQuestion(bank: TriviaBank, id: string): TriviaQuestion | null {
  let index = indexes.get(bank);
  if (!index) {
    index = new Map(bank.map((q) => [q.id, q]));
    indexes.set(bank, index);
  }
  return index.get(id) ?? null;
}

/** The pages a question names: its entry and every `also`. */
export function triviaPages(question: Pick<TriviaQuestion, "entry" | "also">): string[] {
  return [question.entry, ...question.also];
}

/** Whether the household has found every page a question names (§3.3: the spoiler rule). */
export function triviaUnlocked(question: Pick<TriviaQuestion, "entry" | "also">, found: FoundEntries): boolean {
  const set = foundSet(found);
  return triviaPages(question).every((id) => set.has(id));
}

/** A record with nothing in it. */
export function emptyTriviaRecord(): TriviaRecord {
  return { v: TRIVIA_RECORD_VERSION, mastered: {}, missed: {}, rungs: [] };
}

/**
 * A stored or sent record, read tolerantly: anything malformed is dropped,
 * never an error, so a bad row reads as less progress rather than a broken
 * book. A record from a newer build (`v` above this one's) reads as empty.
 */
export function readTriviaRecord(raw: unknown): TriviaRecord {
  const out = emptyTriviaRecord();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r["v"] === "number" && r["v"] > TRIVIA_RECORD_VERSION) return out;
  const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
  for (const [id, value] of Object.entries(obj(r["mastered"]))) {
    const m = obj(value);
    if (typeof m["at"] === "string") out.mastered[id] = { at: m["at"], firstTry: m["firstTry"] === true };
  }
  for (const [id, value] of Object.entries(obj(r["missed"]))) {
    if (Object.hasOwn(out.mastered, id)) continue;
    const m = obj(value);
    if (typeof m["at"] === "string" && typeof m["round"] === "string") out.missed[id] = { at: m["at"], round: m["round"] };
  }
  if (Array.isArray(r["rungs"])) {
    out.rungs = [...new Set(r["rungs"].filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  }
  return out;
}

/**
 * Her available pool (§4.1): every question whose entry and `also` the
 * household has found, that she has not mastered, and that is not cooling
 * down. A miss cools down for the rest of the round it happened in
 * (`TriviaMiss.round === roundId`) and is back from the next round.
 */
export function availablePool(bank: TriviaBank, found: FoundEntries, record: TriviaRecord | null | undefined, roundId: string): TriviaQuestion[] {
  const set = foundSet(found);
  const mastered = record?.mastered ?? {};
  const missed = record?.missed ?? {};
  return bank.filter((q) => {
    if (Object.hasOwn(mastered, q.id)) return false;
    if (missed[q.id]?.round === roundId) return false;
    return triviaPages(q).every((id) => set.has(id));
  });
}

/** When a question became askable: the latest find among the pages it names, or undefined when none is dated. */
function unlockedAt(question: TriviaQuestion, foundAt: Readonly<Record<string, string | { foundAt: string } | undefined>>): number | undefined {
  let latest: number | undefined;
  for (const id of triviaPages(question)) {
    const value = foundAt[id];
    const iso = typeof value === "string" ? value : value?.foundAt;
    const t = iso === undefined ? Number.NaN : Date.parse(iso);
    if (!Number.isNaN(t)) latest = latest === undefined ? t : Math.max(latest, t);
  }
  return latest;
}

/**
 * A round (§4.1): up to `size` questions from `pool`, without repeats,
 * deterministic for a seed. Questions about pages found most recently are a
 * little likelier (`TRIVIA_NEWEST_WEIGHT` for the newest find, 1 for the
 * oldest and for any with no date). `foundAt` is canon id → ISO time it was
 * found, or the book's `fieldGuide` map itself (`FieldGuideFind.foundAt`).
 * Shorter than `size` when the pool is.
 */
export function drawRound(
  pool: readonly TriviaQuestion[],
  seed: string | number,
  size: number = TRIVIA_ROUND_SIZE,
  foundAt: Readonly<Record<string, string | { foundAt: string } | undefined>> = {},
): TriviaQuestion[] {
  if (size <= 0 || pool.length === 0) return [];
  const times = pool.map((q) => unlockedAt(q, foundAt));
  const dated = times.filter((t): t is number => t !== undefined);
  const oldest = dated.length ? Math.min(...dated) : 0;
  const newest = dated.length ? Math.max(...dated) : 0;
  const rng = makeRng(seed);
  // Weighted sampling without replacement (Efraimidis-Spirakis): key u^(1/w), the largest keys win.
  const keyed = pool.map((q, i) => {
    const t = times[i];
    const weight = t === undefined || newest === oldest ? (t === undefined ? 1 : TRIVIA_NEWEST_WEIGHT) : 1 + (TRIVIA_NEWEST_WEIGHT - 1) * ((t - oldest) / (newest - oldest));
    return { q, key: Math.pow(rng.next(), 1 / weight) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, size).map((k) => k.q);
}

function shuffle<T>(items: T[], next: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * The four options for one asking (§4.2): the answer and three of its wrong
 * options, drawn fresh and shuffled, deterministic for a seed (seed it with
 * the round and the question so a second asking differs).
 */
export function drawOptions(question: Pick<TriviaQuestion, "answer" | "wrong">, seed: string | number): string[] {
  const rng = makeRng(seed);
  const next = (): number => rng.next();
  const wrong = shuffle([...question.wrong], next).slice(0, TRIVIA_OPTIONS_SHOWN - 1);
  return shuffle([question.answer, ...wrong], next);
}

/** Whether `shown` is a set this question could have been shown with: four distinct options, its answer and three of its wrong ones. */
export function validShownOptions(question: Pick<TriviaQuestion, "answer" | "wrong">, shown: readonly unknown[]): boolean {
  if (!Array.isArray(shown) || shown.length !== TRIVIA_OPTIONS_SHOWN) return false;
  if (new Set(shown).size !== shown.length) return false;
  if (!shown.includes(question.answer)) return false;
  return shown.every((o) => o === question.answer || (typeof o === "string" && question.wrong.includes(o)));
}

/** Why an answer is refused (§6.2): it never counts, and the record is unchanged. */
export type TriviaRefusal = "unknown-question" | "not-found" | "bad-options" | "not-shown" | "retried";

/** What marking one answer did. */
export type TriviaMark =
  | {
      ok: true;
      record: TriviaRecord;
      /** Her pick was the answer. */
      correct: boolean;
      /** It newly mastered the question: it counts toward the ladder. False for a repeat of a mastered one. */
      counts: boolean;
    }
  | { ok: false; reason: TriviaRefusal; record: TriviaRecord };

/**
 * Marks one answer (§4.2, §4.4, §6.2) against `record`, returning the new
 * record (never mutating `record`). Refused, record unchanged: an unknown
 * question, a page it names that the household has not found, a shown set
 * the question could not have been shown with, a pick not among those shown,
 * and a right answer in the very round it was missed in (§4.2: no second try;
 * a miss cools down for the rest of its round, so an honest phone never sends one).
 *
 * Right and not yet mastered: mastered at `answer.at`, on the first try when
 * it was never missed, and its miss cleared. Wrong and not mastered: its miss
 * is recorded with the round, so it cools down for that round. A mastered
 * question is never touched again (an answer about one is accepted, counts
 * for nothing).
 */
export function markAnswer(record: TriviaRecord, answer: TriviaAnswer, bank: TriviaBank, found: FoundEntries): TriviaMark {
  const question = triviaQuestion(bank, answer.questionId);
  if (!question) return { ok: false, reason: "unknown-question", record };
  if (!triviaUnlocked(question, found)) return { ok: false, reason: "not-found", record };
  if (!validShownOptions(question, answer.optionsShown)) return { ok: false, reason: "bad-options", record };
  if (!answer.optionsShown.includes(answer.picked)) return { ok: false, reason: "not-shown", record };
  const correct = answer.picked === question.answer;
  if (Object.hasOwn(record.mastered, question.id)) return { ok: true, record, correct, counts: false };
  if (correct && record.missed[question.id]?.round === answer.round) return { ok: false, reason: "retried", record };
  if (correct) {
    const missed = { ...record.missed };
    const firstTry = !Object.hasOwn(missed, question.id);
    delete missed[question.id];
    return { ok: true, correct, counts: true, record: { ...record, mastered: { ...record.mastered, [question.id]: { at: answer.at, firstTry } }, missed } };
  }
  return { ok: true, correct, counts: false, record: { ...record, missed: { ...record.missed, [question.id]: { at: answer.at, round: answer.round } } } };
}

/**
 * Two copies of one kid's record as one (§6.2; two devices simply union):
 * mastered is the union, the earliest mastery of a question winning (with its
 * first-try flag); a mastered question has no miss (a mastery clears it, and
 * a mastered question is never asked again); of two misses the later wins;
 * rungs are the union.
 */
export function mergeTriviaRecords(a: TriviaRecord, b: TriviaRecord): TriviaRecord {
  const mastered: Record<string, TriviaMastery> = { ...a.mastered };
  for (const [id, m] of Object.entries(b.mastered)) {
    const have = mastered[id];
    if (!have || m.at < have.at) mastered[id] = m;
  }
  const missed: Record<string, TriviaMiss> = {};
  for (const source of [a.missed, b.missed]) {
    for (const [id, m] of Object.entries(source)) {
      if (Object.hasOwn(mastered, id)) continue;
      const have = missed[id];
      if (!have || m.at > have.at) missed[id] = m;
    }
  }
  const rungs = [...new Set([...a.rungs, ...b.rungs])].sort((x, y) => x - y);
  return { v: TRIVIA_RECORD_VERSION, mastered, missed, rungs };
}

/** What the ladder counts: questions mastered, and those mastered on the first ask. */
export interface TriviaCounts {
  mastered: number;
  firstTry: number;
}

export function triviaCounts(record: TriviaRecord): TriviaCounts {
  const all = Object.values(record.mastered);
  return { mastered: all.length, firstTry: all.filter((m) => m.firstTry).length };
}

/** The rungs her counts reach on each track, smallest first. */
export interface TriviaEarned {
  rungs: TriviaRung[];
  firstTry: TriviaRung[];
}

/** Every rung a record (or its counts) has reached, on the main ladder and the first-try track (§5). */
export function laddersEarned(record: TriviaRecord | TriviaCounts, ladder: TriviaLadder): TriviaEarned {
  const counts = "mastered" in record && typeof record.mastered === "number" ? (record as TriviaCounts) : triviaCounts(record as TriviaRecord);
  return {
    rungs: ladder.rungs.filter((r) => counts.mastered >= r.at),
    firstTry: ladder.firstTry.filter((r) => counts.firstTry >= r.at),
  };
}

/**
 * The main-ladder rungs the record has reached and not yet been granted,
 * and the record with them added to `rungs`. What the server writes look
 * receipts for (each rung's `title` to every one of her heroes) once.
 */
export function grantTriviaRungs(record: TriviaRecord, ladder: TriviaLadder): { record: TriviaRecord; granted: TriviaRung[] } {
  const held = new Set(record.rungs);
  const granted = laddersEarned(record, ladder).rungs.filter((r) => !held.has(r.at));
  if (granted.length === 0) return { record, granted };
  return { record: { ...record, rungs: [...held, ...granted.map((r) => r.at)].sort((a, b) => a - b) }, granted };
}

/** The badges her counts have earned, main ladder then first-try track, as `kid-profile.ts` lists them. */
export function triviaBadges(counts: TriviaCounts, ladder: TriviaLadder): Badge[] {
  const earned = laddersEarned(counts, ladder);
  return [...earned.rungs, ...earned.firstTry].flatMap((r) => (r.badge ? [{ id: r.badge.id, name: r.badge.name, blurb: r.badge.blurb }] : []));
}

/**
 * The gear portrait a class page's questions are asked over (§3.5), since
 * class pages have no painting of their own: the class's sworn portrait, one
 * species per class so the four look apart.
 */
export const TRIVIA_CLASS_PORTRAIT_SPECIES: Readonly<Record<string, string>> = {
  thornguard: "bigfoot",
  duskrunner: "kitsune",
  starweaver: "dragonling",
  songkeeper: "griffin",
};

/** A page's picture: its own `art`, or for a class page its gear portrait. Site-absolute, or null. */
export function guidePagePicture(entry: Pick<FieldGuideEntry, "id" | "kind" | "art">): string | null {
  if (entry.art) return entry.art;
  if (entry.kind === "class") {
    const classId = entry.id.replace(/^class\./, "");
    const species = TRIVIA_CLASS_PORTRAIT_SPECIES[classId];
    if (species) return `/assets/gear-portraits/${classId}/sworn/${species}.png`;
  }
  return null;
}

/**
 * The picture a question is asked over (§3.5): `image`'s page, or its
 * entry's, by `guidePagePicture`. Null when the page is unknown or has none
 * (`content:validate` refuses such a question).
 */
export function triviaPicture(question: Pick<TriviaQuestion, "entry" | "image">, guide: Pick<FieldGuide, "entries">): string | null {
  const page = guide.entries[question.image ?? question.entry];
  return page ? guidePagePicture(page) : null;
}
