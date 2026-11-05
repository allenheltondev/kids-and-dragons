/**
 * Whether the chapter end's camp beat is up on this screen (docs/camp.md §3,
 * §8.5; #620): the summary's own page turn, after the recap, the XP and the
 * Dash Cash, to the full camp with the crew's pieces placed and the heroes in
 * it. The summary (ChapterCompletePanel) turns it; the stages (PixiStage's
 * camp, StaticStage's still one) listen. Local to the screen, like any
 * animation: it is never in the protocol and nothing waits on it (§12.6).
 */

type Listener = () => void;

let up = false;
const listeners = new Set<Listener>();

/** Whether the camp beat is showing. */
export function campBeatShown(): boolean {
  return up;
}

/** Turn the camp beat on or off; listeners hear only a change. */
export function setCampBeat(next: boolean): void {
  if (up === next) return;
  up = next;
  for (const listener of [...listeners]) listener();
}

/** Hear the beat turn (useSyncExternalStore's subscribe). Returns the unsubscribe. */
export function onCampBeat(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
