/**
 * Trivia: the Field Guide quiz in the adventure book (docs/trivia.md).
 *
 * The question bank is authored content under `content/trivia/`, one file per
 * group of guide pages (`TRIVIA_GROUPS`), checked by `npm run content:validate`
 * (tools/content/trivia-bank.mjs). The ladder of rewards is
 * `content/trivia/ladder.json`. The rules that read them (the pool, a round,
 * marking an answer, the ladder) are shared `trivia.ts`; the server decides
 * what counts (§6.2), and the phone holds the whole bank so a round works
 * offline.
 *
 * Rewards are cosmetic only (§1): badges on her profile and titles on her
 * heroes. Nothing here is read by the engine.
 */

import type { TitleId } from "./look.js";

/** Where a wrong answer's "Read about it in the Field Guide" goes (§4.3). */
export type TriviaLink = "entry" | "shelf";

/** One authored question (§3.2). */
export interface TriviaQuestion {
  /** Unique across every bank file: `<entry id>.<slug>`, e.g. `creature.bone_crawler.shell`. */
  id: string;
  /** The Field Guide page it is about (a key of `content/field-guide.json` `entries`). */
  entry: string;
  /** The question, under 20 words. */
  ask: string;
  /** The right option, under 10 words. */
  answer: string;
  /** Five or six wrong options, each under 10 words; three are drawn each time it is asked (§4.2). */
  wrong: string[];
  /**
   * Every other guide page the stem or any option names (§3.3). The question
   * is in her pool only once the household has found all of them too.
   */
  also: string[];
  /** `entry`: open the page. `shelf`: open the page's tab, because the answer is the page's name. */
  link: TriviaLink;
  /** Another page's painting to ask it over (§3.5): the `entry` or one of `also`. Absent: the entry's own. */
  image?: string;
}

/** The bank files, one per group of guide pages: `content/trivia/<group>.json`. */
export const TRIVIA_GROUPS = ["creatures", "biomes", "classes", "landmarks", "others"] as const;
export type TriviaGroup = (typeof TRIVIA_GROUPS)[number];

/** One bank file as authored: `content/trivia/<group>.json`. */
export interface TriviaBankFile {
  $schema?: string;
  $comment?: string;
  questions: TriviaQuestion[];
}

/** Every question of every bank file, in group then file order. What the pool and marking read. */
export type TriviaBank = readonly TriviaQuestion[];

/** A badge on her profile, as `kid-profile.ts` `Badge` is. */
export interface TriviaBadge {
  /** Stable, unique across the ladder: `trivia-10`, `trivia-first-25`. */
  id: string;
  name: string;
  blurb: string;
}

/**
 * One rung (§5): reached at `at` questions mastered (or, on the first-try
 * track, mastered on the first ask). Each gives a badge, a title, or both.
 * Frames, the special and tent decorations are owed art and not shipped yet.
 */
export interface TriviaRung {
  at: number;
  badge?: TriviaBadge;
  /** A title in `content/looks.json` whose unlock is `{ from: "trivia", rung: at }`. Main track only. */
  title?: TitleId;
}

/** `content/trivia/ladder.json`: the main ladder and the first-try track (badges only), each smallest first. */
export interface TriviaLadder {
  $schema?: string;
  $comment?: string;
  rungs: TriviaRung[];
  firstTry: TriviaRung[];
}

/** The stored shape's version. */
export const TRIVIA_RECORD_VERSION = 1;

/** A mastered question: when, and whether on the first ask (never missed before). */
export interface TriviaMastery {
  at: string;
  firstTry: boolean;
}

/**
 * A question she answered wrong: when, and in which round. It cools down for
 * the rest of that round (§4.2) and is back in her pool from the next one.
 */
export interface TriviaMiss {
  at: string;
  /** The round's id (`TriviaAnswer.round`), chosen by the phone when the round starts. */
  round: string;
}

/**
 * One kid's quiz (§6.1), per player profile, across every hero and campaign.
 * Rides the book's read (`JournalResponse.trivia`) and is saved with the book,
 * so the quiz opens offline.
 */
export interface TriviaRecord {
  /** `TRIVIA_RECORD_VERSION`. */
  v: number;
  /** Question id → when it was mastered, and whether on the first ask. Never taken back. */
  mastered: Record<string, TriviaMastery>;
  /** Question id → its last miss. Cleared once it is mastered. */
  missed: Record<string, TriviaMiss>;
  /** The main ladder's rungs granted (their `at`), sorted, so a grant is never written twice. */
  rungs: number[];
}

/**
 * One answer as the phone queues it (§6.2) and `POST /api/journal/trivia`
 * receives it.
 */
export interface TriviaAnswer {
  questionId: string;
  /** The four options as shown: the answer and three of its wrong options, in the order shown. */
  optionsShown: string[];
  /** The option she picked; one of `optionsShown`. */
  picked: string;
  /** ISO, when she answered. */
  at: string;
  /** The round it was asked in (any id unique per round; the phone's choice). */
  round: string;
}
