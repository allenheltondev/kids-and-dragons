/**
 * Where recorded narration lives and how a line finds its clips
 * (docs/voice-narration-plan.md §4-§5).
 *
 * The one place that knows the layout, so the tool that uploads a clip and the
 * client that plays it cannot disagree:
 *
 *  - a clip is `voice/<key[0:2]>/<key>.webm` in the site bucket, served by
 *    CloudFront at `/voice/...`. Never under `assets/` (deploy syncs that with
 *    `--delete`). The key is a hash of everything that changes the sound, so a
 *    URL names its bytes for ever and a clip is cached for a year;
 *  - a chapter's manifest, committed to git and deployed with `content/`, says
 *    which clips say which authored words: `/content/voice/manifest/<name>.json`.
 *
 * Pure: strings in, strings out.
 */

import type { NarrationPart } from "./narration.js";

/** The bucket prefix clips live under, beside `assets/` and `content/`. */
export const CLIP_PREFIX = "voice";
export const CLIP_CONTENT_TYPE = "audio/webm";
/** A key names its bytes, so a clip never changes: cache it for a year. */
export const CLIP_CACHE_CONTROL = "public,max-age=31536000,immutable";

export interface ManifestClip {
  /** The clip key, which is also its file name. */
  clip: string;
  ms: number;
}

/** Address, then token variant (`""` when the line has none), then the clips in play order. */
export type VoiceManifest = Record<string, Record<string, ManifestClip[]>>;

const KEY = /^[0-9a-f]{64}$/;

export function isClipKey(key: string): boolean {
  return KEY.test(key);
}

/** The object's key in the bucket, with no leading slash: `voice/ab/abcd….webm`. */
export function clipObjectKey(key: string): string {
  if (!isClipKey(key)) throw new Error(`not a clip key: "${key}"`);
  return `${CLIP_PREFIX}/${key.slice(0, 2)}/${key}.webm`;
}

/** The URL path a browser fetches a clip from. */
export function clipPath(key: string): string {
  return `/${clipObjectKey(key)}`;
}

/**
 * Which manifest file holds a line: its chapter, or `_<campaign>` / `_help`
 * for text outside a chapter (a prologue, a "Last time…", the help sheet).
 */
export function manifestName(chapter: string, campaign: string): string {
  return chapter.startsWith("@") ? `_${campaign}` : chapter;
}

/** Where a manifest is served from: with `content/`, so it deploys with the chapter it describes. */
export function manifestPath(name: string): string {
  return `/content/voice/manifest/${name}.json`;
}

/** `{ party: "2", facets: "3" }` as the variant key a manifest is filed under, in the order the tools write it. */
export function variantKey(token: NarrationPart["token"]): string {
  if (token === undefined) return "";
  return [token.party !== undefined ? `party=${token.party}` : "", token.facets !== undefined ? `facets=${token.facets}` : ""]
    .filter(Boolean)
    .join(",");
}

/**
 * The clips to play, in order, for the pieces a scene was composed from: one
 * list per part, flattened. All or nothing, as the plan requires: a part with
 * no address (run-time text), no manifest entry, or no clips sends the *whole*
 * utterance to the device voice, because half a recording and half a robot is
 * worse than consistently robot. Returns `null` for that.
 */
export function playlistFor(parts: readonly NarrationPart[], manifest: VoiceManifest): ManifestClip[] | null {
  if (parts.length === 0) return null;
  const playlist: ManifestClip[] = [];
  for (const part of parts) {
    if (part.address === undefined) return null;
    const clips = manifest[part.address]?.[variantKey(part.token)];
    if (clips === undefined || clips.length === 0) return null;
    playlist.push(...clips);
  }
  return playlist;
}
