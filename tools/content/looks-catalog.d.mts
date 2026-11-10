/** Types for the parts of looks-catalog.mjs that TypeScript imports. */
import type { Chapter, Effect } from "../../packages/shared/src/types/chapter.ts";
import type { LookCatalog } from "../../packages/shared/src/types/look.ts";

export interface LooksProblem {
  file: string;
  at: string;
  problem: string;
  hint?: string;
  /** Printed, and does not fail the gate. */
  warning?: boolean;
}

export declare function looksCatalogProblems(input: {
  /** content/looks.json, schema-valid. */
  catalog: LookCatalog;
  /** assets/manifest.json → nameplateFrames. */
  manifest?: unknown;
  tiers: ReadonlySet<string>;
  classes: ReadonlySet<string>;
  campaigns: ReadonlySet<string>;
  /** content/camp.json friends. */
  friends: ReadonlySet<string>;
  species: ReadonlySet<string>;
  /** Every loaded chapter, by id: their `findLook` effects. */
  chapters?: ReadonlyMap<string, Chapter>;
}): LooksProblem[];
export declare function chapterLookFinds(chapter: Chapter): { effect: Effect; at: string }[];
