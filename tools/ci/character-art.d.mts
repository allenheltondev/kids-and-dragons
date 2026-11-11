// Types for character-art.mjs, which stays plain JS so a workflow can run it with
// nothing installed but node.
export interface LockLike {
  files?: Record<string, { sha256: string; bytes?: number }>;
}
export interface CharacterChange {
  path: string;
  sha256: string;
  change: "added" | "repainted";
}
export const CHARACTER_ROOTS: readonly string[];
export const APPROVAL_LABEL: string;
export function characterChanges(base: LockLike | null, head: LockLike | null): CharacterChange[];
export function storeLink(storeUrl: string | null, sha256: string, path: string): string | null;
export function review(input: { changes: CharacterChange[]; labels: string[]; storeUrl: string | null }): { ok: boolean; report: string };
