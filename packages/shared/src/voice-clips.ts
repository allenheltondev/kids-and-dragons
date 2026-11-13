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
  /** Who says it: their id on the cast sheet (content/voice/cast.json). Absent for the narrator. */
  by?: string;
  /**
   * Their figure on the cast sheet (`cast/pib`, `entities/faun`), when they have one: while the
   * clip plays, the stage pulses whoever stands in the scene as them (the cast pulse).
   */
  figure?: string;
  /**
   * Everything the content calls them: the sheet's `name`, then its `aliases` ("Soup Woman",
   * "Marigold"). A named figure on the stage is them only under one of these, so two people
   * painted alike (several fauns share `entities/faun`) are never taken for each other.
   */
  names?: string[];
}

/** Who says a clip, as the stage finds them: `ManifestClip`'s figure and names. */
export type SpeakingCast = Pick<ManifestClip, "figure" | "names">;

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

/** The campaign-level kinds of line, filed `<campaign>/@<kind>/…` (tools/voice/inventory.ts). */
const CAMPAIGN_KINDS: ReadonlySet<string> = new Set(["@prologue", "@epilogue", "@lastTime"]);

/**
 * Which manifest an address is filed in, the inverse of `manifestName` over the addresses the
 * inventory writes: a chapter's lines are `<chapter>/…` (its goal and plate included), a
 * campaign's prologue, epilogue and "Last time…" are `<campaign>/@…/…` and live in
 * `_<campaign>`, and the help sheet's are `help/…`, in `_help`. Null for an address that is none
 * of these, which the device voice reads.
 */
export function manifestOfAddress(address: string | undefined): string | null {
  const [first = "", second = ""] = address?.split("/") ?? [];
  if (first === "" || first.startsWith("@")) return null;
  if (first === "help") return manifestName("@help", "help");
  return CAMPAIGN_KINDS.has(second) ? manifestName("@campaign", first) : first;
}

/**
 * Where the help sheet's words are filed (tools/voice/inventory.ts walks help.json: `help/` then
 * the path to each `text`). A screen's own words, or a kind of thing's. A thing with words of its
 * own (an item's description) is run-time text, which has no recording: null, and the device
 * voice reads it.
 */
export function helpAddress(surface: string, thing: { kind: string; text?: string | undefined } | null): string | null {
  if (thing === null) return `help/surfaces/${surface}`;
  return thing.text === undefined ? `help/things/${thing.kind}` : null;
}

/** A "How to play" card's words, by its place in the list. */
export function howToPlayAddress(index: number): string {
  return `help/howToPlay/${String(index)}`;
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
