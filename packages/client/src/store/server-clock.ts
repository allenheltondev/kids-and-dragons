import { serverClockGap } from "@kad/shared";

/**
 * When the last few states were stamped by the server and when they reached this screen, so the
 * TV and phones can draw a moving marker on the server's clock rather than their own
 * (interactionStartLocal). A short window, so a device whose clock is corrected soon forgets the
 * old offset; a state held back behind a presentation only reads as a slow delivery and is
 * outvoted by the quick ones.
 */
const WINDOW = 16;
const samples: { sentAt: string; receivedAt: number }[] = [];

export function noteServerTime(sentAt: string, receivedAt = Date.now()): void {
  samples.push({ sentAt, receivedAt });
  if (samples.length > WINDOW) samples.shift();
}

export function clockGap(): number | undefined {
  return serverClockGap(samples);
}

/** For tests. */
export function forgetServerTime(): void {
  samples.length = 0;
}
