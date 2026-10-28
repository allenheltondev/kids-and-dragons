/**
 * The voiceable lines of the game as a classified, token-expanded list
 * (docs/voice-narration-plan.md §1). Pure: lines in, lines out.
 *
 * `inventory.ts` finds the words and gives each an address; this adds the
 * plan's classification and the clip variants a token turns a line into, which
 * is what `voice:extract` prints and the generator will render.
 */

import type { InventoryOptions, VoiceLine } from "./inventory";

/** `recorded` has no tokens; `templated` is rendered once per token value. */
export type LineClass = "recorded" | "templated";

export interface ClassifiedLine extends VoiceLine {
  class: LineClass;
  /** One entry per clip: `""` for a plain line, else e.g. `party=2,facets=0`. */
  variants: string[];
}

/** `{party}` forms, in the order the engine counts them: a party of one to four. */
const PARTY_VALUES = [1, 2, 3, 4];

export function variantsOf(text: string, options: InventoryOptions): string[] {
  let combos: string[][] = [[]];
  if (text.includes("{party}")) combos = combos.flatMap((c) => PARTY_VALUES.map((n) => [...c, `party=${String(n)}`]));
  if (text.includes("{facets}")) {
    const counts = Array.from({ length: options.facetsMax + 1 }, (_, n) => n);
    combos = combos.flatMap((c) => counts.map((n) => [...c, `facets=${String(n)}`]));
  }
  return combos.map((c) => c.join(","));
}

export function classify(lines: readonly VoiceLine[], options: InventoryOptions): ClassifiedLine[] {
  return lines.map((line) => {
    const variants = variantsOf(line.text, options);
    return { ...line, class: variants.length > 1 ? "templated" : "recorded", variants };
  });
}

/** Addresses that appear more than once: each must name one authored string. */
export function duplicateAddresses(lines: readonly VoiceLine[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { address } of lines) {
    if (seen.has(address)) dupes.add(address);
    seen.add(address);
  }
  return [...dupes].sort();
}
