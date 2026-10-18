/**
 * What the audio engine last said about the browser's sound, kept where the
 * capability report (display/CapabilityReport) can read it without reaching
 * into a component. Import-free on purpose: the shell writes it on every start,
 * and nothing about it may grow the first paint.
 */

export type AudioStatus = "unsupported" | "locked" | "suspended" | "running" | "unknown";

let current: AudioStatus = "unknown";
const listeners = new Set<() => void>();

export function reportAudioStatus(next: AudioStatus): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function audioStatus(): AudioStatus {
  return current;
}

export function onAudioStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
