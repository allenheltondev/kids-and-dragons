/**
 * What makes a clip the same clip (docs/voice-narration-plan.md §4, "The clip
 * key"). A clip is named by a hash of everything that changes how it sounds and
 * nothing else, so:
 *
 *  - a text edit changes exactly that line's key;
 *  - retuning a voice changes exactly that speaker's keys;
 *  - moving or renaming a scene changes none (the address is not in the key);
 *  - two lines with the same words in the same voice are one clip;
 *  - a provider or model change changes every key, on purpose.
 *
 * The neighbouring lines a provider may be given for flow are deliberately not
 * in the key, so editing one line never re-renders the paragraph around it.
 *
 * Pure: strings and objects in, a hash out.
 */

import { createHash } from "node:crypto";
import { numberWord, partyPhrase } from "../../packages/shared/src/narration";

/** Bump to re-render everything: a change to how clips are made, not to what they say. */
export const PIPELINE_VERSION = 1;

export interface ClipSpec {
  provider: string;
  model: string;
  /** Everything about the voice that reaches the provider: id, style, accent, direction. */
  voice: unknown;
  delivery?: string;
  /** The words as spoken (`spokenForm`): tokens filled, lexicon applied. */
  text: string;
}

/** JSON with keys in a fixed order, so the same object always hashes the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function clipKey(spec: ClipSpec): string {
  const body = stableStringify({
    provider: spec.provider,
    model: spec.model,
    voice: spec.voice,
    delivery: spec.delivery ?? null,
    text: spec.text,
    pipeline: PIPELINE_VERSION,
  });
  return createHash("sha256").update(body).digest("hex");
}

/** `party=2,facets=3` to `{ party: 2, facets: 3 }`; the empty variant is no tokens. */
export function parseVariant(variant: string): { party?: number; facets?: number } {
  const out: { party?: number; facets?: number } = {};
  for (const pair of variant.split(",").filter(Boolean)) {
    const [name, value] = pair.split("=");
    if (name === "party" || name === "facets") out[name] = Number(value);
  }
  return out;
}

/** Whole-word respellings for made-up names, applied to what is spoken and never to the screen. */
export type Lexicon = Readonly<Record<string, string>>;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The words as a provider is asked to say them: tokens filled for this variant
 * the way the engine fills them (`fillTokens`), curly quotes straightened, the
 * lexicon applied, spacing collapsed.
 */
export function spokenForm(text: string, variant: string, lexicon: Lexicon = {}): string {
  const { party, facets } = parseVariant(variant);
  let spoken = text;
  if (facets !== undefined) spoken = spoken.replaceAll("{facets}", numberWord(facets));
  if (party !== undefined) spoken = spoken.replaceAll("{party}", partyPhrase(party));
  spoken = spoken
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  for (const [word, respelling] of Object.entries(lexicon)) {
    spoken = spoken.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, "g"), respelling);
  }
  return spoken.replace(/\s+/g, " ").trim();
}
