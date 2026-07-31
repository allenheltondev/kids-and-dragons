/**
 * Appearance options and the name generator for character creation (spec §5.4,
 * §5.5).
 *
 * WHY this lives here and not in `content/rules.json`: `RulesContent` has no
 * appearance section — palette slots are an *art* contract, owned by
 * `assets/manifest.json` (art-pipeline §3), and the manifest does not yet name
 * the palette variants a player may pick between. The swatch hexes below are
 * the manifest's own species palettes and `paletteRule` accent guidance, so
 * this file is a thin, replaceable index over art data rather than a second
 * source of truth for rules. When the manifest gains named palette slots this
 * whole file becomes a fetch, and no component changes.
 *
 * Nothing here is mechanical. Appearance is cosmetic in every direction
 * (spec §9.3) so getting these values slightly wrong can never affect play.
 */

import type { Appearance, SpeciesId } from "@kad/shared";

export interface PaletteOption {
  id: string;
  name: string;
  /** Swatch preview only — the real colours are Rive properties on the rig. */
  coat: string;
  mane: string;
}

export interface AccentOption {
  id: string;
  name: string;
  hex: string;
}

export interface CosmeticOption {
  id: string;
  name: string;
  /** Icon id, so the option is never colour- or text-only (spec §1.5, §11). */
  icon: string;
}

/** Named palettes. Hues are spread so three party members stay distinguishable. */
export const PALETTES: readonly PaletteOption[] = [
  { id: "orchid", name: "Orchid", coat: "#F2E1F2", mane: "#853A85" },
  { id: "meadow", name: "Meadow", coat: "#E1F2E8", mane: "#2B6B46" },
  { id: "tide", name: "Tide", coat: "#E1EBF2", mane: "#4D728C" },
  { id: "bark", name: "Bark", coat: "#F2EAE1", mane: "#4C3F32" },
  { id: "ember", name: "Ember", coat: "#F2E6E1", mane: "#9E512F" },
  { id: "rose", name: "Rose", coat: "#F2E1E4", mane: "#662E37" },
];

/** Accents sit on the signature part only, and are the brighter colour. */
export const ACCENTS: readonly AccentOption[] = [
  { id: "sky", name: "Sky", hex: "#709FE0" },
  { id: "mint", name: "Mint", hex: "#70E09F" },
  { id: "sun", name: "Sun", hex: "#E0C470" },
  { id: "coral", name: "Coral", hex: "#E09F70" },
  { id: "lagoon", name: "Lagoon", hex: "#70CEE0" },
  { id: "fern", name: "Fern", hex: "#96E070" },
];

/*
 * Each cosmetic option shows the thing it names (icons.tsx, "Appearance").
 * These used to borrow interface glyphs — a horn was the unicorn icon, "Plain"
 * was a check — which put a second check inside the chip that the *selected*
 * check also lives in, and left three markings illustrated by a footprint, a
 * minus sign and a star.
 */
export const HORN_STYLES: readonly CosmeticOption[] = [
  { id: "spiral", name: "Spiral", icon: "horn_spiral" },
  { id: "curved", name: "Curved", icon: "horn_curved" },
  { id: "crystal", name: "Crystal", icon: "horn_crystal" },
];

export const WING_STYLES: readonly CosmeticOption[] = [
  { id: "feathered", name: "Feathered", icon: "wing_feathered" },
  { id: "leathery", name: "Leathery", icon: "wing_leathery" },
  { id: "starlit", name: "Starlit", icon: "wing_starlit" },
];

export const MARKINGS: readonly CosmeticOption[] = [
  { id: "plain", name: "Plain", icon: "marking_plain" },
  { id: "dapple", name: "Dapple", icon: "marking_dapple" },
  { id: "stripe", name: "Stripes", icon: "marking_stripe" },
  { id: "starfall", name: "Starfall", icon: "marking_starfall" },
];

/**
 * Which signature part a species has, from `assets/manifest.json` → species
 * → `signature`. Only the matching cosmetic question is asked, so nobody is
 * offered a wing style for a creature with no wings.
 */
const SIGNATURE_PART: Record<SpeciesId, "horn" | "wings" | "mane" | "tail"> = {
  unicorn: "horn",
  dragonling: "wings",
  griffin: "wings",
  bigfoot: "mane",
  kitsune: "tail",
  manticore: "tail",
};

export function hornStylesFor(species: SpeciesId): readonly CosmeticOption[] {
  return SIGNATURE_PART[species] === "horn" ? HORN_STYLES : [];
}

export function wingStylesFor(species: SpeciesId): readonly CosmeticOption[] {
  return SIGNATURE_PART[species] === "wings" ? WING_STYLES : [];
}

/** A complete, valid appearance, so the preview is never half-drawn. */
export function defaultAppearance(species: SpeciesId): Appearance {
  const palette = PALETTES[0]?.id ?? "orchid";
  const accent = ACCENTS[0]?.hex ?? "#709FE0";
  const base: Appearance = { palette, accent, markings: MARKINGS[0]?.id ?? "plain" };
  const horn = hornStylesFor(species)[0];
  if (horn) base.hornStyle = horn.id;
  const wing = wingStylesFor(species)[0];
  if (wing) base.wingStyle = wing.id;
  return base;
}

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
