/**
 * "New in your Field Guide!" — the celebration half of #106's news signal.
 *
 * Two surfaces, one queue each: a toast on a phone (`FieldGuideToast`) and a
 * banner on the shared screen (`FieldGuideBanner`). Each is its own client with
 * its own copy of the news store, so each acknowledges only what *it* showed.
 * Neither fetches field-guide.json until there is something to name — a quiet
 * session never requests it.
 *
 * News is live-only (field-guide-news.ts), so a reload or resync has nothing to
 * celebrate; the book keeps its "New" badges for that.
 *
 * Neither takes focus: they are `role="status"` live regions, and the phone's
 * is a button the player may tap but is never moved to.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import type { FieldGuide } from "@kad/shared";
import { useGameStore, useMyTurnKey, useRunState, useSession } from "../store";
import type { PresentationEvent, ProgressionEvent } from "../store/contract";
import { ackFieldGuideNews, useFieldGuideNews } from "../store/field-guide-news";
import { markFieldGuideSeen } from "../store/field-guide-seen";
import { openGuide } from "../store/player-navigation";
import { presentationDuration, rollCardMs } from "../world/presentation";
import { noticeMs } from "../ui/notice-timing";
import { loadFieldGuide } from "./content";
import { TRANSFORM_BEAT_MS } from "./TransformCutscene";
import "./FieldGuideNews.css";

/** How long a toast or banner stays up. */
export const NEWS_SHOW_MS = 5000;
/** A breath after the last animation before the banner arrives. */
export const NEWS_QUIET_GAP_MS = 400;

/** One entry's worth of "A", or "A, B, C", or "4 new entries" — fits one line. */
export function describeNews(titles: string[], count: number): string {
  if (count > 3 || titles.length < count) return `${count} new entries`;
  return titles.join(", ");
}

/**
 * The guide, fetched once and only while there is something to name.
 * `settled` is true once the fetch has either landed or failed, so a batch
 * never goes up (and gets acknowledged) before its names could be known.
 */
function useGuideFor(wanted: boolean): { guide: FieldGuide | null; settled: boolean } {
  const [state, setState] = useState<{ guide: FieldGuide | null; settled: boolean }>({ guide: null, settled: false });
  useEffect(() => {
    if (!wanted || state.settled) return;
    let live = true;
    loadFieldGuide().then(
      (guide) => { if (live) setState({ guide, settled: true }); },
      () => { if (live) setState({ guide: null, settled: true }); },
    );
    return () => { live = false; };
  }, [wanted, state.settled]);
  return state;
}

/**
 * Take the whole queue as one batch once `ready`, acknowledge it, and clear it
 * after `showMs` (NEWS_SHOW_MS unless told how long this batch's words take to
 * read). News that arrives while a batch is up waits for the next.
 */
function useNewsBatch(ready: boolean, showMs: (ids: string[]) => number = () => NEWS_SHOW_MS): string[] | null {
  const news = useFieldGuideNews();
  const [shown, setShown] = useState<string[] | null>(null);
  useEffect(() => {
    if (shown || !ready || news.length === 0) return;
    const ids = [...new Set(news.map((n) => n.canonId))];
    setShown(ids);
    ackFieldGuideNews(ids);
  }, [news, ready, shown]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), showMs(shown));
    return () => clearTimeout(timer);
    // The time is read once, when the batch goes up.
  }, [shown]);
  return shown;
}

function titlesOf(guide: FieldGuide | null, ids: string[]): string[] {
  if (!guide) return [];
  return ids.map((id) => guide.entries[id]?.title).filter((t): t is string => !!t);
}

/* ------------------------------------------------------------------ phone */

/**
 * Defer while the player owes the table something. `useMyTurnKey` is the
 * codebase's "this player's decision is open" signal (a prompt addressed to
 * me, my combat turn, or no character yet); an unanswered trade offer is the
 * other thing PlayerPanel counts as a task. The toast floats over the panel,
 * so rather than cover a choice card or the action bar it waits and appears
 * once the question is answered. The news stays queued meanwhile.
 */
function useHasPendingTurn(): boolean {
  const turnKey = useMyTurnKey();
  const state = useRunState();
  const playerId = useSession()?.playerId ?? "";
  const trade = (state?.trades ?? []).some((offer) => offer.toPlayerId === playerId);
  return turnKey !== null || trade;
}

export function FieldGuideToast(): ReactElement | null {
  const busy = useHasPendingTurn();
  const news = useFieldGuideNews();
  const { guide, settled } = useGuideFor(news.length > 0);
  const ids = useNewsBatch(!busy && settled);
  if (!ids) return null;
  const titles = titlesOf(guide, ids);
  const first = ids[0]!;
  const art = ids.length === 1 ? guide?.entries[first]?.art : undefined;
  const open = (): void => {
    if (ids.length === 1) {
      markFieldGuideSeen(first);
      openGuide(first);
    } else {
      openGuide();
    }
  };
  return (
    <div className="guide-news guide-news--phone" role="status" aria-live="polite">
      <button type="button" className="guide-news__body" onClick={open}>
        {art
          ? <img className="guide-news__art" src={art} alt="" />
          : <span className="guide-news__art guide-news__art--star" aria-hidden="true">★</span>}
        <span className="guide-news__text">
          <span className="guide-news__lead">New in your Field Guide</span>
          <span className="guide-news__title">{describeNews(titles, ids.length)}</span>
        </span>
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------- TV */

/**
 * True when nothing on the shared screen is mid-moment. Dice, scene entries,
 * combat sequences and the tier cutscene all announce themselves on the store
 * (presentation / progression channels); each sets a "busy until", and the
 * banner waits for it plus a short gap. The narration panel is persistent, so
 * the banner sits at the top edge, clear of it.
 */
function useStageQuiet(): boolean {
  const [quiet, setQuiet] = useState(true);
  const until = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const hold = (ms: number): void => {
      until.current = Math.max(until.current, Date.now() + ms + NEWS_QUIET_GAP_MS);
      setQuiet(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setQuiet(true), until.current - Date.now());
    };
    let lastPresentation = useGameStore.getState().presentation?.seq ?? 0;
    let lastProgression = useGameStore.getState().progression?.seq ?? 0;
    const unsubscribe = useGameStore.subscribe((s) => {
      const p: PresentationEvent | null = s.presentation;
      if (p && p.seq > lastPresentation) {
        lastPresentation = p.seq;
        // A roll holds the banner for the whole dice card, not just the patch:
        // news landing over "14 + 3 = 17" would bury the number it is about.
        hold(
          p.presentation.kind === "ROLL"
            ? rollCardMs(p.presentation.roll)
            : presentationDuration(p.presentation),
        );
      }
      const g: ProgressionEvent | null = s.progression;
      if (g && g.seq > lastProgression) {
        lastProgression = g.seq;
        const crossings = (g.progression.awards ?? []).filter((a) => a.newTier !== undefined).length;
        if (crossings > 0) hold(crossings * TRANSFORM_BEAT_MS);
      }
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return quiet;
}

/** What the shared screen's banner says, start to finish, for how long it takes to read. */
export function bannerWords(titles: string[], count: number): string {
  return `New in the Field Guide ${describeNews(titles, count)}`;
}

/**
 * Drawn in the shared screen's column (App.tsx `.kad-display-stack`) when there is one, under
 * the chapter's goal and over the stage, with the arrivals and the toast, so none of them lands
 * on another or on the goal. Up for as long as its words take to read (`noticeMs`).
 */
export function FieldGuideBanner(): ReactElement | null {
  const quiet = useStageQuiet();
  const news = useFieldGuideNews();
  const { guide, settled } = useGuideFor(news.length > 0);
  const ids = useNewsBatch(quiet && settled, (batch) => noticeMs(bannerWords(titlesOf(guide, batch), batch.length)));
  if (!ids) return null;
  const titles = titlesOf(guide, ids);
  const arts = ids.slice(0, 3).map((id) => guide?.entries[id]?.art).filter((a): a is string => !!a);
  const dock = typeof document === "undefined" ? null : document.querySelector(".kad-display-stack");
  const banner = (
    <div className={`guide-news guide-news--tv${dock ? " guide-news--dock" : ""}`} role="status" aria-live="polite">
      <div className="guide-news__body">
        {arts.length > 0
          ? <span className="guide-news__arts">{arts.map((src) => <img key={src} className="guide-news__art" src={src} alt="" />)}</span>
          : <span className="guide-news__art guide-news__art--star" aria-hidden="true">★</span>}
        <span className="guide-news__text">
          <span className="guide-news__lead">New in the Field Guide</span>
          <span className="guide-news__title">{describeNews(titles, ids.length)}</span>
        </span>
      </div>
    </div>
  );
  return dock ? createPortal(banner, dock) : banner;
}
