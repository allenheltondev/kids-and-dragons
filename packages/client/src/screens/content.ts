/**
 * Content loading guard.
 *
 * Species, classes and stats are data (`content/rules.json`), never constants
 * in a component — the roadmap's "content as data" rule. Screens that read
 * rules or the item catalog ask for them here so they work no matter which
 * surface mounted first; `loadContent()` is idempotent by contract.
 */

import { useEffect } from "react";
import { TRIVIA_GROUPS, triviaBankOf } from "@kad/shared";
import type { FieldGuide, TriviaBank, TriviaBankFile, TriviaLadder } from "@kad/shared";
import { useGameStore } from "../store";

/**
 * `content/field-guide.json`, fetched on first ask and kept — only once the
 * guide is opened or there is news to name, so a quiet session never requests
 * it. A failed fetch clears the cache so the next ask retries.
 */
let fieldGuide: Promise<FieldGuide> | null = null;

export function loadFieldGuide(): Promise<FieldGuide> {
  fieldGuide ??= fetch("/content/field-guide.json")
    .then((response) => {
      if (!response.ok) throw new Error(`field guide: ${response.status}`);
      return response.json() as Promise<FieldGuide>;
    })
    .catch((error: unknown) => {
      fieldGuide = null;
      throw error;
    });
  return fieldGuide;
}

/** Test seam: forget the cached guide. */
export function resetFieldGuideCache(): void {
  fieldGuide = null;
}

/** The Field Guide quiz's content (docs/trivia.md §6.2): every question, and the ladder. */
export interface TriviaContent {
  bank: TriviaBank;
  ladder: TriviaLadder;
}

let triviaContent: Promise<TriviaContent> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

/**
 * `content/trivia/<group>.json` for every group, as one bank, and
 * `content/trivia/ladder.json`, fetched on first ask and kept, the way the
 * field guide is. The service worker precaches every file
 * (`SW_PRECACHE_CONTENT`), so the quiz opens offline. A failed fetch clears
 * the cache so the next ask retries.
 */
export function loadTriviaContent(): Promise<TriviaContent> {
  triviaContent ??= Promise.all([
    Promise.all(TRIVIA_GROUPS.map((group) => fetchJson<TriviaBankFile>(`/content/trivia/${group}.json`))),
    fetchJson<TriviaLadder>("/content/trivia/ladder.json"),
  ])
    .then(([files, ladder]) => ({ bank: triviaBankOf(files), ladder: { rungs: ladder.rungs, firstTry: ladder.firstTry } }))
    .catch((error: unknown) => {
      triviaContent = null;
      throw error;
    });
  return triviaContent;
}

/** Test seam: forget the cached quiz content. */
export function resetTriviaContentCache(): void {
  triviaContent = null;
}

export function useEnsureContent(): void {
  const loadContent = useGameStore((s) => s.loadContent);
  useEffect(() => {
    void loadContent();
  }, [loadContent]);
}

/**
 * The chapter in play, for surfaces that render it (the combat board's biome
 * tiles and enemy art). Keyed on the run's `chapterId` so a mid-session
 * chapter change refetches by itself; `loadChapter` is idempotent per id.
 */
/**
 * The world map's key, for the map and nothing else: a phone that never opens
 * the map never fetches the painting's coordinates. `loadWorld` is idempotent.
 */
export function useEnsureWorld(): void {
  const loadWorld = useGameStore((s) => s.loadWorld);
  useEffect(() => {
    void loadWorld();
  }, [loadWorld]);
}

export function useEnsureChapter(): void {
  const chapterId = useGameStore((s) => s.state?.chapterId ?? null);
  const loadChapter = useGameStore((s) => s.loadChapter);
  useEffect(() => {
    if (chapterId) void loadChapter(chapterId);
  }, [chapterId, loadChapter]);
}
