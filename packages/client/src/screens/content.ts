/**
 * Content loading guard.
 *
 * Species, classes and stats are data (`content/rules.json`), never constants
 * in a component — the roadmap's "content as data" rule. Screens that read
 * rules or the item catalog ask for them here so they work no matter which
 * surface mounted first; `loadContent()` is idempotent by contract.
 */

import { useEffect } from "react";
import { useGameStore } from "../store";

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
