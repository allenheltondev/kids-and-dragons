// Types for e2e-shard.mjs, which stays plain JS so a workflow can run it with
// nothing installed but node (and Playwright, which it drives).
export interface ListedTest {
  file: string;
  line: number;
  key: string;
  seconds?: number;
}
export interface Shard {
  locations: string[];
  seconds: number;
}
export function keyOf(file: string, titles: string[]): string;
export function testsOf(report: unknown): ListedTest[];
export function plan(tests: ListedTest[], timings: Record<string, number>, count: number): Shard[];
export function merge(reports: string[], timings: Record<string, number>): Record<string, number>;
