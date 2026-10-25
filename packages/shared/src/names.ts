/**
 * The word filter every typed name passes (#253).
 *
 * Players and heroes are shown on a TV across the room, so a name is vetted
 * where it is accepted, on the server. The client runs the same function only
 * to say "pick another one" a moment sooner. Generated names (`randomName`)
 * are ours and need no vetting.
 *
 * The word list is data (`data/blocked-names.json`), not code.
 */

import blocked from "./data/blocked-names.json" with { type: "json" };

/** What a kid sees when a name is turned away. Says nothing about why. */
export const NAME_REFUSED_MESSAGE = "Hmm, let's pick another one!";

const LOOKALIKES: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t",
};

/** Lowercase, no accents, digits and symbols read as the letters they imitate. */
function fold(raw: string): string {
  let out = "";
  for (const ch of raw.normalize("NFKD").toLowerCase()) {
    if (/\p{M}/u.test(ch)) continue;
    out += LOOKALIKES[ch] ?? ch;
  }
  return out;
}

/** The same text with a letter repeated three or more times cut to one ("fuuuck"). */
function squeeze(text: string): string {
  return text.replace(/(.)\1+/gu, "$1");
}

const WORDS = new Set(blocked.words.map((w) => squeeze(w)));
const INSIDE = blocked.inside.map((w) => squeeze(w));

/** True when a typed name contains something we would not put on a TV. */
export function isBlockedName(raw: string): boolean {
  const folded = fold(raw);
  const tokens = folded.split(/[^\p{L}]+/u).filter((t) => t !== "");
  for (const token of tokens) {
    if (WORDS.has(token) || WORDS.has(squeeze(token))) return true;
  }
  // Spaces and punctuation stripped out, so "f u c k" and "f.u.c.k" are caught.
  const run = squeeze(folded.replace(/[^\p{L}]/gu, ""));
  return INSIDE.some((bad) => run.includes(bad));
}

/** Longest name a household's table may have ("Grandma's kitchen table"). */
export const LOCATION_NAME_MAX = 40;

/**
 * A name a family gave its table: trimmed, spaces collapsed, run through
 * the same word filter as any typed name. Empty is fine (an unnamed table).
 */
export function checkLocationName(raw: unknown): NameCheck {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  const checked = checkTypedName(text.slice(0, LOCATION_NAME_MAX).trim());
  return checked;
}

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/** Trim a typed name and say whether it may be used. Length is the caller's rule. */
export function checkTypedName(raw: unknown): NameCheck {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name !== "" && isBlockedName(name)) return { ok: false, message: NAME_REFUSED_MESSAGE };
  return { ok: true, name };
}
