/** Types for the parts of trivia-bank.mjs that TypeScript imports. */
import type { FieldGuide } from "../../packages/shared/src/field-guide.ts";
import type { LookCatalog } from "../../packages/shared/src/types/look.ts";

export interface TriviaProblem {
  file: string;
  at: string;
  problem: string;
  hint?: string;
}

export declare const TRIVIA_DIR: "content/trivia";
export declare const LADDER: "content/trivia/ladder.json";
export declare const MAX_OPTION_WORDS: number;
export declare const MAX_ASK_WORDS: number;
export declare const WRONG_OPTIONS: { min: number; max: number };

export declare function titleForms(title: string): string[];
export declare function pluralForms(form: string): string[];
export declare function pagesNamed(text: string, guide: Pick<FieldGuide, "entries">): { id: string; title: string; index: number }[];

export declare function triviaBankProblems(input: {
  /** Each content/trivia/<group>.json, parsed and schema-valid. */
  files: readonly { path: string; data: unknown }[];
  /** content/trivia/ladder.json, schema-valid, or null to skip the ladder. */
  ladder: unknown;
  guide: Pick<FieldGuide, "entries">;
  looks: LookCatalog | null;
  /** Whether a repo-relative file is there (a question's picture). */
  exists: (path: string) => boolean;
}): TriviaProblem[];
