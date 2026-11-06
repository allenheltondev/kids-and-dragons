/**
 * The camp's friends on the screens (docs/camp.md §4.4, §8.5; #624): who is
 * out, as the camp draws them, and how big each is.
 *
 * The server chooses who is out (`CampMoment.friends.out`: each seated
 * hero's buddy, then the moment's rotation, at most four); this only reads
 * it. A friend is a figure like a hero, drawn at its true height on the same
 * scale (camp-motion.ts `campHeightPx`), so a kid goat stands knee-high to a
 * unicorn and a duckling at the camp's legibility floor. Friends stand at
 * the frame's friend spots (`CampStandPoint.friend`, by the friends' corner
 * and the campfire) and wander like heroes, never to a hero's bedroll, tent
 * or a piece's action spot.
 *
 * Pure and Pixi-free: the moving camp, the still camp and camp-boxes.ts all
 * read it.
 */

import { heightInBand } from "@kad/shared";
import type { CampFriendCard, RunState } from "@kad/shared";
import { castArtUrl } from "./art-paths";
import { campHeightPx } from "./camp-motion";
import { figureSize, NOMINAL_PAINT, type StageMeasure } from "./figure-scale";
import { ANCHOR_Y } from "./art-paths";
import type { CastStance } from "@kad/shared";

/**
 * A friend as the camp stage draws it: camp.ts `CampFigure` with its friend
 * spot set and no seat. Declared here rather than imported, so the art
 * checks (tools/art/camp-art.test.ts) read this module without the stage.
 */
export interface FriendFigure {
  id: string;
  url: string | null;
  heightCm: number;
  stance: CastStance;
  friend: number;
  name: string;
  figure: string;
}

/** How many friend spots each frame has: one per friend out (§4.4). */
export const FRIEND_SPOTS = 4;

/**
 * Per friend figure, its painted box as a share of its drawn height (as
 * camp-ownership.ts `HERO_PAINT` is for heroes): measured from the art with
 * alpha over 64, rounded up. A figure not listed is the nominal box.
 * tools/art/camp-art.test.ts holds it to every catalog friend's painting.
 */
export const FRIEND_PAINT: Readonly<Record<string, { height: number; width: number }>> = {
  "cast/bun": { height: 1.04, width: 1.01 },
  "entities/mosshorn": { height: 1.03, width: 0.73 },
  "entities/duckling": { height: 0.99, width: 0.64 },
  "cast/snowhorn_kid": { height: 0.99, width: 0.85 },
};

const NOMINAL_BOX = { height: 1, width: (NOMINAL_PAINT.right - NOMINAL_PAINT.left) / (ANCHOR_Y - NOMINAL_PAINT.top) };

/** How tall a friend stands in camp: its figure's height, in its size band (`CampFriendCard.size`). */
export function friendHeightCm(card: Pick<CampFriendCard, "figure" | "size">): number {
  return heightInBand(figureSize(card.figure).heightCm, card.size);
}

/** A friend's drawn box on the camp canvas, before its lane's scale and the camp's figure factor. */
export function friendDrawnBox(figure: string, heightCm: number, measure: StageMeasure): { height: number; width: number } {
  const drawn = campHeightPx(heightCm, measure);
  const box = FRIEND_PAINT[figure] ?? NOMINAL_BOX;
  return { height: drawn * box.height, width: drawn * box.width };
}

/** The friends out now, in the order the server chose them: buddies first. */
export function campFriendsOut(state: Pick<RunState, "campMoment"> | null | undefined): CampFriendCard[] {
  const friends = state?.campMoment?.friends;
  if (!friends) return [];
  return friends.out.map((id) => friends.cards.find((c) => c.id === id)).filter((c): c is CampFriendCard => c !== undefined);
}

/** A friend as the camp stage draws it: its art, its true height, and the friend spot it calls home. */
export function friendFigure(card: CampFriendCard, spot: number): FriendFigure {
  const size = figureSize(card.figure);
  return { id: `friend:${card.id}`, url: castArtUrl(card.figure), heightCm: friendHeightCm(card), stance: size.stance, friend: spot, name: card.name, figure: card.figure };
}

/**
 * Every friend out, as figures, each at its own friend spot: `before`'s
 * where it still holds (`friendSpots`, kept across a moment).
 */
export function campFriendFigures(state: Pick<RunState, "campMoment"> | null | undefined, before: ReadonlyMap<string, number> = new Map()): FriendFigure[] {
  const cards = campFriendsOut(state).slice(0, FRIEND_SPOTS);
  const spots = friendSpots(before, cards.map((c) => c.id), new Map(cards.map((c) => [c.id, friendHeightCm(c)])));
  return cards.map((card) => friendFigure(card, spots.get(card.id) ?? 0));
}

/** The figure id a friend is drawn under. */
export const friendFigureId = (friendId: string): string => `friend:${friendId}`;

/**
 * Each friend out at a friend spot (0 to 3). Spot 0 is the roomy one, which
 * every frame keeps for the tallest friend out; the other three take friends
 * a kid goat's size (camp-boxes.test.ts holds every frame to both). So the
 * tallest friend out stands at spot 0, and every other friend who was
 * already out keeps its spot, so a buddy coming out never sends the rest
 * across the camp; a new friend takes the first spot nobody holds.
 * `heights` is each friend's height (`friendHeightCm`).
 */
export function friendSpots(before: ReadonlyMap<string, number>, out: readonly string[], heights: ReadonlyMap<string, number> = new Map()): Map<string, number> {
  const next = new Map<string, number>();
  const tallest = [...out].sort((a, b) => (heights.get(b) ?? 0) - (heights.get(a) ?? 0) || out.indexOf(a) - out.indexOf(b))[0];
  if (tallest !== undefined) next.set(tallest, 0);
  for (const id of out) {
    const spot = before.get(id);
    if (id !== tallest && spot !== undefined && spot > 0 && spot < FRIEND_SPOTS) next.set(id, spot);
  }
  const held = new Set(next.values());
  for (const id of out) {
    if (next.has(id)) continue;
    const spot = Array.from({ length: FRIEND_SPOTS }, (_, i) => i).find((i) => !held.has(i));
    if (spot === undefined) continue;
    next.set(id, spot);
    held.add(spot);
  }
  return next;
}
