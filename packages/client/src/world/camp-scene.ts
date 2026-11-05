/**
 * What the camp shows, read off the run state and the art manifest (docs/camp.md
 * §4, §4.5, §12.5; #620): which piece stands at each shared hotspot, the
 * trophies, the crew's banner and name, the pieces found or bought this
 * chapter waiting beside the campfire, and each hero's kit as the camp draws
 * it. Pure and Pixi-free, so the moving camp (camp.ts), the still one
 * (StillCamp.tsx) and a phone's Camp panel (CampPanel.tsx) cannot read it
 * three ways, and its rules are a table of tests (camp-scene.test.ts).
 *
 * The art manifest's ids are the catalog's (content/camp.json; the validator
 * holds the two together), so the shared rules (camp-edit.ts) read the
 * manifest's hotspots and pieces here exactly as the server reads the
 * catalog's.
 */

import { campPieceLabel, freshPieces, hotspotOptions, isPickable, kitAccent, shownAt, stageForPiece } from "@kad/shared";
import type { CampView, HeroKitView, HotspotRule, PieceRule, RunState } from "@kad/shared";
import { camp as campManifest } from "../../../../assets/manifest.json";
import type { CampHotspot, CampLayout, CampMovingPart } from "./camp-layout";
import { crewChoices } from "../screens/crew-copy";

/** A crew piece as the art manifest declares it. */
export interface CampArtPiece {
  id: string;
  hotspot: string;
  group: string;
  path: string;
  heightCm: number;
  /** Its painted width, as `heightCm` is its height: the box the layout keeps clear (camp-boxes.ts). */
  widthCm?: number;
  campaign?: string;
  movingParts?: { path: string; motion: CampMovingPart["motion"] }[];
}

/** A kit piece (tent or decoration) as the art manifest declares it. */
export interface KitArt {
  id: string;
  group: string;
  path: string;
  heightCm?: number;
  kit?: string;
  tier?: string;
  flap?: string;
}

export const CREW_PIECE_ART: readonly CampArtPiece[] = (campManifest.crewPieces ?? []) as CampArtPiece[];
export const TENT_ART: readonly KitArt[] = (campManifest.tentStyles ?? []) as KitArt[];
export const DECORATION_ART: readonly KitArt[] = (campManifest.decorations ?? []) as KitArt[];
export const KIT_STYLE_ART: readonly { id: string; path: string }[] = (campManifest.kitStyles ?? []) as { id: string; path: string }[];

/** The kit catalog as the shared rules read it, from the art (the catalog's ids). */
export const KIT_RULES = {
  styles: KIT_STYLE_ART.map((s) => ({ id: s.id })),
  tents: TENT_ART.map((t) => ({ id: t.id, group: t.group })),
  decorations: DECORATION_ART.map((d) => ({ id: d.id, group: d.group })),
};

/** The crew pieces as the shared rules read them. */
export const PIECE_RULES: readonly PieceRule[] = CREW_PIECE_ART.map((p) => ({ id: p.id, hotspot: p.hotspot, group: p.group }));

/** Every hotspot any frame declares, with the stage it first appears at: what a piece's "waits for" note reads. */
export const ALL_HOTSPOTS: readonly HotspotRule[] = (() => {
  const out = new Map<string, HotspotRule>();
  const frames = [...((campManifest.frames ?? []) as { stage: number; hotspots?: CampHotspot[] }[])].sort((a, b) => a.stage - b.stage);
  for (const frame of frames) {
    for (const h of frame.hotspots ?? []) if (!out.has(h.id)) out.set(h.id, { id: h.id, kind: h.kind, stage: frame.stage, ...(h.default ? { default: h.default } : {}) });
  }
  return [...out.values()];
})();

/** The hotspots this layout's frame has, as the shared rules read them. */
export function layoutHotspots(layout: Pick<CampLayout, "frame">): HotspotRule[] {
  return (layout.frame.hotspots ?? []).map((h) => ({ id: h.id, kind: h.kind, ...(h.default ? { default: h.default } : {}) }));
}

export const pieceArt = (id: string): CampArtPiece | undefined => CREW_PIECE_ART.find((p) => p.id === id);

/** A crew piece's name on screen: "Striped awning", "Crew banner", "Gemfall trophy". */
export function pieceName(id: string): string {
  if (id === "kept_crew_banner") return "Crew banner";
  if (id === "cookfire_pot") return "Cookfire";
  const trophy = pieceArt(id)?.campaign;
  if (trophy) return `${trophy.charAt(0).toUpperCase()}${trophy.slice(1)} trophy`;
  return campPieceLabel(id);
}

/** A hotspot's name on screen. */
export function hotspotName(kind: string): string {
  switch (kind) {
    case "cookfire":
      return "Cookfire";
    case "awning":
      return "Awning";
    case "lanterns":
      return "Lanterns";
    case "friends_corner":
      return "Friends' corner";
    case "banner_pole":
      return "Banner pole";
    case "trophy":
      return "Trophy";
    default:
      return kind;
  }
}

/** A kit piece's name: "Little flag", "Quilted", "Sworn tent". */
export function kitName(id: string, kind: "style" | "tent" | "decoration"): string {
  const words = id.replace(/^deco_/, "").split("_").join(" ");
  const cap = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  return kind === "tent" ? `${cap} tent` : cap;
}

/** The crew's name, for its banner (`CrewIdentity`). */
export function crewName(state: Pick<RunState, "crew" | "crews" | "firstCrewName">): string {
  return crewChoices(state).current;
}

/** One shared hotspot as the camp draws it. */
export interface CampSpotView {
  id: string;
  kind: string;
  lane: string;
  x: number;
  /** What stands there, or null for an empty spot. */
  pieceId: string | null;
  label: string;
  /** The piece's art, relative to `assets/`. */
  path: string | null;
  heightCm: number;
  widthCm: number;
  movingParts: { path: string; motion: CampMovingPart["motion"] }[];
  /** Somebody may pick for it (never a trophy). */
  pickable: boolean;
  /** A piece beside the campfire fits here (§12.5). */
  highlighted: boolean;
  /** The crew's name, on the banner. */
  banner: string | null;
}

/** A piece found or bought this chapter, waiting beside the campfire (§5.3, §12.5). */
export interface CampBesideView {
  pieceId: string;
  label: string;
  path: string | null;
  heightCm: number;
  widthCm: number;
  /** The hotspot it would go on now, or null while the camp has none for it. */
  hotspotId: string | null;
  /** The frame stage whose camp has a spot for it, when this one does not. */
  waitsForStage: number | null;
}

/**
 * Pieces first owned this chapter that are not up anywhere yet: shown beside
 * the campfire at the chapter's end, never put up on their own (§12.5).
 */
export function campBeside(
  state: Pick<RunState, "campMoment" | "campFinds" | "campShop" | "camp">,
  layout: Pick<CampLayout, "frame">,
): CampBesideView[] {
  const camp = state.camp;
  if (!camp) return [];
  const hotspots = layoutHotspots(layout);
  const shown = new Set(hotspots.map((h) => shownAt(h, camp.placed)).filter((p): p is string => p !== null));
  const out: CampBesideView[] = [];
  for (const pieceId of freshPieces(state)) {
    if (!camp.owned.includes(pieceId) || shown.has(pieceId)) continue;
    const art = pieceArt(pieceId);
    const rule = PIECE_RULES.find((p) => p.id === pieceId);
    const spot = rule ? hotspots.find((h) => h.kind === rule.hotspot && isPickable(h)) : undefined;
    out.push({
      pieceId,
      label: pieceName(pieceId),
      path: art?.path ?? null,
      heightCm: art?.heightCm ?? 60,
      widthCm: art?.widthCm ?? art?.heightCm ?? 60,
      hotspotId: spot?.id ?? null,
      waitsForStage: spot || !rule ? null : stageForPiece(rule, ALL_HOTSPOTS),
    });
  }
  return out;
}

/**
 * Every shared hotspot of the frame, with what stands there: the crew's pick
 * or the frame's own piece, a trophy per finished full campaign in the order
 * they were finished, and the crew's name on its banner.
 */
export function campSpots(
  layout: Pick<CampLayout, "frame">,
  camp: Pick<CampView, "placed" | "grownBy"> | undefined,
  options: { crewName?: string | null; highlight?: ReadonlySet<string> } = {},
): CampSpotView[] {
  const placed = camp?.placed ?? {};
  const trophies = (camp?.grownBy ?? []).map((campaign) => CREW_PIECE_ART.find((p) => p.group === "trophy" && p.campaign === campaign)?.id).filter((id): id is string => id !== undefined);
  let trophy = 0;
  return (layout.frame.hotspots ?? []).map((h) => {
    const pieceId = h.kind === "trophy" ? (trophies[trophy++] ?? null) : shownAt({ id: h.id, kind: h.kind, ...(h.default ? { default: h.default } : {}) }, placed);
    const art = pieceId ? pieceArt(pieceId) : undefined;
    return {
      id: h.id,
      kind: h.kind,
      lane: h.lane,
      x: h.x,
      pieceId,
      label: pieceId ? pieceName(pieceId) : hotspotName(h.kind),
      path: art?.path ?? null,
      heightCm: art?.heightCm ?? 60,
      widthCm: art?.widthCm ?? art?.heightCm ?? 60,
      movingParts: art?.movingParts ?? [],
      pickable: h.kind !== "trophy",
      highlighted: options.highlight?.has(h.id) ?? false,
      banner: pieceId === "kept_crew_banner" ? (options.crewName ?? null) : null,
    };
  });
}

/** What a hotspot can show, for a phone's pick: owned pieces of its kind, and the frame's own. */
export function spotOptions(spot: Pick<CampSpotView, "id" | "kind">, layout: Pick<CampLayout, "frame">, camp: Pick<CampView, "owned">): string[] {
  const rule = layoutHotspots(layout).find((h) => h.id === spot.id);
  return rule ? hotspotOptions(rule, PIECE_RULES, camp.owned) : [];
}

/** Owned pieces this frame has no spot for yet, with the stage that has one (§12.5). */
export function waitingPieces(layout: Pick<CampLayout, "frame">, camp: Pick<CampView, "owned">): { pieceId: string; label: string; stage: number | null }[] {
  const here = layoutHotspots(layout).filter(isPickable);
  return camp.owned
    .map((id) => PIECE_RULES.find((p) => p.id === id))
    .filter((p): p is PieceRule => p !== undefined && p.group !== "trophy" && !here.some((h) => h.kind === p.hotspot))
    .map((p) => ({ pieceId: p.id, label: pieceName(p.id), stage: stageForPiece(p, ALL_HOTSPOTS) }));
}

/** How a hero's kit draws: her style and tent (null: her id's hash), her color and decorations. */
export interface CampKitLook {
  style: string | null;
  tent: string | null;
  accent: string;
  slots: (string | null)[];
}

/** A hero's kit look from her stored kit, or as before kits when there is none. */
export function kitLook(kit: HeroKitView | undefined, ownAccent: string): CampKitLook {
  return {
    style: kit?.style ?? null,
    tent: kit?.tent ?? null,
    accent: kitAccent(kit?.color ?? null, ownAccent),
    slots: kit?.slots ?? [],
  };
}

/** The tent art a hero's kit draws: her tent, or the tent of her bedroll style, or the rolled fallback. */
export function tentArt(tent: string | null, style: string): KitArt | undefined {
  return TENT_ART.find((t) => t.id === tent) ?? TENT_ART.find((t) => t.kit === style) ?? TENT_ART.find((t) => t.id === "rolled");
}
