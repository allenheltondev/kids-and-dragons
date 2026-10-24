/**
 * Unsaved work on this page: a hero half made, a join code half typed (#456,
 * from review). None of it is a fact about the run, so none of it is in the
 * store or on the wire; the screens that hold it say so while they do, and
 * the update reload (`converge.ts`) waits until they are done.
 */

import { useEffect, useSyncExternalStore } from "react";

const reasons = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Whether any screen is holding unsaved work. */
export function isBusy(): boolean {
  return reasons.size > 0;
}

export function setBusy(reason: string, active: boolean): void {
  if (reasons.has(reason) === active) return;
  if (active) reasons.add(reason);
  else reasons.delete(reason);
  emit();
}

export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hold `reason` while `active` and this component is mounted. */
export function useBusy(reason: string, active = true): void {
  useEffect(() => {
    setBusy(reason, active);
    return () => setBusy(reason, false);
  }, [reason, active]);
}

export function useIsBusy(): boolean {
  return useSyncExternalStore(subscribeBusy, isBusy, () => false);
}

/** Tests: forget every reason. */
export function resetBusy(): void {
  reasons.clear();
  emit();
}
