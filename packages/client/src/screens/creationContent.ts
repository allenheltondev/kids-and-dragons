/**
 * Appearance options and the name generator for character creation (spec §5.4,
 * §5.5).
 *
 * WHY this lives here and not in `content/rules.json`: `RulesContent` has no
 * appearance section, and the swatch hexes below are drawn from the manifest's
 * own species palettes and `paletteRule` guidance (art-pipeline §3) rather than
 * invented — so this file is a thin, replaceable index over art data rather
 * than a second source of truth. When the manifest names the variants a player
 * may pick between, this whole file becomes a fetch and no component changes.
 *
 * Nothing here is mechanical. Appearance is cosmetic in every direction
 * (spec §9.3) so getting these values slightly wrong can never affect play.
 */

import type { Appearance, SpeciesId } from "@kad/shared";
import type { RigLook } from "../world/rig-look";

export interface PaletteOption {
  id: string;
  name: string;
  /** The swatch ring. `mane` is the color the creature's main mass turns. */
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
  /** Icon id, so the option is never color- or text-only (spec §1.5, §11). */
  icon: string;
}

/**
 * Named palettes — the player's main color. Hues are spread so three party
 * members stay distinguishable.
 *
 * They are the six species' own mane colors (assets/manifest.json → species
 * → palette.mane), so every creature starts in the one it was painted in
 * (`defaultAppearance`) and any other is a color some creature really wears.
 * Picking one repaints the creature's main mass (world/rig-look.ts) and still
 * dresses this player's chrome: their flame in the lantern, the light their
 * portrait stands in, the trim on their panel.
 *
 * The swatch leads with `mane` because that is what changes; `coat` is the
 * ring, so a chip reads as a creature rather than a dot.
 */
export const PALETTES: readonly PaletteOption[] = [
  { id: "orchid", name: "Orchid", coat: "#F2E1F2", mane: "#853A85" },
  { id: "meadow", name: "Meadow", coat: "#E1F2E8", mane: "#2B6B46" },
  { id: "tide", name: "Tide", coat: "#E1EBF2", mane: "#4D728C" },
  { id: "bark", name: "Bark", coat: "#F2EAE1", mane: "#4C3F32" },
  { id: "ember", name: "Ember", coat: "#F2E6E1", mane: "#9E512F" },
  { id: "rose", name: "Rose", coat: "#F2E1E4", mane: "#662E37" },
];

/**
 * The second color — the six species' own accents. It lands on the signature
 * part only (horn, wings, tail, or a bigfoot's mane), and is the brighter one.
 */
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

/** The wings each winged species was painted with — its default, drawn as is. */
const PAINTED_WINGS: Partial<Record<SpeciesId, string>> = {
  dragonling: "leathery",
  griffin: "feathered",
};

/** The horn the unicorn was painted with. */
const PAINTED_HORN = "spiral";

/**
 * Each species' own palette (assets/manifest.json → species → palette): what
 * the art was painted in, and so what a repaint is measured from.
 */
const SPECIES_PALETTE: Record<SpeciesId, { palette: string; mane: string; accent: string }> = {
  unicorn: { palette: "orchid", mane: "#853A85", accent: "#709FE0" },
  dragonling: { palette: "meadow", mane: "#2B6B46", accent: "#E09F70" },
  griffin: { palette: "tide", mane: "#4D728C", accent: "#E0C470" },
  bigfoot: { palette: "bark", mane: "#4C3F32", accent: "#70E09F" },
  kitsune: { palette: "ember", mane: "#9E512F", accent: "#70CEE0" },
  manticore: { palette: "rose", mane: "#662E37", accent: "#96E070" },
};

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

/** Which part a species' second color lands on. */
export function signatureOf(species: SpeciesId): "horn" | "wings" | "mane" | "tail" {
  return SIGNATURE_PART[species];
}

export function hornStylesFor(species: SpeciesId): readonly CosmeticOption[] {
  return SIGNATURE_PART[species] === "horn" ? HORN_STYLES : [];
}

/** Painted wings first, so the default is the creature as drawn. */
export function wingStylesFor(species: SpeciesId): readonly CosmeticOption[] {
  if (SIGNATURE_PART[species] !== "wings") return [];
  const painted = PAINTED_WINGS[species];
  return [...WING_STYLES].sort((a, b) => Number(b.id === painted) - Number(a.id === painted));
}

/**
 * A complete, valid appearance, so the preview is never half-drawn — and the
 * creature exactly as painted, so nothing changes until the player changes it.
 */
export function defaultAppearance(species: SpeciesId): Appearance {
  const own = SPECIES_PALETTE[species];
  const palette = own.palette;
  const accent = ACCENTS.find((a) => a.hex.toLowerCase() === own.accent.toLowerCase())?.hex ?? own.accent;
  const base: Appearance = { palette, accent, markings: MARKINGS[0]?.id ?? "plain" };
  const horn = hornStylesFor(species)[0];
  if (horn) base.hornStyle = horn.id;
  const wing = wingStylesFor(species)[0];
  if (wing) base.wingStyle = wing.id;
  return base;
}

/**
 * What the rig should wear for an appearance (world/rig-look.ts). Anything
 * that matches the painted art is left undefined, so "as painted" stays the
 * exact art rather than a repaint of it.
 */
export function rigLookFor(species: SpeciesId, appearance: Appearance): RigLook {
  const own = SPECIES_PALETTE[species];
  const main = PALETTES.find((p) => p.id === appearance.palette)?.mane ?? own.mane;
  const second = appearance.accent !== "" ? appearance.accent : own.accent;
  const markings = appearance.markings;
  const wing = appearance.wingStyle;
  const horn = appearance.hornStyle;
  const look: RigLook = {
    from: { mane: own.mane, accent: own.accent },
    to: { mane: main, accent: second },
    signature: SIGNATURE_PART[species],
  };
  if (markings !== undefined && markings !== "plain") look.markings = markings;
  if (wing !== undefined && SIGNATURE_PART[species] === "wings" && wing !== PAINTED_WINGS[species]) look.wingStyle = wing;
  if (horn !== undefined && SIGNATURE_PART[species] === "horn" && horn !== PAINTED_HORN) look.hornStyle = horn;
  return look;
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
