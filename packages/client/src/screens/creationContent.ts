/**
 * The name generator for character creation (spec §5.5).
 *
 * There used to be appearance options here too — palettes, accents, horn and
 * wing styles, markings. None of them was ever drawn on the creature, so they
 * are gone: colors are assigned by the server (shared player-colors.ts) and
 * the rest had nothing to show.
 */

// ---------------------------------------------------------------------------
// Names — spec §5.5: typing must be optional, never required (spec §1.1)
// ---------------------------------------------------------------------------

const FIRST_PARTS: readonly string[] = [
  "Ember", "Moon", "Thistle", "Bramble", "Frost", "Sun", "Storm", "Pebble",
  "Clover", "Cinder", "Willow", "Dusk", "Star", "River", "Honey", "Aspen",
];

const SECOND_PARTS: readonly string[] = [
  "wing", "hoof", "song", "spark", "paw", "leaf", "mane", "dash",
  "whisker", "bloom", "tail", "glow", "step", "heart", "horn", "hop",
];

function pick(list: readonly string[]): string {
  const index = Math.floor(Math.random() * list.length);
  return list[index] ?? list[0] ?? "";
}

/** One generated name. Compound so it always reads as a creature's name. */
export function randomName(): string {
  return `${pick(FIRST_PARTS)}${pick(SECOND_PARTS)}`;
}

/**
 * `count` distinct suggestions, offered as tappable chips: choosing a name is
 * then a tap like every other decision, and the keyboard is opt-in.
 */
export function randomNames(count: number): string[] {
  const out = new Set<string>();
  // Bounded: never spin on an unlucky run of duplicates.
  for (let i = 0; i < count * 12 && out.size < count; i += 1) out.add(randomName());
  return [...out];
}

/** Names are shown on a TV across the room, so keep them short and clean. */
export const NAME_MAX_LENGTH = 16;

export function sanitizeName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} '-]/gu, "").slice(0, NAME_MAX_LENGTH);
}
