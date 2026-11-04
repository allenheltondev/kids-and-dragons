/**
 * The lobby's camp, read off the run state (docs/camp.md §3, §8.5, #614).
 *
 * Phase 1 of the camp stores nothing: no camp record, no catalog, no intent.
 * Everything the camp shows in the lobby is already in the state every screen
 * mirrors, and every moment it acts out is a *transition* of that state, the
 * way world/victory.ts reads a won fight off two states rather than adding a
 * presentation for it:
 *
 *   - a hero appears in `party`                      → `arrive`
 *   - their `ready` turns on, or off                 → `ready`, `unready`
 *   - their `connected` turns off (stepped away, #258) → `away`; back on → `arrive`
 *   - the phase leaves the lobby for a scene (Begin) → `setOff`
 *
 * Pure and Pixi-free, like cast.ts, so the mapping is a table of tests
 * (lobby-camp.test.ts) and the TV and a phone looking at the same lobby
 * cannot read it two ways.
 */

import type { CastStance, PartyMember, PhaseKind, RunState } from "@kad/shared";
import { characterWorldArtUrl } from "./art-paths";
import { camp as campManifest } from "../../../../assets/manifest.json";
import type { CampFigure } from "./camp";
import { CAMP_SEATS, campLayout, parseCampManifest, type CampLayout } from "./camp-layout";
import { NOMINAL_PAINT, figureSize } from "./figure-scale";
import { ANCHOR_Y } from "./art-paths";
import { campHeightPx, campMeasure } from "./camp-motion";

/** The terrain family the lobby pitches in, for everyone in Phase 1 (§10). */
export const LOBBY_CAMP_FAMILY = "open_plains";
/** Bedrolls round a small campfire (§4.1). */
export const LOBBY_CAMP_STAGE = 1;
/**
 * The plains biome's own background (biomeFamilies → open_plains), drawn in
 * the camp backdrop's place until its painting lands (#615).
 */
export const LOBBY_CAMP_STAND_IN = "biomes/plains/bg.webp";

/**
 * The lobby's camp layout, from assets/manifest.json → `camp`: the
 * `open_plains` backdrop at frame stage 1, for everyone in Phase 1 (§10).
 * Only the `camp` section is imported, so a bundle carries 4 KB of layout
 * rather than the whole manifest. Parsed once; a layout that fails to parse
 * is reported and leaves the lobby on the story stage as before, never blank.
 */
let parsedLayout: CampLayout | null | undefined;
export function lobbyCampLayout(): CampLayout | null {
  if (parsedLayout === undefined) {
    try {
      parsedLayout = campLayout(parseCampManifest(campManifest), LOBBY_CAMP_FAMILY, LOBBY_CAMP_STAGE);
    } catch (error) {
      globalThis.reportError?.(error);
      parsedLayout = null;
    }
  }
  return parsedLayout;
}

/**
 * Whether the shared screen shows the camp in this phase: the lobby, and
 * `creation`, which is the lobby too. The engine turns the lobby into
 * `creation` when the first hero is made and never turns it back
 * (engine.ts `doVoteCampaign`), so a camp keyed on `lobby` alone would vanish
 * the moment the first kid sat down. The same pair WorldView mounts
 * LobbyContent for, and a missing phase reads as the lobby, as WorldView's
 * own default does (PixiStage `nameplatesVisibleIn`).
 */
export function campShownIn(phase: PhaseKind | string | null | undefined): boolean {
  const resolved = phase ?? "lobby";
  return resolved === "lobby" || resolved === "creation";
}

/** Begin: the lobby gave way to the chapter's first scene. */
export function begun(before: PhaseKind | string | null | undefined, after: PhaseKind | string | null | undefined): boolean {
  return campShownIn(before) && (after === "scene" || after === "check" || after === "encounter");
}

/** A seated hero as the camp needs them: the figure, and the two facts its moments read. */
export interface CampHero {
  figure: CampFigure & { seat: number };
  ready: boolean;
  /** Stepped away (#258): `connected` is false. */
  away: boolean;
}

/**
 * Every seated hero, in seat order. A player still making their hero is not
 * in `party` and so is not drawn; one the host took out (#267) stays in
 * `party` but is not at the table, so is not drawn either.
 *
 * A hero's seat is their place in `party`, which is the order they sat down
 * and never changes while the room is open, so nobody's bedroll moves when
 * somebody else leaves. Past the camp's four bedrolls (a seat freed by a
 * removal and taken again) a hero takes the first bedroll nobody holds.
 */
export function campHeroes(state: Pick<RunState, "party" | "removed"> | null | undefined): CampHero[] {
  if (!state) return [];
  const removed = new Set(state.removed ?? []);
  const seated = state.party
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => !removed.has(member.playerId));
  const held = new Set(seated.map(({ index }) => index).filter((index) => index < CAMP_SEATS));
  const spare = Array.from({ length: CAMP_SEATS }, (_, seat) => seat).filter((seat) => !held.has(seat));
  return seated.map(({ member, index }) => ({
    figure: { ...heroFigure(member), seat: index < CAMP_SEATS ? index : spare.shift() ?? index },
    ready: member.ready,
    away: !member.connected,
  }));
}

/**
 * A hero's figure: the art, true height and stance the story lineup draws
 * them with (scene.ts), so the camp's unicorn is the lineup's unicorn.
 */
function heroFigure(member: PartyMember): Omit<CampFigure, "seat"> {
  const { character } = member;
  const size: { heightCm: number; stance: CastStance } = figureSize(`characters/${character.species}`);
  return {
    id: character.id,
    url: characterWorldArtUrl(character.species, character.tier, character.class),
    accent: character.appearance.accent,
    heightCm: size.heightCm,
    stance: size.stance,
  };
}

/** A hero in the still camp (StaticStage): their art's square canvas, placed in the backdrop. */
export interface StillCampFigure {
  id: string;
  url: string | null;
  /** Feet on the ground, as fractions of the backdrop canvas. */
  x: number;
  y: number;
  /** The art's square canvas, as a fraction of the backdrop canvas's height. */
  size: number;
  away: boolean;
}

/**
 * The camp as a still picture, for a screen with no WebGL (§8.7): every hero
 * at their own bedroll, at the size the moving camp draws them, faded if they
 * stepped away. Nobody walks and nobody queues: nothing is lost but movement.
 */
export function stillCampFigures(layout: CampLayout, heroes: readonly CampHero[]): StillCampFigure[] {
  const measure = campMeasure(layout.canvas.height);
  const out: StillCampFigure[] = [];
  for (const hero of heroes) {
    const bed = layout.frame.standPoints.find((point) => point.seat === hero.figure.seat);
    const lane = bed ? layout.lanes.get(bed.lane) : undefined;
    if (!bed || !lane) continue;
    // camp.ts `fitArt`: the canvas is drawn so the nominal paint is the figure's height.
    const heightPx = campHeightPx(hero.figure.heightCm, measure) * lane.scale;
    out.push({
      id: hero.figure.id,
      url: hero.figure.url,
      x: bed.x,
      y: lane.y,
      size: heightPx / (ANCHOR_Y - NOMINAL_PAINT.top) / layout.canvas.height,
      away: hero.away,
    });
  }
  return out;
}

/** One thing for the camp to act out. */
export type CampCue =
  | { kind: "arrive" | "ready" | "unready" | "away"; id: string }
  | { kind: "setOff" };

/**
 * The moments between two readings of the seated heroes.
 *
 * `before` null is a first look: a screen opening onto a lobby already under
 * way. Nobody "arrives" then (they are simply there, fading in at their
 * bedrolls), but whoever is away is shown away and whoever is ready stands in
 * the trailhead's line, so a TV refreshed mid-lobby tells the same story.
 *
 * A hero who stepped away is not lined up even if their ready flag is still
 * set (lobby-readiness.ts counts only the connected), and one who comes back
 * already ready walks home and then joins the line.
 */
export function campCues(before: readonly CampHero[] | null, after: readonly CampHero[]): CampCue[] {
  const cues: CampCue[] = [];
  const was = new Map((before ?? []).map((hero) => [hero.figure.id, hero]));
  for (const hero of after) {
    const id = hero.figure.id;
    const prior = was.get(id);
    if (before === null || !prior) {
      if (before !== null && !hero.away) cues.push({ kind: "arrive", id });
      if (hero.away) cues.push({ kind: "away", id });
      else if (hero.ready) cues.push({ kind: "ready", id });
      continue;
    }
    if (hero.away && !prior.away) {
      cues.push({ kind: "away", id });
      continue;
    }
    if (!hero.away && prior.away) {
      cues.push({ kind: "arrive", id });
      if (hero.ready) cues.push({ kind: "ready", id });
      continue;
    }
    if (hero.away) continue;
    if (hero.ready && !prior.ready) cues.push({ kind: "ready", id });
    if (!hero.ready && prior.ready) cues.push({ kind: "unready", id });
  }
  return cues;
}

/**
 * The downtime moment's seed (§8.5, §12.6), never the clock: the room, its
 * run, and which lobby visit this is. A chapter's trail (`visited`) is reset
 * when a chapter starts and kept through the lobby after it, so it tells one
 * visit from the next without anything new stored; before the first chapter
 * it is empty. Nothing the lobby changes while it is up (seats, ready, the
 * adventure vote) is in it, so the camp is not reshuffled by a tap, and the
 * TV and a phone's World pane read the same number.
 */
export function campSeed(state: Pick<RunState, "roomCode" | "runId" | "visited"> | null | undefined): number {
  if (!state) return 0;
  const trail = state.visited ?? [];
  return hash(`${state.roomCode}|${state.runId}|${trail.length}|${trail.at(-1) ?? ""}`);
}

/** FNV-1a: small, stable, and the same on every screen. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
