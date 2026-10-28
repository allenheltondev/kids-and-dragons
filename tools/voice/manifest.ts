/**
 * What has been rendered, and what is still owed (docs/voice-narration-plan.md
 * §4, "Manifest and lock").
 *
 * `content/voice/manifest/<group>.json` says which clips say which authored
 * words: address, then token variant, then the clips to play in order.
 * `content/voice/voice.lock.json` pins approved takes by clip key. `voice:generate`
 * writes the first; a person writes the second on the review page.
 *
 * Both are optional. A game with no clips rendered is not an error: every
 * clip is `missing`, which is a report and never a gate.
 */

import { manifestName, type ManifestClip, type VoiceManifest } from "../../packages/shared/src/voice-clips";
import type { ClassifiedLine } from "./lines";
import type { Desired, DesiredLine } from "./desired";

export type { ManifestClip };
/** address, then variant (`""` when the line has no tokens), then the clips in play order. */
export type Manifest = VoiceManifest;

export interface Lock {
  approved: Record<string, { at?: string; note?: string }>;
}

/** Which manifest file holds a line (voice-clips.ts, the layout the client reads too). */
export function groupOf(line: Pick<ClassifiedLine, "chapter" | "campaign">): string {
  return manifestName(line.chapter, line.campaign);
}

export type ClipState = "approved" | "awaiting-review" | "stale" | "missing";

export interface ClipRow {
  key: string;
  state: ClipState;
  chars: number;
}

export interface Status {
  /** One row per distinct clip key still wanted; identical words in one voice are one clip. */
  clips: ClipRow[];
  /** Clips in a manifest that nothing asks for any more. */
  orphaned: string[];
  /** Lines read by the device voice (a stale or broken script). */
  deviceVoice: Desired["deviceVoice"];
  lines: number;
}

/**
 * Compare what is wanted with what is rendered.
 *
 * - `approved`: rendered and pinned in the lock.
 * - `awaiting-review`: rendered, not pinned.
 * - `stale`: the line has a take already but not this one (its words, voice or
 *   delivery changed). Re-rendering replaces it.
 * - `missing`: never rendered.
 */
export function clipStatus(desired: Desired, manifest: Manifest, lock: Lock): Status {
  const rendered = new Set<string>();
  for (const variants of Object.values(manifest)) for (const clips of Object.values(variants)) for (const c of clips) rendered.add(c.clip);

  const wanted = new Map<string, ClipRow>();
  const wantedKeys = new Set<string>();
  for (const line of desired.lines) {
    const had = manifest[line.address]?.[line.variant];
    for (const segment of line.segments) {
      wantedKeys.add(segment.key);
      if (wanted.has(segment.key)) continue;
      const state: ClipState = lock.approved[segment.key]
        ? "approved"
        : rendered.has(segment.key)
          ? "awaiting-review"
          : had !== undefined
            ? "stale"
            : "missing";
      wanted.set(segment.key, { key: segment.key, state, chars: segment.text.length });
    }
  }

  const orphaned = [...rendered].filter((key) => !wantedKeys.has(key)).sort();
  return { clips: [...wanted.values()], orphaned, deviceVoice: desired.deviceVoice, lines: desired.lines.length };
}

/** The clips a `voice:generate` run would render: everything stale or missing. */
export function toRender(status: Status): ClipRow[] {
  return status.clips.filter((row) => row.state === "stale" || row.state === "missing");
}

export function countByState(status: Status): Record<ClipState, number> {
  const counts: Record<ClipState, number> = { approved: 0, "awaiting-review": 0, stale: 0, missing: 0 };
  for (const row of status.clips) counts[row.state] += 1;
  return counts;
}

/** Which lines each distinct clip serves, for a report that names the scenes behind a count. */
export function linesByClip(desired: Desired): Map<string, DesiredLine[]> {
  const out = new Map<string, DesiredLine[]>();
  for (const line of desired.lines) for (const segment of line.segments) out.set(segment.key, [...(out.get(segment.key) ?? []), line]);
  return out;
}

/**
 * The manifest after a run. A line gets an entry once *every* clip it needs is
 * rendered (all or nothing, as playback is), with each clip's length. Entries
 * already there stay, so a partial run never takes away a take that was good;
 * `prune` drops the ones nothing asks for any more. Output is sorted so the
 * file diffs cleanly in git.
 */
export function mergeManifest(existing: Manifest, lines: readonly DesiredLine[], lengths: ReadonlyMap<string, number>, prune = false): Manifest {
  const wanted = new Set(lines.map((line) => `${line.address}\u0000${line.variant}`));
  const merged: Manifest = {};
  for (const [address, variants] of Object.entries(existing)) {
    for (const [variant, clips] of Object.entries(variants)) {
      if (prune && !wanted.has(`${address}\u0000${variant}`)) continue;
      (merged[address] ??= {})[variant] = clips;
    }
  }
  for (const line of lines) {
    const clips: ManifestClip[] = [];
    for (const segment of line.segments) {
      const ms = lengths.get(segment.key);
      if (ms === undefined) break;
      clips.push({ clip: segment.key, ms });
    }
    if (clips.length === line.segments.length) (merged[line.address] ??= {})[line.variant] = clips;
  }
  const sorted: Manifest = {};
  for (const address of Object.keys(merged).sort()) {
    sorted[address] = {};
    for (const variant of Object.keys(merged[address] ?? {}).sort()) sorted[address][variant] = merged[address]?.[variant] ?? [];
  }
  return sorted;
}
