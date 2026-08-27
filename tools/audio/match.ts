/**
 * Which downloaded file is which cue.
 *
 * The import path exists because generating audio is not always an API call.
 * A free tier gives you a web UI and a Downloads folder, and what comes out of
 * one is named `ElevenLabs_2026-08-26T14-02-11_dice_pvc.mp3` — the sound is
 * right, the filename is somebody else's.
 *
 * So matching is by *containment* rather than equality, and it is deliberately
 * cautious: a file that matches two cues, or two files that match the same
 * cue, are reported and skipped rather than guessed at. Naming the wrong sound
 * `down.webm` is worse than importing nothing, because the game then plays a
 * cheerful chime when somebody is knocked over and nothing anywhere says why.
 */

import type { AudioJob } from "./specs";

/** Lowercase alphanumerics only: `Level-Up (2).mp3` and `level_up` agree. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * A filename's words, and every short run of adjacent ones.
 *
 * Matching on *words* rather than on raw substrings, because a substring
 * match is wrong in both directions and the failures are quiet. `down` sits
 * inside `~/Downloads`, so a plain `includes` matched every file in the folder
 * against the knocked-down cue — found by running this against a realistic
 * path rather than a tidy one. In the other direction, a cue like
 * `level-up` never appears verbatim in `level-up final.mp3` once separators
 * are stripped per-word, which is why runs of adjacent words are joined too:
 * `level` + `up` is `levelup`.
 *
 * Only the basename is considered. Where a file happens to live says nothing
 * about what is in it.
 */
export function fileTokens(fileName: string): Set<string> {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  const words = stem
    // Split on separators *and* on camelCase humps, so `SceneEnter` works.
    .split(/[^a-zA-Z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);

  const tokens = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    // Runs of up to three words: no cue id has more parts than that.
    for (let length = 1; length <= 3 && start + length <= words.length; length += 1) {
      tokens.add(words.slice(start, start + length).join(""));
    }
  }
  return tokens;
}

export type Match =
  | { readonly kind: "matched"; readonly job: AudioJob }
  | { readonly kind: "unmatched" }
  /** Two cues in one filename — say so rather than pick the first. */
  | { readonly kind: "ambiguous"; readonly candidates: string[] };

/**
 * The cue a filename names, if exactly one does.
 *
 * Longest id first, so `scene-enter` wins over a hypothetical `scene` instead
 * of losing to it on iteration order.
 */
export function matchFile(fileName: string, jobs: AudioJob[]): Match {
  const tokens = fileTokens(fileName);
  const hits = jobs
    .filter((job) => tokens.has(normalize(job.id)))
    .sort((a, b) => b.id.length - a.id.length);

  if (hits.length === 0) return { kind: "unmatched" };
  if (hits.length === 1) return { kind: "matched", job: hits[0]! };

  /*
   * More than one cue is named. Only ambiguous when they are genuinely
   * different sounds: a file called `attack-and-down` cannot be both, while a
   * longer id that swallows a shorter one is a single answer.
   */
  const longest = hits[0]!;
  const others = hits.slice(1).filter((job) => !normalize(longest.id).includes(normalize(job.id)));
  if (others.length === 0) return { kind: "matched", job: longest };
  return { kind: "ambiguous", candidates: [longest, ...others].map((job) => job.selector) };
}

export interface Plan {
  /** One file per cue, ready to encode. */
  imports: { file: string; job: AudioJob }[];
  /** Files that named no cue at all. */
  unmatched: string[];
  /** Files that named more than one, and the cues they named. */
  ambiguous: { file: string; candidates: string[] }[];
  /** Cues more than one file claimed — every one of them skipped. */
  contested: { selector: string; files: string[] }[];
}

/**
 * Turn a folder of downloads into a plan.
 *
 * Contested cues are the case worth being strict about: a Downloads folder
 * accumulates `dice.mp3`, `dice (1).mp3`, `dice (2).mp3` as somebody tries
 * again, and the newest is not reliably the best — it is simply the last one
 * they clicked. Picking for them would silently discard the take they meant.
 */
export function planImport(files: string[], jobs: AudioJob[]): Plan {
  const plan: Plan = { imports: [], unmatched: [], ambiguous: [], contested: [] };
  const claims = new Map<string, { file: string; job: AudioJob }[]>();

  for (const file of files) {
    const match = matchFile(file, jobs);
    if (match.kind === "unmatched") {
      plan.unmatched.push(file);
      continue;
    }
    if (match.kind === "ambiguous") {
      plan.ambiguous.push({ file, candidates: match.candidates });
      continue;
    }
    const existing = claims.get(match.job.selector) ?? [];
    existing.push({ file, job: match.job });
    claims.set(match.job.selector, existing);
  }

  for (const [selector, claimants] of claims) {
    if (claimants.length === 1) {
      plan.imports.push(claimants[0]!);
    } else {
      plan.contested.push({ selector, files: claimants.map((claim) => claim.file) });
    }
  }
  return plan;
}
