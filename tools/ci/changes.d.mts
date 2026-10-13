// Types for changes.mjs, which stays plain JS so a workflow can run it with
// nothing installed but node.
export type Job = "build" | "e2e" | "rigs" | "motion" | "deploy";
export const JOBS: readonly Job[];
export const RIG_MANIFEST_KEYS: readonly string[];
export function classify(files: string[], opts?: { rigManifestChanged?: boolean }): Record<Job, boolean>;
