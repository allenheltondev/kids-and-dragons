import { defaultStorage } from "./persistence";

/**
 * Which regions this device has already watched the clouds roll back from.
 * Per-device UI state, like the Field Guide's "seen" marks: a discovery is the
 * household's, but the little reveal is a moment each screen gets once.
 */
export const ATLAS_CLOUDS_KEY = "kad.atlas.revealed";

/** Place ids whose clouds have lifted on this device. Never throws. */
export function revealedClouds(): ReadonlySet<string> {
  try {
    const raw = defaultStorage().getItem(ATLAS_CLOUDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** Remember that these clouds have lifted. Never throws (private mode, quota). */
export function markCloudsRevealed(placeIds: readonly string[]): void {
  if (placeIds.length === 0) return;
  const next = new Set([...revealedClouds(), ...placeIds]);
  try {
    defaultStorage().setItem(ATLAS_CLOUDS_KEY, JSON.stringify([...next]));
  } catch {
    /* the reveal simply plays again next visit */
  }
}

/** Tests: forget every reveal. */
export function resetRevealedClouds(): void {
  try { defaultStorage().removeItem(ATLAS_CLOUDS_KEY); } catch { /* ignore */ }
}
