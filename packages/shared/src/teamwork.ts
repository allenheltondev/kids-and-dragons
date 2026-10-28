import { supportsReady, type InteractionPrompt } from "./interactions.js";

/** The load responds to the whole team's lift, not a prescribed setting per player. */
export function balanceLift(prompt: InteractionPrompt, connected: readonly string[]): number {
  return connected.length ? connected.reduce((sum, id) => sum + (prompt.levels?.[id] ?? 0), 0) / connected.length : 0;
}

export const TEAM_HOLD_MS = 1800;

/** Progress is derived from server state, so TV, refresh and every phone agree. */
export function cooperationProgress(prompt: InteractionPrompt, connected: readonly string[], now: string): number {
  if (prompt.spec.kind !== "cooperate") return 0;
  if (prompt.phase === "result" && prompt.outcome === "success") return 1;
  if (!supportsReady(prompt, connected, now) || !prompt.steadySince ||
      prompt.steadyPlayerIds?.length !== connected.length || !connected.every((id) => prompt.steadyPlayerIds?.includes(id))) return 0;
  const elapsed = Date.parse(now) - Date.parse(prompt.steadySince);
  return Number.isFinite(elapsed) ? Math.max(0, Math.min(1, elapsed / TEAM_HOLD_MS)) : 0;
}

