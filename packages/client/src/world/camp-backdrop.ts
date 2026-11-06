/**
 * Which camp backdrop a chapter pitches in (docs/camp.md §3.1; #625): the one
 * place the lobby, an outdoor rest scene and the chapter end's camp beat (and
 * anything else that pitches the full camp) pick it.
 *
 * A chapter's `biome` belongs to a terrain family (assets/manifest.json →
 * `biomeFamilies`), and each family gets one camp backdrop
 * (`camp.backdrops[].family`). The families are painted a wave at a time, so a
 * family with no backdrop yet, a biome in no family (`sallow_wastelands`
 * today) and no chapter at all all pitch in `open_plains`, the fallback §3.1
 * names.
 *
 * Pure and Pixi-free: a table of tests (camp-backdrop.test.ts) and the same
 * answer on the TV, a phone's World pane and its Camp panel.
 */

import type { Chapter } from "@kad/shared";
import { biomeFamilies, camp as campManifest } from "../../../../assets/manifest.json";

/** The family every unpainted terrain, and every screen with no chapter, pitches in. */
export const CAMP_FALLBACK_FAMILY = "open_plains";

const FAMILIES: Readonly<Record<string, readonly string[]>> = biomeFamilies;
const PAINTED: ReadonlySet<string> = new Set((campManifest.backdrops ?? []).map((b: { family: string }) => b.family));

/** The terrain family a biome belongs to, or null for a biome in none. */
export function terrainFamilyOf(biome: string | null | undefined): string | null {
  if (!biome) return null;
  for (const [family, biomes] of Object.entries(FAMILIES)) if (biomes.includes(biome)) return family;
  return null;
}

/**
 * The terrain family whose camp backdrop a chapter (or a bare biome id) is
 * pitched in: its own family where that backdrop is painted, `open_plains`
 * everywhere else. `painted` is the families the manifest has backdrops for;
 * a test may pass its own.
 */
export function campBackdropFamily(
  where: Pick<Chapter, "biome"> | string | null | undefined,
  painted: ReadonlySet<string> = PAINTED,
): string {
  const biome = typeof where === "string" ? where : where?.biome;
  const family = terrainFamilyOf(biome);
  return family !== null && painted.has(family) ? family : CAMP_FALLBACK_FAMILY;
}
