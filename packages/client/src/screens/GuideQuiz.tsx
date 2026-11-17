/**
 * The Field Guide quiz (docs/trivia.md §2, §4, §5): a Quiz button beside the
 * guide's progress line in the adventure book, and a round of up to eight
 * questions that opens over the guide.
 *
 * Every question is asked over its page's picture (§3.5): a creature, a
 * people, a folk or a person as its figure, a place as its backdrop, a class
 * as its gear portrait. Four options, shuffled every asking. A right answer
 * glows and chimes, and counts. A wrong one says "Not this time." and nothing
 * else: no right answer marked, no second try, and one button to read about
 * it in the Field Guide, which closes the quiz onto the guide and keeps the
 * rest of the round for when she comes back.
 *
 * The phone marks each answer at once and queues it (store/trivia-queue.ts),
 * as the book queues kit edits; book-trivia-sync.ts sends it, and the server
 * decides what counts. A rung newly reached says so at once ("You earned the
 * title the Learned!").
 *
 * Only in the book, never in a scene, a check or a fight: JournalScreen gives
 * this nothing to draw while the table is live (layout/BookTab.tsx's rule). A
 * family tablet asks whose quiz it is before the first round, the way its
 * book asks whose kit.
 */

import { useEffect, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  drawOptions,
  triviaQuestion,
  type FieldGuide as FieldGuideData,
  type JournalResponse,
  type TriviaAnswer,
  type TriviaRecord,
  type TriviaRung,
} from "@kad/shared";
import { cue } from "../audio/cue";
import { DETAIL_STEP, useBackStep } from "../store/back-steps";
import { answerTrivia, bookTriviaStatus, clearBookTriviaNotes, onBookTrivia, unsentTriviaAnswers, type ApplyTrivia } from "../store/book-trivia-sync";
import { selectGuideEntry, selectGuideTab } from "../store/player-navigation";
import { loadPlayerDeviceToken } from "../store/persistence";
import { useGameStore } from "../store";
import { withQueuedTrivia } from "../store/trivia-queue";
import {
  answerRound,
  beginRound,
  claimQuiz,
  closeQuiz,
  endRound,
  nextQuestion,
  openQuiz,
  roundFor,
  useQuizState,
  type QuizRound,
} from "../store/trivia-round";
import { LOOKS } from "../world/hero-name";
import { noticeMs } from "../ui/notice-timing";
import { Icon } from "./icons";
import { loadFieldGuide, loadTriviaContent, type TriviaContent } from "./content";
import { QUIZ_EMPTY_WORDS, newRoundId, newlyReached, pickRound, quizCandidates, quizEmptyReason, rungRewardWords, pictureOnPhone, type QuizEmpty } from "./quiz-rules";
import "./GuideQuiz.css";

/** The quiz's content and the guide, once both are here; null while loading or when they will not load. */
function useQuizContent(): { content: TriviaContent; guide: FieldGuideData } | null {
  const [loaded, setLoaded] = useState<{ content: TriviaContent; guide: FieldGuideData } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([loadTriviaContent(), loadFieldGuide()]).then(
      ([content, guide]) => {
        if (live) setLoaded({ content, guide });
      },
      () => {
        /* no quiz content (an older build, or never fetched with a signal): no Quiz button */
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}

/** Re-render on any change to the queued or in-flight answers. */
function useTriviaSync(): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onBookTrivia(rerender), []);
}

/** Whose quiz this is: the phone's binding, or a family tablet's seat. */
function useQuizOwner(): { owner: string | null; tablet: boolean } {
  const seat = useGameStore((s) => s.session?.playerId ?? null);
  const device = loadPlayerDeviceToken();
  return { owner: device ?? seat, tablet: device === null };
}

/** Her record as the book shows it: the server's, with every answer not yet sent marked over it. */
export function shownTriviaRecord(journal: JournalResponse, content: TriviaContent | null): TriviaRecord {
  return withQueuedTrivia(journal.trivia, unsentTriviaAnswers(), content?.bank ?? null, journal.fieldGuide);
}

/**
 * How many questions a fresh round could ask right now, checked against the
 * pictures on the phone when there is no signal; null while it is being worked out.
 */
function useAskable(journal: JournalResponse, loaded: { content: TriviaContent; guide: FieldGuideData } | null, record: TriviaRecord): number | null {
  const [askable, setAskable] = useState<number | null>(null);
  const masteredKey = Object.keys(record.mastered).length;
  useEffect(() => {
    if (!loaded) return undefined;
    let live = true;
    const candidates = quizCandidates(loaded.content.bank, loaded.guide, journal.fieldGuide, record, newRoundId());
    void Promise.all(candidates.map((c) => pictureOnPhone(c.picture))).then((ready) => {
      if (live) setAskable(ready.filter((src) => src !== null).length);
    });
    return () => {
      live = false;
    };
    // The record is read through how much is mastered: a miss never empties a fresh round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, journal.fieldGuide, masteredKey]);
  return askable;
}

export interface GuideQuizProps {
  journal: JournalResponse;
  /** What the server answered with, for the book's copy. */
  onTrivia: ApplyTrivia;
}

/** The Quiz button beside the guide's progress line, or why there is nothing to ask (§4.1). */
export function QuizButton({ journal }: GuideQuizProps): ReactElement | null {
  useTriviaSync();
  const loaded = useQuizContent();
  useQuizState();
  const { owner } = useQuizOwner();
  const record = shownTriviaRecord(journal, loaded?.content ?? null);
  const askable = useAskable(journal, loaded, record);
  // No questions in this build: the guide says nothing about a quiz.
  if (!loaded || loaded.content.bank.length === 0) return null;
  const round = roundFor(owner);
  if (round !== null) {
    const going = round.index < round.questions.length;
    return (
      <button type="button" className="quiz-entry kad-tap kad-focusable" onClick={openQuiz} data-testid="quiz-open">
        <Icon name="star" />
        <span>{going ? "Back to your quiz" : "Quiz"}</span>
      </button>
    );
  }
  if (askable === null) return null;
  const empty = quizEmptyReason(loaded.content.bank, journal.fieldGuide, record, askable);
  if (empty) {
    return (
      <p className="quiz-entry__empty" data-testid="quiz-empty" data-reason={empty}>
        <Icon name="star" />
        <span>{QUIZ_EMPTY_WORDS[empty]}</span>
      </p>
    );
  }
  return (
    <button type="button" className="quiz-entry kad-tap kad-focusable" onClick={openQuiz} data-testid="quiz-open">
      <Icon name="star" />
      <span>Quiz</span>
    </button>
  );
}

/** The quiz itself, over the guide, while it is open. */
export function QuizOverlay({ journal, onTrivia }: GuideQuizProps): ReactElement | null {
  useTriviaSync();
  const quiz = useQuizState();
  const loaded = useQuizContent();
  const { owner, tablet } = useQuizOwner();
  const [starting, setStarting] = useState(false);
  const [empty, setEmpty] = useState<QuizEmpty | null>(null);
  const [rewards, setRewards] = useState<string[]>([]);
  const record = shownTriviaRecord(journal, loaded?.content ?? null);
  const round = roundFor(owner);
  const claimed = !tablet || (quiz.whose !== null && quiz.whose === owner);

  useBackStep(quiz.open ? () => { closeQuiz(); return true; } : null, DETAIL_STEP + 1);

  // A round starts as the quiz opens with none in progress (once a tablet's kid has said it is hers).
  useEffect(() => {
    if (!quiz.open || !loaded || round !== null || !claimed || starting) return;
    let live = true;
    setStarting(true);
    setEmpty(null);
    const id = newRoundId();
    void pickRound(loaded.content.bank, loaded.guide, journal.fieldGuide, record, id).then((questions) => {
      if (!live) return;
      setStarting(false);
      if (questions.length === 0) {
        setEmpty(quizEmptyReason(loaded.content.bank, journal.fieldGuide, record, 0));
        return;
      }
      const options: Record<string, string[]> = {};
      for (const q of questions) {
        const question = triviaQuestion(loaded.content.bank, q.id);
        if (question) options[q.id] = drawOptions(question, `${id}:${q.id}`);
      }
      beginRound({ id, owner: owner ?? "", questions, options });
    });
    return () => {
      live = false;
      setStarting(false);
    };
    // The round is drawn from the record as the quiz opens, not again on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz.open, loaded, round === null, claimed]);

  useEffect(() => {
    if (rewards.length === 0) return undefined;
    const timer = setTimeout(() => setRewards([]), noticeMs(rewards.join(" ")) + 2000);
    return () => clearTimeout(timer);
  }, [rewards]);

  if (!quiz.open) return null;

  const close = (): void => {
    if (round && round.index >= round.questions.length) endRound();
    closeQuiz();
  };

  let body: ReactElement;
  if (!claimed) {
    body = <WhoseQuiz name={journal.profile?.displayName ?? null} onMine={() => claimQuiz(owner)} onNotMine={closeQuiz} />;
  } else if (!loaded || (round === null && empty === null)) {
    body = <p className="quiz__busy" role="status">Finding your questions…</p>;
  } else if (round === null) {
    body = (
      <div className="quiz__done" data-testid="quiz-empty-round">
        <Icon name="star" size="2em" />
        <p>{QUIZ_EMPTY_WORDS[empty ?? "all-done"]}</p>
        <button type="button" className="quiz__next kad-tap kad-focusable" onClick={closeQuiz}>Back to the guide</button>
      </div>
    );
  } else if (round.index >= round.questions.length) {
    body = <RoundDone round={round} onAgain={() => { endRound(); }} onClose={close} />;
  } else {
    const current = round.questions[round.index]!;
    const question = triviaQuestion(loaded.content.bank, current.id);
    if (!question) {
      // A question this build no longer has: nothing to ask, so on to the next.
      body = (
        <button type="button" className="quiz__next kad-tap kad-focusable" onClick={nextQuestion}>
          <span>Next question</span>
          <Icon name="forward" />
        </button>
      );
    } else {
      const pick = (picked: string): void => {
        if (round.answers[question.id]) return;
        const correct = picked === question.answer;
        const answer: TriviaAnswer = {
          questionId: question.id,
          optionsShown: [...(round.options[question.id] ?? [])],
          picked,
          at: new Date().toISOString(),
          round: round.id,
        };
        const before = record;
        const after = withQueuedTrivia(before, [answer], loaded.content.bank, journal.fieldGuide);
        answerRound(question.id, { picked, correct });
        if (correct) cue("chime-echo");
        const reached: TriviaRung[] = newlyReached(before, after, loaded.content.ladder);
        const words = reached.flatMap((r) => rungRewardWords(r, LOOKS));
        if (words.length > 0) setRewards((was) => [...was, ...words]);
        void answerTrivia(answer, onTrivia).catch(() => undefined);
      };
      const read = (): void => {
        const page = loaded.guide.entries[question.entry];
        if (question.link === "entry") selectGuideEntry(question.entry);
        else {
          selectGuideEntry(null);
          if (page) selectGuideTab(page.category);
        }
        nextQuestion();
        closeQuiz();
      };
      body = (
        <QuestionCard
          key={`${round.id}:${question.id}`}
          number={round.index + 1}
          of={round.questions.length}
          picture={current.picture}
          place={current.place}
          ask={question.ask}
          options={round.options[question.id] ?? []}
          answer={round.answers[question.id] ?? null}
          onPick={pick}
          onRead={read}
          onNext={nextQuestion}
          last={round.index + 1 >= round.questions.length}
        />
      );
    }
  }

  const status = bookTriviaStatus();
  return (
    <section className="quiz" role="dialog" aria-modal="false" aria-labelledby="quiz-title" data-testid="quiz">
      <header className="quiz__bar">
        <h2 className="quiz__title" id="quiz-title">
          <Icon name="star" />
          <span>Field Guide quiz</span>
        </h2>
        <button type="button" className="quiz__stop kad-tap kad-focusable" onClick={close} data-testid="quiz-stop">
          <Icon name="close" />
          <span>Stop</span>
        </button>
      </header>
      {rewards.length > 0 ? (
        <div className="quiz__reward" role="status" aria-live="polite" data-testid="quiz-reward">
          <span className="quiz__reward-star" aria-hidden="true">★</span>
          <p>{rewards.join(" ")}</p>
          <button type="button" className="quiz__reward-ok kad-tap kad-focusable" onClick={() => setRewards([])}>OK</button>
        </div>
      ) : null}
      {status.notes.length > 0 ? (
        <div className="quiz__note" role="status" data-testid="quiz-note">
          <Icon name="hand" />
          <p>{status.notes.join(" ")}</p>
          <button type="button" className="quiz__reward-ok kad-tap kad-focusable" onClick={clearBookTriviaNotes}>OK</button>
        </div>
      ) : null}
      <div className="quiz__body kad-scroll">{body}</div>
    </section>
  );
}

/** A family tablet's question before the first round: whose quiz is it? */
function WhoseQuiz({ name, onMine, onNotMine }: { name: string | null; onMine: () => void; onNotMine: () => void }): ReactElement {
  return (
    <div className="quiz__whose" data-testid="quiz-whose">
      <h3 className="quiz__ask">Whose quiz is it?</h3>
      <p className="kad-muted">Right answers count for this player.</p>
      <div className="quiz__whose-picks" role="radiogroup" aria-label="Whose quiz">
        <button type="button" role="radio" aria-checked="false" className="quiz__option kad-tap kad-focusable" onClick={onMine}>
          {name ? `It's ${name}'s` : "It's mine"}
        </button>
      </div>
      <button type="button" className="quiz__link kad-tap kad-focusable" onClick={onNotMine}>Not mine</button>
    </div>
  );
}

interface QuestionCardProps {
  number: number;
  of: number;
  picture: string;
  place: boolean;
  ask: string;
  options: readonly string[];
  answer: { picked: string; correct: boolean } | null;
  onPick: (option: string) => void;
  onRead: () => void;
  onNext: () => void;
  last: boolean;
}

/** One question over its picture, four options, and what her pick was. */
function QuestionCard({ number, of, picture, place, ask, options, answer, onPick, onRead, onNext, last }: QuestionCardProps): ReactElement {
  const heading = useRef<HTMLHeadingElement>(null);
  const after = useRef<HTMLButtonElement>(null);
  const [broken, setBroken] = useState(false);
  // A new question: her screen reader starts at the question, not the last button she pressed.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (answer) after.current?.focus();
  }, [answer]);
  return (
    <article className={`quiz__card${place ? " quiz__card--place" : ""}`} data-testid="quiz-question">
      <p className="quiz__count">
        <span>Question {number} of {of}</span>
        <span className="quiz__pips" aria-hidden="true">
          {Array.from({ length: of }, (_, i) => (
            <span key={i} className={`quiz__pip${i < number - 1 ? " quiz__pip--done" : ""}${i === number - 1 ? " quiz__pip--on" : ""}`} />
          ))}
        </span>
      </p>
      <div className={place ? "quiz__backdrop" : "quiz__figure"} aria-hidden="true">
        {broken ? null : <img src={picture} alt="" onError={() => setBroken(true)} data-testid="quiz-picture" />}
      </div>
      <h3 className="quiz__ask" id="quiz-ask" tabIndex={-1} ref={heading}>{ask}</h3>
      <div className="quiz__options" role="group" aria-labelledby="quiz-ask">
        {options.map((option) => {
          const mine = answer?.picked === option;
          const mark = mine ? (answer.correct ? " quiz__option--right" : " quiz__option--wrong") : "";
          return (
            <button
              key={option}
              type="button"
              className={`quiz__option kad-tap kad-focusable${mark}`}
              aria-pressed={mine}
              aria-disabled={answer !== null || undefined}
              onClick={() => { if (!answer) onPick(option); }}
            >
              {option}
            </button>
          );
        })}
      </div>
      <div className="quiz__after" aria-live="polite">
        {answer ? (
          <>
            <p className={`quiz__verdict${answer.correct ? " quiz__verdict--right" : ""}`} data-testid="quiz-verdict">
              {answer.correct ? "That's it!" : "Not this time."}
            </p>
            {answer.correct ? null : (
              <button type="button" className="quiz__link kad-tap kad-focusable" onClick={onRead} data-testid="quiz-read">
                <Icon name="story" />
                <span>Read about it in the Field Guide</span>
              </button>
            )}
            <button type="button" className="quiz__next kad-tap kad-focusable" onClick={onNext} ref={after} data-testid="quiz-next">
              <span>{last ? "See how you did" : "Next question"}</span>
              <Icon name="forward" />
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

/** The end of a round: how many she knew, and the way to another. */
function RoundDone({ round, onAgain, onClose }: { round: QuizRound; onAgain: () => void; onClose: () => void }): ReactElement {
  const right = Object.values(round.answers).filter((a) => a.correct).length;
  const asked = Object.keys(round.answers).length;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="quiz__done" data-testid="quiz-done">
      <Icon name="star" size="2.4em" />
      <h3 className="quiz__ask" tabIndex={-1} ref={heading}>
        {asked === 0 ? "Round over" : right === asked ? `All ${String(asked)} right!` : `You knew ${String(right)} of ${String(asked)}.`}
      </h3>
      <p className="kad-muted">{right < asked ? "The ones you missed will come back in another round." : "Every one counts toward your next reward."}</p>
      <button type="button" className="quiz__next kad-tap kad-focusable" onClick={onAgain} data-testid="quiz-again">
        <span>Another round</span>
        <Icon name="forward" />
      </button>
      <button type="button" className="quiz__link kad-tap kad-focusable" onClick={onClose}>Back to the guide</button>
    </div>
  );
}
