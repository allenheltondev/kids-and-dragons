/** Reusable story mechanics. All completion and branching is decided by the engine. */
export type InteractionSpec =
  | { kind: "precision"; cue: string; actionLabel: string; target: number; width: number; periodMs: number }
  | { kind: "timing"; cue: string; actionLabel: string; target: number; width: number; periodMs: number }
  | { kind: "tracking"; cue: string; actionLabel: string; covers: string[]; start: number; swaps: [number, number][]; stepMs: number }
  | { kind: "memory"; cue: string; actionLabel: string; options: InteractionOption[]; answer: string[]; stepMs: number }
  | { kind: "balance"; cue: string; actionLabel: string; objectLabel: string }
  | { kind: "relay"; cue: string; actionLabel: string; objectLabel: string }
  | { kind: "play"; cue: string; actionLabel: string; options: (InteractionOption & { reaction: string })[]; participation: "any" | "everyone"; stages?: string[] }
  | { kind: "cooperate"; cue: string; supportLabel: string; actionLabel: string }
  | { kind: "sequence"; cue: string; actionLabel: string; options: { id: string; label: string; icon: string }[]; answer: string[]; clues: string[] };

export interface InteractionOption { id: string; label: string; icon: string }

export interface InteractionPrompt {
  kind: "interaction";
  sceneId: string;
  /** Unique across repeated visits to the same scene. */
  openedSeq: number;
  attempt: number;
  spec: InteractionSpec;
  playerIds: string[];
  actorId: string;
  /** Who acted when the outcome was set. A phone that drops before "continue" must not move the story turn or the reward. */
  resolvedActorId?: string;
  phase: "ready" | "active" | "result";
  relaxed: boolean;
  startedAt?: string;
  /** A prop uses null; a held support has a server-time lease. */
  supports: Record<string, string | null>;
  levels?: Record<string, number>;
  passed?: string[];
  caughtBy?: string;
  contributions?: Record<string, string>;
  reactions?: { playerId: string; text: string }[];
  taps?: number;
  /** The actual tap/guess, retained for shared visual feedback and refresh. */
  stopPosition?: number;
  submittedAnswer?: string[];
  outcome?: "success" | "failure" | "assisted";
  /** Server time when this exact connected team began holding together. */
  steadySince?: string;
  steadyPlayerIds?: string[];
}

export type InteractionAction =
  | { action: "start"; relaxed: boolean }
  | { action: "stop"; position: number }
  | { action: "support"; mode: "hold" | "prop" | "release" }
  | { action: "complete" }
  | { action: "answer"; answer: string[] }
  | { action: "adjust"; direction: "up" | "down"; steps?: number }
  | { action: "catch" }
  | { action: "pass" }
  | { action: "play"; optionId: string }
  | { action: "retry" }
  | { action: "assist" }
  | { action: "continue" };

export const SUPPORT_LEASE_MS = 6000;

export function precisionPosition(elapsedMs: number, periodMs: number): number {
  const phase = (Math.max(0, elapsedMs) % periodMs) / (periodMs / 2);
  return phase <= 1 ? phase : 2 - phase;
}

/**
 * When an attempt began, on this device's own clock. A TV's and a phone's clocks can disagree
 * by seconds, so reading the server's `startedAt` against `Date.now()` drew the marker in a
 * different place on every screen, or held it at the start while a slow clock caught up.
 *
 * `clockGapMs` is the smallest `received - updatedAt` this device has seen lately (serverClockGap):
 * its clock's offset plus its quickest delivery, which one-way stamps cannot tell apart. A gap
 * that could be just a delivery (0 to CLOCK_TRUSTED_MS) means a clock in step with the server's,
 * the usual case, and the sweep is read straight off it. A larger or negative gap means a clock
 * that is off, and the gap stands in for its offset, give or take the quickest delivery.
 *
 * Without a gap (or when the gap would start the sweep later than this state shows), `updatedAt`
 * still helps: it is stamped by the same clock as `startedAt`, so their difference is how far into
 * the attempt this state was sent, and only this delivery's delay is left over. Either way a phone
 * that rejoins mid-attempt picks the sweep up where it is.
 */
export function interactionStartLocal(startedAt: string, updatedAt: string, receivedAt: number, clockGapMs?: number): number {
  const into = Date.parse(updatedAt) - Date.parse(startedAt);
  const byReceipt = receivedAt - (Number.isFinite(into) ? Math.max(0, into) : 0);
  if (clockGapMs === undefined || !Number.isFinite(clockGapMs)) return byReceipt;
  const offset = clockGapMs >= 0 && clockGapMs <= CLOCK_TRUSTED_MS ? 0 : clockGapMs;
  return Math.min(byReceipt, Date.parse(startedAt) + offset);
}

/** The largest clock gap that could still be only a delivery delay, from a clock in step with the server's. */
export const CLOCK_TRUSTED_MS = 400;

/** The smallest `received - sent` of recent states: this clock's offset from the server's, plus the quickest delivery. */
export function serverClockGap(samples: readonly { sentAt: string; receivedAt: number }[]): number | undefined {
  const gaps = samples.map((sample) => sample.receivedAt - Date.parse(sample.sentAt)).filter(Number.isFinite);
  return gaps.length ? Math.min(...gaps) : undefined;
}

export function precisionSuccess(spec: Extract<InteractionSpec, { kind: "precision" } | { kind: "timing" }>, position: number, relaxed: boolean): boolean {
  return Number.isFinite(position) && position >= 0 && position <= 1 &&
    Math.abs(position - spec.target) <= Math.min(1, spec.width * (relaxed ? 2 : 1)) / 2;
}

export function playbackMs(spec: InteractionSpec, relaxed: boolean): number {
  const step = spec.kind === "tracking" || spec.kind === "memory" ? spec.stepMs * (relaxed ? 2 : 1) : 0;
  return spec.kind === "tracking" ? (spec.swaps.length + 1) * step : spec.kind === "memory" ? spec.answer.length * step : 0;
}

export function trackedCover(spec: Extract<InteractionSpec, { kind: "tracking" }>): number {
  return spec.swaps.reduce((at, [a, b]) => at === a ? b : at === b ? a : at, spec.start);
}

export function balanceReady(prompt: InteractionPrompt, connected: readonly string[]): boolean {
  const total = connected.reduce((sum, id) => sum + (prompt.levels?.[id] ?? 0), 0);
  return connected.length > 0 && connected.every((id) => (prompt.levels?.[id] ?? 0) > 0) &&
    Math.abs(total - connected.length * 0.5) <= (prompt.relaxed ? 0.25 : 0.125);
}

export function relayHolder(prompt: InteractionPrompt, connected: readonly string[]): string | undefined {
  return [...prompt.playerIds, ...connected.filter((id) => !prompt.playerIds.includes(id))]
    .find((id) => connected.includes(id) && !prompt.passed?.includes(id));
}

export function playReady(prompt: InteractionPrompt, connected: readonly string[]): boolean {
  if (prompt.spec.kind !== "play") return false;
  const contributed = connected.filter((id) => prompt.contributions?.[id] !== undefined);
  return contributed.length > 0 && (prompt.spec.participation === "any" || contributed.length === connected.length) &&
    (prompt.taps ?? 0) >= (prompt.spec.stages?.length ?? 1);
}

export function interactionActor(prompt: InteractionPrompt, connected: readonly string[]): string | undefined {
  return connected.includes(prompt.actorId) ? prompt.actorId : connected[0];
}

export function supportPlayers(_prompt: InteractionPrompt, connected: readonly string[]): string[] {
  return [...connected];
}

export function supportsReady(prompt: InteractionPrompt, connected: readonly string[], now: string): boolean {
  const needed = supportPlayers(prompt, connected);
  return needed.length > 0 && needed.every((id) => {
    const lease = prompt.supports[id];
    return lease === null || (typeof lease === "string" && Date.parse(lease) > Date.parse(now));
  });
}

/** Cooperative information, freely shareable; not a secrecy boundary. */
export function interactionClues(prompt: InteractionPrompt, playerId: string, connected: readonly string[]): string[] {
  if (prompt.spec.kind !== "sequence") return [];
  const seats = prompt.playerIds.filter((id) => connected.includes(id));
  const seat = seats.indexOf(playerId);
  return seat < 0 ? [] : prompt.spec.clues.filter((_, index) => index % seats.length === seat);
}
