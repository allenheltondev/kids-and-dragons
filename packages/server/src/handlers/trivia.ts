/**
 * The Field Guide quiz's server side (docs/trivia.md §5.1, §6).
 *
 * **The record** is one `TriviaRecord` per kid, on her profile row
 * (`getTrivia` / `putTrivia`, store repository.ts): it rides the book's read
 * (`JournalResponse.trivia`) and moves and goes with her.
 *
 * **The write** is `POST /api/journal/trivia` (`answerTrivia`), authorised as
 * `POST /api/journal/kit` is: the kid is the one the device binding (or the
 * room session a family tablet's picked kid holds) names, never the body.
 * Each queued answer is marked by the shared rule (`markAnswer`) against the
 * household's Field Guide and the bank: an unknown question, a page the
 * household has not found, a shown set the question could not have been
 * shown with or a pick not among those shown is refused and never counts.
 * What is left is merged over what is stored (`mergeTriviaRecords`: two
 * phones for one kid simply union), the rungs it now reaches are granted
 * once (`grantTriviaRungs`), and the record is written conditional on the
 * revision read, retried from a fresh read on a lost race, as kit writes are.
 *
 * **Looks.** Every rung her record holds gives its title to every one of her
 * heroes, written as a receipt (`from: "trivia"`, "From the quiz") after the
 * record lands, by `grantLooks` (conditional on each hero's row, retried).
 * Every answer batch re-checks every hero, so a hero she made after a rung, or
 * one whose write was lost, is caught up on her next batch; until then every
 * server view of her look reads the rungs back (`readEarnedLook`'s
 * `triviaRungs`, via `triviaRungsOf`).
 *
 * **Badges** are read from her record's counts on her page (profile.ts).
 */

import {
  TRIVIA_RECORD_VERSION,
  grantTriviaRungs,
  markAnswer,
  mergeTriviaRecords,
  readLook,
  readTriviaRecord,
  triviaBadges,
  triviaCounts,
  triviaLookGrants,
  type Badge,
  type Character,
  type JournalTriviaResponse,
  type JournalTriviaVerdict,
  type TriviaAnswer,
  type TriviaRecord,
  type TriviaRung,
} from "@kad/shared";
import { CAMP_WRITE_ATTEMPTS } from "./camp.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { grantLooks } from "./look-unlocks.ts";

/** The most answers one request may carry: a long car ride's worth of rounds, and a bound on the work. */
export const TRIVIA_BATCH_LIMIT = 200;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Her record as stored, read tolerantly, or null when she is not there.
 * Throws on a store failure: the caller decides what a failed read means.
 */
export async function readTrivia(householdId: string, playerId: string, deps: Pick<HandlerDeps, "repo">): Promise<TriviaRecord | null> {
  const row = await deps.repo.getTrivia(householdId, playerId);
  return row ? readTriviaRecord(row.record) : null;
}

/**
 * The rungs her record holds, for a view of one of her heroes' looks to read
 * back (`readEarnedLook`'s `triviaRungs`). Never fails: a record that cannot
 * be read gives no rungs, and the hero's stored receipts still stand.
 */
export async function triviaRungsOf(householdId: string, playerId: string, deps: Pick<HandlerDeps, "repo">): Promise<number[]> {
  try {
    return (await readTrivia(householdId, playerId, deps))?.rungs ?? [];
  } catch (err) {
    console.error(`trivia: could not read ${playerId}'s quiz record:`, err);
    return [];
  }
}

/** The rungs of the kid who owns `hero`, read at her home (the hero's household). */
export async function heroTriviaRungs(hero: Pick<Character, "householdId" | "ownerPlayerId">, deps: Pick<HandlerDeps, "repo">): Promise<number[]> {
  return triviaRungsOf(hero.householdId, hero.ownerPlayerId, deps);
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

export interface TriviaInput {
  /** The kid the phone is bound to: her household and her player id, never the body's. */
  householdId: string;
  playerId: string;
  body: Record<string, unknown>;
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** The answers a request carries, or why it cannot be read. */
function parseAnswers(body: Record<string, unknown>): TriviaAnswer[] | string {
  const { answers } = body;
  if (!Array.isArray(answers)) return "answers is a list";
  if (answers.length > TRIVIA_BATCH_LIMIT) return `at most ${TRIVIA_BATCH_LIMIT} answers at once`;
  const out: TriviaAnswer[] = [];
  for (const raw of answers as unknown[]) {
    if (typeof raw !== "object" || raw === null) return "each answer is { questionId, optionsShown, picked, at, round }";
    const a = raw as Record<string, unknown>;
    if (!isText(a.questionId, 200)) return "an answer's questionId is required";
    if (!Array.isArray(a.optionsShown) || a.optionsShown.length > 8 || !a.optionsShown.every((o) => isText(o, 200))) {
      return "an answer's optionsShown are the options shown";
    }
    if (!isText(a.picked, 200)) return "an answer's picked is the option picked";
    if (!isText(a.at, 40) || Number.isNaN(Date.parse(a.at))) return "an answer's at is when it was answered";
    if (!isText(a.round, 64)) return "an answer's round is required";
    out.push({ questionId: a.questionId, optionsShown: [...(a.optionsShown as string[])], picked: a.picked, at: a.at, round: a.round });
  }
  return out;
}

/** What marking a batch over `stored` gives: the merged record and one verdict per answer. */
function markBatch(
  stored: TriviaRecord,
  answers: readonly TriviaAnswer[],
  deps: Pick<HandlerDeps, "content">,
  found: Record<string, unknown>,
  nowIso: string,
): { record: TriviaRecord; verdicts: JournalTriviaResponse["verdicts"] } {
  const bank = deps.content.triviaBank() ?? [];
  let marked = stored;
  const verdicts: JournalTriviaResponse["verdicts"] = [];
  for (const answer of answers) {
    // A time from the phone's clock, but never one still to come: earliest mastery wins a merge.
    const at = answer.at > nowIso ? nowIso : answer.at;
    const mark = markAnswer(marked, { ...answer, at }, bank, found);
    let verdict: JournalTriviaVerdict;
    if (!mark.ok) verdict = mark.reason;
    else if (mark.counts) verdict = "counted";
    // Mastered already: nothing changes, right or wrong (a mastered question is never touched again).
    else if (Object.hasOwn(marked.mastered, answer.questionId)) verdict = "already";
    else verdict = "missed";
    verdicts.push({ questionId: answer.questionId, at: answer.at, verdict });
    marked = mark.record;
  }
  // Over what is stored, by the union rule: a miss sent late never covers a later one.
  return { record: marked === stored ? stored : mergeTriviaRecords(stored, marked), verdicts };
}

const sameRecord = (a: TriviaRecord, b: TriviaRecord) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A batch of her queued quiz answers (`POST /api/journal/trivia`, docs/trivia.md §6.2).
 * See the header for what is checked, merged, granted and written.
 */
export async function answerTrivia(input: TriviaInput, deps: HandlerDeps): Promise<HandlerResult<JournalTriviaResponse>> {
  const answers = parseAnswers(input.body);
  if (typeof answers === "string") return fail("ILLEGAL", answers);
  if (!deps.content.triviaBank()) return fail("ILLEGAL", "there is no quiz in this content");
  const ladder = deps.content.triviaLadder();
  const nowIso = iso(deps.now());

  const book = await deps.repo.getFieldGuide(input.householdId);
  let result: { before: TriviaRecord; record: TriviaRecord; verdicts: JournalTriviaResponse["verdicts"]; granted: TriviaRung[] } | null = null;
  for (let attempt = 0; attempt < CAMP_WRITE_ATTEMPTS; attempt++) {
    const row = await deps.repo.getTrivia(input.householdId, input.playerId);
    if (!row) return fail("NOT_FOUND", "no such player");
    const stored = readTriviaRecord(row.record);
    const marked = markBatch(stored, answers, deps, book.entries, nowIso);
    const grant = ladder ? grantTriviaRungs(marked.record, ladder) : { record: marked.record, granted: [] };
    const next = { ...grant.record, v: TRIVIA_RECORD_VERSION };
    const candidate = { before: stored, record: next, verdicts: marked.verdicts, granted: grant.granted };
    // Nothing new (a resent batch, or only refusals): no write.
    if (sameRecord(stored, next) || (await deps.repo.putTrivia({ householdId: input.householdId, playerId: input.playerId, record: next, expectedRevision: row.revision }))) {
      result = candidate;
      break;
    }
  }
  if (!result) {
    console.error(`trivia: ${input.playerId}'s quiz answers were not written (conflict)`);
    return fail("STALE_DECISION", "Your quiz answers could not be saved just now. Try again.");
  }

  // Her heroes' titles: every rung held, to every hero who lacks its look. Never fails the batch.
  await grantTriviaLooks(input.householdId, input.playerId, result.record.rungs, nowIso, deps);

  const had = new Set(ladder ? triviaBadges(triviaCounts(result.before), ladder).map((b) => b.id) : []);
  const badges: Badge[] = ladder ? triviaBadges(triviaCounts(result.record), ladder).filter((b) => !had.has(b.id)) : [];
  return ok({ trivia: result.record, verdicts: result.verdicts, granted: result.granted, badges });
}

/**
 * Write the looks `rungs` give to each of her heroes that does not hold them
 * yet, as receipts at `at`. Logged, never thrown: the record already holds
 * the rungs, and every view of her look reads them back until this lands.
 * Returns how many heroes were written to.
 */
export async function grantTriviaLooks(
  householdId: string,
  playerId: string,
  rungs: readonly number[],
  at: string,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<number> {
  const catalog = deps.content.looksCatalog();
  if (!catalog || rungs.length === 0) return 0;
  let heroes: Character[];
  try {
    heroes = (await deps.repo.listCharacters(householdId)).filter((c) => c.ownerPlayerId === playerId);
  } catch (err) {
    console.error(`trivia: could not list ${playerId}'s heroes for their quiz looks:`, err);
    return 0;
  }
  let wrote = 0;
  for (const hero of heroes) {
    const owed = triviaLookGrants(catalog, rungs, hero.species);
    const held = readLook(hero).unlocked;
    if (owed.every((g) => Object.hasOwn(held, g.id))) continue;
    try {
      const written = await grantLooks(householdId, hero.id, (_look, row) => triviaLookGrants(catalog, rungs, row.species), at, deps);
      if (written.ok && written.changed) wrote++;
      else if (!written.ok && written.reason !== "missing") console.error(`trivia: hero ${hero.id}'s quiz looks were not written (${written.reason})`);
    } catch (err) {
      console.error(`trivia: writing hero ${hero.id}'s quiz looks failed:`, err);
    }
  }
  return wrote;
}
