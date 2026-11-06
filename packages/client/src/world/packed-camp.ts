/**
 * The camp packed down into an indoor rest's own picture (docs/camp.md §3.2,
 * §8.3 "Indoors, one lane"; #625).
 *
 * Indoors, and anywhere outdoors no campsite fits (a boat deck, a narrow
 * ledge, a climb), the shared screen keeps the scene's illustration and the
 * story lineup, and the camp comes along packed: each hero's bedroll and pack
 * set down on the ground beside her, along the front of the picture. There
 * are no tents, no campfire, no shared hotspots, and nobody wanders. Her kit
 * can still change from her phone (§4.5), and it is redrawn when it does.
 *
 * One generic layout, with no per-scene authoring: the lineup's own ground
 * line is the one near lane, each hero's bedroll lies on it at her side
 * (`packedCampSpots`), and the friends (§4.4, #624) sit at the two ends of the
 * row. This module only places them; scene.ts draws the bedrolls and the
 * still stage (StaticStage) draws the same row in plain images.
 *
 * Pure and Pixi-free, so the layout is a table of tests (packed-camp.test.ts).
 */

import type { HeroKitView, PartyMember, RunState } from "@kad/shared";
import { campKitStyle, type CampKitStyle } from "./camp-kit-art";
import { kitLook } from "./camp-scene";
import { indoorRest } from "./lobby-camp";

/** One hero's packed kit: her bedroll-and-pack painting, in her color. */
export interface PackedKit {
  /** Her character id: the bedroll lies beside her in the lineup. */
  id: string;
  style: CampKitStyle;
  accent: string;
}

/**
 * A friend sitting beside the packed bedrolls. The seam for #624 (friends):
 * whoever builds friends hands them here, and they get a spot at the ends of
 * the row. Nothing draws one yet.
 */
export interface PackedFriend {
  id: string;
}

/** Where a bedroll or a friend sits, in the story's design units (feet / ground contact). */
export interface PackedSpot {
  id: string;
  x: number;
  y: number;
  /** The painted width of the bedroll and pack; a friend's spot is as wide as its slot share. */
  width: number;
  /** Drawn turned round, so a row of the same painting does not read as a stamp. */
  mirrored: boolean;
}

/** How far to her side a bedroll lies, as a share of her lineup slot (its middle). */
export const PACKED_SIDE = 0.36;
/** The widest a bedroll is drawn, as a share of her lineup slot. */
export const PACKED_SLOT_WIDTH = 0.85;
/** The widest a bedroll is drawn, as a share of her drawn height: gear she could use, never bigger than she is. */
export const PACKED_HEIGHT_WIDTH = 0.7;
/** How far behind her feet the bedroll's ground contact is, in design units: she stands in front of it. */
export const PACKED_BEHIND = 6;

/**
 * Each hero's bedroll beside her (`heroes` in lineup order, each at its feet
 * and drawn height), and a spot at each end of the row for each friend.
 * A bedroll lies on her right, a little behind her feet, so she stands at its
 * end and nothing covers her or her name; it is no wider than her slot leaves
 * room for, nor than she is tall.
 */
export function packedCampSpots(
  heroes: readonly { id: string; x: number; y: number; height: number }[],
  slot: number,
  friends: readonly PackedFriend[] = [],
): { bedrolls: PackedSpot[]; friends: PackedSpot[] } {
  const bedrolls = heroes.map((hero, index) => ({
    id: hero.id,
    x: hero.x + slot * PACKED_SIDE,
    y: hero.y - PACKED_BEHIND,
    width: Math.max(0, Math.min(slot * PACKED_SLOT_WIDTH, hero.height * PACKED_HEIGHT_WIDTH)),
    mirrored: index % 2 === 1,
  }));
  const spots: PackedSpot[] = [];
  if (heroes.length > 0) {
    const xs = heroes.map((h) => h.x);
    const ground = Math.max(...heroes.map((h) => h.y));
    const left = Math.min(...xs) - slot * 0.5;
    const right = Math.max(...xs) + slot * (PACKED_SIDE + PACKED_SLOT_WIDTH / 2) + slot * 0.25;
    friends.forEach((friend, index) => {
      // Alternate ends, each further out than the last on its side.
      const step = Math.floor(index / 2) * slot * 0.3;
      const x = index % 2 === 0 ? left - step : right + step;
      spots.push({ id: friend.id, x, y: ground, width: slot * 0.3, mirrored: index % 2 === 0 });
    });
  }
  return { bedrolls, friends: spots };
}

/**
 * What the packed camp on screen depends on, as one string, so a screen redraws
 * it when a kit, a seat or the rest changes and not on every vote tick. Empty
 * outside an indoor rest.
 */
export function packedCampKey(state: (Pick<RunState, "phase" | "sceneType" | "sceneId" | "campMoment" | "party" | "removed" | "kits">) | null | undefined): string {
  if (!indoorRest(state)) return "";
  return `${state!.sceneId ?? ""}|${packedKits(state).map((k) => `${k.id}:${k.style}:${k.accent}`).join(",")}`;
}

/**
 * Each seated hero's packed kit, read off the run state as the moving and the
 * still camp read it (`kitLook`): her stored style and color, or, before her
 * kid has picked, the style her id hashes to in her own accent.
 */
export function packedKits(state: Pick<RunState, "party" | "removed" | "kits"> | null | undefined): PackedKit[] {
  if (!state) return [];
  const removed = new Set(state.removed ?? []);
  return state.party
    .filter((member: PartyMember) => !removed.has(member.playerId))
    .map((member) => {
      const kit: HeroKitView | undefined = state.kits?.[member.character.id];
      const look = kitLook(kit, member.character.appearance.accent);
      return { id: member.character.id, style: campKitStyle(member.character.id, look.style), accent: look.accent };
    });
}
