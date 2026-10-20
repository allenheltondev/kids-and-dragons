/**
 * The one list of what the game needs to sound like.
 *
 * Imported from the client's own table rather than re-stated here: the briefs
 * are what the *game* asks for, `audio:briefs` prints them, `audio:import`
 * files against them and the gate checks against them, and a second copy would be a second answer to "what
 * cues exist" — the failure `bestiary.ts` argues about at length.
 */

import { CUE_SPECS, MUSIC_SPECS, type CueSpec } from "../../packages/client/src/audio/paths";

export interface AudioJob extends CueSpec {
  id: string;
  /** Effect or loop: how the brief reads, and how the gate budgets it. */
  kind: "sfx" | "music";
  /** Path under assets/audio, relative. */
  file: string;
  /** What to type on the command line to mean this one. */
  selector: string;
}

export function audioJobs(): AudioJob[] {
  return [
    ...Object.entries(CUE_SPECS).map(([id, spec]) => ({
      ...spec,
      id,
      kind: "sfx" as const,
      file: `cues/${id}.webm`,
      selector: id,
    })),
    ...Object.entries(MUSIC_SPECS).map(([id, spec]) => ({
      ...spec,
      id,
      kind: "music" as const,
      file: `music/${id}.webm`,
      selector: `music:${id}`,
    })),
  ];
}
