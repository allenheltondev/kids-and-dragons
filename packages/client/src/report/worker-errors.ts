/**
 * The service worker's failures reach the crash reporter (#459). A worker has
 * no screen and its console is nobody's, so when its install or activate
 * throws, or it hits a full disk or a file that is not the one fingerprinted,
 * it posts `{ type: "kad:sw-error", stage, message, build }` to the open pages
 * (sw.ts `reportOnce`). This is the page's half: it hands the stage to
 * `report()`, which sends a kind of failure and never the worker's own words.
 *
 * Small and in the first paint beside `listen.ts`; `report.ts` loads on the
 * first message.
 */

export const WORKER_STAGES = ["install", "activate", "fingerprint", "quota"] as const;
export type WorkerStage = (typeof WORKER_STAGES)[number];

/** The stage a worker message names, or null when it is not one of ours. */
export function workerErrorStage(data: unknown): WorkerStage | null {
  if (!data || typeof data !== "object") return null;
  const { type, stage } = data as { type?: unknown; stage?: unknown };
  if (type !== "kad:sw-error") return null;
  return WORKER_STAGES.find((known) => known === stage) ?? null;
}

/**
 * What the reporter is handed for a stage. Its message begins with the words
 * `diagnose` (shared/error-report.ts) turns into a fixed phrase, and it has no
 * stack: the frames of the page that received it would point at the wrong code.
 */
export function workerError(stage: WorkerStage): Error {
  const error = new Error(`service worker ${stage}`);
  error.stack = "";
  return error;
}

/** Call `send` for every worker error message that arrives on `target`. */
export function listenForWorkerErrors(
  target: Pick<EventTarget, "addEventListener"> | undefined,
  send: (thrown: unknown) => void,
): void {
  target?.addEventListener("message", (event) => {
    const stage = workerErrorStage((event as MessageEvent).data);
    if (stage) send(workerError(stage));
  });
}
