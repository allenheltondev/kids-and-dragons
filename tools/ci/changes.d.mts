// Types for changes.mjs, which stays plain JS so a workflow can run it with
// nothing installed but node.
export type Job = "build" | "e2e" | "deploy";
export const JOBS: readonly Job[];
export function classify(files: string[]): Record<Job, boolean>;
