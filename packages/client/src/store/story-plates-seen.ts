import { create } from "zustand";
import { defaultStorage } from "./persistence";

/**
 * Which story plates (a campaign's prologue, a chapter's plate) this device has shown, by
 * `StartPlates.key`. Per-device UI state, like the Field Guide's "new" markers: it is never
 * synced, so it lives in localStorage rather than the household record. A table that plays on
 * another screen sees the opening once there too, which is the right amount of once.
 *
 * `unavailable` is for this page load only: a reel whose paintings have not been delivered (or
 * cannot be fetched) is passed over without being marked seen, so it plays the day they land.
 */
export const STORY_PLATES_SEEN_KEY = "kad.plates.seen";

function load(): ReadonlySet<string> {
  try {
    const raw = defaultStorage().getItem(STORY_PLATES_SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

const useStore = create<{ seen: ReadonlySet<string>; unavailable: ReadonlySet<string> }>(() => ({
  seen: load(),
  unavailable: new Set(),
}));

/** Keys this device has shown. */
export function useStoryPlatesSeen(): ReadonlySet<string> {
  return useStore((s) => s.seen);
}

/** Keys passed over this page load for want of a painting. */
export function useStoryPlatesUnavailable(): ReadonlySet<string> {
  return useStore((s) => s.unavailable);
}

/** Record that a reel was shown (or skipped). Never throws (private mode, quota). */
export function markStoryPlatesSeen(key: string): void {
  const current = useStore.getState().seen;
  if (current.has(key)) return;
  const next = new Set(current).add(key);
  useStore.setState({ seen: next });
  try {
    defaultStorage().setItem(STORY_PLATES_SEEN_KEY, JSON.stringify([...next]));
  } catch {
    /* it simply plays once more next visit */
  }
}

/** Pass a reel over for this page load, without remembering it. */
export function markStoryPlatesUnavailable(key: string): void {
  const current = useStore.getState().unavailable;
  if (current.has(key)) return;
  useStore.setState({ unavailable: new Set(current).add(key) });
}

/** Tests: forget everything, in memory and on disk. */
export function resetStoryPlatesSeen(): void {
  useStore.setState({ seen: new Set(), unavailable: new Set() });
  try {
    defaultStorage().removeItem(STORY_PLATES_SEEN_KEY);
  } catch {
    /* ignore */
  }
}
