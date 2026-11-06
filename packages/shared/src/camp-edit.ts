/**
 * Changing the camp at the table (docs/camp.md §4.2, §4.5, §6.1, §12.1,
 * §12.5; #620): the pure rules the server enforces and the phones show.
 *
 *   - **Downtime moments.** The server says which one the table is in
 *     (`campMomentKind`): the lobby, a rest scene, the chapter's end. Each is
 *     its own moment, with its own count of shared changes.
 *   - **Shared hotspots.** Any seated player, in the full camp only (never
 *     indoors), from what the crew owns that fits the hotspot's kind. One
 *     counted change a player a moment (`SHARED_EDITS_PER_MOMENT`, the one
 *     number a playtest tunes); Undo gives a player's own latest change back;
 *     placing a piece first owned this chapter, at the chapter's end, is free.
 *   - **A hero's kit.** Only her own player, any downtime, no limit, and only
 *     from the kit catalog and what she has unlocked (§12.1): no crew piece
 *     ever goes in a kit.
 *
 * Shaped over small structural types rather than the whole catalog, so the
 * client can feed it the art manifest's hotspots and pieces (the same ids)
 * and the server the catalog, and both read one rule.
 */

import { PLAYER_COLORS } from "./player-colors.js";
import { KIT_SLOTS } from "./camp-record.js";
import type {
  CampChange,
  CampMoment,
  CampMomentKind,
  CampPieceId,
  CampView,
  FrameStage,
  HeroKit,
  HeroKitView,
  HotspotId,
  KitPieceId,
} from "./types/camp.js";
import type { RunState } from "./types/state.js";
import type { Chapter, RestSetting } from "./types/chapter.js";

/**
 * Shared changes each seated player may make in one downtime moment (§6.1,
 * §12.5). Under test: the playtest decides the number, so it is this one
 * constant, read by the server's check and the phones' words alike.
 */
export const SHARED_EDITS_PER_MOMENT = 1;
/** The most decoration slots a kit has (§4.5: two or three). */
export const MAX_KIT_SLOTS = 3;

// ---------------------------------------------------------------------------
// Downtime moments
// ---------------------------------------------------------------------------

/** The downtime moment a run state is in, or null in a scene, a check or a fight. */
export function campMomentKind(state: Pick<RunState, "phase" | "sceneType">): CampMomentKind | null {
  if (state.phase === "lobby" || state.phase === "creation") return "lobby";
  if (state.phase === "chapter_complete") return "chapterEnd";
  if (state.phase === "scene" && state.sceneType === "rest") return "rest";
  return null;
}

/**
 * What tells one moment from the next while the phase holds: a rest is its
 * scene, so two rest scenes in a row are two moments. Null outside downtime.
 */
export function campMomentScope(state: Pick<RunState, "phase" | "sceneType" | "sceneId">): string | null {
  const kind = campMomentKind(state);
  if (kind === null) return null;
  return kind === "rest" ? `rest:${state.sceneId ?? ""}` : kind;
}

/** The scope of a moment the state already carries. */
export function scopeOfMoment(moment: CampMoment): string {
  const at = moment.id.indexOf("|");
  return at < 0 ? moment.kind : moment.id.slice(0, at);
}

/**
 * A new moment for `state`, or null outside downtime. Its id leads with its
 * scope (`scopeOfMoment`), then `stamp`, which the server makes unique (the
 * run and the seq that began it).
 *
 * The lobby and the chapter's end are always the full, outdoor camp. A rest is
 * outdoors only when its scene says so (`RestScene.setting`, §3.2; #625), which
 * the caller reads off the chapter (`restSettingOf`); a rest it could not read
 * is indoors, the packed-down camp, which shows nothing a scene could contradict.
 */
export function newCampMoment(
  state: Pick<RunState, "phase" | "sceneType" | "sceneId">,
  stamp: string,
  restSetting?: RestSetting | null,
): CampMoment | null {
  const kind = campMomentKind(state);
  const scope = campMomentScope(state);
  if (kind === null || scope === null) return null;
  return { id: `${scope}|${stamp}`, kind, outdoor: kind !== "rest" || restSetting === "outdoor", changes: {} };
}

/**
 * The setting of the rest scene `state` is on (§3.2), read off its chapter;
 * null anywhere else, or when `chapter` is not the one the state is in.
 */
export function restSettingOf(
  chapter: Pick<Chapter, "id" | "scenes"> | null | undefined,
  state: Pick<RunState, "chapterId" | "sceneId" | "sceneType">,
): RestSetting | null {
  if (!chapter || state.sceneType !== "rest" || !state.sceneId || chapter.id !== state.chapterId) return null;
  const scene = chapter.scenes[state.sceneId];
  return scene?.type === "rest" ? scene.setting ?? null : null;
}

/**
 * What makes a new moment's id its own: the run, the chapter and how far
 * along its trail the table is. Read off the state rather than the seq, so
 * replaying the same play names the same moments.
 */
export function campMomentStamp(state: Pick<RunState, "runId" | "chapterId" | "visited">): string {
  const trail = state.visited ?? [];
  return `${state.runId}:${state.chapterId ?? "-"}:${String(trail.length)}`;
}

/**
 * The moment `after` should carry: `before`'s while the table stays in the
 * same one, a fresh one when it has moved into another, none outside
 * downtime. Returns `before` itself when nothing changes.
 */
export function followCampMoment(
  before: CampMoment | undefined,
  after: Pick<RunState, "phase" | "sceneType" | "sceneId">,
  stamp: string,
  restSetting?: RestSetting | null,
): CampMoment | undefined {
  const scope = campMomentScope(after);
  if (scope === null) return undefined;
  if (before && scopeOfMoment(before) === scope) return before;
  return newCampMoment(after, stamp, restSetting) ?? undefined;
}

// ---------------------------------------------------------------------------
// Shared hotspots
// ---------------------------------------------------------------------------

/** A hotspot as both the catalog and the art declare it. */
export interface HotspotRule {
  id: HotspotId;
  kind: string;
  /** The frame stage it first appears at (the catalog's); absent: every stage that lists it. */
  stage?: number;
  default?: CampPieceId;
}

/** A crew piece as both the catalog and the art declare it: the hotspot kind it stands at, and its group. */
export interface PieceRule {
  id: CampPieceId;
  hotspot: string;
  group: string;
}

/** The hotspots a camp at `stage` has. */
export function hotspotsAt<T extends HotspotRule>(hotspots: readonly T[], stage: number): T[] {
  return hotspots.filter((h) => h.stage === undefined || h.stage <= stage);
}

/** Trophies are kept pieces the game hangs itself, one per finished campaign (§4.3); nobody picks them. */
export const isPickable = (hotspot: Pick<HotspotRule, "kind">): boolean => hotspot.kind !== "trophy";

/** What a hotspot shows: the crew's pick, or its frame's own piece, or nothing. */
export function shownAt(hotspot: HotspotRule, placed: Readonly<Record<HotspotId, CampPieceId>>): CampPieceId | null {
  return placed[hotspot.id] ?? hotspot.default ?? null;
}

/**
 * The pieces a hotspot can show (§4.2, §12.1): every crew piece of its kind
 * the crew owns, and its frame's own piece, in catalog order. A kit piece is
 * never one: they are a separate catalog with separate ids.
 */
export function hotspotOptions(hotspot: HotspotRule, pieces: readonly PieceRule[], owned: readonly CampPieceId[]): CampPieceId[] {
  if (!isPickable(hotspot)) return [];
  const mine = new Set(owned);
  return pieces
    .filter((p) => p.hotspot === hotspot.kind && (mine.has(p.id) || p.id === hotspot.default))
    .map((p) => p.id);
}

/**
 * The frame stage a piece's hotspot first appears at, or null when no frame
 * has one: a piece the crew owns before its hotspot is there waits in the
 * collection with a note saying when it can go up (§12.5).
 */
export function stageForPiece(piece: PieceRule, hotspots: readonly HotspotRule[]): number | null {
  const stages = hotspots.filter((h) => h.kind === piece.hotspot && isPickable(h)).map((h) => h.stage ?? 1);
  return stages.length === 0 ? null : Math.min(...stages);
}

/**
 * The pieces first owned this chapter (§6.1): its finds and what the shop
 * bought on this visit. Placing one at the chapter's end costs no change. Only
 * at the chapter's end; anywhere else, nothing is new.
 */
export function freshPieces(state: Pick<RunState, "campMoment" | "campFinds" | "campShop">): CampPieceId[] {
  if (state.campMoment?.kind !== "chapterEnd") return [];
  const out = new Set<CampPieceId>();
  for (const find of state.campFinds ?? []) if (find.kind === "camp") out.add(find.pieceId);
  const bought = state.campShop?.result;
  if (bought?.kind === "bought") out.add(bought.pieceId);
  return [...out];
}

/** How many counted changes a player has made in a moment. */
export function sharedEditsUsed(moment: CampMoment | undefined, playerId: string): number {
  return (moment?.changes[playerId] ?? []).filter((c) => c.counted).length;
}

/** How many counted changes a player has left in a moment. */
export function sharedEditsLeft(moment: CampMoment | undefined, playerId: string): number {
  return Math.max(0, SHARED_EDITS_PER_MOMENT - sharedEditsUsed(moment, playerId));
}

/**
 * The change a player's Undo would give back: her own latest one this
 * moment, and only while its hotspot still shows what she put there (§12.5:
 * it never undoes another child's pick). Null when there is none.
 */
export function undoableChange(
  moment: CampMoment | undefined,
  playerId: string,
  placed: Readonly<Record<HotspotId, CampPieceId>>,
): CampChange | null {
  const last = moment?.changes[playerId]?.at(-1);
  if (!last) return null;
  return (placed[last.hotspot] ?? null) === last.after ? last : null;
}

/** Why a shared change cannot be made, or null when it can. */
export type PlaceRefusal =
  | "indoors"
  | "no_hotspot"
  | "not_pickable"
  | "not_owned"
  | "wrong_hotspot"
  | "unchanged"
  | "limit";

/**
 * Whether `piece` (null: the frame's own, or nothing) may go on `hotspotId`
 * now, by `playerId`, and whether it would count. The server's check; the
 * phones use it to grey a choice out.
 */
export function placeProblem(input: {
  moment: CampMoment;
  camp: Pick<CampView, "frameStage" | "owned" | "placed">;
  hotspots: readonly HotspotRule[];
  pieces: readonly PieceRule[];
  hotspotId: HotspotId;
  piece: CampPieceId | null;
  playerId: string;
  fresh: readonly CampPieceId[];
}): { refused: PlaceRefusal } | { counted: boolean } {
  if (!input.moment.outdoor) return { refused: "indoors" };
  const hotspot = hotspotsAt(input.hotspots, input.camp.frameStage).find((h) => h.id === input.hotspotId);
  if (!hotspot) return { refused: "no_hotspot" };
  if (!isPickable(hotspot)) return { refused: "not_pickable" };
  if (input.piece !== null) {
    const rule = input.pieces.find((p) => p.id === input.piece);
    if (!rule) return { refused: "not_owned" };
    if (rule.hotspot !== hotspot.kind) return { refused: "wrong_hotspot" };
    if (!hotspotOptions(hotspot, input.pieces, input.camp.owned).includes(input.piece)) return { refused: "not_owned" };
  }
  const now = input.camp.placed[hotspot.id] ?? null;
  const target = input.piece === hotspot.default ? null : input.piece;
  if (now === target) return { refused: "unchanged" };
  const counted = !(input.piece !== null && input.fresh.includes(input.piece));
  if (counted && sharedEditsLeft(input.moment, input.playerId) <= 0) return { refused: "limit" };
  return { counted };
}

/**
 * `placed` with `piece` on `hotspotId`: null (or the hotspot's own default)
 * clears it back to the frame's own. A piece stands in one place at a time,
 * so it leaves any other hotspot it was on.
 */
export function withPlaced(
  placed: Readonly<Record<HotspotId, CampPieceId>>,
  hotspot: Pick<HotspotRule, "id" | "default">,
  piece: CampPieceId | null,
): Record<HotspotId, CampPieceId> {
  const next: Record<HotspotId, CampPieceId> = {};
  for (const [id, p] of Object.entries(placed)) if (id !== hotspot.id && p !== piece) next[id] = p;
  if (piece !== null && piece !== hotspot.default) next[hotspot.id] = piece;
  return next;
}

/** A player's words for a refusal. */
export function placeRefusalText(refused: PlaceRefusal): string {
  switch (refused) {
    case "indoors":
      return "Shared camp spots can only change at the full camp.";
    case "limit":
      return SHARED_EDITS_PER_MOMENT === 1
        ? "You have made your camp change for now. You can change your own tent any time."
        : "You have made your camp changes for now. You can change your own tent any time.";
    case "unchanged":
      return "That is already there.";
    case "no_hotspot":
      return "That spot is not in your camp yet.";
    case "not_pickable":
      return "Trophies hang themselves.";
    case "not_owned":
    case "wrong_hotspot":
      return "That piece does not go there.";
  }
}

// ---------------------------------------------------------------------------
// A hero's kit (§4.5, §12.1)
// ---------------------------------------------------------------------------

/**
 * `RunState.kits[heroId]`: what the screens need of a stored kit, at the camp
 * `key` names (`campKey`), whose buddy is the one shown (§4.4; #624).
 */
export function kitView(kit: HeroKit, key?: string): HeroKitView {
  const buddy = key === undefined ? undefined : kit.buddies[key];
  return {
    revision: kit.revision,
    style: kit.style,
    tent: kit.tent,
    color: kit.color,
    slots: [...kit.slots],
    unlocked: Object.keys(kit.unlocked).sort(),
    ...(buddy ? { buddy } : {}),
  };
}

/** A kit catalog as both the catalog and the art declare it. */
export interface KitRules {
  styles: readonly { id: string }[];
  tents: readonly { id: string; group: string }[];
  decorations: readonly { id: string; group: string }[];
}

/** The kit colors (§4.5): the player color pairs' palette names. Null is the hero's own. */
export const KIT_COLORS: readonly string[] = PLAYER_COLORS.map((c) => c.palette);

/** The hex a kit's color draws in: its palette's accent, or the hero's own. */
export function kitAccent(color: string | null | undefined, ownAccent: string): string {
  return PLAYER_COLORS.find((c) => c.palette === color)?.accent ?? ownAccent;
}

/** The tents a hero may pick: the free ones and the milestone tents she has unlocked. */
export function kitTentChoices(rules: KitRules, unlocked: readonly KitPieceId[]): string[] {
  const mine = new Set(unlocked);
  return rules.tents.filter((t) => t.group === "catalog" || mine.has(t.id)).map((t) => t.id);
}

/** The decorations a hero may hang: the free ones and those she has unlocked. */
export function kitDecorationChoices(rules: KitRules, unlocked: readonly KitPieceId[]): string[] {
  const mine = new Set(unlocked);
  return rules.decorations.filter((d) => d.group === "catalog" || mine.has(d.id)).map((d) => d.id);
}

/** The fields a `KIT_EDIT` may change. */
export interface KitEdit {
  style?: string;
  tent?: string;
  color?: string | null;
  slots?: (string | null)[];
  /** Her buddy in this crew's camp (§4.4; #624), or null for none. */
  buddy?: string | null;
}

/**
 * Why an edit to a kit is refused, or null when it may be written: every id
 * must be in the kit catalog and, beyond the free one, unlocked by her
 * (§12.1). Never anything the crew owns.
 */
export function kitEditProblem(rules: KitRules, unlocked: readonly KitPieceId[], edit: KitEdit, friends: readonly string[] = []): string | null {
  if (edit.style === undefined && edit.tent === undefined && edit.color === undefined && edit.slots === undefined && edit.buddy === undefined) {
    return "nothing to change";
  }
  // A buddy is one of this crew's friends (§4.4): never another crew's, never a piece.
  if (edit.buddy !== undefined && edit.buddy !== null && !friends.includes(edit.buddy)) return `"${edit.buddy}" is not one of this crew's friends`;
  if (edit.style !== undefined && !rules.styles.some((s) => s.id === edit.style)) return `no such kit style "${edit.style}"`;
  if (edit.tent !== undefined && !kitTentChoices(rules, unlocked).includes(edit.tent)) return `tent "${edit.tent}" is not hers to pick`;
  if (edit.color !== undefined && edit.color !== null && !KIT_COLORS.includes(edit.color)) return `no such kit color "${edit.color}"`;
  if (edit.slots !== undefined) {
    if (edit.slots.length < KIT_SLOTS || edit.slots.length > MAX_KIT_SLOTS) return `a kit has ${String(KIT_SLOTS)} to ${String(MAX_KIT_SLOTS)} slots`;
    const choices = new Set(kitDecorationChoices(rules, unlocked));
    const hung = edit.slots.filter((s): s is string => s !== null);
    for (const id of hung) if (!choices.has(id)) return `decoration "${id}" is not hers to hang`;
    if (new Set(hung).size !== hung.length) return "one decoration hangs in one slot";
  }
  return null;
}

/** The kit with an edit applied; a buddy goes under `key`, the camp it is picked in (`campKey`). */
export function withKitEdit<K extends Pick<HeroKit, "style" | "tent" | "color" | "slots"> & Partial<Pick<HeroKit, "buddies">>>(kit: K, edit: KitEdit, key?: string): K {
  const buddies = edit.buddy === undefined || key === undefined ? undefined : { ...(kit.buddies ?? {}) };
  if (buddies && key !== undefined) {
    if (edit.buddy) buddies[key] = edit.buddy;
    else delete buddies[key];
  }
  return {
    ...kit,
    ...(edit.style !== undefined ? { style: edit.style } : {}),
    ...(edit.tent !== undefined ? { tent: edit.tent } : {}),
    ...(edit.color !== undefined ? { color: edit.color } : {}),
    ...(edit.slots !== undefined ? { slots: [...edit.slots] } : {}),
    ...(buddies ? { buddies } : {}),
  };
}

/**
 * Whether a hero's phone should offer the first-session choice (§5.3): she
 * sits with a crew that has a camp, and her kid has never picked a style or a
 * tent. The phone remembers a skip; the server never asks.
 */
export function kitUnchosen(kit: Pick<HeroKitView, "style" | "tent"> | undefined): boolean {
  return kit !== undefined && kit.style === null && kit.tent === null;
}

/** The camp view grown by a `growsCamp` campaign just finished (§4.1), with `grew` set when the frame moved. */
export function grownView(camp: CampView, campaignId: string, frameFor: (grown: number) => FrameStage): CampView {
  if (camp.grownBy.includes(campaignId)) return camp;
  const grownBy = [...camp.grownBy, campaignId];
  const frameStage = frameFor(grownBy.length);
  return { ...camp, grownBy, frameStage, ...(frameStage > camp.frameStage ? { grew: true as const } : {}) };
}
