/**
 * Which playable species a creature's canon lore names, for the bestiary's
 * `likes` / `dislikes` (docs/matchups.md). Only `character.<species>` refs count;
 * peoples, individuals and other creatures are not heroes at the table.
 * Its own module because `bestiary.ts` is a script that writes a file on import.
 */

export const PLAYABLE_SPECIES = ["unicorn", "dragonling", "griffin", "bigfoot", "kitsune", "manticore"];

export function speciesOpinions(opinions: readonly { of: string }[] | undefined): string[] {
  const out: string[] = [];
  for (const { of } of opinions ?? []) {
    const species = of.startsWith("character.") ? of.slice("character.".length) : "";
    if (PLAYABLE_SPECIES.includes(species) && !out.includes(species)) out.push(species);
  }
  return out;
}
