/** Types for the parts of class-places.mjs that TypeScript imports. */
import type { Campaign, Chapter } from "../../packages/shared/src/types/chapter.ts";

/** What a graph campaign gives a party, class by class. */
export interface ClassPlaceReach {
  rooms: Map<string, { status: "open" | "gated" | "missing"; where?: string }>;
  notOffRest: { chapter: string; scene: string; classId: string }[];
}

/** `{ "<campaignId>": "reason" }`, as the file holds it: a reason is checked, not assumed. */
export type ClassPlaceAllowList = Record<string, unknown>;

export declare function classPlaceReach(campaign: Campaign, chapters: readonly Chapter[], classIds: readonly string[]): ClassPlaceReach;
export declare function loadAllowList(path?: string): ClassPlaceAllowList;
export declare function classPlaceVerdict(
  campaignId: string,
  reach: ClassPlaceReach,
  allow?: ClassPlaceAllowList,
): { errors: string[]; warnings: string[] };
