/** Types for the parts of route-paths.mjs that TypeScript imports. */
import type { Chapter } from "../../packages/shared/src/types/chapter.ts";

/** A path that sets two members of one route set, by the ending it reaches. */
export interface RouteSetConflict {
  ending: string;
  set: string;
  flags: string[];
}

export declare function routeSetConflicts(
  chapter: Chapter,
  routeSets: Record<string, string[]>,
): { conflicts: RouteSetConflict[]; truncated: boolean };
