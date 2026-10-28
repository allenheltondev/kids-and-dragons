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

import type { Chapter, NarrationVariant, SceneId } from "./types/chapter.js";
import type { NarrationToken } from "./condition-lint.js";
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
  return composeNarrationPieces(base, variants, party)
    .map((piece) => piece.text)
    .join(JOIN);
}

/**
 * One authored string `composeNarration` joins. `variant` is the index of the
 * variant in the authored array it came from, absent for the base text, so a
 * caller that knows where the base lives can say where every piece did.
 */
export interface NarrationPiece {
  text: string;
  variant?: number;
}

/**
 * The authored strings `composeNarration` joins, in the order it joins them:
 * the pieces a recorded voice is keyed on (docs/voice-narration-plan.md §1).
 */
export function composeNarrationPieces(
  base: string,
  variants: readonly NarrationVariant[] | undefined,
  party: ChoiceParty,
): NarrationPiece[] {
  if (!variants || variants.length === 0) return [{ text: base }];
  const start: NarrationPiece[] = [];
  const end: NarrationPiece[] = [];
  let replacement: NarrationPiece | undefined;
  variants.forEach((variant, index) => {
    if (!evaluateCondition(variant.when, party)) return;
    const piece = { text: variant.text, variant: index };
    if (variant.replace) {
      replacement ??= piece;
      return;
    }
    (variant.at === "start" ? start : end).push(piece);
  });
  // A replacing variant takes the base's place, and sits there whatever its `at`.
  const middle = replacement ?? { text: base };
  return [...start, middle, ...end].filter((piece) => piece.text.trim().length > 0);
}

/**
 * One composed piece of a scene's narration, as authored (tokens unfilled),
 * with where it was authored and the value of each token it carries:
 * `{ address: "ch/s1/variants/0", line: "{party} hold on.", token: { party: "3" } }`.
 *
 * The address is the line address of docs/voice-narration-plan.md §1, the key
 * of the clip manifest and of the script sidecar. Identical words at two
 * addresses (a success and an assisted branch that read the same) are two
 * lines with two voices, so the text alone cannot choose a clip. A part with
 * no address was composed at run time (a fight's spoils) and has no clip: the
 * whole utterance goes to the device voice.
 *
 * The engine writes these beside `RunState.narration`, from the same pieces,
 * so the two cannot disagree.
 */
export interface NarrationPart {
  address?: string;
  line: string;
  token?: Record<string, string>;
}

/** A piece with the address its words were authored at, if they were authored. */
export interface AddressedPiece {
  text: string;
  address?: string;
}

/** The parts for `pieces`, each with the token values `fillTokens` would use. */
export function narrationPartsOf(pieces: readonly AddressedPiece[], party: ChoiceParty): NarrationPart[] {
  return pieces
    .filter((piece) => piece.text.trim().length > 0)
    .map((piece) => {
      const token: Record<string, string> = {};
      if (piece.text.includes("{facets}")) token.facets = String(countPartyItems(party, "facet_*"));
      if (piece.text.includes("{party}")) token.party = String(party.members.length);
      return {
        ...(piece.address !== undefined ? { address: piece.address } : {}),
        line: piece.text,
        ...(Object.keys(token).length > 0 ? { token } : {}),
      };
    });
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

// Every token the engine fills, by name (`{facets}` → `"facets"`). The
// validator rejects any other `{name}` in authored text.
export { NARRATION_TOKENS, type NarrationToken } from "./condition-lint.js";

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

/**
 * The end-of-chapter recap: every priority-1 scene on the trail
 * (`RunState.visited`), once each and in the order the party reached them, in
 * its own authored words with its variants and tokens resolved against
 * `party`. Branch lines are left out; the recap retells what the party found
 * out, not how they got there.
 *
 * A trail is chapter-scoped (the engine clears it at the chapter boundary), so
 * every id on it names a scene in `chapter`. One that does not is skipped
 * rather than trusted.
 */
export function revelationsOf(
  chapter: Pick<Chapter, "scenes">,
  visited: readonly SceneId[],
  party: ChoiceParty,
): string[] {
  const seen = new Set<SceneId>();
  const lines: string[] = [];
  for (const sceneId of visited) {
    if (seen.has(sceneId)) continue;
    seen.add(sceneId);
    const scene = chapter.scenes[sceneId];
    if (!scene || scene.type === "encounter" || scene.priority !== 1) continue;
    const base = scene.type === "check" ? (scene.narration ?? scene.prompt) : scene.narration;
    const text = fillTokens(composeNarration(base, scene.variants, party), party).trim();
    if (text.length > 0) lines.push(text);
  }
  return lines;
}
