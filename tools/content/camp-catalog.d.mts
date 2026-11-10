/** Types for the parts of camp-catalog.mjs that TypeScript imports. */
import type { MILESTONE_KIT_PIECES } from "../../packages/shared/src/camp-milestones.ts";
import type { CampCatalog } from "../../packages/shared/src/types/camp.ts";
import type { Chapter, Effect } from "../../packages/shared/src/types/chapter.ts";

/** An effect found by a deep walk of a chapter, with its JSON pointer. */
export interface FoundEffect {
  effect: Effect;
  at: string;
}

export interface CatalogProblem {
  file: string;
  at: string;
  problem: string;
  hint?: string;
}

export declare function chapterBefriends(chapter: Chapter): FoundEffect[];
export declare function chapterFinds(chapter: Chapter): FoundEffect[];
export declare function campCatalogProblems(input: {
  /** content/camp.json, schema-valid. */
  catalog: CampCatalog;
  /** assets/manifest.json → camp. */
  manifest: unknown;
  /** Every schema-valid chapter, by id. */
  chapters: ReadonlyMap<string, Chapter>;
  /** Chapter ids that failed to load (not reported again). */
  brokenChapters?: ReadonlySet<string>;
  campaigns: ReadonlySet<string>;
  milestones: typeof MILESTONE_KIT_PIECES;
  /** assets/manifest.json → castFigures. */
  castFigures?: readonly unknown[];
}): CatalogProblem[];
