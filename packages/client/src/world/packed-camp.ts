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
 * (`packedCampSpots`), and the friends out (§4.4, #624; `packedFriends`) sit
 * at the two ends of the row. This module only places them; scene.ts draws the bedrolls and the
 * still stage (StaticStage) draws the same row in plain images.
 *
 * Pure and Pixi-free, so the layout is a table of tests (packed-camp.test.ts).
 */

import type { CastStance, HeroKitView, PartyMember, RunState } from "@kad/shared";
import type { CampKitStyle } from "./camp-kit-art";
import { FRIEND_SPOTS, campFriendsOut, friendFigure } from "./camp-friends";
import { kitLook } from "./camp-scene";
import { indoorRest } from "./lobby-camp";

/**
 * One hero's packed kit: her bedroll rolled up beside her pack, in her color.
 * Indoors nobody sleeps in it, so it is always the rolled painting, whatever
 * style her kid picked for the camp (owner, docs/camp.md §3.2, §11).
 */
export interface PackedKit {
  /** Her character id: the bedroll lies beside her in the lineup. */
  id: string;
  style: CampKitStyle;
  accent: string;
}

/**
 * A friend out at an indoor rest (§4.4; #624), sitting at one end of the
 * packed row: the friend the lobby camp would draw (camp-friends.ts
 * `campFriendsOut`), at its true height on the story stage's scale.
 */
export interface PackedFriend {
  /** The friend's catalog id. */
  id: string;
  /** Its painting, or null for none (nothing is drawn). */
  url: string | null;
  /** Its true height, in its size band (camp-friends.ts `friendHeightCm`). */
  heightCm: number;
  stance: CastStance;
  /** Its figure, for its painted box (camp-friends.ts `FRIEND_PAINT`). */
  figure: string;
  /** Its drawn painted width, where the caller knows it: what its spot keeps clear of the row's edge. */
  width?: number;
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

/** Indoors the bedroll is rolled up: the camp's rolled bedroll-and-pack painting, for every hero. */
export const PACKED_STYLE: CampKitStyle = "rolled";

/** How far to her side a bedroll lies, as a share of her lineup slot (its middle). */
export const PACKED_SIDE = 0.36;
/** The widest a bedroll is drawn, as a share of her lineup slot. */
export const PACKED_SLOT_WIDTH = 0.85;
/** The widest the rolled bedroll and pack are drawn, as a share of her drawn height: packed gear, sized to her. */
export const PACKED_HEIGHT_WIDTH = 0.7;
/** How far behind her feet the bedroll's ground contact is, in design units: she stands in front of it. */
export const PACKED_BEHIND = 6;

/** A friend's share of a lineup slot, where the caller does not say how wide it is drawn. */
export const PACKED_FRIEND_WIDTH = 0.3;

/**
 * Each hero's bedroll beside her (`heroes` in lineup order, each at its feet
 * and drawn height), and a spot at each end of the row for each friend.
 * A bedroll lies on her right, a little behind her feet, so she stands at its
 * end and nothing covers her or her name; it is no wider than her slot leaves
 * room for, nor than she is tall. Friends alternate ends, left first, each
 * further out than the last on its side, turned to face the row; `bounds`
 * (the stage's shown edges, in the same units) keeps each one wholly inside
 * them, moving a friend to the other end when its own is full.
 */
export function packedCampSpots(
  heroes: readonly { id: string; x: number; y: number; height: number }[],
  slot: number,
  friends: readonly Pick<PackedFriend, "id" | "width">[] = [],
  bounds?: { left: number; right: number },
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
    // Just past the last bedroll as drawn, a step clear of it.
    const right = Math.max(...bedrolls.map((b) => b.x + b.width / 2)) + slot * 0.1;
    // Each side's next friend sits just beyond the last one there. A side
    // with no room left inside `bounds` sends it to the other end; with no
    // room at either, it stays on its own side, at the edge.
    const reach = { left, right };
    const used = { left: 0, right: 0 };
    const gap = slot * 0.05;
    const at = (onLeft: boolean, width: number): number => {
      const side = onLeft ? used.left : used.right;
      // The first on the left stands at the first hero's slot edge; the first on the right just past the last bedroll.
      const pad = side === 0 ? (onLeft ? 0 : width / 2) : gap + width / 2;
      return onLeft ? reach.left - pad : reach.right + pad;
    };
    const fits = (onLeft: boolean, x: number, width: number): boolean =>
      !bounds || (onLeft ? x - width / 2 >= bounds.left : x + width / 2 <= bounds.right);
    friends.forEach((friend, index) => {
      const width = friend.width ?? slot * PACKED_FRIEND_WIDTH;
      let onLeft = index % 2 === 0;
      if (!fits(onLeft, at(onLeft, width), width) && fits(!onLeft, at(!onLeft, width), width)) onLeft = !onLeft;
      let x = at(onLeft, width);
      if (bounds) x = Math.max(bounds.left + width / 2, Math.min(bounds.right - width / 2, x));
      if (onLeft) { reach.left = Math.min(reach.left, x - width / 2); used.left++; }
      else { reach.right = Math.max(reach.right, x + width / 2); used.right++; }
      // Drawn facing left; a friend on the left turns round to face the row.
      spots.push({ id: friend.id, x, y: ground, width, mirrored: onLeft });
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
  return `${state!.sceneId ?? ""}|${packedKits(state).map((k) => `${k.id}:${k.style}:${k.accent}`).join(",")}|${packedFriends(state).map((f) => f.id).join(",")}`;
}

/**
 * The friends out at an indoor rest, as the packed row seats them: the
 * lobby camp's (camp-friends.ts `campFriendsOut`, buddies first, at most
 * four), each at its true height. None outside one.
 */
export function packedFriends(state: Pick<RunState, "phase" | "sceneType" | "sceneId" | "campMoment"> | null | undefined): PackedFriend[] {
  if (!indoorRest(state)) return [];
  return campFriendsOut(state)
    .slice(0, FRIEND_SPOTS)
    .map((card) => {
      const figure = friendFigure(card, 0);
      return { id: card.id, url: figure.url, heightCm: figure.heightCm, stance: figure.stance, figure: card.figure };
    });
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
      return { id: member.character.id, style: PACKED_STYLE, accent: look.accent };
    });
}
