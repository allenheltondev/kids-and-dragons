/**
 * The voiceable lines of the game as a classified, token-expanded list
 * (docs/voice-narration-plan.md §1). Pure: lines in, lines out.
 *
 * `inventory.ts` finds the words and gives each an address; this adds the
 * plan's classification and the clip variants a token turns a line into, which
 * is what `voice:extract` prints and the generator will render.
 */

import { LINE_KINDS, type InventoryOptions, type VoiceLine } from "./inventory";

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

/** The tokens a clip can be rendered for, one clip per value. Any other token is filled at run time. */
const RENDERED_TOKENS = new Set(["party", "facets"]);

/**
 * Refuses a line that could carry a player's name (#552): a hero's name is
 * shown, never spoken, and never sent to a provider. Only authored kinds are
 * recorded, and only with tokens a clip can be rendered for; a line from a
 * surface that composes names at run time (turns, decision lines, the fight
 * log, NAME_BEARING_SURFACES in packages/shared/src/spoken-names.ts) is
 * neither, so it stops here rather than reaching the generator.
 */
export function refuseNameBearing(line: Pick<VoiceLine, "address" | "kind" | "text">): void {
  if (!(LINE_KINDS as readonly string[]).includes(line.kind)) {
    throw new Error(`${line.address}: "${line.kind}" is not an authored line; lines composed at run time can carry a hero's name and are never recorded`);
  }
  for (const [, token] of line.text.matchAll(/\{(\w+)\}/g)) {
    if (!RENDERED_TOKENS.has(token!)) {
      throw new Error(`${line.address}: {${token!}} is filled at run time and could be a hero's name; it is never recorded`);
    }
  }
}

export function classify(lines: readonly VoiceLine[], options: InventoryOptions): ClassifiedLine[] {
  return lines.map((line) => {
    refuseNameBearing(line);
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
