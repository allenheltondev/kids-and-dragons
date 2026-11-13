/**
 * Whether something opaque lies over the whole stage (a story plate reel, an epilogue).
 *
 * The stage's ticker stops while it does (PixiStage.tsx): a painting nobody can see is not
 * worth thirty frames a second of a television's GPU, least of all under a reel that is
 * itself drifting a full-screen picture. Counted, so two covers overlapping (an epilogue
 * arriving as a replay closes) do not uncover the stage early.
 */

let covers = 0;
const listeners = new Set<() => void>();

/** Cover the stage until the returned function is called (once; later calls do nothing). */
export function coverStage(): () => void {
  covers += 1;
  for (const listener of [...listeners]) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    covers -= 1;
    for (const listener of [...listeners]) listener();
  };
}

export function stageCovered(): boolean {
  return covers > 0;
}

export function onStageCover(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
