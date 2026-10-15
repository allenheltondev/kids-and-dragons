/**
 * Narration variants and text tokens (#159).
 *
 * A scene's words can depend on the party in front of it: a line that only
 * reads when the party carries two facets, a "both of you" that says "all four
 * of you" when four are seated. Both are resolved **once, when the scene
 * opens**, and the result is stored on `RunState.narration` — so a phone that
 * reloads mid-scene reads the words everyone else is reading, not a
 * recomputation against a party that has since changed.
 *
 * Pure, like the rest of the engine: text in, text out.
 */

import type { NarrationVariant } from "./types/chapter.js";
import { countPartyItems, evaluateCondition, type ChoiceParty } from "./chapter-graph.js";

/** How composed pieces are joined: a paragraph break, as branch narration is. */
const JOIN = "\n\n";

/**
 * Base narration plus every variant whose `when` holds, in authored order.
 *
 * `at: "start"` variants go before the base, the rest after it. A matching
 * `replace: true` drops the base; if several replace (an authoring error the
 * validator reports), the first in authored order is the one kept as the base
 * and the others are dropped, so the result is still deterministic.
 */
export function composeNarration(
  base: string,
  variants: readonly NarrationVariant[] | undefined,
  party: ChoiceParty,
): string {
  if (!variants || variants.length === 0) return base;
  const start: string[] = [];
  const end: string[] = [];
  let replacement: NarrationVariant | undefined;
  for (const variant of variants) {
    if (!evaluateCondition(variant.when, party)) continue;
    if (variant.replace) {
      replacement ??= variant;
      continue;
    }
    (variant.at === "start" ? start : end).push(variant.text);
  }
  // A replacing variant takes the base's place, and sits there whatever its `at`.
  const middle = replacement ? replacement.text : base;
  return [...start, middle, ...end].filter((part) => part.trim().length > 0).join(JOIN);
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
] as const;

/**
 * A count as a word a child reads aloud: "no", "one", "two" … "fourteen";
 * digits beyond that (and for anything that is not a whole, non-negative
 * number). The one helper every counting token uses.
 */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length
    ? (NUMBER_WORDS[n] as string)
    : String(n);
}

/** "you", "both of you", "all three of you", "all four of you". */
export function partyPhrase(size: number): string {
  if (size <= 1) return "you";
  if (size === 2) return "both of you";
  return `all ${numberWord(size)} of you`;
}

/**
 * Every token the engine fills, by name (`{facets}` → `"facets"`). The
 * validator rejects any other `{name}` in authored text.
 */
export const NARRATION_TOKENS = ["facets", "party"] as const;
export type NarrationToken = (typeof NARRATION_TOKENS)[number];

const TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Fills `{facets}` (distinct `facet_*` items the party holds, as a number
 * word) and `{party}` (who is seated, as "you" … "all four of you"). An unknown
 * token is left exactly as written — the validator's job is to refuse it, and
 * the table seeing `{oops}` beats it silently disappearing.
 */
export function fillTokens(text: string, party: ChoiceParty): string {
  if (!text.includes("{")) return text;
  return text.replace(TOKEN, (whole, name: string) => {
    switch (name as NarrationToken) {
      case "facets":
        return numberWord(countPartyItems(party, "facet_*"));
      case "party":
        return partyPhrase(party.members.length);
      default:
        return whole;
    }
  });
}
