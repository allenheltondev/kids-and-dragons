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
