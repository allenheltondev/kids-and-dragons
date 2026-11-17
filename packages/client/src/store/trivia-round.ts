/**
 * The quiz round she is in (docs/trivia.md §4), kept for the life of the page.
 *
 * In the page's memory rather than the quiz screen's state, because the quiz
 * opens over the guide and "go read about it" closes it onto the guide: the
 * rest of the round is kept for when she comes back (§4.3), and so is a round
 * she stopped in the middle (§4.1: every answer so far is kept). A round is
 * one kid's: a family tablet passed to her brother starts his own.
 */

import { useSyncExternalStore } from "react";
import type { RoundQuestion } from "../screens/quiz-rules";

/** How one question went. Absent: not answered yet. */
export interface RoundAnswer {
  picked: string;
  correct: boolean;
}

export interface QuizRound {
  /** `TriviaAnswer.round`: misses cool down for the rest of this round. */
  id: string;
  /** The player it belongs to. */
  owner: string;
  questions: RoundQuestion[];
  /** The four options each question was shown with, in the order shown. */
  options: Record<string, string[]>;
  /** The question on screen; `questions.length` once the round is over. */
  index: number;
  answers: Record<string, RoundAnswer>;
}

export interface QuizState {
  /** The quiz is open over the guide. */
  open: boolean;
  round: QuizRound | null;
  /** On a family tablet: the player who said this quiz is hers, this page. */
  whose: string | null;
}

let state: QuizState = { open: false, round: null, whose: null };
const listeners = new Set<() => void>();

function set(next: Partial<QuizState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function quizState(): QuizState {
  return state;
}

export function useQuizState(): QuizState {
  return useSyncExternalStore(subscribe, quizState, quizState);
}

/** Open the quiz over the guide (a round in progress picks up where she left it). */
export function openQuiz(): void {
  set({ open: true });
}

/** Close the quiz onto the guide. The round, if any, is kept. */
export function closeQuiz(): void {
  if (state.open) set({ open: false });
}

/** Start a round. */
export function beginRound(round: Omit<QuizRound, "index" | "answers">): void {
  set({ round: { ...round, index: 0, answers: {} }, open: true });
}

/** Her answer to the question on screen. */
export function answerRound(questionId: string, answer: RoundAnswer): void {
  const round = state.round;
  if (!round || round.answers[questionId]) return;
  set({ round: { ...round, answers: { ...round.answers, [questionId]: answer } } });
}

/** On to the next question (or the end of the round). */
export function nextQuestion(): void {
  const round = state.round;
  if (!round) return;
  set({ round: { ...round, index: Math.min(round.index + 1, round.questions.length) } });
}

/** The round is over and seen: the next tap on Quiz starts a fresh one. */
export function endRound(): void {
  set({ round: null });
}

/** A family tablet's kid says the quiz is hers. */
export function claimQuiz(playerId: string | null): void {
  set({ whose: playerId });
}

/** The round in progress for `owner`, or null (another kid's round is never hers). */
export function roundFor(owner: string | null): QuizRound | null {
  return state.round && state.round.owner === owner ? state.round : null;
}

/** Test seam. */
export function resetQuiz(): void {
  set({ open: false, round: null, whose: null });
}
