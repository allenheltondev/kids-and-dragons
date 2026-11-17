/**
 * The Field Guide quiz's screen rules (docs/trivia.md §3.5, §4, §5), the
 * parts the shared rules (shared trivia.ts) leave to the phone: which file a
 * question's picture is drawn from on this device and whether it is here
 * offline, what the Quiz button says when there is nothing to ask, what a
 * newly reached rung is called, and how a quiz title shows on her look shelf
 * before the server has written it.
 *
 * Pure where it can be, so the quiz screen and its tests read the same words.
 */

import {
  TRIVIA_LOOK_SOURCE,
  TRIVIA_ROUND_SIZE,
  availablePool,
  drawRound,
  guidePagePicture,
  laddersEarned,
  lookTitleText,
  triviaLookGrants,
  triviaPicture,
  triviaUnlocked,
  type FieldGuide,
  type FieldGuideFind,
  type HeroLookView,
  type LookCatalog,
  type SpeciesId,
  type TriviaBank,
  type TriviaCounts,
  type TriviaLadder,
  type TriviaQuestion,
  type TriviaRecord,
  type TriviaRung,
} from "@kad/shared";
import { fitArt } from "../world/art-paths";

/** A question's picture as this device draws it (§3.5). */
export interface QuizPicture {
  /** The file to draw. */
  src: string;
  /** The painting itself, when `src` is a copy of it: what an offline phone may hold instead. */
  painting: string;
  /** A place is a backdrop filling the top of the screen; anything else is a figure, as on its guide card. */
  place: boolean;
}

/**
 * The picture a question is asked over: its page's painting (or a class's
 * gear portrait), a place as its backdrop, drawn from the half-size copy on a
 * phone as backdrops are everywhere else (`fitArt`); a figure as its guide
 * card draws it. Null when the page has none, which `content:validate` refuses.
 */
export function quizPicture(question: Pick<TriviaQuestion, "entry" | "image">, guide: Pick<FieldGuide, "entries">, small?: boolean): QuizPicture | null {
  const painting = triviaPicture(question, guide);
  if (!painting) return null;
  const page = guide.entries[question.image ?? question.entry];
  const place = page?.category === "places";
  return { src: place ? fitArt(painting, small) : painting, painting, place };
}

/**
 * What the book saves for the quiz while there is a signal, beyond what it
 * already saves for the guide (sw/warm.ts `offlineArtFor`): a found place's
 * copy for this device, and a found class's gear portrait.
 */
export function quizOfflineArt(guide: FieldGuide | null, found: readonly string[], small?: boolean): string[] {
  if (!guide) return [];
  const out = new Set<string>();
  for (const id of found) {
    const page = guide.entries[id];
    if (!page) continue;
    const painting = guidePagePicture(page);
    if (!painting) continue;
    out.add(page.category === "places" ? fitArt(painting, small) : painting);
  }
  return [...out];
}

/**
 * Which file to draw a question's picture from right now, or null when it is
 * not on this phone (§3.5): with a signal, the picture as this device draws
 * it; with none, whichever of its copy and its painting the service worker
 * kept (every saved file is keyed with its fingerprint, so the search is
 * ignored). A question whose picture is held back is never asked offline.
 */
export async function pictureOnPhone(picture: QuizPicture): Promise<string | null> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return picture.src;
  if (typeof caches === "undefined") return null;
  for (const url of new Set([picture.src, picture.painting])) {
    try {
      if ((await caches.match(url, { ignoreSearch: true })) !== undefined) return url;
    } catch {
      /* no cache to look in */
    }
  }
  return null;
}

/** Why there is no round to start (§4.1). */
export type QuizEmpty = "nothing-yet" | "all-done" | "resting";

/** What the Quiz button says in place of starting a round. */
export const QUIZ_EMPTY_WORDS: Readonly<Record<QuizEmpty, string>> = {
  "nothing-yet": "Find things on an adventure, and questions about them show up here.",
  "all-done": "You've answered everything you've found. Go find more!",
  // A miss rests only for the round it was in (docs/trivia.md §4.2), so with questions left and
  // none askable, what is missing is their pictures: this phone has not saved them yet.
  resting: "Some questions need their pictures. Open your book with a signal, then come back.",
};

/**
 * Why nothing can be asked, or null when something can: nothing found has a
 * question yet; every found question is mastered; or some are left but none
 * can be asked now (cooling down, or offline without their picture).
 */
export function quizEmptyReason(bank: TriviaBank, found: Readonly<Record<string, unknown>>, record: TriviaRecord, askable: number): QuizEmpty | null {
  if (askable > 0) return null;
  const unlocked = bank.filter((q) => triviaUnlocked(q, found));
  const left = unlocked.filter((q) => !Object.hasOwn(record.mastered, q.id));
  if (left.length > 0) return "resting";
  return unlocked.length > 0 || Object.keys(record.mastered).length > 0 ? "all-done" : "nothing-yet";
}

/** A fresh round's id: any string unique to this round on this phone. */
export function newRoundId(now: number = Date.now()): string {
  return `r_${now.toString(36)}_${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
}

/** The questions that could be asked in round `roundId`, each with its picture, before anything is checked offline. */
export function quizCandidates(
  bank: TriviaBank,
  guide: Pick<FieldGuide, "entries">,
  found: Readonly<Record<string, FieldGuideFind>>,
  record: TriviaRecord,
  roundId: string,
  small?: boolean,
): { question: TriviaQuestion; picture: QuizPicture }[] {
  return availablePool(bank, found, record, roundId).flatMap((question) => {
    const picture = quizPicture(question, guide, small);
    return picture ? [{ question, picture }] : [];
  });
}

/** One question of a round, with the file its picture is drawn from. */
export interface RoundQuestion {
  id: string;
  picture: string;
  place: boolean;
}

/**
 * A round (§4.1): the questions that can be asked now (their pictures on this
 * phone), up to eight, newer finds a little likelier (shared `drawRound`).
 */
export async function pickRound(
  bank: TriviaBank,
  guide: Pick<FieldGuide, "entries">,
  found: Readonly<Record<string, FieldGuideFind>>,
  record: TriviaRecord,
  roundId: string,
  small?: boolean,
): Promise<RoundQuestion[]> {
  const candidates = quizCandidates(bank, guide, found, record, roundId, small);
  const ready = await Promise.all(candidates.map(async (c) => ({ ...c, src: await pictureOnPhone(c.picture) })));
  const askable = ready.filter((c): c is typeof c & { src: string } => c.src !== null);
  const byId = new Map(askable.map((c) => [c.question.id, c]));
  return drawRound(askable.map((c) => c.question), roundId, TRIVIA_ROUND_SIZE, found).map((q) => {
    const c = byId.get(q.id)!;
    return { id: q.id, picture: c.src, place: c.picture.place };
  });
}

/** What reaching a rung gave her, in the words the toast says (§6.2: "You earned the Learned!"). */
export function rungRewardWords(rung: TriviaRung, catalog: LookCatalog): string[] {
  const out: string[] = [];
  if (rung.title) {
    const text = lookTitleText(catalog, rung.title);
    if (text) out.push(`You earned the title ${text}!`);
  }
  if (rung.badge) out.push(`You earned the ${rung.badge.name} badge!`);
  return out;
}

/** The rungs, on both tracks, `after` reaches that `before` did not. */
export function newlyReached(before: TriviaRecord | TriviaCounts, after: TriviaRecord | TriviaCounts, ladder: TriviaLadder): TriviaRung[] {
  const was = laddersEarned(before, ladder);
  const now = laddersEarned(after, ladder);
  const had = new Set([...was.rungs.map((r) => `m${String(r.at)}`), ...was.firstTry.map((r) => `f${String(r.at)}`)]);
  return [...now.rungs.filter((r) => !had.has(`m${String(r.at)}`)), ...now.firstTry.filter((r) => !had.has(`f${String(r.at)}`))];
}

/**
 * The quiz rungs her record stands on for her looks: the rungs the server
 * granted, and every rung of a quiz look her mastered count has reached since
 * (answers the phone marked and has not sent yet), so a title she has just
 * earned is on her shelf at once.
 */
export function triviaLookRungs(record: TriviaRecord, catalog: LookCatalog): number[] {
  const mastered = Object.keys(record.mastered).length;
  const rungs = new Set(record.rungs);
  for (const title of catalog.titles) {
    const unlock = title.unlock as { from?: string; rung?: number } | undefined;
    if (unlock?.from === "trivia" && typeof unlock.rung === "number" && unlock.rung <= mastered) rungs.add(unlock.rung);
  }
  return [...rungs].sort((a, b) => a - b);
}

/**
 * Her look with the quiz's looks laid on (§5.1): each one she holds by
 * `rungs` added to what she has unlocked, and named "From the quiz" on the
 * shelf where the server has not named it yet. A look with nothing to add is
 * returned as it is.
 */
export function withTriviaLooks(look: HeroLookView, rungs: readonly number[], catalog: LookCatalog, species?: SpeciesId): HeroLookView {
  if (rungs.length === 0) return look;
  const grants = triviaLookGrants(catalog, rungs, species);
  const missing = grants.filter((g) => !look.unlocked.includes(g.id) || !look.sources?.[g.id]);
  if (missing.length === 0) return look;
  const unlocked = [...new Set([...look.unlocked, ...grants.map((g) => g.id)])].sort();
  const sources = { ...(look.sources ?? {}) };
  for (const g of grants) sources[g.id] ??= g.source ?? TRIVIA_LOOK_SOURCE;
  return { ...look, unlocked, sources };
}
