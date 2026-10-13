import { create } from "zustand";
import { defaultStorage } from "./persistence";

/**
 * Which Field Guide entries this device has opened since they were found.
 * Per-device UI state only: it drives the "new" marker and is never synced,
 * so it lives in localStorage rather than the household record.
 */
export const FIELD_GUIDE_SEEN_KEY = "kad.fieldguide.seen";

function load(): ReadonlySet<string> {
  try {
    const raw = defaultStorage().getItem(FIELD_GUIDE_SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

const useSeenStore = create<{ seen: ReadonlySet<string> }>(() => ({ seen: load() }));

/** Canon ids opened on this device. */
export function useFieldGuideSeen(): ReadonlySet<string> {
  return useSeenStore((s) => s.seen);
}

/** Record that an entry was opened. Never throws (private mode, quota). */
export function markFieldGuideSeen(entryId: string): void {
  const current = useSeenStore.getState().seen;
  if (current.has(entryId)) return;
  const next = new Set(current).add(entryId);
  useSeenStore.setState({ seen: next });
  try {
    defaultStorage().setItem(FIELD_GUIDE_SEEN_KEY, JSON.stringify([...next]));
  } catch {
    /* the marker simply comes back next visit */
  }
}

/** Tests: forget everything, in memory and on disk. */
export function resetFieldGuideSeen(): void {
  useSeenStore.setState({ seen: new Set() });
  try { defaultStorage().removeItem(FIELD_GUIDE_SEEN_KEY); } catch { /* ignore */ }
}
