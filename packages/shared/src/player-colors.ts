/**
 * Each player's colors — picked by the table, not by the player.
 *
 * A character's `appearance.palette` and `appearance.accent` dress that
 * player's chrome: their flame in the sign-in lineup and the keepsake
 * lantern, the light their portrait stands in, the trim on their sheet. The
 * figure itself is always drawn as painted (client world/nameplate.ts), so
 * there is nothing for a player to see by choosing one — and two players who
 * chose the same one could not be told apart by it. So the engine assigns a
 * pair when the character is made, unused by anyone already at the table, and
 * the pair is the character's for good: it is stored with them and comes back
 * with them to every later game.
 *
 * The six pairs are the six species' own mane and accent colors
 * (assets/manifest.json → species → palette), crossed so that no pair is a
 * species' own — a palette never reads as "the unicorn's color".
 */

import type { Appearance } from "./types/domain.js";
import { makeRng } from "./dice.js";

export interface PlayerColors {
  /** Palette slot name — the mane color it is named for. */
  palette: string;
  /** Hex. The brighter color most chrome is drawn in. */
  accent: string;
}

export const PLAYER_COLORS: readonly PlayerColors[] = [
  { palette: "orchid", accent: "#E0C470" },
  { palette: "meadow", accent: "#709FE0" },
  { palette: "tide", accent: "#E09F70" },
  { palette: "bark", accent: "#70CEE0" },
  { palette: "ember", accent: "#96E070" },
  { palette: "rose", accent: "#70E09F" },
];

/**
 * A color pair for a new character: random, but not one anybody at the table
 * already wears. Seeded rather than drawn from the dice stream, so assigning
 * colors never shifts a roll and a replay rebuilds the same pair.
 *
 * With every pair taken (more characters than pairs, or saved heroes who came
 * back wearing the same one) it falls back to any pair — a duplicate color is
 * a cosmetic clash, never a reason to refuse a character.
 */
export function assignPlayerColors(seed: string, taken: readonly Pick<Appearance, "accent">[]): PlayerColors {
  const used = new Set(taken.map((appearance) => appearance.accent.toLowerCase()));
  const free = PLAYER_COLORS.filter((colors) => !used.has(colors.accent.toLowerCase()));
  const pool = free.length > 0 ? free : PLAYER_COLORS;
  const index = Math.floor(makeRng(seed).next() * pool.length);
  return pool[index] ?? (PLAYER_COLORS[0] as PlayerColors);
}
