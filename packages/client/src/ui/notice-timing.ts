/**
 * How long a notice on the shared screen stays up before it goes by itself.
 *
 * The TV is read, not driven: a remote is a clumsy mouse, so nothing there
 * waits for a tap to go away. Four seconds is enough to read "Pip joined"
 * across a room; every word past the first few buys a quarter second more, up
 * to six, so a long error or three names in one line can still be read once.
 */

export const NOTICE_MIN_MS = 4000;
export const NOTICE_MAX_MS = 6000;

/** Words read in the first four seconds; each one after adds NOTICE_MS_PER_WORD. */
const FREE_WORDS = 3;
const NOTICE_MS_PER_WORD = 250;

export function noticeMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(NOTICE_MAX_MS, NOTICE_MIN_MS + Math.max(0, words - FREE_WORDS) * NOTICE_MS_PER_WORD);
}
