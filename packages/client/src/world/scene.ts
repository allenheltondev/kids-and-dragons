/**
 * The Pixi scene: a backdrop, the party standing in it — and, when a fight is
 * on, the combat board (world/board.ts) in its place.
 *
 * ---------------------------------------------------------------------------
 * Finished transparent illustrations share a subtle breath anchored at the
 * feet. Story and combat use the same art and preserve their own transitions.
 *
 * ---------------------------------------------------------------------------
 * ONE CAMERA (docs/briefs/combat-rendering.md, trap 1)
 *
 * world/camera.ts is the only camera. This module used to carry its own ad-hoc
 * `CameraState`/`resolveCamera` that fit the 1600×900 design rect and nothing
 * else; that is gone. Instead the scene owns a `camera.ts` state, feeds it the
 * viewport from `resize()`, and drives the stage transform from
 * `resolveCamera(state, viewport)` every tick — which is what makes the clamp,
 * the letterbox, the NaN laundering and the pinch/pan override one tested
 * behavior on the TV and on a phone pane alike.
 *
 * camera.ts thinks in *tiles*, so each of the two things it frames declares
 * its own tile size:
 *
 *   - the combat board is 10×8 real tiles (spec §7.1), drawn by board.ts at
 *     128 board-pixels per tile;
 *   - the story lineup is authored in a 1600×900 design rect, which the camera
 *     sees as a 16×9 board of 100-design-unit "tiles". Those tiles are only a
 *     unit of measure — nothing snaps to them — but they give `focusCamera`'s
 *     `"character"`/`"point"` arms real meaning and the empty focus ("frame
 *     everything") lands on exactly the contain-fit the old code hardcoded.
 *
 * A pinch or a drag on the canvas becomes `zoomBy`/`panBy`, and while the
 * override is live the auto-frame is not consulted — camera.ts's rules on what
 * releases it (a changed attention key, nothing else) apply verbatim; callers
 * hand the key in via `setCameraAttention`.
 * ---------------------------------------------------------------------------
 */

import { stanceIdle } from "./idle-motion";
import { Application, Assets, BufferImageSource, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { CastStance, PartyMember, Position, SceneRift } from "@kad/shared";
import { currentActorId } from "@kad/shared";
import {
  createCameraState,
  panBy,
  resolveCamera,
  setAttention,
  setFocus,
  zoomBy,
  type CameraState,
  type Viewport,
} from "./camera";
import { BOARD_TILE_PX, createBoardLayer, type BoardLayer, type BoardViewState } from "./board";
import {
  ANCHOR_X,
  ANCHOR_Y,
  BOB_RATE,
  CAMERA_RATE,
  DOWN_RATE,
  FADE_RATE,
  FALLEN_ALPHA,
  FALLEN_ROTATION,
  approach,
  biomeBackdropUrl,
  characterArtUrl,
  characterWorldArtUrl,
  drawContactShadow,
  drawPlaceholder,
  breathingShadowScale,
  groundedFootprint,
  measureFootprint,
  measurePaint,
  shadowOffset,
  type Footprint,
} from "./actor-art";
import { figureSize, fitCanvas, NOMINAL_PAINT, paintAspect, STANCE_LIFT, type Overflow, type PaintBox } from "./figure-scale";
import { sceneBackdropUrl } from "./art-paths";
import {
  RIFT_FOOT,
  RIFT_GLOW_COLOR,
  RIFT_DASHES,
  RIFT_HALO_LINE,
  RIFT_INK_COLOR,
  RIFT_MOTES,
  groundFade,
  HOLE_TEXTURE_HEIGHT,
  HOLE_TEXTURE_WIDTH,
  holeTexturePixels,
  riftPasses,
  riftPresence,
  riftStand,
  ringMarks,
  ringPoint,
  STILL_FRAME,
  TEAR_HALF_HEIGHT_PX,
  TEAR_HALF_WIDTH_PX,
  TEAR_MIDDLE_PX,
  type RiftPass,
} from "./scene-rift";
import { RIFT_SHEET, riftSheetUrl } from "../screens/riftlight";
import { isQuiet, QUIET_FLASH_SCALE } from "../quiet";
import { focusHolds, type FocusHold } from "./attention";
import {
  advanceShake,
  impactBeats,
  SHAKE_MAX_FRACTION,
  shakeOffset,
  joltStrength,
  startShake,
  type Shake,
} from "./shake";
import {
  createNameplate,
  fitNameplate,
  nameplateBoxOf,
  nameplateGap,
  nameplateLabel,
  type NameplateReading,
} from "./nameplate";
import type { EncounterEvent } from "@kad/shared";
import { stageLayout, STORY_MEASURE, type StageCastMember } from "./cast";
import { boardStageWidth, storyStageFrame } from "./stage-inset";
import { reducedMotion } from "../a11y/prefs";

export { characterArtUrl };

/**
 * How long the scene-step veil takes to lift after its window — after the
 * gated patch has applied, so the new scene is revealed rather than watched
 * arriving. Exported for the test that pins the swap stays covered.
 */
export const SCENE_STEP_TAIL_MS = 250;

/** How long the victory bloom lasts, and how bright it gets. */
export const VICTORY_MS = 900;
const VICTORY_PEAK = 0.5;

/** The story scene is authored at this size and framed into whatever pane it gets. */
const DESIGN = { width: 1600, height: 900 } as const;
/** One camera "tile" of story space, in design units. See the header. */
export const STORY_TILE = 100;
const STORY_BOARD = { width: DESIGN.width / STORY_TILE, height: DESIGN.height / STORY_TILE } as const;

/*
 * The floor sits low and the figures stand tall in the design rect because the
 * story camera frames only what is above the narration plate (setStageInset):
 * the rect is the stage, and the text has its own band beneath it. When the
 * floor was at 82% with a gradient of words over the bottom 60% of the pane,
 * the party stood behind the paragraph on every scene.
 */
const GROUND_Y = DESIGN.height * 0.88;
/** A character's drawn height in design units at zoom 1. */
const ACTOR_HEIGHT = DESIGN.height * 0.56;
/**
 * Where a backdrop's ground is, in its own design space. Every biome and scene
 * painting keeps its walkable floor in the band from ~70% down (asset-brief
 * §4.5), and 80% is the middle of it. `backdropFit` puts this line under the
 * figures' feet, wherever the stage has had to move them.
 */
export const BACKDROP_FLOOR = DESIGN.height * 0.8;
/** How far the painting runs under the narration plate before it ends. */
const BACKDROP_TAIL_PX = 48;

/**
 * Scale and place the backdrop so its floor meets the figures' feet.
 *
 * The story stage stands above the narration plate, which on a TV puts the
 * feet around half way down the pane. A painting simply covering the pane
 * keeps its floor at the bottom, under the words, and the party stands on its
 * rooftops and sky. So the painting follows the feet instead: scaled so it is
 * at least as wide as the pane and reaches above its top, and so it runs a
 * little way under the plate; whatever is below that is the plate's own dark.
 *
 * Pure, so the "nobody floats" rule is a test (scene.test.ts).
 */
export function backdropFit(
  pane: { width: number; height: number },
  feetY: number,
  stageBottom: number,
  bleed: number,
): { scale: number; x: number; y: number } {
  const cover = Math.max((pane.width + bleed * 2) / DESIGN.width, (pane.height + bleed * 2) / DESIGN.height);
  if (!(feetY > 0)) {
    return { scale: cover, x: (pane.width - DESIGN.width * cover) / 2, y: (pane.height - DESIGN.height * cover) / 2 };
  }
  const scale = Math.min(
    cover * 3,
    Math.max(
      (pane.width + bleed * 2) / DESIGN.width,
      (feetY + bleed) / BACKDROP_FLOOR,
      (stageBottom + BACKDROP_TAIL_PX - feetY) / (DESIGN.height - BACKDROP_FLOOR),
    ),
  );
  return { scale, x: (pane.width - DESIGN.width * scale) / 2, y: feetY - BACKDROP_FLOOR * scale };
}

/** How far off to the right a cast member starts their entrance. */
const CAST_ENTRY_OFFSET = DESIGN.width * 0.18;
/** Per-second approach rates for a cast entrance/exit and a hero turning. */
const CAST_ENTER_RATE = 5;
const TURN_RATE = 9;
/** The widest the lineup spreads on a wide pane, as a multiple of the design width. */
const MAX_STAGE_SPREAD = 1.6;
/** How much of a lineup slot a nameplate may fill — the rest is the gutter
    that keeps two names from running into each other. */
const NAMEPLATE_SLOT = 0.9;

export type FocusTarget =
  | { kind: "party" }
  | { kind: "character"; characterId: string }
  | { kind: "point"; x: number; y: number; zoom?: number };

export interface PartyScene {
  resize(width: number, height: number): void;
  setParty(members: readonly PartyMember[]): void;
  /**
   * Frame something. Unconditional on every surface (architecture §4.6 rule 3):
   * a 10×8 grid on a phone is unreadable at full extent, and
   * the TV gets the same camera for free. Combat drives this every turn; this
   * seam is for story callers (cutscenes, creation).
   */
  focusCamera(target: FocusTarget): void;
  /**
   * Put the combat board up (or take it down with null). While a view is set
   * the board owns the camera — it frames the active actor each turn — and the
   * story lineup is hidden; the party is on the grid, not in the wings.
   */
  setEncounter(view: BoardViewState | null): void;
  /** Feed a COMBAT_SEQUENCE's beats to the board (damage numbers, walks). */
  playCombatEvents(events: readonly EncounterEvent[], totalMs: number): void;
  /**
   * Jolt the stage — an impact landed (world/shake.ts). Strength 0..1;
   * suppressed entirely for a viewer who asked the OS for reduced motion,
   * because a shaking screen is exactly what that setting is for.
   */
  shake(strength: number): void;
  /**
   * The step between story scenes: a veil rises across `ms` — SCENE_ENTER's
   * hold, at whose end the gated patch applies — and lifts over a short tail
   * with the new scene already behind it, so moving reads as *going
   * somewhere* and the swap itself is never watched happening. Gentle enough
   * that a redundant call costs nothing but the dip.
   */
  playSceneStep(ms: number): void;
  /**
   * The victory flourish — a bloom of light over the scene the party is
   * walking into, roadmap chapter 8's "victory sequences". Deliberately not a
   * screen and not a pause: §7.3 makes a loss a story branch rather than a
   * failure, and the mirror of that is that a win is not a trophy ceremony
   * either. Suppressed under reduced motion, like the jolt.
   */
  playVictory(): void;
  /**
   * Where the story is happening (spec §6.2). The chapter's biome art replaces
   * the drawn stand-in behind the lineup. Optional scene art overrides it;
   * a missing illustration falls back to the biome. Null or a missing biome
   * leaves the stand-in in place. Repeating the same selection does not reload.
   */
  setBiome(biome: string | null, art?: string | null): void;
  /**
   * Whether the figures carry their names (world/nameplate.ts).
   *
   * On everywhere by default, and off for the one surface that already
   * answers the question: the lobby lists every player by name, level and
   * ready state in a card row directly above the lineup, so a nameplate there
   * is the same name twice — and the copy nobody needs is the one competing
   * with the art for the same band of screen. Driven by phase from PixiStage,
   * because which panel is up is the shell's fact and not the scene's.
   */
  setNameplatesVisible(visible: boolean): void;
  /**
   * Who is standing in the scene with the party (world/cast.ts). They walk in
   * from the right, the party turns to face them, and they leave the same way
   * when the story moves on without them. Keyed, so a character who stays
   * across scenes stays put. Empty clears the stage back to the party alone.
   */
  setCast(members: readonly StageCastMember[]): void;
  /**
   * The rift in plain view in this scene (world/scene-rift.ts), or null.
   * `key` names the scene, so an `"open"` or `"collapse"` plays once as the
   * scene opens and not again on a re-render; a new key replays it. The same
   * key with a different rift is not a re-render: the state can name a scene
   * before its chapter has loaded, which reads as no rift, and the real one
   * must still play when the chapter lands.
   */
  setRift(rift: SceneRift | null, key: string | null): void;
  /**
   * How many CSS px along the bottom of the pane the story text covers
   * (world/stage-inset.ts). The story camera frames the stage into the rest,
   * so nobody stands behind a paragraph. The fight board ignores it.
   */
  setStageInset(bottomPx: number): void;
  /** How far down the pane the narration's head reaches (#356): see stage-inset.ts `storyStageFrame`. */
  setStageInsetTop(topPx: number): void;
  /**
   * How many CSS px along the pane's end the shared screen's fight log covers
   * (world/stage-inset.ts). The fight camera frames the board into the rest,
   * so no monster stands under the log. The story ignores it.
   */
  setBoardInset(endPx: number): void;
  /**
   * The names currently drawn, as boxes in whichever space is on screen —
   * board pixels during a fight, design units otherwise.
   *
   * Nameplates live in a canvas, so nothing in the DOM knows they exist and
   * neither did any test: both defects this feature shipped with were found by
   * a human looking at a screenshot. This is the seam that makes them
   * assertable — see `e2e/nameplates.spec.ts`.
   */
  nameplateBoxes(): NameplateReading;
  /** Actual rendered figure bounds in canvas pixels, for phone framing checks. */
  storyFigureBoxes?(): { x: number; y: number; width: number; height: number }[];
  storyNameplateBoxes?(): { text: string; x: number; y: number; width: number; height: number; fontPixels: number }[];
  /**
   * Each figure on the story stage as drawn (#362), in canvas pixels: the box
   * its *paint* fills (not its canvas), the ground line under it, the top of
   * its name, and the height and stance it was drawn for. For
   * e2e/true-size.spec.ts; nothing at play reads it.
   */
  storyFigureReport?(): StoryFigureReading[];
  /**
   * The camera's attention key (world/camera.ts header): a manual pan/pinch
   * survives everything except this key changing — callers set it to
   * "who this device is being asked to act as", so the board comes back
   * exactly when a question needs answering and at no other time.
   */
  setCameraAttention(key: string): void;
  destroy(): void;
}

/**
 * What every figure on the story stage carries for true size and stance
 * (#362, figure-scale.ts). `height` is set by layout; the rest arrives with
 * the art, which is measured once it loads.
 */
export interface StoryFigureReading {
  name: string | null;
  hero: boolean;
  heightCm: number;
  stance: CastStance;
  /** The painted box, or null while the art is loading. */
  paint: { x: number; y: number; width: number; height: number } | null;
  /** Where the ground (or water) line is under this figure. */
  groundY: number;
  /** The top of its nameplate, or null for none. */
  labelTop: number | null;
  /** Which edge of the frame it runs off, if it is too big for it. */
  overflow: Overflow | null;
  /** Its drawn height over its natural one: the stage's scale `k` for anything neither floored nor capped. */
  scale: number;
}

interface StageFigureArt {
  container: Container;
  art: Container;
  label: Text | null;
  shadow: Graphics;
  heightCm: number;
  stance: CastStance;
  /** A hero is drawn against the nominal box, so tier growth shows. */
  hero: boolean;
  paint: PaintBox | null;
  /** The measured feet, with the paint moved onto the ground line. */
  footprint: Footprint | null;
  sprite: Sprite | null;
  /** Drawn painted height, in design units. Set by layout. */
  height: number;
  /** The canvas side that height comes to, and the one the shadow was drawn for. */
  canvas: number;
  shadowCanvas: number;
  /** How far right of the anchor the feet are, as drawn (facing left). The
      shadow follows `art.scale.x` across, so it stays under them on a turn. */
  shadowX: number;
  /** A swimmer's water line, and the mask that hides what is under it. */
  ripple: Graphics | null;
  mask: Graphics | null;
  /** The most its stance may lift it: a figure overflowing off the right is trimmed to fit the frame's height. */
  maxLift: number;
  /** Drawn with its paint's left edge on the container, not its middle: a figure overflowing the frame, anchored at its slot. */
  anchorLeft: boolean;
}

interface Actor extends StageFigureArt {
  characterId: string;
  /** Which asset this actor was built from. See `visualKeyOf`. */
  visualKey: string;
  /*
   * `label` is the name under their feet — who this is, when two players
   * picked the same species (nameplate.ts). Null for a name with nothing in
   * it. A sibling of `art` rather than a child: the art rotates and fades and
   * the label must not go with it.
   */
  /** What `label` is currently saying, so a renamed character is spotted
      without measuring a Text every patch. */
  labelText: string | null;
  phase: number;
  down: boolean;
  connected: boolean;
  /** Design-space position of the actor's feet: the slot `layoutActors`
      gives them. The container glides to it in tick(). */
  x: number;
  y: number;
  /** Whether the container has stood in a slot yet. A figure's first slot is
      taken at once; only a move between slots is walked. */
  placed: boolean;
  /* `shadow` is the contact shadow, a sibling of `art` so it neither turns
     nor falls. */
}

/** Somebody standing opposite the party (world/cast.ts). */
interface CastActor extends StageFigureArt {
  key: string;
  /** The manifest's word on how it overflows, if any (`FIGURE_OVERFLOW`). */
  overflow?: Overflow;
  /** Whether layout has it overflowing the frame this scene, and off which edge. */
  overflowing: Overflow | null;
  /** One of a group: laid out close together (see `stageSlots`). */
  crowded: boolean;
  /** For one of a group: 0 or 1, the odd ones standing a step back. */
  row: number;
  /** Where layout wants them, in design units. */
  x: number;
  /** 0 offstage → 1 in place. Eased by tick(). */
  presence: number;
  leaving: boolean;
  phase: number;
}

/**
 * Which *asset* an actor was built from — as opposed to `character.id`, the
 * identity it is *found* by.
 *
 * The two are not the same thing, and the difference is this chapter's whole
 * payoff: a character who levels into a new tier keeps her id and changes her
 * body. An actor rebuilt only when a new id appeared would have gone on
 * drawing the Fledgling figure for the rest of the session — the transformation
 * cutscene playing over a figure that visibly never transformed.
 *
 * Class matters only when it selects a delivered manifest.figureVariants illustration;
 * `characterWorldArtUrl` folds that exact distinction into the key without
 * rebuilding an undeclared class/species/tier combination onto the same base
 * illustration. Appearance is deliberately *not* in here. Nothing about a figure is drawn
 * from it any more — the runtime recolour is gone and every figure wears the
 * colours it was authored in (`nameplate.ts` explains why) — so folding it in
 * would throw a illustration away and reload an identical one because
 * somebody tapped a swatch that now only colours their UI chrome.
 *
 * Pure and exported so the rule is testable without a WebGL context, the same
 * way `storyFocusTiles` is.
 */
export function visualKeyOf(member: PartyMember): string {
  const { species, tier, class: characterClass } = member.character;
  return characterWorldArtUrl(species, tier, characterClass);
}

/**
 * The story-space focus tiles for a FocusTarget — pure, so the mapping from
 * "frame Sparklehoof" to camera.ts's tile vocabulary is testable without a
 * WebGL context. An empty list means "frame everything", which camera.ts
 * resolves to the whole design rect: the old party-lineup fit, by other means.
 */
export function storyFocusTiles(
  target: FocusTarget,
  actors: readonly { characterId: string; x: number; y: number }[],
): Position[] {
  const tileAt = (x: number, y: number): Position => ({
    x: Math.max(0, Math.min(STORY_BOARD.width - 1, Math.floor(x / STORY_TILE))),
    y: Math.max(0, Math.min(STORY_BOARD.height - 1, Math.floor(y / STORY_TILE))),
  });

  if (target.kind === "point") return [tileAt(target.x, target.y)];
  if (target.kind === "character") {
    const actor = actors.find((a) => a.characterId === target.characterId);
    if (!actor) return [];
    // Feet and head, so the frame holds the whole figure, not just its hooves.
    return [tileAt(actor.x, actor.y), tileAt(actor.x, actor.y - ACTOR_HEIGHT)];
  }
  return [];
}

export function createScene(app: Application): PartyScene {
  const stage = app.stage;

  const backdrop = new Container();
  /** The camera-driven subtree: story lineup in design units, board in board px. */
  const storyLayer = new Container();
  const boardWrap = new Container();
  boardWrap.visible = false;
  stage.addChild(backdrop, storyLayer, boardWrap);

  /** The plate's dark, under wherever the painting stops. */
  const backdropFloor = new Graphics();
  const backdropArt = drawBackdrop();
  backdrop.addChild(backdropFloor, backdropArt);
  /** The shake's overscan, kept from resize() for backdropFit. */
  let backdropBleed = 0;

  /** The selected backdrop URL, and the sprite drawing it. */
  let biomeId: string | null = null;
  let biomeSprite: Sprite | null = null;

  const actorsLayer = new Container();
  // Painter's order by zIndex, so the depth stagger in layoutActors() reads
  // right: the nearer (lower) actor draws in front, whatever order they joined.
  actorsLayer.sortableChildren = true;
  storyLayer.addChild(actorsLayer);

  const actors = new Map<string, Actor>();
  const castActors = new Map<string, CastActor>();

  /*
   * A scene's rift (#401): one sprite standing between the party and the
   * cast, stepping through the painted sheets that `riftPasses` lists. Behind
   * every figure, since it stands in the gap rather than in front of anyone.
   */
  const riftSprite = new Sprite();
  riftSprite.anchor.set(0.5, RIFT_FOOT);
  riftSprite.visible = false;
  riftSprite.label = "rift";
  // The painted slit is not drawn (scene-rift.ts): its frames only time the opening and the fold.
  riftSprite.alpha = 0;
  /*
   * Around the painted tear, the layers that make it easy to see and give it
   * presence (scene-rift.ts, "Making the tear easy to see"): a steady mist, a
   * deep hole with a lighter rim, and two rings turning opposite ways. All in
   * sheet-frame pixels around the tear's middle, sized each frame by
   * `riftPresence`; only the rings are redrawn as they turn.
   */
  const riftGlow = new Graphics();
  // Many faint rings rather than a few strong ones, so the mist has no visible edge.
  for (let ring = 16; ring >= 1; ring--) {
    const spread = 1 + ring * 0.05;
    riftGlow
      .ellipse(0, 0, TEAR_HALF_WIDTH_PX * spread, TEAR_HALF_HEIGHT_PX * spread)
      .fill({ color: RIFT_GLOW_COLOR, alpha: 0.065 });
  }
  // The painted inside (scene-rift.ts `holeTexturePixels`): deep, mottled and misty at the rim.
  const holeTexture = new Texture({
    source: new BufferImageSource({
      resource: holeTexturePixels(),
      width: HOLE_TEXTURE_WIDTH,
      height: HOLE_TEXTURE_HEIGHT,
      alphaMode: "no-premultiply-alpha",
    }),
  });
  const riftHole = new Sprite(holeTexture);
  riftHole.anchor.set(0.5);
  riftHole.width = TEAR_HALF_WIDTH_PX * 2;
  riftHole.height = TEAR_HALF_HEIGHT_PX * 2;
  const riftRings = new Graphics();
  /**
   * Redraw the rings where they stand now. Each dash is a tapered brushstroke,
   * thick in the middle and pointed at both ends, a pale core inside the warm
   * dark outline the figures wear, so it reads on bright and dark ground
   * alike; each mote a dot in the same two tones. Anything under the floor
   * line is not drawn (`groundFade`).
   */
  function drawRiftRings(seconds: number): void {
    const still = prefersReducedMotion();
    riftRings.clear();
    // The still line first, under the turning marks: an arch over the tear, faded into the ground.
    const lineSteps = 48;
    for (const [width, color, alpha] of [[3, RIFT_INK_COLOR, 0.32], [1.2, RIFT_GLOW_COLOR, 0.5]] as const) {
      let drawing = false;
      for (let i = 0; i <= lineSteps; i++) {
        const angle = (2 * Math.PI * i) / lineSteps;
        const point = { x: RIFT_HALO_LINE.rx * Math.cos(angle), y: RIFT_HALO_LINE.ry * Math.sin(angle) };
        if (groundFade(point.y) < 0.5) {
          if (drawing) riftRings.stroke({ width, color, alpha });
          drawing = false;
          continue;
        }
        if (drawing) riftRings.lineTo(point.x, point.y);
        else riftRings.moveTo(point.x, point.y);
        drawing = true;
      }
      if (drawing) riftRings.stroke({ width, color, alpha });
    }
    const steps = 8;
    for (const mark of ringMarks(RIFT_DASHES, seconds, still)) {
      const at = (i: number) => ringPoint(RIFT_DASHES, mark.from + ((mark.to - mark.from) * i) / steps, mark.reach);
      const middle = at(steps / 2);
      const fade = groundFade(middle.y);
      if (fade <= 0) continue;
      for (const [half, color, alpha] of [[3.4, RIFT_INK_COLOR, 0.75], [1.6, RIFT_GLOW_COLOR, 0.95]] as const) {
        // Out along one side and back along the other, widest at the middle.
        const left: number[] = [];
        const right: number[] = [];
        for (let i = 0; i <= steps; i++) {
          const point = at(i);
          const next = at(Math.min(steps, i + 1));
          const prev = at(Math.max(0, i - 1));
          const dx = next.x - prev.x;
          const dy = next.y - prev.y;
          const length = Math.hypot(dx, dy) || 1;
          const w = half * mark.width * (0.35 + 0.65 * Math.sin((Math.PI * i) / steps));
          left.push(point.x - (dy / length) * w, point.y + (dx / length) * w);
          right.unshift(point.x + (dy / length) * w, point.y - (dx / length) * w);
        }
        for (let i = 0; i < right.length; i += 2) left.push(right[i]!, right[i + 1]!);
        riftRings.poly(left).fill({ color, alpha: alpha * fade });
      }
    }
    for (const mark of ringMarks(RIFT_MOTES, seconds, still)) {
      const point = ringPoint(RIFT_MOTES, mark.from, mark.reach);
      const fade = groundFade(point.y);
      if (fade <= 0) continue;
      riftRings.circle(point.x, point.y, 3.3 * mark.width).fill({ color: RIFT_INK_COLOR, alpha: 0.75 * fade });
      riftRings.circle(point.x, point.y, 1.9 * mark.width).fill({ color: RIFT_GLOW_COLOR, alpha: 0.95 * fade });
    }
  }
  const riftPresenceLayer = new Container();
  riftPresenceLayer.position.set(0, -TEAR_MIDDLE_PX);
  riftPresenceLayer.addChild(riftGlow, riftRings, riftHole);
  /** The tear and what is behind it, standing on the floor line; scaled to the stage in layoutActors. */
  const riftGroup = new Container();
  riftGroup.zIndex = -1;
  riftGroup.visible = false;
  riftGroup.addChild(riftPresenceLayer, riftSprite);
  // On the stage only while a scene has a rift: an ordinary scene's tree is
  // the one it always was.
  let riftKey: string | null = null;
  /** The rift `riftKey` was last set with: a repeat is the same scene *and* the same rift. */
  let riftShown: SceneRift | null = null;
  let riftSequence: RiftPass[] = [];
  let riftPassAt = 0;
  /** When the current one-shot pass began, on `elapsed`. */
  let riftPassStart = 0;
  const riftSheets = new Map<string, Promise<Texture[] | null>>();
  const riftFrames = new Map<string, Texture[]>();

  function riftSheet(effect: string): Promise<Texture[] | null> {
    const cached = riftSheets.get(effect);
    if (cached) return cached;
    const task = Assets.load<Texture>(riftSheetUrl(effect))
      .then((sheet) => {
        const frames = Array.from(
          { length: RIFT_SHEET.frames },
          (_, i) =>
            new Texture({ source: sheet.source, frame: new Rectangle(i * RIFT_SHEET.size, 0, RIFT_SHEET.size, RIFT_SHEET.size) }),
        );
        riftFrames.set(effect, frames);
        return frames;
      })
      // A missing sheet leaves the scene without its rift, never without its scene.
      .catch(() => null);
    riftSheets.set(effect, task);
    return task;
  }

  /** Step the rift's sprite to this moment's frame, moving through its passes. */
  function tickRift(): void {
    const pass = riftSequence[riftPassAt];
    const frames = pass ? riftFrames.get(pass.effect) : undefined;
    if (!pass) {
      // Every pass played (a rift that folded away): off the stage.
      riftGroup.removeFromParent();
      return;
    }
    if (!frames) {
      riftGroup.visible = false;
      return;
    }
    let frame: number;
    if (pass.loop) {
      // Loops run on the stage's clock, so they never restart on a re-render.
      frame = prefersReducedMotion() ? STILL_FRAME : Math.floor(elapsed * RIFT_SHEET.fps) % RIFT_SHEET.frames;
    } else {
      frame = Math.floor((elapsed - riftPassStart) * RIFT_SHEET.fps);
      if (frame >= RIFT_SHEET.frames) {
        riftPassAt += 1;
        riftPassStart = elapsed;
        tickRift();
        return;
      }
    }
    riftSprite.texture = frames[frame] ?? frames[0]!;
    riftSprite.visible = true;
    const presence = riftPresence(pass, frame, RIFT_SHEET.frames);
    riftPresenceLayer.scale.set(presence.size);
    drawRiftRings(elapsed);
    riftGlow.alpha = presence.glow;
    riftHole.alpha = presence.hole;
    riftGroup.visible = true;
  }
  /** -1 = facing right, toward a cast on the right; 1 = as drawn. */
  let facing = 1;
  /**
   * CSS px of pane the narration plate covers. See setStageInset. The camera
   * frames against `insetBottom`, which eases toward `insetTarget` in tick():
   * a plate that grows a line because somebody leaned on a choice should not
   * kick the whole stage up by half a line in one frame.
   */
  let insetBottom = 0;
  let insetTarget = 0;
  /** The head's reach down the pane, eased the same way (#356). */
  let insetTop = 0;
  let insetTopTarget = 0;
  /** CSS px of pane end the fight log covers. See setBoardInset. */
  let boardInsetEnd = 0;
  let board: BoardLayer | null = null;
  let encounterView: BoardViewState | null = null;
  /**
   * Beats that arrived before the board did. ENCOUNTER_BEGAN can carry the
   * opening monster turns, and its *patch* — the one that puts `encounter` on
   * the state and therefore the board on this stage — is held until the beat
   * finishes (sync/channel.ts). Dropping them would eat the first round's
   * animation on every fight a monster wins initiative in.
   */
  let heldEvents: { events: readonly EncounterEvent[]; totalMs: number }[] = [];

  let destroyed = false;
  let elapsed = 0;

  /** The current jolt, if the stage is still ringing (world/shake.ts). */
  let shakeState: Shake | null = null;
  /**
   * Impacts waiting for their beat, on the same clock as `elapsed`. Scheduled
   * off the same `beatOffsetsMs` the board paces its damage numbers with, so
   * the flinch and the number land on the same frame — a jolt at a sequence's
   * head flinched during the walk-up and was still by the time the blow
   * played.
   */
  let pendingShakes: { at: number; strength: number }[] = [];
  /**
   * Who a beat is about, held in frame while it plays (world/attention.ts).
   * On the same clock as the jolts above, so the flinch, the damage number
   * and the frame all describe the same moment.
   */
  let pendingFocus: { at: number; until: number; actorIds: string[] }[] = [];

  /** The one gate every jolt passes: a viewer who asked the OS for reduced
      motion, or a quiet room (#260), gets none, scheduled or immediate alike. */
  function jolt(strength: number): void {
    shakeState = startShake(shakeState, joltStrength(strength, { reducedMotion: prefersReducedMotion(), quiet: isQuiet() }));
  }

  /** Hand a round to the board and put its impacts on the clock. */
  function dispatchCombat(events: readonly EncounterEvent[], totalMs: number): void {
    board?.playEvents(events, totalMs);
    for (const beat of impactBeats(events, totalMs)) {
      pendingShakes.push({ at: elapsed + beat.atMs / 1000, strength: beat.strength });
    }
    for (const hold of focusHolds(events, totalMs) as FocusHold[]) {
      pendingFocus.push({
        at: elapsed + hold.atMs / 1000,
        until: elapsed + hold.untilMs / 1000,
        actorIds: hold.actorIds,
      });
    }
  }

  /*
   * The scene-step dip: a full-pane veil over everything, driven by tick().
   * `stepAge < 0` means idle. Drawn once at viewport size in resize() —
   * a Graphics rect, so it weighs nothing while its alpha is 0.
   *
   * The profile is deliberately asymmetric around the thing it exists to
   * cover. SCENE_ENTER's *patch* — the new narration, the new state — is held
   * by the presentation gate and applies only when the hold elapses
   * (sync/channel.ts). A veil that rose and fell inside the hold would be
   * back at zero at exactly that moment, leaving the actual swap fully
   * visible. So the veil **rises across the hold** to peak as the patch
   * lands, then lifts over a short tail with the new scene already behind it.
   */
  const stepVeil = new Graphics();
  stepVeil.alpha = 0;
  stage.addChild(stepVeil);
  let stepAge = -1;
  let stepMs = 0;

  /** How deep the scene-step dip goes. A veil, not a blackout. */
  const STEP_DEPTH = 0.4;

  /*
   * The victory bloom: one warm radial flash over the whole pane, drawn at
   * resize like the veil and driven by the same clock. `victoryAge < 0` is
   * idle. A flash rather than a burst of particles because it has to read
   * across a room at 3 metres and cost nothing on a mini-PC (spec §1's TV).
   */
  const victoryGlow = new Graphics();
  victoryGlow.alpha = 0;
  stage.addChild(victoryGlow);
  let victoryAge = -1;
  /** The bloom's brightness for the bloom now playing: dimmer in a quiet room. */
  let victoryPeak = VICTORY_PEAK;

  /** See `setNameplatesVisible`. Applied to each label as it is laid out, so
      an actor built while the lobby is up is born hidden like the rest. */
  let nameplatesVisible = true;

  let viewport: Viewport = { width: DESIGN.width, height: DESIGN.height };
  let target: FocusTarget = { kind: "party" };
  let attention = "";

  // One camera. The state is swapped wholesale when the space changes —
  // a fresh fight (or leaving one) resets any pinch override along with the
  // board size, which is the right reading of "a new question takes the view".
  let camState: CameraState = createCameraState({ board: STORY_BOARD });
  /** Smoothed view, in tiles + px/tile. Null = snap to the next resolve. */
  let camNow: { x: number; y: number; scale: number } | null = null;

  function boardFocus(): Position[] {
    if (!encounterView) return [];
    const board = encounterView.encounter.board;
    const tiles: Position[] = [];

    const activeId = currentActorId(encounterView.encounter);
    const actor = activeId ? board.actors.find((a) => a.id === activeId) : null;
    if (actor) tiles.push({ x: actor.x, y: actor.y });

    /*
     * Whoever the beat now playing is about, alongside her. `setFocus` grows
     * the frame to hold every tile it is given, so a wisp hitting somebody
     * across the board pulls the target into shot for as long as the beat
     * lasts and no longer (world/attention.ts).
     */
    for (const hold of pendingFocus) {
      if (hold.at > elapsed) continue;
      for (const id of hold.actorIds) {
        const subject = board.actors.find((a) => a.id === id);
        if (subject) tiles.push({ x: subject.x, y: subject.y });
      }
    }
    return tiles;
  }

  /**
   * The rect the camera frames into. The board gets the pane left of the
   * fight log (the whole pane where there is none); the story gets the part
   * above the narration plate, so the figures stand clear of the words
   * instead of behind them.
   */
  function cameraViewport(): Viewport {
    if (encounterView !== null) return { width: boardStageWidth(viewport.width, boardInsetEnd), height: viewport.height };
    return { width: viewport.width, height: storyFrame().height };
  }

  /** Where the story frame sits in the pane: below the head's reach, if it reaches past the sky. */
  function storyFrame(): { top: number; height: number } {
    return storyStageFrame(viewport.width, viewport.height, insetBottom, insetTop);
  }

  /** How far down the pane the camera's frame starts: 0 for the board. */
  function frameTop(): number {
    return encounterView !== null ? 0 : storyFrame().top;
  }

  function applyCamera(dt: number): void {
    const inCombat = encounterView !== null;
    camState = setFocus(camState, inCombat ? boardFocus() : storyFocusTiles(target, [...actors.values()]));
    const frame = cameraViewport();
    const cam = resolveCamera(camState, frame);

    // A live gesture tracks the finger 1:1; only the auto-frame is eased.
    if (camNow === null || cam.manual) {
      camNow = { x: cam.centre.x, y: cam.centre.y, scale: cam.scale };
    } else {
      camNow = {
        x: approach(camNow.x, cam.centre.x, CAMERA_RATE, dt),
        y: approach(camNow.y, cam.centre.y, CAMERA_RATE, dt),
        scale: approach(camNow.scale, cam.scale, CAMERA_RATE, dt),
      };
    }

    const layer = inCombat ? boardWrap : storyLayer;
    const unit = inCombat ? BOARD_TILE_PX : STORY_TILE;
    // `screenPx = tile · scale + offset`, and the layer's own geometry is in
    // units of `unit` px per tile — so the container scale is scale/unit.
    layer.scale.set(camNow.scale / unit);
    layer.x = frame.width / 2 - camNow.x * camNow.scale;
    const shift = frameTop();
    layer.y = shift + frame.height / 2 - camNow.y * camNow.scale;

    storyLayer.visible = !inCombat;
    boardWrap.visible = inCombat;

    // The painting's floor under the figures' feet (backdropFit). In a fight
    // the board is the floor, and the painting just covers the pane.
    const feetY = inCombat ? 0 : layer.y + GROUND_Y * layer.scale.y;
    const fit = backdropFit(viewport, feetY, shift + frame.height, backdropBleed);
    backdropArt.scale.set(fit.scale);
    backdropArt.position.set(fit.x, fit.y);
  }

  /**
   * How much story space is in view across, in design units: the design rect
   * on a 16:9 pane, more on anything wider, capped so a very wide pane does
   * not scatter the party to its edges.
   */
  function stageWidth(): number {
    const frame = cameraViewport();
    if (!(frame.width > 0) || !(frame.height > 0)) return DESIGN.width;
    const contain = Math.min(frame.width / DESIGN.width, frame.height / DESIGN.height);
    return Math.max(DESIGN.width, Math.min(frame.width / contain, DESIGN.width * MAX_STAGE_SPREAD));
  }

  /**
   * The right edge of what the camera shows, in design units. Wider than the
   * layout's `stageWidth` on a very wide frame (a TV with the goal head and the
   * plate both up), where the spread is capped but the picture is not.
   */
  function visibleRightEdge(): number {
    const frame = cameraViewport();
    if (!(frame.width > 0) || !(frame.height > 0)) return DESIGN.width;
    const contain = Math.min(frame.width / DESIGN.width, frame.height / DESIGN.height);
    return DESIGN.width / 2 + frame.width / contain / 2;
  }

  function layoutActors(): void {
    const list = [...actors.values()];
    const cast = [...castActors.values()].filter((member) => !member.leaving);
    // Lay out across what the camera actually shows, not just the design
    // rect: a TV's stage above the plate is far wider than 16:9, and spending
    // that width on spacing is what keeps three heroes and a centaur from
    // standing in each other.
    const width = stageWidth();
    const left = (DESIGN.width - width) / 2;
    // True proportion (#362): everybody at their real height relative to one
    // another, shrunk together only when the tallest would leave the frame or
    // somebody would not fit their slot. A slot is only known here, because
    // it shrinks as the party grows.
    const fit = stageLayout(list, cast, width, viewport.width < 600);
    const slots = fit.slots;
    slots.party = slots.party.map((x) => x + left);
    slots.cast = slots.cast.map((x) => x + left);
    const rift = riftStand({ ...slots, castLeft: slots.castLeft.map((x) => x + left) }, left, width, fit.k);
    riftGroup.position.set(rift.x, GROUND_Y);
    // By scale, not width: the frames may not have loaded yet, and a width set
    // against the empty texture would be 256 times too big once they do.
    riftGroup.scale.set(rift.frame / RIFT_SHEET.size);
    // Heroes are drawn facing left; with company on the right they turn round.
    facing = cast.length > 0 ? -1 : 1;
    // A name may be no wider than the slot its character stands in, less a
    // gutter — two nameplates that touch are one unreadable name, which is the
    // failure the nameplate was added to fix. Names are no longer scaled with
    // the figures, so a mouse-sized guest's name reads as well as a troll's.
    // Wrapped names need a little extra gutter between their taller blocks.
    const nameplateSlot = viewport.width < 600 ? 0.82 : NAMEPLATE_SLOT;
    const slot = slots.partySlot * nameplateSlot;
    // The right edge of what the camera shows, in design units: an
    // overflowing figure's name is pinned inside it.
    const visibleRight = visibleRightEdge();
    // The right edge of the party's share of the stage: no overflowing guest stands over a hero.
    const partyEdge = slots.party.length > 0 ? Math.max(...slots.party) + slots.partySlot / 2 : left;
    cast.forEach((member, index) => {
      const way = fit.castOverflow[index] ?? null;
      member.overflowing = way;
      member.maxLift = fit.castMaxLift[index] ?? Infinity;
      // Too big for the frame (#366): anchored at the left of its slot, so it
      // runs off the top or the right and never back over the party.
      member.anchorLeft = way !== null;
      fitFigure(member, fit.cast[index] ?? member.height);
      const paintWidth = member.height * paintAspect(member.paint ?? NOMINAL_PAINT);
      if (way === "top") {
        // A tall one shows as much of its body as the frame allows: slid left
        // until its right edge meets the frame's, but never past the party.
        const slotLeft = slots.castLeft[index] ?? member.x;
        member.x = Math.min(slotLeft, Math.max(partyEdge, visibleRight - paintWidth));
      } else if (way === "right") {
        // A wide one runs off the right however wide the stage: anchored at
        // its slot, or further right, so at least WIDE_SPILL of it is past the edge.
        const slotLeft = slots.castLeft[index] ?? member.x;
        member.x = Math.max(slotLeft, visibleRight - paintWidth * (1 - WIDE_SPILL));
      } else {
        member.x = slots.cast[index] ?? member.x;
      }
      if (member.label) {
        member.label.visible = nameplatesVisible;
        if (way) {
          // Centred under the part of it that is on screen, and no wider.
          const shown = Math.max(0, Math.min(paintWidth, visibleRight - member.x));
          member.label.x = shown / 2;
          fitNameplate(member.label, Math.max(shown, slots.castSlots[index] ?? 0) * nameplateSlot, viewport.width < 600);
          // A long name under a narrow shown part still keeps inside the frame.
          const half = member.label.width / 2;
          member.label.x = Math.max(half, Math.min(member.label.x, visibleRight - member.x - half));
        } else {
          fitNameplate(member.label, (slots.castSlots[index] ?? slot) * nameplateSlot, viewport.width < 600);
          // A guest spilled off the right of a crowded stage keeps its name
          // in the frame: under what shows of it, or at the edge.
          const half = member.label.width / 2;
          member.label.x = Math.min(0, visibleRight - member.x - half);
        }
      }
    });
    const still = prefersReducedMotion();
    list.forEach((actor, index) => {
      fitFigure(actor, fit.party[index] ?? actor.height);
      if (actor.label) {
        actor.label.visible = nameplatesVisible;
        fitNameplate(actor.label, slot, viewport.width < 600);
      }
      actor.x = slots.party[index] ?? actor.x;
      // A shallow depth stagger so three characters read as a group rather than
      // a row of stickers. Allen's Chapter 2 lineup composition replaces this.
      actor.y = GROUND_Y + (index % 2 === 0 ? 0 : DESIGN.height * 0.03);
      // Somebody joining, a cast arriving or the plate changing height moves
      // every slot; tick() walks the figures there rather than teleporting
      // them. A figure new to the stage simply stands in its slot.
      if (!actor.placed || still) {
        actor.container.x = actor.x;
        actor.container.y = actor.y;
        actor.placed = true;
      }
      // Feet further down the screen = nearer the viewer = drawn in front.
      actor.container.zIndex = actor.y;
    });
  }

  function tick(): void {
    if (destroyed) return;
    const dt = app.ticker.deltaMS / 1000;
    elapsed += dt;

    // What the last frame cost, for whoever is measuring (see `onFrame`).
    // Nothing is listening unless somebody asked for `?perf`, so this is a
    // set-size check per frame in the ordinary case.
    if (frameListeners.size > 0) {
      for (const listener of frameListeners) listener(app.ticker.deltaMS);
    }

    // The plate's height, eased like the camera it feeds — and the lineup
    // re-spread across the frame as it goes, so the party drifts with it.
    if (insetBottom !== insetTarget) {
      insetBottom =
        Math.abs(insetTarget - insetBottom) < 0.5
          ? insetTarget
          : approach(insetBottom, insetTarget, CAMERA_RATE, dt);
      layoutActors();
    }
    if (insetTop !== insetTopTarget) {
      insetTop =
        Math.abs(insetTopTarget - insetTop) < 0.5
          ? insetTopTarget
          : approach(insetTop, insetTopTarget, CAMERA_RATE, dt);
      layoutActors();
    }

    applyCamera(dt);
    board?.tick(dt);
    tickRift();

    // Holds whose tail has passed. Dropped rather than kept so the frame
    // closes back onto the active actor instead of widening all round.
    pendingFocus = pendingFocus.filter((hold) => hold.until > elapsed);

    // Impacts whose beat has come. The queue is at most a round of events.
    for (let i = 0; i < pendingShakes.length; ) {
      const beat = pendingShakes[i];
      if (beat && beat.at <= elapsed) {
        pendingShakes.splice(i, 1);
        jolt(beat.strength);
      } else {
        i += 1;
      }
    }

    // The jolt rides the whole stage — backdrop, lineup and board move as one
    // piece, which is what makes it read as the *camera* flinching rather
    // than the world sliding. Applied after the camera so the two never
    // argue about who owns the layer transforms.
    shakeState = advanceShake(shakeState, dt);
    const displacement = shakeOffset(shakeState, viewport.height);
    stage.position.set(displacement.x, displacement.y);

    /*
     * The victory bloom: a fast arrival and a slower fall, so it lands like a
     * cheer rather than a fade. Sized well under a second — the next scene is
     * arriving underneath it and this must not be in the way of reading it.
     */
    if (victoryAge >= 0) {
      victoryAge += dt * 1000;
      if (victoryAge >= VICTORY_MS) {
        victoryAge = -1;
        victoryGlow.alpha = 0;
      } else {
        const t = victoryAge / VICTORY_MS;
        victoryGlow.alpha = victoryPeak * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
      }
    }

    // The scene-step veil: up across the hold, down across the tail — see the
    // declaration for why the peak sits at the hold's end, where the patch
    // lands. Past the whole window it parks at exactly 0.
    if (stepAge >= 0) {
      stepAge += dt * 1000;
      if (stepAge >= stepMs + SCENE_STEP_TAIL_MS) {
        stepAge = -1;
        stepVeil.alpha = 0;
      } else if (stepAge < stepMs) {
        stepVeil.alpha = STEP_DEPTH * (stepAge / stepMs);
      } else {
        stepVeil.alpha = STEP_DEPTH * (1 - (stepAge - stepMs) / SCENE_STEP_TAIL_MS);
      }
    }

    // The backdrop arrives over the stand-in rather than cutting to it: a
    // chapter's art can take a moment on a phone, and a hard swap under a party
    // that is already standing there reads as a glitch.
    if (biomeSprite !== null && biomeSprite.alpha < 1) {
      biomeSprite.alpha = approach(biomeSprite.alpha, 1, FADE_RATE, dt);
    }

    tickCast(dt);

    // No walk between slots for a viewer who asked for reduced motion — the
    // same rule tickCast keeps for an entrance.
    const still = prefersReducedMotion();
    for (const actor of actors.values()) {
      actor.container.x = still ? actor.x : approach(actor.container.x, actor.x, CAMERA_RATE, dt);
      actor.container.y = still ? actor.y : approach(actor.container.y, actor.y, CAMERA_RATE, dt);
      // Turning to face whoever is here: a quick squash through edge-on, which
      // reads as the figure turning round rather than flipping.
      actor.art.scale.x = approach(actor.art.scale.x, facing, TURN_RATE, dt);
      actor.shadow.x = actor.shadowX * actor.art.scale.x;
      if (actor.down) {
        // spec §7.3 — knocked down, never dead. They lie on the grid and wait
        // for someone to come get them.
        actor.art.rotation = approach(actor.art.rotation, FALLEN_ROTATION, DOWN_RATE, dt);
        actor.art.y = approach(actor.art.y, actor.canvas * 0.18, DOWN_RATE, dt);
        actor.art.x = approach(actor.art.x, 0, DOWN_RATE, dt);
        actor.art.scale.y = approach(actor.art.scale.y, 1, DOWN_RATE, dt);
        actor.shadow.scale.set(shadowScale(actor, 1));
        actor.art.alpha = approach(actor.art.alpha, FALLEN_ALPHA, DOWN_RATE, dt);
        continue;
      }
      // A standing hero breathes, not bobs: the art is anchored at the feet, so
      // a stretch on y swells the body and leaves the feet on their shadow.
      // Lifting the whole figure is what made the lineup look like it hovered.
      // Anything raised bobs or drifts instead (stanceIdle, #362).
      const idle = stanceIdle(actor.stance, elapsed, actor.phase, still);
      const reach = motionReach(actor.height);
      // Reduced motion holds the figure upright at once: an eased return from
      // the standing lean is still motion.
      actor.art.rotation = still ? idle.rotation : approach(actor.art.rotation, idle.rotation, BOB_RATE, dt);
      actor.art.y = approach(actor.art.y, restY(actor) + idle.dy * reach, DOWN_RATE, dt);
      actor.art.x = idle.dx * reach;
      actor.art.scale.y = 1 + idle.breath;
      // The shadow tightens as the body rises and spreads as it settles.
      actor.shadow.scale.set(shadowScale(actor, idle.shadow * breathingShadowScale(idle.breath)));
      if (actor.ripple) actor.ripple.scale.set(rippleWidth(actor) * idle.ripple / RIPPLE_UNIT);
      actor.art.alpha = approach(actor.art.alpha, actor.connected ? 1 : 0.5, FADE_RATE, dt);
    }
  }

  function tickCast(dt: number): void {
    const still = prefersReducedMotion();
    for (const member of [...castActors.values()]) {
      member.presence = approach(member.presence, member.leaving ? 0 : 1, CAST_ENTER_RATE, dt);
      if (member.leaving && member.presence < 0.02) {
        member.container.destroy({ children: true });
        castActors.delete(member.key);
        continue;
      }
      const away = 1 - member.presence;
      member.container.x = member.x + (still ? 0 : away * CAST_ENTRY_OFFSET);
      // A step further back reads as a huddle, not a row of stickers.
      const rowY = GROUND_Y - member.row * DESIGN.height * 0.025;
      member.container.y = rowY;
      // An overflowing figure stands behind everybody it runs past.
      // Among overlapping guests, the smaller stands in front.
      member.container.zIndex = rowY - (member.overflowing ? DESIGN.height : 1) - member.height / 10_000;
      member.art.alpha = member.presence;
      member.shadow.alpha = member.presence * STANCE_SHADOW[member.stance].alpha;
      if (member.ripple) member.ripple.alpha = member.presence;
      if (member.label) member.label.alpha = member.presence;
      {
        // Breathing about the feet, or bobbing, drifting or swimming by
        // stance — see the party's idle in tick().
        const idle = stanceIdle(member.stance, elapsed, member.phase, still);
        const reach = motionReach(member.height);
        member.art.y = restY(member) + idle.dy * reach;
        member.art.x = idle.dx * reach;
        member.art.rotation = idle.rotation;
        member.art.scale.y = 1 + idle.breath;
        member.shadow.scale.set(shadowScale(member, idle.shadow * breathingShadowScale(idle.breath)));
        if (member.ripple) member.ripple.scale.set(rippleWidth(member) * idle.ripple / RIPPLE_UNIT);
      }
    }
  }

  function makeCastActor(member: StageCastMember): CastActor {
    const container = new Container();
    const art = new Container();
    container.addChild(art);
    actorsLayer.addChild(container);
    // Until layout says otherwise: a person, standing, at natural size.
    const height = ACTOR_HEIGHT * NOMINAL_FILL;
    // Fitted to the feet once the art is here and can be measured; until
    // then, a modest one at the anchor (it fades in with the figure anyway).
    const shadow = drawContactShadow(ACTOR_HEIGHT, null, SCENE_SHADOW_SQUASH);
    container.addChildAt(shadow, 0);
    const label =
      member.name === null
        ? null
        : createNameplate(member.name, { typeHeight: ACTOR_HEIGHT, figureHeight: ACTOR_HEIGHT, maxWidth: ACTOR_HEIGHT });
    if (label) {
      label.visible = nameplatesVisible;
      container.addChild(label);
    }
    const actor: CastActor = {
      key: member.key,
      container,
      art,
      label,
      shadow,
      heightCm: member.heightCm,
      stance: member.stance,
      hero: false,
      paint: null,
      footprint: null,
      sprite: null,
      height,
      canvas: ACTOR_HEIGHT,
      shadowCanvas: ACTOR_HEIGHT,
      shadowX: 0,
      ripple: null,
      mask: null,
      maxLift: Infinity,
      anchorLeft: false,
      ...(member.overflow ? { overflow: member.overflow } : {}),
      overflowing: null,
      crowded: member.crowd !== undefined,
      row: (member.crowd?.index ?? 0) % 2,
      x: DESIGN.width,
      presence: 0,
      leaving: false,
      phase: Math.random() * Math.PI * 2,
    };
    applyStance(actor);
    container.x = DESIGN.width + CAST_ENTRY_OFFSET;
    container.y = GROUND_Y;
    art.alpha = 0;
    void Assets.load<Texture>(member.url)
      .then((texture) => {
        // Still the live entry for this key, even if mid-exit: setCast can
        // call a leaving member back (A → B → A), reviving this same actor,
        // and nothing would load its art a second time. A figure that does
        // finish leaving is deleted from the map before it is destroyed.
        if (destroyed || castActors.get(member.key) !== actor) return;
        const sprite = new Sprite(texture);
        sprite.anchor.set(ANCHOR_X, ANCHOR_Y);
        art.addChild(sprite);
        actor.sprite = sprite;
        // Every figure is drawn to the same 1024 canvas, so the painting is
        // measured and the canvas scaled to make *it* the right height.
        actor.paint = measurePaint(texture);
        actor.footprint = groundedFootprint(measureFootprint(texture), actor.paint);
        layoutActors();
        actor.shadow = refitShadow(container, actor.shadow, actor.canvas, actor.footprint);
        actor.shadowCanvas = actor.canvas;
      })
      .catch(() => {
        /* nobody there is better than a broken image; the validator guards the path */
      });
    return actor;
  }

  app.ticker.add(tick);

  // ---------------------------------------------------------------------------
  // Gestures — pinch-zoom and pan override the auto-frame (spec §2.2). All the
  // arithmetic is camera.ts's; this is only pointer bookkeeping. Attached to
  // the canvas, which sits behind every DOM overlay, so a drag on a panel is a
  // scroll and a drag on the world is a pan — no gesture arbitration needed.
  // ---------------------------------------------------------------------------

  const canvas = app.canvas;
  const pointers = new Map<number, { x: number; y: number }>();

  function localPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent): void {
    pointers.set(event.pointerId, localPoint(event));
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* a synthetic or already-released pointer; the gesture still works */
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = localPoint(event);

    if (pointers.size === 1) {
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      // A finger has to actually travel before a tap becomes a pan — an
      // override taken by a wobbly tap would then need explaining away.
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        camState = panBy(camState, cameraViewport(), { x: dx, y: dy });
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.entries()].map(([id, at]) =>
        id === event.pointerId ? point : at,
      );
      const [pa, pb] = [...pointers.values()];
      if (a && b && pa && pb) {
        const before = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const after = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const midBefore = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        if (before > 0 && after > 0) {
          camState = zoomBy(camState, cameraViewport(), after / before, mid);
        }
        camState = panBy(camState, cameraViewport(), { x: mid.x - midBefore.x, y: mid.y - midBefore.y });
      }
    }

    pointers.set(event.pointerId, point);
  }

  function onPointerEnd(event: PointerEvent): void {
    pointers.delete(event.pointerId);
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    camState = zoomBy(camState, cameraViewport(), Math.exp(-event.deltaY * 0.0015), localPoint(event));
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  function removeGestures(): void {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerEnd);
    canvas.removeEventListener("pointercancel", onPointerEnd);
    canvas.removeEventListener("wheel", onWheel);
  }

  // ---------------------------------------------------------------------------

  /**
   * Put a (possibly new, possibly now-empty) name under a figure that is
   * staying. Cheap on the common path — every patch carries a name and almost
   * none of them changed it — and the width is left to `layoutActors`, which
   * runs at the end of the same `setParty`.
   */
  function setLabel(actor: Actor, name: string): void {
    const next = nameplateLabel(name);
    if (next === actor.labelText) return;
    actor.labelText = next;

    if (next === null) {
      actor.label?.destroy();
      actor.label = null;
      return;
    }
    if (actor.label) {
      actor.label.text = next;
      return;
    }
    // Named for the first time — a save from before names were required.
    actor.label = createNameplate(next, {
      typeHeight: ACTOR_HEIGHT,
      figureHeight: ACTOR_HEIGHT,
      maxWidth: ACTOR_HEIGHT,
    });
    if (actor.label) actor.container.addChild(actor.label);
  }

  function makeActor(member: PartyMember): Actor {
    const container = new Container();
    const art = new Container();
    container.addChild(art);
    actorsLayer.addChild(container);

    // Feet on the ground: a soft contact shadow, outside `art` so it neither
    // turns with the figure nor tips over when they are knocked down.
    const shadow = drawContactShadow(ACTOR_HEIGHT, null, SCENE_SHADOW_SQUASH);
    container.addChildAt(shadow, 0);

    const placeholder = drawPlaceholder(ACTOR_HEIGHT);
    art.addChild(placeholder);

    const { species, tier, id, name, class: characterClass } = member.character;
    // Fitted to the lineup's real spacing by `layoutActors`, which is the only
    // thing that knows how much room a figure has — and knows it only once the
    // party size is settled, which is after this runs.
    const label = createNameplate(name, {
      typeHeight: ACTOR_HEIGHT,
      figureHeight: ACTOR_HEIGHT,
      maxWidth: ACTOR_HEIGHT,
    });
    if (label) container.addChild(label);

    // A hero's true height is their species' (#362): the party line shows a
    // kitsune and a bigfoot as differently sized as they are.
    const size = figureSize(`characters/${species}`);
    const actor: Actor = {
      container,
      art,
      characterId: id,
      visualKey: visualKeyOf(member),
      label,
      labelText: nameplateLabel(name),
      phase: Math.random() * Math.PI * 2,
      down: member.down,
      connected: member.connected,
      x: 0,
      y: GROUND_Y,
      placed: false,

      shadow,
      shadowX: 0,
      heightCm: size.heightCm,
      stance: size.stance,
      hero: true,
      paint: null,
      footprint: null,
      sprite: null,
      height: ACTOR_HEIGHT * NOMINAL_FILL,
      canvas: ACTOR_HEIGHT,
      shadowCanvas: ACTOR_HEIGHT,
      ripple: null,
      mask: null,
      maxLift: Infinity,
      anchorLeft: false,
    };
    applyStance(actor);

    /*
     * Always try to load; the placeholder is the fallback. There used to be a
     * hardcoded list of "species Allen has delivered" here, which is a fact
     * about the repo that goes stale the moment art lands — and it did, the
     * day all six species were approved. Asking for the file and keeping the
     * placeholder when it isn't there cannot go stale.
     */
    const loadPng = (): void => {
      void Assets.load<Texture>(characterWorldArtUrl(species, tier, characterClass))
        .then((texture) => {
          // Identity, not id: a character who left and rejoined mid-load has a
          // *new* actor under the same id, and this stale resolve would draw
          // into containers that were destroyed with the old one.
          if (destroyed || actors.get(id) !== actor) return;
          const sprite = new Sprite(texture);
          sprite.anchor.set(ANCHOR_X, ANCHOR_Y);
          art.removeChildren();
          placeholder.destroy();
          art.addChild(sprite);
          actor.sprite = sprite;
          actor.paint = measurePaint(texture);
          actor.footprint = groundedFootprint(measureFootprint(texture), actor.paint);
          // The measured width changes how much room this hero needs.
          layoutActors();
          actor.shadow = refitShadow(container, actor.shadow, actor.canvas, actor.footprint);
          actor.shadowCanvas = actor.canvas;
        })
        .catch(() => {
          /* keep the placeholder: a missing tier must never blank the stage */
        });
    };

    loadPng();

    return actor;
  }

  return {
    resize(width, height) {
      // A ResizeObserver callback can land after teardown — strict mode's
      // mount/unmount/remount does it on every save. Pixi nulls a destroyed
      // object's transform, so touching `scale` here would throw.
      if (destroyed) return;
      /*
       * A new pane is a cut, not a camera move. The ease below only advances on
       * ticks, and a phone stops ticking while its World tab is hidden, so an
       * eased resize opened the tab on the last frame's framing (at first, the
       * 1600×900 default: four times too close on a 390px phone) and zoomed
       * out over the next second, cropping the party at the edges until it
       * settled. Snap instead.
       */
      if (width !== viewport.width || height !== viewport.height) camNow = null;
      viewport = { width, height };
      /*
       * Cover the pane with the *design rect*, not with the backdrop's bounds.
       * The drawn stand-in's ellipses deliberately bleed past the rect (they are
       * atmosphere, not geometry), so measuring `backdropArt.width` centres the
       * bleed instead of the picture — which with a real biome backdrop in there
       * showed up as a 200px band of nothing down one side of a 1280px TV.
       */
      /*
       * Overscanned by the shake's maximum displacement. The jolt translates
       * the whole stage, and a backdrop that fits the pane exactly — which is
       * what plain cover produces on a pane with the design rect's own 16:9 —
       * exposes a bare strip of the DOM surface along the trailing edge on
       * every nonzero offset. Bleeding the cover by one jolt's worth on each
       * side means the stage can move that far in any direction and still be
       * showing backdrop.
       */
      backdropBleed = Math.ceil(height * SHAKE_MAX_FRACTION) + 2;
      const bleed = backdropBleed;
      backdropFloor
        .clear()
        .rect(-bleed, -bleed, width + bleed * 2, height + bleed * 2)
        .fill({ color: 0x0d0b1a });
      // The veil covers the pane, whatever the pane is right now. A margin of
      // one shake's amplitude so a jolt mid-step never shows a bright edge.
      stepVeil.clear().rect(-32, -32, width + 64, height + 64).fill({ color: 0x0a0820 });
      // Warm, centred, and wider than the pane so its falloff is off-screen
      // rather than a visible disc edge.
      victoryGlow
        .clear()
        .ellipse(width / 2, height / 2, width * 0.8, height * 0.8)
        .fill({ color: 0xffd98a });
      layoutActors();
      applyCamera(0);
    },

    setParty(members) {
      if (destroyed) return;
      const seen = new Set<string>();

      for (const member of members) {
        const id = member.character.id;
        seen.add(id);
        const existing = actors.get(id);
        if (existing && existing.visualKey === visualKeyOf(member)) {
          existing.down = member.down;
          existing.connected = member.connected;
          // A rename is a label edit, not a reload — the same "write, don't
          // rebuild" split `visualKeyOf` makes for everything else that
          // arrives on a patch.
          setLabel(existing, member.character.name);
          continue;
        }
        if (existing) {
          // A tier or class illustration changed; rebuild its sprite.

          existing.container.destroy({ children: true });
          actors.delete(id);
        }
        actors.set(id, makeActor(member));
      }

      for (const [id, actor] of [...actors.entries()]) {
        if (seen.has(id)) continue;
        actor.container.destroy({ children: true });
        actors.delete(id);
      }

      layoutActors();
    },

    setRift(rift, key) {
      if (destroyed || (key === riftKey && rift === riftShown)) return;
      riftKey = key;
      riftShown = rift;
      riftSequence = riftPasses(rift, prefersReducedMotion());
      riftPassAt = 0;
      riftPassStart = elapsed;
      riftGroup.visible = false;
      if (riftSequence.length === 0) riftGroup.removeFromParent();
      else if (!riftGroup.parent) actorsLayer.addChild(riftGroup);
      // The first pass waits for its sheet; tickRift starts it the frame it lands.
      for (const pass of riftSequence) {
        void riftSheet(pass.effect).then(() => {
          if (riftKey === key && riftSequence[riftPassAt]?.effect === pass.effect) riftPassStart = elapsed;
        });
      }
    },

    setCast(members) {
      if (destroyed) return;
      const wanted = new Set(members.map((member) => member.key));
      for (const member of castActors.values()) {
        if (!wanted.has(member.key)) member.leaving = true;
      }
      for (const member of members) {
        const existing = castActors.get(member.key);
        if (existing) {
          // The first of a group shares its key with the lone figure, so the
          // same actor can be a group of three in one scene and alone in the
          // next: the crowd is the scene's to say, not the actor's to keep.
          existing.crowded = member.crowd !== undefined;
          existing.row = (member.crowd?.index ?? 0) % 2;
          // So is how big they are and how they stand: a chapter may land a
          // griffin in one scene that flew in the last (#362).
          existing.heightCm = member.heightCm;
          existing.overflow = member.overflow;
          if (existing.stance !== member.stance) {
            existing.stance = member.stance;
            applyStance(existing);
          }
          // Called back before they had finished leaving: turn round, no reload.
          existing.leaving = false;
          continue;
        }
        castActors.set(member.key, makeCastActor(member));
      }
      // Keep the authored order for those staying, so layout reads left→right
      // as the chapter wrote it.
      const order = members.map((member) => member.key);
      const sorted = [...castActors.entries()].sort(
        ([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
      );
      castActors.clear();
      for (const [key, value] of sorted) castActors.set(key, value);
      layoutActors();
    },

    setStageInset(bottomPx) {
      if (destroyed) return;
      insetTarget = Math.max(0, bottomPx);
      /*
       * A plate arriving or going (the first scene, a fight starting or
       * ending), or a camera that has not framed anything yet, is a cut and
       * takes effect at once — nobody should watch the party glide up from
       * the bottom of the pane on first paint. Only a plate that is already
       * up changing height is eased, in tick().
       */
      if (camNow === null || insetBottom === 0 || insetTarget === 0) {
        insetBottom = insetTarget;
        camNow = null;
        layoutActors();
        applyCamera(0);
      }
    },

    setStageInsetTop(topPx) {
      if (destroyed) return;
      insetTopTarget = Math.max(0, topPx);
      // Like the plate: the first report, or a camera that has framed nothing yet, is a cut.
      if (camNow === null || insetTop === 0 || insetTopTarget === 0) {
        insetTop = insetTopTarget;
        camNow = null;
        layoutActors();
        applyCamera(0);
      }
    },

    setBoardInset(endPx) {
      if (destroyed) return;
      const next = Math.max(0, endPx);
      if (next === boardInsetEnd) return;
      // A cut, like a plate arriving: the log comes up with the fight.
      boardInsetEnd = next;
      camNow = null;
      applyCamera(0);
    },

    focusCamera(next) {
      target = next;
    },

    setNameplatesVisible(visible) {
      if (destroyed || visible === nameplatesVisible) return;
      nameplatesVisible = visible;
      for (const actor of actors.values()) {
        if (actor.label) actor.label.visible = visible;
      }
      for (const member of castActors.values()) {
        if (member.label) member.label.visible = visible;
      }
    },

    nameplateBoxes() {
      // Whatever is actually on screen, *and which stage that is*. During a
      // fight the lineup is hidden and the board owns the figures, so
      // reporting the lineup's labels would be reporting a stage nobody is
      // looking at — and reporting them without saying so is worse, because
      // the two are the same shape and a caller cannot tell them apart.
      if (encounterView !== null && board) {
        return { space: "board" as const, boxes: board.nameplateBoxes() };
      }
      const boxes = [...actors.values()]
        .filter((actor) => actor.label !== null && actor.label.visible)
        .map((actor) => {
          // Lineup labels are children of their actor, so their own x/y is
          // relative to its feet. Lift both into design space, or every box
          // comes back centred on zero and nothing can be compared. The slot,
          // not the figure mid-walk to it — the same as the cast below.
          const box = nameplateBoxOf(actor.label!);
          const scale = actor.container.scale.x;
          return { ...box, x: actor.x + box.x * scale, y: actor.y + box.y * scale,
            width: box.width * scale, height: box.height * scale };
        });
      for (const member of castActors.values()) {
        if (member.leaving || member.label === null || !member.label.visible) continue;
        const box = nameplateBoxOf(member.label);
        const scale = member.container.scale.x;
        boxes.push({ ...box, x: member.x + box.x * scale, y: GROUND_Y + box.y * scale,
          width: box.width * scale, height: box.height * scale });
      }
      return { space: "story" as const, boxes };
    },

    storyFigureBoxes() {
      if (encounterView !== null) return [];
      return [...actors.values(), ...castActors.values()].map((actor) => {
        const bounds = actor.art.getBounds();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      });
    },

    storyNameplateBoxes() {
      if (encounterView !== null) return [];
      return [...actors.values(), ...castActors.values()].flatMap((actor) => {
        if (!actor.label?.visible) return [];
        const b = actor.label.getBounds();
        return [{ text: actor.label.text, x: b.x + b.width / 2, y: b.y, width: b.width, height: b.height,
          fontPixels: Number(actor.label.style.fontSize) * Math.abs(actor.label.worldTransform.d) }];
      });
    },

    storyFigureReport() {
      if (encounterView !== null) return [];
      const figures: StageFigureArt[] = [...actors.values(), ...[...castActors.values()].filter((m) => !m.leaving)];
      return figures.map((figure) => {
        let paint: StoryFigureReading["paint"] = null;
        if (figure.sprite) {
          const b = figure.sprite.getBounds();
          const box = figure.paint ?? NOMINAL_PAINT;
          paint = { x: b.x + box.left * b.width, y: b.y + box.top * b.height,
            width: (box.right - box.left) * b.width, height: (box.bottom - box.top) * b.height };
        }
        return {
          name: figure.label?.text ?? null,
          hero: figure.hero,
          heightCm: figure.heightCm,
          stance: figure.stance,
          paint,
          groundY: figure.container.toGlobal({ x: 0, y: 0 }).y,
          labelTop: figure.label?.visible ? figure.label.getBounds().y : null,
          overflow: "overflowing" in figure ? (figure as CastActor).overflowing : null,
          scale: figure.height / (figure.heightCm * STORY_MEASURE.pxPerCm),
        };
      });
    },

    setBiome(next, art) {
      const fallback = next === null ? null : biomeBackdropUrl(next);
      const wanted = (art ? sceneBackdropUrl(art) : null) ?? fallback;
      if (destroyed || wanted === biomeId) return;
      biomeId = wanted;
      // A new place: take the old art down immediately. The drawn stand-in is
      // underneath it, so the gap while the next one loads is never a blank
      // screen — and staying in the last chapter's woods would be worse.
      biomeSprite?.destroy();
      biomeSprite = null;
      if (wanted === null) return;

      void Assets.load<Texture>(wanted)
        .catch((error: unknown) => {
          // A missing illustration returns to the chapter's environment.
          if (destroyed || biomeId !== wanted || fallback === null || wanted === fallback) {
            throw error;
          }
          return Assets.load<Texture>(fallback);
        })
        .then((texture) => {
          // The chapter may have moved on (or the stage gone) while it loaded.
          if (destroyed || biomeId !== wanted) return;
          const sprite = new Sprite(texture);
          /*
           * Cover the design rect, then centre in it. Backdrops are authored
           * 1920×1080 (asset-brief §4.5) — the rect's own 16:9 — so for every
           * committed biome this is an exact fit; a differently-shaped one
           * fills the rect and loses its edges rather than letterboxing.
           */
          sprite.scale.set(
            Math.max(DESIGN.width / texture.width, DESIGN.height / texture.height),
          );
          sprite.x = (DESIGN.width - sprite.width) / 2;
          sprite.y = (DESIGN.height - sprite.height) / 2;
          sprite.alpha = 0; // faded up by tick()
          biomeSprite = sprite;
          backdropArt.addChild(sprite);
        })
        .catch(() => {
          /* keep the drawn stand-in: a missing backdrop must never blank the
             stage, exactly like a missing tier PNG */
        });
    },

    setEncounter(view) {
      if (destroyed) return;
      const wasCombat = encounterView !== null;
      encounterView = view;

      if (view && !wasCombat) {
        board ??= createBoardLayer();
        if (board.container.parent !== boardWrap) boardWrap.addChild(board.container);
        // A fresh camera for a different space: the board's real tile grid,
        // and any story-space pinch left behind is not a fact about this fight.
        camState = createCameraState({
          board: { width: view.encounter.board.width, height: view.encounter.board.height },
          attention,
          wholeWhenRoomy: true,
        });
        camNow = null; // the ENCOUNTER_BEGAN beat covers the cut
      }
      if (!view && wasCombat) {
        camState = createCameraState({ board: STORY_BOARD, attention });
        camNow = null;
        heldEvents = [];
        // Impacts scheduled for a fight that is over would land on the
        // lineup — cleared for the same reason heldEvents is, and the frame
        // holds with them.
        pendingShakes = [];
        pendingFocus = [];
      }
      if (view) {
        board?.update(view);
        for (const held of heldEvents.splice(0)) {
          dispatchCombat(held.events, held.totalMs);
        }
      }
    },

    playCombatEvents(events, totalMs) {
      if (encounterView === null) {
        heldEvents.push({ events, totalMs });
        return;
      }
      dispatchCombat(events, totalMs);
    },

    shake(strength) {
      if (destroyed) return;
      jolt(strength);
    },

    playVictory() {
      if (destroyed || prefersReducedMotion()) return;
      victoryAge = 0;
      victoryPeak = isQuiet() ? VICTORY_PEAK * QUIET_FLASH_SCALE : VICTORY_PEAK;
    },

    playSceneStep(ms) {
      if (destroyed || ms <= 0) return;
      // Reduced motion keeps the veil: it is a crossfade, not motion — the
      // thing that setting asks to be spared is the shake above.
      stepAge = 0;
      stepMs = ms;
    },

    setCameraAttention(key) {
      attention = key;
      camState = setAttention(camState, key);
    },

    destroy() {
      destroyed = true;
      app.ticker.remove(tick);
      removeGestures();
      // Leave the stage where the next scene expects to find it — a stage
      // torn down mid-jolt must not bequeath its displacement.
      stage.position.set(0, 0);
      stepVeil.destroy();
      victoryGlow.destroy();
      for (const actor of actors.values()) {
        actor.container.destroy({ children: true });
      }
      actors.clear();
      riftGroup.destroy({ children: true });
      // The scene's own picture, not a loaded asset: freed with the scene.
      if (!holeTexture.destroyed) holeTexture.destroy(true);
      castActors.clear();
      board?.destroy();
      board = null;
      backdrop.destroy({ children: true });
      storyLayer.destroy({ children: true });
      boardWrap.destroy({ children: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Placeholder art
// ---------------------------------------------------------------------------

/**
 * Bramblewood backdrop art is Allen's Chapter 2 deliverable. This stands in:
 * flat bands in the global palette from assets/manifest.json, sized to the
 * design space so swapping in a real texture is a one-line change.
 */
/** How deep the lineup's ground shadows are for their width: the story
    camera looks along the ground, so they are flatter than the board's. */
const SCENE_SHADOW_SQUASH = 0.2;

/** How much of its canvas a figure's paint fills before it is measured (figure-scale.ts NOMINAL_PAINT). */
const NOMINAL_FILL = NOMINAL_PAINT.bottom - NOMINAL_PAINT.top;

/** The drop from a figure's lowest point to the top of its name: one number for every figure, since names no longer scale with them. */
const NAME_GAP = nameplateGap(ACTOR_HEIGHT);

/**
 * The shadow a stance casts (#362): a contact shadow for anything on the
 * ground, a smaller and fainter one for anything in the air (the higher, the
 * smaller), and none for a swimmer, whose water line is its contact.
 */
const STANCE_SHADOW: Readonly<Record<CastStance, { size: number; alpha: number }>> = {
  standing: { size: 1, alpha: 1 },
  hovering: { size: 0.6, alpha: 0.55 },
  flying: { size: 0.45, alpha: 0.4 },
  swimming: { size: 0, alpha: 0 },
};

/** Idle travel is a fraction of the figure, but never less than of a small one's: a wisp's bob must still show. */
function motionReach(height: number): number {
  return Math.max(height, 160);
}

/** Where the art rests above (or, for a swimmer, below) the ground line. */
function restY(figure: StageFigureArt): number {
  const lift = STANCE_LIFT[figure.stance] * figure.height;
  return -(lift > 0 ? Math.min(lift, figure.maxLift) : lift);
}

function shadowScale(figure: StageFigureArt, idle: number): number {
  return (figure.canvas / figure.shadowCanvas) * STANCE_SHADOW[figure.stance].size * idle;
}

/** The least share of a figure overflowing off the right that is past the frame's edge: it reads as running off, not as fitting. */
const WIDE_SPILL = 0.3;

/** The ripple is drawn this wide and scaled to the swimmer. */
const RIPPLE_UNIT = 100;

function rippleWidth(figure: StageFigureArt): number {
  const paint = figure.paint ?? NOMINAL_PAINT;
  return (figure.height * (paint.right - paint.left)) / (paint.bottom - paint.top) * 0.42;
}

/** A soft pool of water where the swimmer meets the line, and two thin rings on it. */
function drawRipple(): Graphics {
  const g = new Graphics();
  g.ellipse(0, 0, RIPPLE_UNIT * 1.05, RIPPLE_UNIT * 0.14).fill({ color: 0x7fc4e8, alpha: 0.22 });
  g.ellipse(0, 0, RIPPLE_UNIT * 0.9, RIPPLE_UNIT * 0.1).stroke({ width: 2.5, color: 0xe2f5ff, alpha: 0.45 });
  g.ellipse(0, RIPPLE_UNIT * 0.03, RIPPLE_UNIT * 0.6, RIPPLE_UNIT * 0.06).stroke({ width: 2, color: 0xe2f5ff, alpha: 0.3 });
  return g;
}

/**
 * Size a figure's art to `height` (its painted height, design units): the
 * canvas scaled so the paint is that tall and its lowest row on the ground
 * line, the shadow slid under the feet, and the name under the figure. A
 * raised figure's name goes with it, under its body rather than on the empty
 * ground below; a swimmer's sits under the water line.
 */
function fitFigure(figure: StageFigureArt, height: number): void {
  figure.height = height;
  const fit = fitCanvas(height, figure.paint, figure.hero ? NOMINAL_PAINT : figure.paint);
  figure.canvas = fit.canvas;
  for (const child of figure.art.children) {
    if (child === figure.sprite) continue;
    // The "art pending" stand-in, drawn a canvas of ACTOR_HEIGHT tall.
    child.scale.set(fit.canvas / ACTOR_HEIGHT);
  }
  // Left-anchored: the paint's left edge on the container (ANCHOR_X is the canvas middle).
  const anchorX = figure.anchorLeft ? (ANCHOR_X - (figure.paint ?? NOMINAL_PAINT).left) * fit.canvas : 0;
  if (figure.sprite) {
    figure.sprite.scale.set(fit.canvas / figure.sprite.texture.height);
    figure.sprite.y = fit.offsetY;
    figure.sprite.x = anchorX;
  }
  figure.shadowX = shadowOffset(fit.canvas, figure.footprint) + anchorX;
  if (figure.ripple) {
    const paint = figure.paint ?? NOMINAL_PAINT;
    figure.ripple.x = anchorX + ((paint.left + paint.right) / 2 - ANCHOR_X) * fit.canvas;
  }
  figure.shadow.x = figure.shadowX * (figure.art.scale.x < 0 ? -1 : 1);
  if (figure.label) figure.label.y = Math.min(0, restY(figure)) + NAME_GAP;
}

/**
 * Put a stance's furniture up or take it down (#362). A swimmer gets a water
 * line: a mask that hides everything below the ground line, and a ripple
 * drawn over the cut. Anything else gets its shadow back.
 */
function applyStance(figure: StageFigureArt): void {
  const swimming = figure.stance === "swimming";
  if (swimming && !figure.mask) {
    const mask = new Graphics().rect(-4000, -8000, 8000, 8000).fill({ color: 0xffffff });
    figure.container.addChild(mask);
    figure.art.mask = mask;
    figure.mask = mask;
    const ripple = drawRipple();
    figure.container.addChildAt(ripple, figure.container.getChildIndex(figure.art) + 1);
    figure.ripple = ripple;
  } else if (!swimming && figure.mask) {
    figure.art.mask = null;
    figure.mask.destroy();
    figure.mask = null;
    figure.ripple?.destroy();
    figure.ripple = null;
  }
  figure.shadow.visible = !swimming;
  if (figure.label) figure.label.y = Math.min(0, restY(figure)) + NAME_GAP;
}

/**
 * Swap `old` for a shadow fitted to `footprint`, in the same slot under the
 * art and at the same fade, and return it.
 */
function refitShadow(
  container: Container,
  old: Graphics,
  height: number,
  footprint: Footprint | null,
): Graphics {
  const fitted = drawContactShadow(height, footprint, SCENE_SHADOW_SQUASH);
  fitted.x = shadowOffset(height, footprint);
  fitted.alpha = old.alpha;
  container.addChildAt(fitted, container.getChildIndex(old));
  old.destroy();
  return fitted;
}

function drawBackdrop(): Container {
  const container = new Container();
  const g = new Graphics();

  g.rect(0, 0, DESIGN.width, DESIGN.height).fill({ color: 0x141033 });
  g.ellipse(DESIGN.width * 0.5, BACKDROP_FLOOR * 0.62, DESIGN.width * 0.42, DESIGN.height * 0.34)
    .fill({ color: 0x2a2159, alpha: 0.7 });
  g.ellipse(DESIGN.width * 0.18, BACKDROP_FLOOR, DESIGN.width * 0.34, DESIGN.height * 0.22)
    .fill({ color: 0x1d2a3b, alpha: 0.8 });
  g.ellipse(DESIGN.width * 0.84, BACKDROP_FLOOR, DESIGN.width * 0.32, DESIGN.height * 0.2)
    .fill({ color: 0x1d2a3b, alpha: 0.8 });
  g.rect(0, BACKDROP_FLOOR, DESIGN.width, DESIGN.height - BACKDROP_FLOOR).fill({ color: 0x0f1a1c });
  g.moveTo(0, BACKDROP_FLOOR).lineTo(DESIGN.width, BACKDROP_FLOOR).stroke({ width: 3, color: 0x3a2a1e, alpha: 0.9 });

  container.addChild(g);
  return container;
}

// ---------------------------------------------------------------------------
// Active-scene registry
//
// The camera has to be drivable from game code that has no reference to the
// Pixi tree — a combat controller, a cutscene, a screen. One mounted stage at a
// time, so a module-level handle is honest and avoids threading a ref through
// every layout shell.
// ---------------------------------------------------------------------------

let active: PartyScene | null = null;

export function setActiveScene(scene: PartyScene | null): void {
  active = scene;
}

export function getActiveScene(): PartyScene | null {
  return active;
}

/** No-ops before the stage mounts, which is exactly what a display client wants. */
export function focusCamera(target: FocusTarget): void {
  active?.focusCamera(target);
}

/**
 * Frame durations, for anything that wants to know what the renderer costs
 * (world/frame-stats.ts).
 *
 * A subscription to the ticker the scene already runs rather than a loop of
 * its own: a second requestAnimationFrame competing with the renderer would
 * change the number it was reporting, which is the classic way a performance
 * meter becomes the performance problem.
 *
 * Module-level, like `setActiveScene`, because the meter is a shell component
 * and the scene is a plain Pixi module — neither can hold a reference to the
 * other without one of them learning about React.
 */
const frameListeners = new Set<(ms: number) => void>();

export function onFrame(listener: (ms: number) => void): () => void {
  frameListeners.add(listener);
  return () => {
    frameListeners.delete(listener);
  };
}

/** Jolt the mounted stage, if there is one. Same contract as focusCamera. */
export function shakeStage(strength: number): void {
  active?.shake(strength);
}

/** Play the between-scenes dip on the mounted stage, if there is one. */
export function sceneStep(ms: number): void {
  active?.playSceneStep(ms);
}

/**
 * Whether this viewer asked the OS to skip motion effects. Read per call —
 * it is one media query, and a preference flipped mid-session should win
 * the very next beat.
 */
function prefersReducedMotion(): boolean {
  return reducedMotion();
}
