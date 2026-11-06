/**
 * The camp stage (docs/camp.md §8): a backdrop, the crew's pieces and the
 * figures living among them. A third stage beside the story lineup
 * (scene.ts) and the combat board (board.ts), sharing actor-art.ts with both
 * so a hero stands, shadows and fades the same way in all three.
 *
 * The thinking is elsewhere and Pixi-free: the ground and the routes are
 * camp-layout.ts, who walks when is camp-wander.ts, and how a step, a pose or
 * a flickering flame looks at a given moment is camp-motion.ts. This module
 * only reads those and moves containers, so the §8.6 rules are held by the
 * modules' tests and checked here frame by frame (camp.test.ts).
 *
 * It follows WorldView's rules: nothing here reads the room mode and nothing
 * uses a viewport unit. The lobby (world/lobby-camp-stage.ts) owns this stage and calls
 * its small imperative API: who is in camp (`setFigures`), the downtime
 * moment's seed (`setSeed`), the moments the game already has (`moment`),
 * reduced motion (`setStill`), and the header and panels over it (`setInset`). Moments take priority over wandering, and
 * nothing waits on an animation (§12.6): every call takes effect on the next
 * frame, and Begin's `setOff` is cut short by whatever comes next.
 *
 * Heroes who tap Ready queue along the trailhead's lane in tap order, behind
 * the trailhead and spaced by their widths (camp-wander.ts `queueSpots`); the
 * line closes up when one steps away, and Begin sends it off front first.
 * Nobody walks through anybody to get in or out of it (a hero whose way is
 * blocked waits a beat, or fades), a hero who takes Ready back steps out of
 * it promptly, and every place in it, like every stand point, is moved in
 * from an edge the pane crops so the whole hero is on screen (`pointX`,
 * camp-framing.ts `campVisibleSpan`). A pane showing too little of the lane
 * for the whole party gets a second row (camp-wander.ts `queuePlaces`).
 *
 * Motion runs on frame time (`frameSeconds`), capped per frame, so a hidden
 * screen picks up where it was instead of replaying what it missed (§8.7).
 */

import { Assets, Container, Graphics, Rectangle, Sprite, Texture, type Application } from "pixi.js";
import leafArt from "../assets/painted/leaf.webp";
import { CAMP_KIT_STYLES, campKitStyle, campTentCloth } from "./camp-kit-art";
import { campKitCanvas } from "./camp-kit-canvas";
import { campPieceOwner } from "./camp-ownership";
import { bannerName, hotspotGlow, pieceStandIn, souvenirStandIn, standInLabel, tentStandIn } from "./camp-stand-in";
import { campBoxes, campFitFor, ownedPieceSize, type CampBox, type CampBoxInput, type CampLabelBox } from "./camp-boxes";
import { campPaint } from "./camp-paint";
import { campAccent, campAccentPose } from "./camp-accents";
import { tentArt, type CampBesideView, type CampSpotView } from "./camp-scene";
import type { CastStance } from "@kad/shared";
import {
  ANCHOR_X,
  ANCHOR_Y,
  FADE_RATE,
  approach,
  breathingShadowScale,
  drawPlaceholder,
  measurePaint,
} from "./actor-art";
import {
  friendHabitSpot,
  campRoute,
  campRoutes,
  laneAt,
  laneOf,
  laneScaleAt,
  pieceHeightCm,
  standPoint,
  type CampAction,
  type CampFace,
  type CampFriendHabit,
  type CampLane,
  type CampLayout,
  type CampPartMotion,
  type CampSpot,
  type CampStandPoint,
  type LaneSweep,
  type RoutePoint,
} from "./camp-layout";
import {
  activeHotspots,
  actionPose,
  bunSettlePose,
  ducklingSettlePose,
  mosshornLeafDrop,
  campGait,
  campHeightPx,
  campMeasure,
  campStride,
  frameSeconds,
  partMotion,
  planWalk,
  walkPose,
  wavePose,
  WAVE_S,
  type CampGait,
  type CampWalk,
} from "./camp-motion";
import { CLEARANCE, QUEUE_GAP, createWanderPlanner, queuePlaces, type QueueRow, type WanderPlace, type WanderPlanner } from "./camp-wander";
import { stanceIdle } from "./idle-motion";
import { DEFAULT_SIZE, fitCanvas, NOMINAL_PAINT, paintAspect, STANCE_LIFT, STANCE_LIFT_CM } from "./figure-scale";
import { reducedMotion } from "../a11y/prefs";
import {
  BLEED_SOURCE,
  campBleed,
  campStandRange,
  campStandX,
  campVisibleSpan,
  campWindow,
  type CampFraming,
  type CampSpan,
} from "./camp-framing";

/** Somebody in camp: a hero or a friend. */
export interface CampFigure {
  id: string;
  habit?: CampFriendHabit;
  /** The cutout, or null for the "art pending" placeholder. */
  url: string | null;
  /** True height (figure-scale.ts `figureSize`). */
  heightCm: number;
  stance: CastStance;
  /** A hero's species, whose drawn box her own gear is fitted to (camp-ownership.ts). */
  species?: string;
  /** A hero's seat (0 to 3), whose bedroll is theirs. Friends have none. */
  seat?: number;
  /** Hero accent for their own bedroll; friends have no kit. */
  accent?: string;
  /**
   * The hero's stored bedroll-and-pack style (`HeroKit.style`), when her kid
   * has picked one. Absent or null draws the style her id hashes to
   * (`campKitStyle`), exactly as before kits were stored.
   */
  kitStyle?: string | null;
  /** Her stored tent (`HeroKit.tent`); absent or null draws the tent of her bedroll style. */
  tent?: string | null;
  /** Her name, under her tent while its painting is owed. */
  name?: string;
  /** Her decoration slots, hung on her tent. */
  slots?: readonly (string | null)[];
  /** How many souvenirs she carries, on the line beside her tent. */
  souvenirs?: number;
}

/**
 * The crew's side of the camp (§4.2, §12.5; #620): what stands at each shared
 * hotspot, and what waits beside the campfire for a kid to place.
 */
export interface CampDressing {
  spots: readonly CampSpotView[];
  beside: readonly CampBesideView[];
}

/**
 * How long the heroes take to pitch a new camp when the frame grows (§4.1):
 * a small cousin of the transformation cutscene, never longer than it
 * (camp.test.ts holds it to `TRANSFORM_BEAT_MS`), and nothing waits on it.
 */
export const PITCH_S = 2.4;
/** How far apart the pieces go up while pitching. */
const PITCH_STAGGER_S = 0.15;
/**
 * The moments the game already has (§8.5) that the camp acts out. `unready`
 * is a Ready taken back: out of the trailhead's line and back to wandering.
 */
export type CampMoment = "arrive" | "ready" | "unready" | "away" | "setOff";

export interface CampOptions {
  /** The downtime moment's seed (§12.6). Never the wall clock. */
  seed?: number;
  /** Reduced motion; defaults to the viewer's preference (a11y/prefs.ts). */
  still?: boolean;
  /** Where a path relative to `assets/` is served. */
  assetUrl?: (path: string) => string;
  /**
   * A full URL drawn in the backdrop's place while its painting does not
   * load (a stand-in until the camp art lands, #615). Absent: a plain dusk.
   */
  fallbackBackdrop?: string;
  /** How a texture is loaded; Pixi's `Assets.load` unless a test says otherwise. */
  loadTexture?: (url: string) => Promise<Texture>;
}

/** One figure as it stands this frame: what camp.test.ts reads. */
export interface CampFigureView {
  id: string;
  /** Feet on the ground, in backdrop-canvas pixels. */
  x: number;
  y: number;
  /** How far the body is drawn above the feet, in canvas pixels. */
  lift: number;
  alpha: number;
  /** The art's `scale.x` sign: 1 as drawn (facing left), -1 turned right. */
  artScaleX: number;
  /** The lane under the feet, or null on a crossing. */
  lane: string | null;
  /** Travelling this frame (a step or a glide). */
  walking: boolean;
  /** Feet off the ground in a hop. */
  airborne: boolean;
  /** The stand point it is at (null while walking or away from one). */
  point: string | null;
  /** The factor it is drawn at (camp-framing.ts `campFigureScale`), on top of its lane's scale. */
  figureScale: number;
  /** Its drawn height (nominal paint) on screen this frame, in canvas pixels: lane and figure factor applied. */
  heightPx: number;
}

export interface CampStage {
  readonly view: Container;
  setFigures(figures: readonly CampFigure[]): void;
  setSeed(seed: number): void;
  moment(kind: "arrive" | "ready" | "unready" | "away", figureId: string): void;
  moment(kind: "setOff"): void;
  setStill(still: boolean): void;
  resize(width: number, height: number): void;
  /**
   * How many px along the bottom of the pane panels cover, and how far down
   * from its top the header reaches (the lobby's, stage-inset.ts). The camp's
   * painting covers the pane and is slid so its focus band stands in the
   * window between them (camp-framing.ts `campFraming`).
   */
  setInset(bottomPx: number, topPx?: number): void;
  /** Every figure, this frame. */
  figures(): CampFigureView[];
  /** The pieces somebody is using, whose moving parts animate. */
  activePieces(): string[];
  /** The crew's pieces at their hotspots and beside the campfire (#620). */
  setDressing(dressing: CampDressing): void;
  /** The frame just grew: the heroes pitch the new camp (§4.1). Cut short by anything; never waited on. */
  pitch(): void;
  /** Whether a pitch is still under way (for tests). */
  pitching(): boolean;
  destroy(): void;
}

/** The turn rate board.ts uses: `scale.x` eases through zero. */
const TURN_RATE = 9;
/** How fast a piece's moving part comes to life and settles back. */
const PART_RATE = 3;
/** How fast the remains of an interrupted hop ease away. */
const CARRY_RATE = 14;
/** A stepped-away hero, the way the lineup fades one (scene.ts). */
const AWAY_ALPHA = 0.5;
/** Begin: the crew files off, the Ready queue first, this far apart. */
const SET_OFF_STAGGER_S = 0.3;
/** How far past the edge the trail takes them. */
const OFF_EDGE = 0.1;
/** One upper-left sun for the camp: soft brown contact and a faint lower-right cast. */
function campGroundShadow(width: number, height: number, texture?: Texture, canvas = height, mirrored = false): Container {
  const shadow = new Container();
  shadow.label = "camp-ground-shadow";
  if (texture) {
    const projection = new Container();
    projection.scale.set(.9, -.18);
    projection.skew.x = .9;
    projection.x = width * .08;
    projection.y = height * .015;
    const cast = new Sprite(texture);
    cast.label = "camp-cast-body";
    cast.anchor.set(ANCHOR_X, ANCHOR_Y);
    cast.width = cast.height = canvas;
    if (mirrored) cast.scale.x *= -1;
    cast.tint = 0x302b20;
    cast.alpha = .16;
    projection.addChild(cast);
    shadow.addChild(projection);
  }
  const contact = new Graphics();
  for (let ring = 12; ring > 0; ring--) {
    const spread = ring / 12;
    contact.ellipse(width * .22, height * .035, width * .62 * spread, height * .065 * spread)
      .fill({ color: 0x51452c, alpha: .014 });
    contact.ellipse(0, 0, width * .48 * spread, height * .025 * spread)
      .fill({ color: 0x302b20, alpha: .022 });
  }
  shadow.addChild(contact);
  return shadow;
}

const CAMP_AMBIENT_TINT = 0xfff7ec;
/** How fast the camp eases to a new frame when the panels over it change height. */
const FRAME_RATE = 4;
/**
 * A hero who takes back Ready walks out of the line when a lane-mate lets it
 * (camp-wander.ts `release` soon); one still boxed in after this long, by
 * heroes who are still lined up, fades out and back in at home (§8.6, rule 3).
 */
export const STEP_OUT_S = 2.5;
/**
 * A hero walking to its place in the line waits for lane-mates in its way;
 * one still waiting after this long (a line that must form past somebody who
 * cannot step aside) fades out, and back in at its place once nobody stands there.
 */
export const QUEUE_WAIT_S = 3;
/** A line place that moved less than this (canvas fractions) is not walked to again. */
const QUEUE_SETTLE = 0.01;
/** The longest a fade into the line stays out of sight waiting for its place to clear. */
const CLEAR_WAIT_S = 20;
/**
 * How much of its nominal box a figure's paint fills across: a walker passing
 * a lane-mate keeps this share of their two widths apart, so their boxes may
 * brush where the art seldom reaches (a tail, a hoof), never their bodies.
 */
export const BOX_FILL = 0.75;

type Place = WanderPlace;

interface Actor {
  def: CampFigure;
  container: Container;
  body: Container;
  art: Container;
  shadow: Container;
  sprite: Sprite | null;
  leaf?: Sprite;
  placeholder: Graphics;
  gait: CampGait;
  heightPx: number;
  /** Ground position, canvas pixels. */
  x: number;
  y: number;
  lane: string | null;
  point: string | null;
  /** The way it should face: 1 right, -1 left. */
  facing: 1 | -1;
  /** Its art's facing now, eased through zero on a turn. */
  facingNow: number;
  walk: CampWalk | null;
  walkStart: number;
  walkTo: Place | null;
  /** Face this way on arriving (otherwise the stand point's). */
  arriveFacing: 1 | -1 | null;
  /** What a moment does once its walk is over. */
  onArrive: (() => void) | null;
  arrivedAt: number;
  action: CampAction | null;
  alpha: number;
  alphaTarget: number;
  teleport: {
    place: Place;
    alpha: number;
    facing: 1 | -1 | null;
    then: (() => void) | null;
    /** Stay out of sight until nobody stands where it reappears, or until this time. */
    clearBy: number | null;
  } | null;
  waveStart: number | null;
  releaseAt: number | null;
  /** Out of the line and waiting to walk off: fades home if still here at this time. */
  stepOutBy: number | null;
  /** In the line, but waiting for lane-mates to clear its way there since this time. */
  queueWaitSince: number | null;
  /** What was left of a hop and lean when a walk was cut short. */
  carryLift: number;
  carryRotation: number;
  lastLift: number;
  lastRotation: number;
  phase: number;
  leaving: boolean;
  removing: boolean;
  airborne: boolean;
  moving: boolean;
}

interface PieceView {
  ownerScale: number;
  /** The art it is drawn with now, relative to `assets/`. */
  path: string;
  /** Its art did not load: a labelled stand-in is drawn instead (camp-stand-in.ts). */
  missing: boolean;
  standIn: Container | null;
  /** What the stand-in was last drawn for, so it is redrawn only when that changes. */
  standInKey: string;
  /** How far up it is while the camp is being pitched, 0 to 1. */
  pitch: number;
  shadow: Container;
  groundCount: number;
  mirrored: boolean;
  kitKey?: string;
  kitRevision: number;
  neutralTexture: Texture | null;
  id: string;
  container: Container;
  /** The piece's own cutout and its moving part's, sharing one canvas registration. */
  sprite: Sprite | null;
  partSprite: Sprite | null;
  part: Container | null;
  motion: CampPartMotion | null;
  strength: number;
  /** Its painted height, canvas pixels, before the lane's scale. */
  heightPx: number;
  /** Its lane's scale; the camp's figure factor goes on top. */
  laneScale: number;
  fit: { canvas: number; offsetY: number };
}

const toFacing = (face: CampFace): 1 | -1 => (face === "right" ? 1 : -1);

export function createCamp(app: Application, layout: CampLayout, options: CampOptions = {}): CampStage {
  const W = layout.canvas.width;
  const H = layout.canvas.height;
  const measure = campMeasure(H);
  const pxPerCm = measure.pxPerCm;
  const assetUrl = options.assetUrl ?? ((path: string) => `/assets/${path}`);
  const load = options.loadTexture ?? ((url: string) => Assets.load<Texture>(url));
  let still = options.still ?? reducedMotion();
  let seed = options.seed ?? 0;
  let destroyed = false;
  let elapsed = 0;
  /**
   * The factor every figure and piece is drawn at (camp-framing.ts
   * `campFigureScale`), and where it is headed: below 1 when the band would
   * not fit the lobby's window at full size. It eases with the framing.
   */
  let figureScale = 1;
  let figureScaleTarget = 1;

  const view = new Container();
  view.label = "camp";
  app.stage.addChild(view);

  // The backdrop: painted art when it loads, a plain dusk until then, so a
  // missing file never leaves the stage blank.
  //
  // The painting covers the pane's width and is slid to put the camp in the
  // window (camp-framing.ts), so it may stop short of the pane's top or
  // bottom. There its own plain edge rows (sky above, grass below) are drawn
  // on, flipped so the seam meets itself: one painting, edge to edge.
  const backdrop = new Container();
  // Far past the canvas: a phone's pane is several painting-heights tall at its scale.
  const dusk = new Graphics().rect(-W, -8 * H, 3 * W, 17 * H).fill({ color: 0x2a2f4a });
  backdrop.addChild(dusk);
  view.addChild(backdrop);
  let bleedTop: Sprite | null = null;
  let bleedBottom: Sprite | null = null;
  const accent = campAccent(layout.backdrop.family);
  let accentSprite: Sprite | null = null;
  function updateAccent(): void {
    if (!accent || !accentSprite) return;
    const pose = campAccentPose(accent, elapsed, still);
    accentSprite.position.set(pose.x, pose.y);
    accentSprite.angle = pose.angle;
    accentSprite.alpha = pose.alpha;
    accentSprite.height = accent.height * pose.stretch;
  }
  const showBackdrop = (texture: Texture): void => {
    if (destroyed) return;
    const sprite = new Sprite(texture);
    sprite.label = "camp-backdrop";
    sprite.width = W;
    sprite.height = H;
    // The edge strips, cut from the painting's own texture.
    const tw = texture.frame.width;
    const th = texture.frame.height;
    const strip = (y: number) =>
      new Texture({ source: texture.source, frame: new Rectangle(texture.frame.x, texture.frame.y + y, tw, th * BLEED_SOURCE) });
    bleedTop = new Sprite(strip(0));
    bleedTop.label = "camp-bleed-top";
    bleedBottom = new Sprite(strip(th * (1 - BLEED_SOURCE)));
    bleedBottom.label = "camp-bleed-bottom";
    backdrop.addChild(bleedTop, bleedBottom, sprite);
    if (framed) place(framed);
  };
  const fallback = options.fallbackBackdrop;
  void load(assetUrl(layout.backdrop.path))
    .then(async (texture) => {
      showBackdrop(texture);
      if (!accent || destroyed) return;
      const art = await load(accent.url);
      if (destroyed) return;
      accentSprite = new Sprite(art);
      accentSprite.label = "camp-terrain-accent";
      accentSprite.anchor.set(accent.pivotX / accent.width, accent.pivotY / accent.height);
      accentSprite.width = accent.width;
      updateAccent();
      backdrop.addChild(accentSprite);
    }, () => (fallback ? load(fallback).then(showBackdrop) : undefined))
    .catch(() => undefined);

  // Pieces and figures share one depth-sorted layer: the nearer the feet,
  // the later drawn. A piece sorts just behind figures on its own lane.
  const ground = new Container();
  ground.sortableChildren = true;
  view.addChild(ground);

  /*
   * Pieces are cutouts on the figures' contract: a 1024 canvas with the
   * ground contact at (512, 900), drawn at true size (`heightCm`, or a
   * default by kind, camp-layout.ts `pieceHeightCm`) on the same scale as the
   * figures, times the lane's. A moving part is a second cutout on the same
   * canvas, drawn over its piece with the same registration, so it moves
   * about the piece's own ground contact.
   */
  const pieces = new Map<string, PieceView>();
  const pieceDefs = new Map(layout.frame.pieces.map((piece) => [piece.id, piece]));
  const fitSprite = (sprite: Sprite, fit: { canvas: number; offsetY: number }, mirrored = false): void => {
    sprite.anchor.set(ANCHOR_X, ANCHOR_Y);
    sprite.width = fit.canvas;
    sprite.height = fit.canvas;
    sprite.y = fit.offsetY;
    sprite.scale.x = Math.abs(sprite.scale.x) * (mirrored ? -1 : 1);
    sprite.tint = CAMP_AMBIENT_TINT;
  };
  const fitPieceShadow = (piece: PieceView, texture: Texture): void => {
    const paint = measurePaint(texture);
    const width = paint ? piece.fit.canvas * (paint.right - paint.left) : piece.heightPx;
    const shadow = campGroundShadow(width, piece.heightPx, texture, piece.fit.canvas, piece.mirrored);
    piece.container.addChildAt(shadow, piece.container.getChildIndex(piece.shadow));
    piece.shadow.destroy({ children: true });
    piece.shadow = shadow;
  };
  const showPieceArt = (piece: PieceView, texture: Texture, path = piece.path): void => {
    const sprite = new Sprite(texture);
    // The table's footprint (camp-paint.ts), the one the boxes were laid out by; measured only for art it lacks.
    piece.fit = fitCanvas(piece.heightPx, campPaint(path) ?? measurePaint(texture));
    fitPieceShadow(piece, texture);
    fitSprite(sprite, piece.fit, piece.mirrored);
    if (piece.partSprite) fitSprite(piece.partSprite, piece.fit);
    piece.sprite?.destroy();
    piece.sprite = sprite;
    for (const child of [...piece.container.children]) {
      if (child instanceof Graphics && !child.label.startsWith("camp-ground-")) child.destroy();
    }
    piece.container.addChildAt(sprite, piece.groundCount);
  };
  for (const piece of layout.frame.pieces) {
    const lane = laneOf(layout, piece.lane);
    const container = new Container();
    container.label = `piece:${piece.id}`;
    container.x = piece.x * W;
    container.y = lane.y * H;
    container.zIndex = lane.y * H - 0.5;
    container.scale.set(lane.scale);
    const heightPx = campHeightPx(pieceHeightCm(piece), measure);
    if (piece.id === "campfire") {
      const light = new Graphics();
      light.label = "camp-ground-firelight";
      for (let ring = 12; ring > 0; ring--) {
        const spread = ring / 12;
        light.ellipse(0, 0, heightPx * 1.4 * spread, heightPx * .3 * spread)
          .fill({ color: 0xf7be67, alpha: .008 });
      }
      container.addChild(light);
    }
    const shadow = campGroundShadow(heightPx * (piece.id.startsWith("bedroll") ? 1.7 : .9), heightPx);
    container.addChild(shadow);
    const groundCount = container.children.length;
    const pending = new Graphics()
      .roundRect(-0.4 * heightPx, -heightPx, 0.8 * heightPx, heightPx, 0.1 * heightPx)
      .stroke({ width: 2, color: 0x8b6cf5, alpha: 0.6 });
    container.addChild(pending);
    ground.addChild(container);
    const entry: PieceView = {
      id: piece.id,
      ownerScale: 1,
      path: piece.path,
      missing: false,
      standIn: null,
      standInKey: "",
      pitch: 1,
      kitRevision: 0,
      neutralTexture: null,
      shadow,
      groundCount,
      mirrored: piece.id.startsWith("bedroll") && piece.x > .5,
      container,
      sprite: null,
      partSprite: null,
      part: null,
      motion: null,
      strength: 0,
      heightPx,
      laneScale: lane.scale,
      fit: fitCanvas(heightPx, null),
    };
    pieces.set(piece.id, entry);
    loadPiece(entry, piece.path);
  }
  function tintCloth(texture: Texture, cloth?: string, accent?: string): Texture {
    const source = texture.source?.resource as CanvasImageSource | undefined;
    const canvas = source && cloth && accent ? campKitCanvas(source, cloth, accent) : null;
    return canvas ? Texture.from(canvas) : texture;
  }

  function loadPiece(entry: PieceView, path: string, cloth?: string, accent?: string): Promise<void> {
    const revision = entry.kitRevision;
    entry.path = path;
    return load(assetUrl(path))
      .then((texture) => {
        if (destroyed || entry.path !== path || (entry.id.startsWith("tent_") && entry.kitRevision !== revision)) return;
        entry.neutralTexture = texture;
        entry.missing = false;
        entry.standIn?.destroy({ children: true });
        entry.standIn = null;
        if (entry.kitKey && entry.sprite && entry.id.startsWith("bedroll")) return;
        // Measured like a figure, so a campfire painted small in its canvas
        // is still its true height; the part follows the same fit.
        showPieceArt(entry, tintCloth(texture, cloth, accent));
      })
      .catch(() => {
        if (destroyed || entry.path !== path || (entry.id.startsWith("tent_") && entry.kitRevision !== revision)) return;
        if (entry.sprite) entry.sprite.visible = false;
        entry.missing = true;
        drawStandIn(entry, lastOwners.get(entry.id));
      });
  }

  /** The owner each owned piece was last drawn for. */
  const lastOwners = new Map<string, CampFigure | undefined>();

  /** A labelled stand-in for a piece whose painting is owed (camp-stand-in.ts). */
  function drawStandIn(entry: PieceView, owner: CampFigure | undefined): void {
    if (!entry.missing || destroyed) return;
    const decorations = (owner?.slots ?? []).filter((s) => s !== null).length;
    const key = `${owner?.id ?? ""}:${owner?.accent ?? ""}:${owner?.species ?? ""}:${String(owner?.heightCm ?? "")}:${String(decorations)}:${String(owner?.souvenirs ?? 0)}`;
    if (entry.standIn && entry.standInKey === key) return;
    entry.standInKey = key;
    entry.standIn?.destroy({ children: true });
    for (const child of [...entry.container.children]) {
      if (child instanceof Graphics && !child.label.startsWith("camp-ground-") && !child.label.startsWith("camp-stand-in")) child.destroy();
    }
    // Drawn at her authored height and scaled with the container by her fit; a tent's width is her own.
    const size = ownedPieceSize(layout, pieceDefs.get(entry.id)!, owner);
    const standIn = entry.id.startsWith("tent_")
      ? tentStandIn(entry.heightPx, { ...(owner?.accent ? { accent: owner.accent } : {}), owned: owner !== undefined, widthPx: size.width / size.scale, decorations })
      : entry.id.startsWith("souvenirs_")
        ? souvenirStandIn(entry.heightPx, { ...(owner?.accent ? { accent: owner.accent } : {}), souvenirs: owner?.souvenirs ?? 0 })
        : pieceStandIn(entry.heightPx, size.width / size.scale);
    entry.standIn = standIn;
    entry.container.addChildAt(standIn, entry.groundCount);
    labelsDirty = true;
  }

  for (const moving of layout.frame.movingParts) {
    const piece = pieces.get(moving.piece);
    if (!piece || piece.part) continue;
    const part = new Container();
    part.label = `part:${moving.piece}`;
    piece.container.addChild(part);
    piece.part = part;
    piece.motion = moving.motion;
    if (piece.id.startsWith("tent_")) continue;
    void load(assetUrl(moving.path))
      .then((texture) => {
        if (destroyed) return;
        const sprite = new Sprite(texture);
        fitSprite(sprite, piece.fit);
        piece.partSprite = sprite;
        part.addChild(sprite);
      })
      .catch(() => undefined);
  }

  const actors = new Map<string, Actor>();
  let planner = makePlanner(seed);

  function makePlanner(withSeed: number): WanderPlanner {
    return createWanderPlanner(layout, withSeed, {
      walkSeconds: (id, route) => {
        const actor = actors.get(id);
        return actor ? planWalk(route, layout.canvas, strideOf(actor), actor.facing).duration : 1;
      },
      pointX,
      // Lane-mates keep their drawn widths apart, less the empty corners of a cutout's box.
      halfWidth: (id, lane) => {
        const actor = actors.get(id);
        return actor ? (widthOf(actor, laneOf(layout, lane).scale) / 2) * BOX_FILL : CLEARANCE / 2;
      },
      reserved: () => lineStretches,
      fitRoute: (id, route) => {
        const actor = actors.get(id);
        return actor ? fitRoute(actor, route) : route;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Places
  // ---------------------------------------------------------------------------

  /**
   * How wide `actor` is drawn on a lane of `laneScale`, as a fraction of the
   * canvas width, at the figure factor the camp is easing to (so a place
   * worked out from it holds still while the factor eases).
   */
  function widthOf(actor: Actor, laneScale: number): number {
    return (actor.heightPx * figureScaleTarget * paintAspect(NOMINAL_PAINT) * laneScale) / W;
  }

  /** The part of the painting the pane shows across (camp-framing.ts `campVisibleSpan`), where the framing is headed. */
  function visible(): CampSpan {
    return framing && pane.width > 0 ? campVisibleSpan(pane.width, framing, W) : { x0: 0, x1: 1 };
  }

  /**
   * Where a stand point is on this screen: as authored, or moved in from a
   * cropped edge far enough that the widest figure in camp stands there whole
   * (§8.6). On a TV only the trailhead's end is ever near an edge; a phone's
   * World pane crops both sides.
   */
  function pointX(point: CampStandPoint): number {
    const lane = laneOf(layout, point.lane);
    let widest = (campHeightPx(DEFAULT_SIZE.heightCm, measure) * figureScaleTarget * paintAspect(NOMINAL_PAINT) * lane.scale) / W;
    for (const a of actors.values()) if (!a.removing) widest = Math.max(widest, widthOf(a, lane.scale));
    return campStandX(point.x, campStandRange(lane, visible(), widest));
  }

  const pointPlace = (point: CampStandPoint): Place => ({ spot: { lane: point.lane, x: pointX(point) }, point: point.id });

  /** Stand points somebody stands at or is headed to, other than `except`. */
  function heldPoints(except?: Actor): Set<string> {
    const held = new Set<string>();
    for (const a of actors.values()) {
      if (a === except || a.removing) continue;
      if (a.point) held.add(a.point);
      if (a.walkTo?.point) held.add(a.walkTo.point);
      if (a.teleport?.place.point) held.add(a.teleport.place.point);
    }
    for (const s of planner.snapshots()) {
      if (s.id === except?.def.id) continue;
      if (s.at.point) held.add(s.at.point);
      if (s.to?.point) held.add(s.to.point);
    }
    return held;
  }

  /** Whether a figure standing at `place` would stand in the trailhead's line. */
  function inLine(actor: Actor, place: Place): boolean {
    const half = widthOf(actor, laneOf(layout, place.spot.lane).scale) / 2;
    return lineStretches.some((s) => s.lane === place.spot.lane && place.spot.x + half >= s.lo && place.spot.x - half <= s.hi);
  }

  /**
   * A hero's own bedroll, or for a friend (or a hero with no bedroll free) the
   * first free point. A bedroll the trailhead's line has grown over is not
   * free either: its hero goes to a free spot until the line moves off.
   */
  function homeOf(actor: Actor): Place {
    const points = layout.frame.standPoints;
    const own = actor.def.seat === undefined ? undefined : points.find((p) => p.seat === actor.def.seat);
    if (own && !inLine(actor, pointPlace(own))) return pointPlace(own);
    const held = heldPoints(actor);
    const open = (p: CampStandPoint) => !held.has(p.id) && p.seat === undefined && !inLine(actor, pointPlace(p));
    const free = points.find(open) ?? own ?? points.find((p) => !held.has(p.id));
    return free ? pointPlace(free) : { spot: { ...layout.frame.trailhead }, point: null };
  }

  /**
   * Where a hero leaving the line by a fade reappears: home (`homeOf`) if
   * nobody stands or is walking there, otherwise the nearest free stand point
   * that is clear, so it is not kept out of sight while a lane-mate passes.
   */
  function fadeHome(actor: Actor): Place {
    const home = homeOf(actor);
    if (bodiesClear(actor, home, true)) return home;
    const held = heldPoints(actor);
    const here = actor.x / W;
    const other = layout.frame.standPoints
      .filter((p) => p.seat === undefined && !held.has(p.id))
      .map(pointPlace)
      .filter((place) => !inLine(actor, place) && bodiesClear(actor, place, true))
      .sort((a, b) => Math.abs(a.spot.x - here) - Math.abs(b.spot.x - here));
    return other[0] ?? home;
  }

  /** Where the trail leaves camp, and which way. */
  function trailOut(): { side: 1 | -1; lane: string } {
    const t = layout.frame.trailhead;
    return { side: t.x >= 0.5 ? 1 : -1, lane: t.lane };
  }

  /** Heroes who tapped Ready, in the order they tapped (§8.5). */
  const queue: string[] = [];

  /** The stretches of lane the line stands in, a row to a lane: nobody wanders into them. */
  let lineStretches: LaneSweep[] = [];

  /**
   * The lanes the line may stand on: the trailhead's, then (when the pane
   * shows too little of it for the whole party) the next lane back, and on.
   */
  const lineLanes = (() => {
    const trail = laneOf(layout, layout.frame.trailhead.lane);
    const rest = [...layout.lanes.values()].filter((lane) => lane.id !== trail.id);
    rest.sort((a, b) => Number(a.y > trail.y) - Number(b.y > trail.y) || Math.abs(a.y - trail.y) - Math.abs(b.y - trail.y));
    return [trail, ...rest];
  })();

  /** Where an actor is, or is headed: the end of its walk or its fade. */
  function headedOf(actor: Actor): CampSpot | null {
    if (actor.teleport) return actor.teleport.place.spot;
    if (actor.walk) return actor.walkTo?.spot ?? null;
    return actor.lane ? { lane: actor.lane, x: actor.x / W } : null;
  }

  /**
   * Everybody standing on `lane` who is not in the line, or walking to a
   * place on it: the line steps round them (camp-wander.ts `queueSpots`),
   * never into them.
   */
  function lineObstacles(line: readonly Actor[], lane: CampLane): { x: number; width: number }[] {
    const out: { x: number; width: number }[] = [];
    for (const a of actors.values()) {
      if (a.removing || a.leaving || line.includes(a)) continue;
      const at = headedOf(a);
      if (at?.lane === lane.id) out.push({ x: at.x, width: widthOf(a, lane.scale) });
    }
    return out;
  }

  /** What is left of an actor's walk, from where it is now (canvas px, as `CampWalk.points`). */
  function walkAhead(actor: Actor): { x: number; y: number; lane: string | null }[] {
    const points = actor.walk?.points ?? [];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1]!;
      const q = points[i]!;
      const onX = actor.x >= Math.min(p.x, q.x) - 0.5 && actor.x <= Math.max(p.x, q.x) + 0.5;
      const onY = actor.y >= Math.min(p.y, q.y) - 0.5 && actor.y <= Math.max(p.y, q.y) + 0.5;
      if (onX && onY) return [{ x: actor.x, y: actor.y, lane: null }, ...points.slice(i)];
    }
    return points;
  }

  /**
   * Whether nobody else can be seen standing on `place`'s lane where `actor`
   * would stand at it, nor will walk through it: where a fade may put it back
   * in view. `ahead`: judge a figure that is fading somewhere else by where it
   * will be, not where it is (choosing a place, rather than appearing in it).
   */
  function bodiesClear(actor: Actor, place: Place, ahead = false): boolean {
    const lane = laneOf(layout, place.spot.lane);
    const mine = widthOf(actor, lane.scale);
    const x = place.spot.x;
    for (const a of actors.values()) {
      if (a === actor || a.removing) continue;
      const gap = (mine + widthOf(a, lane.scale)) / 2;
      const body = ahead && a.teleport ? a.teleport.place.spot : a.alpha < 0.02 ? null : a.lane ? { lane: a.lane, x: a.x / W } : null;
      if (body?.lane === lane.id && Math.abs(body.x - x) < gap) return false;
      // Nor where somebody walking has still to pass: it would walk through the new arrival.
      const points = walkAhead(a);
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1]!;
        const q = points[i]!;
        if (Math.abs(p.y - lane.y * H) > 0.5 || Math.abs(q.y - lane.y * H) > 0.5) continue;
        if (x > Math.min(p.x, q.x) / W - gap && x < Math.max(p.x, q.x) / W + gap) return false;
      }
    }
    return true;
  }

  /**
   * Walk everyone in the queue to their place in it: the first at the
   * trailhead, the rest behind, all of them on screen. Run every frame, so
   * every Ready of a frame is lined up at once in tap order, and the line
   * closes up once whoever stood in it has gone. Nobody walks through a
   * lane-mate to get there (§8.6, rule 4): a hero whose every way is blocked
   * waits, nudging whoever is idling in it, and one still waiting after
   * `QUEUE_WAIT_S` (two heroes who must swap places, say) fades out, and back
   * in at its place once nobody stands there.
   *
   * A pane that shows too little of the trailhead's lane for the whole party
   * gets a second row on the next lane back (camp-wander.ts `queuePlaces`).
   *
   * `move` false only works out where the line stands (`lineStretches`), as a
   * moment does before the next frame sends anybody anywhere.
   */
  function requeue(move = true): void {
    const t = layout.frame.trailhead;
    const side = trailOut().side;
    const line = queue.map((id) => actors.get(id)).filter((a): a is Actor => a !== undefined && !a.removing);
    const rows: QueueRow[] = lineLanes.map((lane) => ({
      lane: lane.id,
      x0: lane.x0,
      x1: lane.x1,
      widths: line.map((a) => widthOf(a, lane.scale)),
      obstacles: lineObstacles(line, lane),
    }));
    const places = queuePlaces(t.x, side, rows, QUEUE_GAP, visible());
    lineStretches = [];
    places.forEach((place, i) => {
      const half = widthOf(line[i]!, laneOf(layout, place.lane).scale) / 2;
      const row = lineStretches.find((s) => s.lane === place.lane);
      if (row) {
        row.lo = Math.min(row.lo, place.x - half);
        row.hi = Math.max(row.hi, place.x + half);
      } else lineStretches.push({ lane: place.lane, lo: place.x - half, hi: place.x + half });
    });
    if (!move) return;
    line.forEach((actor, i) => {
      const { lane, x } = places[i]!;
      const headed = headedOf(actor);
      if (headed?.lane === lane && Math.abs(headed.x - x) < QUEUE_SETTLE) {
        actor.queueWaitSince = null;
        if (actor.point && !actor.walk && !actor.teleport) {
          // Already standing about where its place is: it stops resting there and turns to the trail.
          actor.point = null;
          actor.action = null;
          actor.facing = side;
          planner.direct(actor.def.id, { spot: headed, point: null }, null, 0);
        }
        return;
      }
      const to: Place = { spot: { lane, x }, point: null };
      if (still || actor.alpha < 0.05 || actor.teleport) {
        actor.queueWaitSince = null;
        direct(actor, to, { face: side, fade: true, waitClear: true });
        return;
      }
      const way = clearWay(actor, to.spot);
      if (way.route) {
        actor.queueWaitSince = null;
        direct(actor, to, { face: side, route: way.route });
        return;
      }
      for (const id of way.blockers) planner.nudge(id);
      actor.queueWaitSince ??= elapsed;
      if (elapsed - actor.queueWaitSince < QUEUE_WAIT_S) return;
      // Waited long enough for a lane that will not clear: out, and back in at its place.
      actor.queueWaitSince = null;
      direct(actor, to, { face: side, fade: true, waitClear: true });
    });
  }

  /**
   * The shortest way from where `actor` is to `to` that passes through nobody
   * (camp-layout.ts `campRoutes`, camp-wander.ts `blockers`), round by another
   * lane if need be; or, with every way blocked, who blocks the shortest.
   */
  function clearWay(actor: Actor, to: CampSpot): { route: RoutePoint[] | null; blockers: string[] } {
    let blockers: string[] | null = null;
    for (const route of routesFrom(actor, to)) {
      const inWay = planner.blockers(actor.def.id, route);
      if (inWay.length === 0) return { route, blockers: [] };
      blockers ??= inWay;
    }
    return { route: null, blockers: blockers ?? [] };
  }

  /**
   * A figure standing where the screen now cuts it off (the pane was resized,
   * or a wider hero sat down) fades out and back in where it is seen whole
   * (§8.6, rule 3): at its stand point as this screen places it, or along its
   * lane. The line is `requeue`'s.
   */
  function keepOnScreen(actor: Actor): void {
    if (actor.walk || actor.teleport || !actor.lane || queue.includes(actor.def.id)) return;
    const lane = laneOf(layout, actor.lane);
    const range = campStandRange(lane, visible(), widthOf(actor, lane.scale));
    const x = actor.x / W;
    if (x >= range.x0 - 1e-3 && x <= range.x1 + 1e-3) return;
    const point = actor.point ? standPoint(layout, actor.point) : undefined;
    const to: Place = point ? pointPlace(point) : { spot: { lane: lane.id, x: campStandX(x, range) }, point: null };
    const wasDirected = planner.snapshot(actor.def.id)?.mode === "directed";
    const alpha = actor.alphaTarget > 0 ? actor.alphaTarget : 1;
    const face = actor.facing;
    const stepping = actor.stepOutBy;
    direct(actor, to, { fade: true, waitClear: true, alpha, face, ...(wasDirected ? {} : { then: () => planner.release(actor.def.id) }) });
    actor.stepOutBy = stepping;
  }

  /**
   * Take an actor out of wandering where it is: standing, or on the walk it
   * is on (the planner keeps that walk's stretch of lane reserved).
   */
  function holdForMoment(actor: Actor): void {
    const id = actor.def.id;
    if (actor.walk && actor.walkTo) {
      const remaining = Math.max(0, actor.walkStart + actor.walk.duration - elapsed);
      const route = actor.walk.points.map((p) => ({ x: p.x / W, y: p.y / H, lane: p.lane }));
      planner.direct(id, actor.walkTo, route, remaining);
      return;
    }
    const at = actor.teleport?.place ?? { spot: { lane: actor.lane ?? layout.frame.trailhead.lane, x: actor.x / W }, point: actor.point };
    planner.direct(id, at, null, 0);
  }

  /**
   * Out of the line: back to wandering after a beat, to the nearest free spot
   * whose way is clear (camp-wander.ts `release` soon). Still boxed in by the
   * heroes lined up after `STEP_OUT_S`, it fades home instead (`tick`).
   */
  function stepOut(actor: Actor): void {
    if (actor.removing || queue.includes(actor.def.id)) return;
    planner.release(actor.def.id, { soon: true });
    actor.stepOutBy = elapsed + STEP_OUT_S;
  }

  function leaveQueue(actor: Actor): void {
    const at = queue.indexOf(actor.def.id);
    if (at < 0) return;
    queue.splice(at, 1);
    requeue(false);
  }

  /** A route from where the actor stands now, even mid-crossing. */
  function routeFrom(actor: Actor, to: CampSpot): RoutePoint[] | null {
    const here = actor.x / W;
    if (actor.lane) {
      const route = campRoute(layout, { lane: actor.lane, x: here }, to);
      return route ? fitRoute(actor, route) : null;
    }
    // Between lanes on a crossing: carry on to the nearest lane, then go.
    const lanes = [...layout.lanes.values()];
    const nearest = lanes.reduce((a, b) => (Math.abs(b.y * H - actor.y) < Math.abs(a.y * H - actor.y) ? b : a));
    const rest = campRoute(layout, { lane: nearest.id, x: here }, to);
    return rest ? fitRoute(actor, [{ x: here, y: actor.y / H, lane: null }, ...rest]) : null;
  }

  /** Every way from where the actor stands now, shortest first (`routeFrom`'s, and the ways round). */
  function routesFrom(actor: Actor, to: CampSpot): RoutePoint[][] {
    const here = actor.x / W;
    if (actor.lane) return campRoutes(layout, { lane: actor.lane, x: here }, to).map((route) => fitRoute(actor, route));
    const only = routeFrom(actor, to);
    return only ? [only] : [];
  }

  // ---------------------------------------------------------------------------
  // Figures
  // ---------------------------------------------------------------------------

  /** The actor's gait at the size it is drawn now: its stride shrinks with it. */
  function strideOf(actor: Actor): CampGait {
    return campStride(actor.gait, figureScale);
  }

  function sizeOf(def: CampFigure): { heightPx: number; gait: CampGait } {
    const heightPx = campHeightPx(def.heightCm, measure);
    return { heightPx, gait: campGait(def.heightCm, def.stance, pxPerCm, heightPx) };
  }

  /** The art's canvas is drawn so the nominal paint is `heightPx` tall (figure-scale.ts). */
  function fitArt(actor: Actor): void {
    const canvas = actor.heightPx / (ANCHOR_Y - 0.078);
    if (actor.sprite) {
      actor.sprite.width = canvas;
      actor.sprite.height = canvas;
    }
    actor.placeholder.scale.set(actor.heightPx / 100);
    const paint = actor.sprite ? measurePaint(actor.sprite.texture) : null;
    const width = paint ? canvas * (paint.right - paint.left) * .72 : canvas * .3;
    const shadow = campGroundShadow(width, actor.heightPx, actor.sprite?.texture, canvas);
    actor.container.addChildAt(shadow, actor.container.getChildIndex(actor.shadow));
    actor.shadow.destroy({ children: true });
    actor.shadow = shadow;
  }

  function loadArt(actor: Actor): void {
    const url = actor.def.url;
    if (!url) return;
    void load(url)
      .then((texture) => {
        if (destroyed || actors.get(actor.def.id) !== actor || actor.def.url !== url) return;
        const sprite = new Sprite(texture);
        sprite.tint = CAMP_AMBIENT_TINT;
        sprite.anchor.set(ANCHOR_X, ANCHOR_Y);
        actor.sprite?.destroy();
        actor.sprite = sprite;
        actor.placeholder.visible = false;
        actor.art.addChild(sprite);
        fitArt(actor);
      })
      .catch(() => {
        /* keep the placeholder: a to-do, not a broken image */
      });
  }

  function placeAt(actor: Actor, place: Place, face: 1 | -1 | null): void {
    const lane = laneOf(layout, place.spot.lane);
    actor.x = place.spot.x * W;
    actor.y = lane.y * H;
    actor.lane = lane.id;
    actor.point = place.point;
    const point = place.point ? standPoint(layout, place.point) : undefined;
    actor.action = point?.action ?? null;
    actor.facing = face ?? (point ? toFacing(point.face) : actor.facing);
    actor.facingNow = actor.facing;
    actor.walk = null;
    actor.walkTo = null;
    actor.arrivedAt = elapsed;
  }

  function addActor(def: CampFigure): Actor {
    const container = new Container();
    container.label = `figure:${def.id}`;
    const body = new Container();
    const art = new Container();
    const placeholder = drawPlaceholder(100);
    art.addChild(placeholder);
    body.addChild(art);
    const shadow = new Graphics();
    container.addChild(shadow, body);
    ground.addChild(container);
    const { heightPx, gait } = sizeOf(def);
    const actor: Actor = {
      def,
      container,
      body,
      art,
      shadow,
      sprite: null,
      placeholder,
      gait,
      heightPx,
      x: 0,
      y: 0,
      lane: null,
      point: null,
      facing: -1,
      facingNow: -1,
      walk: null,
      walkStart: 0,
      walkTo: null,
      arriveFacing: null,
      onArrive: null,
      arrivedAt: 0,
      action: null,
      alpha: 0,
      alphaTarget: 1,
      teleport: null,
      waveStart: null,
      releaseAt: null,
      stepOutBy: null,
      queueWaitSince: null,
      carryLift: 0,
      carryRotation: 0,
      lastLift: 0,
      lastRotation: 0,
      // Seeded too, so two screens breathe alike.
      phase: ((hash(def.id) ^ seed) % 628) / 100,
      leaving: false,
      removing: false,
      airborne: false,
      moving: false,
    };
    actors.set(def.id, actor);
    fitArt(actor);
    const habitSpot = def.habit ? friendHabitSpot(layout, def.habit) : undefined;
    const home = habitSpot ? { spot: { lane: habitSpot.lane, x: pointX(habitSpot) }, point: null } : homeOf(actor);
    placeAt(actor, home, habitSpot ? toFacing(habitSpot.face) : null);
    planner.add({ id: def.id, ...(def.seat !== undefined ? { seat: def.seat } : {}) }, home);
    if (habitSpot) planner.direct(def.id, home, null, 0);
    loadArt(actor);
    if (def.habit === "mosshorn") {
      void load(leafArt).then((texture) => {
        if (destroyed || actors.get(def.id) !== actor) return;
        const leaf = new Sprite(texture);
        leaf.label = "mosshorn-leaf";
        leaf.anchor.set(0.5);
        leaf.visible = false;
        actor.leaf = leaf;
        actor.container.addChild(leaf);
      }).catch(() => {});
    }
    return actor;
  }

  /** Walk an actor along `route` to `to`, starting `delay` seconds from now. */
  /**
   * A route's corners (its crossings) moved in from an edge the pane crops,
   * so a figure changing lanes there is still seen whole. Its two ends stay:
   * where the figure is, and where it is going (already placed on screen).
   */
  function fitRoute(actor: Actor, route: RoutePoint[]): RoutePoint[] {
    if (route.length < 3) return route;
    const span = visible();
    const scale = Math.max(...[...layout.lanes.values()].map((lane) => lane.scale));
    const range = campStandRange({ x0: 0, x1: 1 }, span, widthOf(actor, scale));
    return route.map((p, i) => (i === 0 || i === route.length - 1 ? p : { ...p, x: campStandX(p.x, range) }));
  }

  function startWalk(actor: Actor, route: RoutePoint[], to: Place, startedAt = elapsed): void {
    // Whatever hop or lean was under way eases out rather than snapping.
    actor.carryLift = actor.lastLift;
    actor.carryRotation = actor.lastRotation;
    actor.walk = planWalk(route, layout.canvas, strideOf(actor), actor.facing);
    actor.walkStart = startedAt;
    actor.walkTo = to;
    actor.point = null;
    actor.action = null;
    actor.waveStart = null;
  }

  /** Be somewhere else at once: fade out, move, fade back in (§8.6, rule 3). */
  function teleport(
    actor: Actor,
    place: Place,
    alpha: number,
    face: 1 | -1 | null,
    then: (() => void) | null = null,
    waitClear = false,
  ): void {
    actor.walk = null;
    actor.walkTo = null;
    actor.onArrive = null;
    actor.teleport = { place, alpha, facing: face, then, clearBy: waitClear ? elapsed + CLEAR_WAIT_S : null };
    actor.alphaTarget = 0;
    actor.waveStart = null;
  }

  /** Hand an actor to a moment: walk (or, still, fade) to `to`. */
  function direct(
    actor: Actor,
    to: Place,
    opts: {
      alpha?: number;
      face?: 1 | -1 | null;
      delay?: number;
      then?: () => void;
      /** By a fade, never a walk. */
      fade?: boolean;
      /** A fade that reappears only once nobody stands there (`bodiesClear`). */
      waitClear?: boolean;
      /** The way to walk, when the caller has chosen one (`clearWay`). */
      route?: RoutePoint[];
    } = {},
  ): void {
    actor.releaseAt = null;
    actor.stepOutBy = null;
    actor.leaving = false;
    actor.arriveFacing = opts.face ?? null;
    const alpha = opts.alpha ?? 1;
    const route = still || opts.fade ? null : opts.route ?? routeFrom(actor, to.spot);
    if (!route || actor.alpha < 0.05) {
      planner.direct(actor.def.id, to, null, 0);
      teleport(actor, to, alpha, opts.face ?? null, opts.then ?? null, opts.waitClear ?? false);
      return;
    }
    actor.teleport = null;
    actor.alphaTarget = alpha;
    startWalk(actor, route, to, elapsed + (opts.delay ?? 0));
    actor.onArrive = opts.then ?? null;
    planner.direct(actor.def.id, to, route, (opts.delay ?? 0) + actor.walk!.duration);
  }

  // ---------------------------------------------------------------------------
  // The frame
  // ---------------------------------------------------------------------------

  function finishWalk(actor: Actor): void {
    const to = actor.walkTo;
    const walk = actor.walk!;
    actor.walk = null;
    actor.walkTo = null;
    if (to) {
      actor.point = to.point;
      const point = to.point ? standPoint(layout, to.point) : undefined;
      actor.action = point?.action ?? null;
      actor.facing = actor.arriveFacing ?? (point ? toFacing(point.face) : walk.endHeading);
    }
    actor.arriveFacing = null;
    actor.arrivedAt = actor.walkStart + walk.duration;
    const then = actor.onArrive;
    actor.onArrive = null;
    then?.();
  }

  function tickActor(actor: Actor, dt: number): void {
    // Fading somewhere else: move only once nobody can see it go.
    const clearing = actor.teleport?.clearBy ?? null;
    if (actor.teleport && actor.alpha < 0.02 && (clearing === null || elapsed >= clearing || bodiesClear(actor, actor.teleport.place))) {
      const { place, alpha, facing, then } = actor.teleport;
      actor.teleport = null;
      placeAt(actor, place, facing);
      actor.alphaTarget = alpha;
      then?.();
    }

    let lift = 0;
    let rotation = 0;
    let scaleX = 1;
    let scaleY = 1;
    let shadow = 1;
    let turned = false;
    actor.airborne = false;
    actor.moving = false;

    if (actor.walk) {
      const pose = walkPose(actor.walk, elapsed - actor.walkStart);
      actor.x = pose.x;
      actor.y = pose.y;
      actor.lane = pose.lane;
      lift = pose.lift;
      rotation = pose.rotation;
      scaleX = pose.scaleX;
      scaleY = pose.scaleY;
      shadow = pose.shadow;
      actor.facing = pose.facing;
      actor.airborne = pose.airborne;
      actor.moving = pose.moving;
      if (actor.leaving && actor.x / W > laneOf(layout, layout.frame.trailhead.lane).x1) actor.alphaTarget = 0;
      if (actor.leaving && actor.x / W < laneOf(layout, layout.frame.trailhead.lane).x0) actor.alphaTarget = 0;
      if (pose.done) finishWalk(actor);
    }

    if (!actor.walk) {
      const since = elapsed - actor.arrivedAt;
      const habit = actor.leaving ? undefined : actor.def.habit;
      const settle = habit === "bun" ? bunSettlePose : habit === "duckling" ? ducklingSettlePose : undefined;
      const pose = settle?.(since, still) ?? actionPose(actor.action ?? "rest", since, still || !actor.action);
      const forward = actor.facing;
      rotation += pose.lean * forward;
      lift += pose.lift * actor.heightPx;
      scaleY *= 1 - pose.low;
      if (actor.waveStart !== null) {
        const wave = wavePose(elapsed - actor.waveStart, still);
        lift += wave.lift * actor.heightPx;
        turned = wave.turned;
        if (elapsed - actor.waveStart > WAVE_S) actor.waveStart = null;
      }
      const idle = stanceIdle(actor.def.stance, elapsed * pose.breathPace, actor.phase, still);
      scaleY *= 1 + idle.breath;
      rotation += idle.rotation;
      lift -= idle.dy * actor.heightPx;
      shadow *= idle.shadow * breathingShadowScale(idle.breath);
    } else if (actor.def.stance !== "standing") {
      // Hovering and flying figures glide with their bob.
      const idle = stanceIdle(actor.def.stance, elapsed, actor.phase, still);
      lift -= idle.dy * actor.heightPx;
      shadow *= idle.shadow;
    }

    if (actor.releaseAt !== null && elapsed >= actor.releaseAt) {
      actor.releaseAt = null;
      planner.release(actor.def.id);
    }

    // The remains of an interrupted hop ease away.
    actor.carryLift = approach(actor.carryLift, 0, CARRY_RATE, dt);
    actor.carryRotation = approach(actor.carryRotation, 0, CARRY_RATE, dt);
    actor.lastLift = lift;
    actor.lastRotation = rotation;

    const target = turned ? -actor.facing : actor.facing;
    actor.facingNow = still ? target : approach(actor.facingNow, target, TURN_RATE, dt);
    // Fades ease in reduced motion too: an arrival there is a soft fade (§8.7).
    actor.alpha = approach(actor.alpha, actor.alphaTarget, FADE_RATE, dt);
    if (Math.abs(actor.alpha - actor.alphaTarget) < 0.002) actor.alpha = actor.alphaTarget;

    // Hovering and flying figures are held off the ground as the other stages hold them.
    const stanceLiftPx = actor.def.stance === "swimming"
      ? 0
      : Math.max(STANCE_LIFT[actor.def.stance] * actor.heightPx, STANCE_LIFT_CM[actor.def.stance] * pxPerCm);
    const laneScale = laneScaleAt(layout, actor.y / H);
    actor.container.x = actor.x;
    actor.container.y = actor.y;
    actor.container.zIndex = actor.y;
    // The figure's whole drawing, hop and shadow included, at the camp's
    // factor; its feet stay on the ground point, which the factor never moves.
    actor.container.scale.set(laneScale * figureScale);
    actor.container.alpha = actor.alpha;
    actor.body.y = -(lift + actor.carryLift + stanceLiftPx);
    actor.body.rotation = rotation + actor.carryRotation;
    actor.body.scale.y = scaleY;
    // Art is drawn facing left: scale.x 1 faces left, -1 right.
    actor.art.scale.x = -actor.facingNow * scaleX;
    if (actor.leaf) {
      const drop = mosshornLeafDrop(elapsed - actor.arrivedAt, still);
      actor.leaf.visible = actor.sprite !== null && !actor.leaving;
      actor.leaf.width = actor.leaf.height = actor.heightPx * 0.19;
      actor.leaf.x = -actor.heightPx * (0.22 + 0.1 * drop);
      actor.leaf.y = -actor.heightPx * (0.55 * (1 - drop) + 0.035);
      actor.leaf.rotation = -0.8 * drop;
    }
    actor.shadow.scale.set(Math.max(0.3, shadow));
    const cast = actor.shadow.getChildByLabel("camp-cast-body", true);
    if (cast) cast.scale.x = Math.abs(cast.scale.x) * (Math.sign(actor.art.scale.x) || 1);
  }

  function usingPoints(): string[] {
    const using: string[] = [];
    for (const a of actors.values()) if (!a.walk && !a.teleport && a.point && a.alpha > 0.5 && !a.removing) using.push(a.point);
    return using;
  }

  function tick(): void {
    if (destroyed) return;
    const dt = frameSeconds(app.ticker.deltaMS);
    elapsed += dt;
    updateAccent();
    easeFrame(dt);

    if (!still) {
      for (const walk of planner.advance(dt)) {
        const actor = actors.get(walk.id);
        if (!actor || actor.removing) continue;
        startWalk(actor, walk.route, walk.to, elapsed - (planner.clock - walk.startedAt));
      }
    }

    requeue();
    for (const actor of actors.values()) {
      if (actor.removing || actor.leaving) continue;
      if (actor.stepOutBy !== null) {
        if (actor.walk || actor.teleport) actor.stepOutBy = null;
        else if (elapsed >= actor.stepOutBy) {
          // Still boxed in by heroes who are lined up: out of the line by a fade, home.
          actor.stepOutBy = null;
          direct(actor, fadeHome(actor), { fade: true, waitClear: true, then: () => planner.release(actor.def.id) });
        }
      }
      keepOnScreen(actor);
    }

    for (const actor of [...actors.values()]) {
      tickActor(actor, dt);
      if (actor.removing && actor.alpha < 0.02) {
        actors.delete(actor.def.id);
        planner.remove(actor.def.id);
        actor.container.destroy({ children: true });
      }
    }

    const active = activeHotspots(layout.frame.standPoints, usingPoints());
    tickPitch();
    updateLabels();
    for (const piece of pieces.values()) {
      piece.container.scale.set(piece.laneScale * figureScale * piece.ownerScale * piece.pitch);
      if (!piece.part || !piece.motion) continue;
      piece.strength = approach(piece.strength, !still && active.has(piece.id) ? 1 : 0, PART_RATE, dt);
      if (piece.strength < 0.001) piece.strength = 0;
      const pose = partMotion(piece.motion, elapsed, piece.strength);
      piece.part.y = pose.dy * 0.1 * H;
      piece.part.rotation = pose.rotation;
      piece.part.scale.set(pose.scaleX, pose.scaleY);
      piece.part.alpha = pose.alpha;
    }
  }
  app.ticker.add(tick);

  // ---------------------------------------------------------------------------
  // The API
  // ---------------------------------------------------------------------------

  function setFigures(figures: readonly CampFigure[]): void {
    if (destroyed) return;
    for (const definition of layout.frame.pieces) {
      const piece = pieces.get(definition.id)!;
      const owner = campPieceOwner(layout, definition, figures);
      // Her gear fits her (camp-ownership.ts): sized from her drawn box, never smaller.
      piece.ownerScale = ownedPieceSize(layout, definition, owner).scale;
      piece.container.scale.set(piece.laneScale * figureScale * piece.ownerScale * piece.pitch);
      lastOwners.set(definition.id, owner);
      if (definition.id.startsWith("tent_")) {
        // Her tent (§4.5): the one she picked, or her bedroll style's.
        const tent = tentArt(owner?.tent ?? null, owner ? campKitStyle(owner.id, owner.kitStyle) : "rolled");
        if (!tent) continue;
        const accent = owner?.accent;
        const key = `${tent.id}:${accent ?? ""}`;
        if (piece.kitKey === key) {
          drawStandIn(piece, owner);
          continue;
        }
        piece.kitKey = key;
        const revision = ++piece.kitRevision;
        piece.heightPx = campHeightPx(tent.heightCm ?? pieceHeightCm(definition), measure);
        piece.partSprite?.destroy();
        piece.partSprite = null;
        const cloth = campTentCloth(tent.id);
        void loadPiece(piece, tent.path, cloth, accent).then(async () => {
          if (destroyed || piece.kitRevision !== revision || piece.missing || !piece.part || !tent.flap) return;
          const texture = await load(assetUrl(tent.flap));
          if (destroyed || piece.kitRevision !== revision) return;
          piece.partSprite = new Sprite(tintCloth(texture, cloth, accent));
          fitSprite(piece.partSprite, piece.fit);
          piece.part.addChild(piece.partSprite);
        }).catch(() => undefined);
        continue;
      }
      if (definition.id.startsWith("souvenirs_")) {
        drawStandIn(piece, owner);
        continue;
      }
      if (!definition.id.startsWith("bedroll")) continue;
      const key = owner?.accent ? `${owner.id}:${owner.accent}:${owner.kitStyle ?? ""}` : undefined;
      if (piece.kitKey === key) continue;
      piece.kitKey = key;
      const revision = ++piece.kitRevision;
      // Restore the neutral painting immediately, including while a replacement
      // owner's kit loads. A departed owner's request must never repaint it.
      if (piece.neutralTexture) showPieceArt(piece, piece.neutralTexture);
      if (!key || !owner?.accent) continue;
      const accent = owner.accent;
      const style = campKitStyle(owner.id, owner.kitStyle);
      void load(assetUrl(CAMP_KIT_STYLES[style].path.replace(/^\/assets\//, ""))).then(texture => {
        if (destroyed || piece.kitRevision !== revision) return;
        const source = texture.source?.resource as CanvasImageSource | undefined;
        const canvas = source ? campKitCanvas(source, CAMP_KIT_STYLES[style].cloth, accent) : null;
        showPieceArt(piece, canvas ? Texture.from(canvas) : texture, CAMP_KIT_STYLES[style].path);
      }).catch(() => undefined);
    }
    const wanted = new Set(figures.map((f) => f.id));
    for (const actor of actors.values()) {
      if (!wanted.has(actor.def.id) && !actor.removing) {
        actor.removing = true;
        const at = queue.indexOf(actor.def.id);
        if (at >= 0) queue.splice(at, 1);
        actor.alphaTarget = 0;
        actor.teleport = null;
      }
    }
    requeue(false);
    for (const def of figures) {
      const actor = actors.get(def.id);
      if (!actor) {
        addActor(def);
        continue;
      }
      actor.removing = false;
      if (actor.alphaTarget === 0 && !actor.leaving && !actor.teleport) actor.alphaTarget = 1;
      const urlChanged = actor.def.url !== def.url;
      const sizeChanged = actor.def.heightCm !== def.heightCm || actor.def.stance !== def.stance;
      actor.def = def;
      if (sizeChanged) {
        const size = sizeOf(def);
        actor.heightPx = size.heightPx;
        actor.gait = size.gait;
        fitArt(actor);
      }
      if (urlChanged) {
        actor.sprite?.destroy();
        actor.sprite = null;
        actor.placeholder.visible = true;
        loadArt(actor);
      }
    }
    heroes = figures.filter((f) => f.seat !== undefined).map((f) => ({ seat: f.seat!, heightCm: f.heightCm, id: f.id, ...(f.species ? { species: f.species } : {}), ...(f.name ? { name: f.name } : {}), kitStyle: f.kitStyle ?? null, tent: f.tent ?? null, souvenirs: f.souvenirs ?? 0 }));
    labelsDirty = true;
    // A taller hero sitting down raises the band the frame keeps in the window.
    frame();
  }

  function setSeed(next: number): void {
    if (destroyed || next === seed) return;
    seed = next;
    const old = planner;
    planner = makePlanner(seed);
    for (const actor of actors.values()) {
      if (actor.removing) continue;
      const was = old.snapshot(actor.def.id);
      const seat = actor.def.seat !== undefined ? { seat: actor.def.seat } : {};
      const here: Place = { spot: { lane: actor.lane ?? layout.frame.trailhead.lane, x: actor.x / W }, point: actor.walk ? null : actor.point };
      planner.add({ id: actor.def.id, ...seat }, here);
      // A walk under way finishes; the new plan starts from where it ends.
      if (actor.walk && actor.walkTo) {
        const remaining = Math.max(0, actor.walkStart + actor.walk.duration - elapsed);
        planner.direct(actor.def.id, actor.walkTo, actor.walk.points.map((p) => ({ x: p.x / W, y: p.y / H, lane: p.lane })), remaining);
        if (was?.mode !== "directed") {
          const chained = actor.onArrive;
          actor.onArrive = () => {
            chained?.();
            planner.release(actor.def.id);
          };
        }
      } else if (was?.mode === "directed") {
        planner.direct(actor.def.id, here, null, 0);
      }
    }
  }

  function moment(kind: CampMoment, figureId?: string): void {
    if (destroyed) return;
    if (kind === "setOff") {
      setOff();
      return;
    }
    const actor = figureId ? actors.get(figureId) : undefined;
    if (!actor || actor.removing) return;
    switch (kind) {
      case "arrive": {
        // Crawls out of the tent, or sits up on the bedroll: at home, and a wave.
        const home = homeOf(actor);
        const present = actor.alphaTarget > AWAY_ALPHA && !actor.leaving && !actor.teleport;
        const wave = (): void => {
          actor.waveStart = elapsed;
          actor.releaseAt = elapsed + WAVE_S;
        };
        actor.leaving = false;
        leaveQueue(actor);
        if (present && actor.alpha > 0.9) {
          // Already here: wave where they stand, after whatever walk they are on.
          if (actor.walk) {
            const chained = actor.onArrive;
            actor.onArrive = () => {
              chained?.();
              wave();
            };
          } else {
            planner.direct(actor.def.id, { spot: { lane: actor.lane ?? home.spot.lane, x: actor.x / W }, point: actor.point }, null, 0);
            wave();
          }
          return;
        }
        planner.direct(actor.def.id, home, null, 0);
        if (actor.alpha < 0.05) {
          actor.teleport = null;
          placeAt(actor, home, null);
          actor.alphaTarget = 1;
          wave();
        } else {
          teleport(actor, home, 1, null, wave);
        }
        return;
      }
      case "ready":
        if (queue.includes(actor.def.id)) return;
        actor.stepOutBy = null;
        queue.push(actor.def.id);
        // Out of wandering from now, even while it waits its turn to walk to the line.
        holdForMoment(actor);
        requeue(false);
        return;
      case "unready": {
        // Out of the line, and back to wandering: promptly, and through nobody.
        if (!queue.includes(actor.def.id)) return;
        leaveQueue(actor);
        actor.queueWaitSince = null;
        const id = actor.def.id;
        if (still || actor.alpha < 0.05 || actor.teleport) {
          direct(actor, fadeHome(actor), { fade: true, waitClear: true, then: () => planner.release(id) });
          return;
        }
        if (actor.walk) {
          // On the way to the line: home from here if the way is clear, else on to
          // where it was going and out of the line from there.
          const home = homeOf(actor);
          const way = clearWay(actor, home.spot);
          if (way.route) {
            direct(actor, home, { route: way.route, then: () => planner.release(id) });
            return;
          }
          holdForMoment(actor);
          const chained = actor.onArrive;
          actor.onArrive = () => {
            chained?.();
            stepOut(actor);
          };
          return;
        }
        holdForMoment(actor);
        stepOut(actor);
        return;
      }
      case "away":
        leaveQueue(actor);
        direct(actor, homeOf(actor), { alpha: AWAY_ALPHA });
        return;
    }
  }

  /** Begin: everybody down the trail and off the edge, nearest first. */
  function setOff(): void {
    const out = trailOut();
    const t = layout.frame.trailhead;
    const exit: Place = { spot: { lane: t.lane, x: out.side > 0 ? 1 + OFF_EDGE : -OFF_EDGE }, point: null };
    // The Ready queue goes first, front to back, then everybody else, nearest the trail first.
    const inLine = (a: Actor): number => {
      const at = queue.indexOf(a.def.id);
      return at < 0 ? Infinity : at;
    };
    const crew = [...actors.values()]
      .filter((a) => !a.removing)
      .sort(
        (a, b) =>
          inLine(a) - inLine(b) ||
          Math.abs(a.x / W - t.x) - Math.abs(b.x / W - t.x) ||
          a.def.id.localeCompare(b.def.id),
      );
    queue.length = 0;
    crew.forEach((actor, rank) => {
      if (still || actor.alpha < 0.05) {
        planner.direct(actor.def.id, exit, null, 0);
        actor.walk = null;
        actor.walkTo = null;
        actor.teleport = null;
        actor.alphaTarget = 0;
        actor.leaving = true;
        return;
      }
      direct(actor, exit, {
        delay: rank * SET_OFF_STAGGER_S,
        face: out.side,
        then: () => {
          actor.alphaTarget = 0;
        },
      });
      actor.leaving = true;
    });
  }

  function setStill(next: boolean): void {
    if (destroyed || next === still) return;
    still = next;
    updateAccent();
    if (!still) return;
    // Nobody wanders and nothing hops: whoever is walking is at their
    // destination instead, by a fade.
    for (const actor of actors.values()) {
      if (!actor.walk || !actor.walkTo) continue;
      const to = actor.walkTo;
      const then = actor.onArrive;
      const face = actor.arriveFacing;
      const alpha = actor.leaving ? 0 : actor.alphaTarget;
      planner.direct(actor.def.id, to, null, 0);
      teleport(actor, to, alpha, face, then);
    }
  }

  let pane = { width: 0, height: 0 };
  let insetBottom = 0;
  let insetTop = 0;

  /** Where the camp is framed this frame, and where it is headed. */
  let framed: CampFraming | null = null;
  let framing: CampFraming | null = null;

  /**
   * Frame the camp in the pane (camp-framing.ts `campFraming`). A new pane
   * size is a cut (the whole canvas is changing anyway); a new inset, which is
   * the lobby's panels growing or shrinking as somebody readies up, or a
   * taller hero sitting down, eases there, because a camp that jumped
   * whenever a line of text appeared would break §8.6's rule 3.
   */
  function frame(cut = false): void {
    if (destroyed || pane.width <= 0 || pane.height <= 0) return;
    const heights = [...actors.values()].filter((a) => !a.removing).map((a) => a.def.heightCm);
    // Her gear and the crew's pieces bound the row and the band too (camp-boxes.ts).
    const fit = campFitFor(pane.width, campWindow(pane.height, insetTop, insetBottom), layout, boxInput(), 0.5, heights);
    framing = fit.framing;
    figureScaleTarget = fit.figureScale;
    if (cut || still || !framed) {
      figureScale = figureScaleTarget;
      place(framing);
    }
  }

  function easeFrame(dt: number): void {
    // The figures grow or shrink at the framing's pace, so the band and the
    // heads in it move together.
    if (figureScale !== figureScaleTarget) {
      figureScale = approach(figureScale, figureScaleTarget, FRAME_RATE, dt);
      if (Math.abs(figureScale - figureScaleTarget) < 1e-4) figureScale = figureScaleTarget;
    }
    if (!framing || !framed || framed === framing) return;
    const to = framing;
    const next = {
      scale: approach(framed.scale, to.scale, FRAME_RATE, dt),
      x: approach(framed.x, to.x, FRAME_RATE, dt),
      y: approach(framed.y, to.y, FRAME_RATE, dt),
    };
    const done = Math.abs(next.scale - to.scale) < 1e-4 && Math.abs(next.x - to.x) < 0.5 && Math.abs(next.y - to.y) < 0.5;
    place(done ? to : next);
  }

  function place(at: CampFraming): void {
    framed = at;
    view.scale.set(at.scale);
    view.x = at.x;
    view.y = at.y;
    if (bleedTop && bleedBottom) {
      // In canvas units: flipped about the painting's top and bottom edges,
      // stretched over whatever of the pane the painting leaves.
      const bleed = campBleed(pane.height, at, layout.canvas);
      const above = bleed.top / at.scale;
      const below = bleed.bottom / at.scale;
      const strip = (sprite: Sprite, px: number, y: number) => {
        sprite.visible = px > 0;
        sprite.scale.set(W / sprite.texture.frame.width, -px / sprite.texture.frame.height);
        sprite.y = y;
      };
      strip(bleedTop, above, 0);
      strip(bleedBottom, below, H + below);
    }
  }

  function resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    pane = { width, height };
    frame(true);
  }

  function setInset(bottomPx: number, topPx = 0): void {
    insetBottom = Number.isFinite(bottomPx) && bottomPx > 0 ? bottomPx : 0;
    insetTop = Number.isFinite(topPx) && topPx > 0 ? topPx : 0;
    frame();
  }

  function figures(): CampFigureView[] {
    return [...actors.values()].map((a) => ({
      id: a.def.id,
      x: a.x,
      y: a.y,
      lift: -a.body.y,
      alpha: a.alpha,
      artScaleX: Math.sign(a.art.scale.x) || 1,
      lane: a.lane ?? laneAt(layout, a.y / H),
      walking: a.moving,
      airborne: a.airborne,
      point: a.walk ? null : a.point,
      figureScale,
      heightPx: a.heightPx * a.container.scale.y,
    }));
  }

  function activePieces(): string[] {
    return [...pieces.values()].filter((p) => p.strength > 0).map((p) => p.id);
  }

  // ---------------------------------------------------------------------------
  // The crew's pieces (#620): at their hotspots, and beside the campfire
  // ---------------------------------------------------------------------------

  interface DressView {
    key: string;
    container: Container;
    laneScale: number;
    heightPx: number;
    pitch: number;
    /** Its painting did not load (or it has none): its label is shown. */
    missing: boolean;
  }
  const dressed = new Map<string, DressView>();
  let dressing: CampDressing = { spots: [], beside: [] };
  /** The seated heroes, as their gear is sized and named (camp-boxes.ts). */
  let heroes: CampBoxInput["heroes"] = [];

  /** What camp-boxes.ts lays out: this party, and the crew's pieces. */
  function boxInput(): Omit<CampBoxInput, "figureScale"> {
    return { heroes, spots: dressing.spots, beside: dressing.beside };
  }

  function dressPiece(key: string, box: CampBox, piece: { path: string | null; heightCm: number; banner?: string | null; glow?: boolean }): DressView {
    const lane = laneOf(layout, box.lane);
    const container = new Container();
    container.label = `dress:${key}`;
    // Drawn from its ground contact; the box is centred on what is painted (camp-paint.ts).
    container.x = box.anchor;
    container.y = box.ground;
    container.zIndex = box.ground - 0.4;
    // The box is at full size on its lane; the container scales it by both.
    const heightPx = box.height / lane.scale;
    const widthPx = box.width / lane.scale;
    const view: DressView = { key, container, laneScale: lane.scale, heightPx, pitch: 1, missing: false };
    // Where its paint's middle is, off its ground contact.
    const middle = (box.x - box.anchor) / lane.scale;
    if (piece.glow) {
      const glow = hotspotGlow(Math.max(widthPx, campHeightPx(120, measure)));
      glow.x = middle;
      container.addChild(glow);
    }
    const body = new Container();
    container.addChild(body);
    const standIn = (): void => {
      if (destroyed || body.destroyed) return;
      body.removeChildren().forEach((c) => c.destroy({ children: true }));
      const shape = pieceStandIn(heightPx, widthPx);
      shape.x = middle;
      body.addChild(shape);
      view.missing = true;
      labelsDirty = true;
    };
    if (piece.path) {
      void load(assetUrl(piece.path))
        .then((texture) => {
          if (destroyed || body.destroyed) return;
          const sprite = new Sprite(texture);
          fitSprite(sprite, fitCanvas(heightPx, campPaint(piece.path) ?? measurePaint(texture)));
          body.removeChildren().forEach((c) => c.destroy({ children: true }));
          body.addChild(sprite);
          view.missing = false;
          labelsDirty = true;
        })
        .catch(standIn);
    } else {
      standIn();
    }
    ground.addChild(container);
    return view;
  }

  function setDressing(next: CampDressing): void {
    if (destroyed) return;
    dressing = next;
    // Laid out at full size, so nothing slides as the figure factor eases.
    const full = new Map(campBoxes(layout, { ...boxInput(), figureScale: 1 }).map((b) => [b.id, b]));
    const want = new Map<string, { key: string; make: () => DressView }>();
    for (const spot of next.spots) {
      if (spot.pieceId === null && !spot.highlighted) continue;
      const lane = laneOf(layout, spot.lane);
      const box = full.get(`spot:${spot.id}`) ?? { id: spot.id, kind: "spot" as const, lane: spot.lane, x: spot.x * W, anchor: spot.x * W, ground: lane.y * H, width: 0, height: campHeightPx(20, measure) * lane.scale, label: null };
      const key = `${spot.pieceId ?? "-"}|${spot.banner ?? ""}|${spot.highlighted ? "lit" : ""}|${String(Math.round(box.x))}`;
      want.set(`spot:${spot.id}`, {
        key,
        make: () => dressPiece(`spot:${spot.id}`, box, { path: spot.pieceId ? spot.path : null, heightCm: spot.heightCm, banner: spot.banner, glow: spot.highlighted }),
      });
    }
    for (const piece of next.beside) {
      const box = full.get(`beside:${piece.pieceId}`);
      if (!box) continue;
      want.set(`beside:${piece.pieceId}`, {
        key: `${String(Math.round(box.x))}`,
        make: () => dressPiece(`beside:${piece.pieceId}`, box, { path: piece.path, heightCm: piece.heightCm }),
      });
    }
    for (const [id, view] of dressed) {
      const wanted = want.get(id);
      if (wanted && wanted.key === view.key) continue;
      view.container.destroy({ children: true });
      dressed.delete(id);
    }
    for (const [id, wanted] of want) {
      if (dressed.has(id)) continue;
      const view = wanted.make();
      view.key = wanted.key;
      dressed.set(id, view);
    }
    labelsDirty = true;
    frame();
  }

  // ---------------------------------------------------------------------------
  // The labels (camp-boxes.ts): small, over everything, clear of each other
  // ---------------------------------------------------------------------------

  const labelLayer = new Container();
  labelLayer.label = "camp-labels";
  view.addChild(labelLayer);
  const labels = new Map<string, Container>();
  let labelsDirty = true;
  let labelsAt = -1;

  /** Whose label shows: a stand-in's, never a painting's (its picture says what it is). */
  function showsLabel(box: CampBox): boolean {
    if (box.kind === "spot" || box.kind === "beside") return dressed.get(box.id)?.missing ?? false;
    if (box.kind === "tent") return pieces.get(box.id)?.missing ?? false;
    return false;
  }

  function updateLabels(): void {
    if (!labelsDirty && Math.abs(labelsAt - figureScale) < 0.002) return;
    labelsDirty = false;
    labelsAt = figureScale;
    const seen = new Set<string>();
    const show = (id: string, label: CampLabelBox, make: (text: string, size: number) => Container | null): void => {
      const key = `${id}|${label.text}|${String(label.size)}`;
      seen.add(key);
      let text = labels.get(key);
      if (!text) {
        const made = make(label.text, label.size);
        if (!made) return;
        text = made;
        labels.set(key, text);
        labelLayer.addChild(text);
      }
      text.x = label.x;
      text.y = label.y;
    };
    for (const box of campBoxes(layout, { ...boxInput(), figureScale })) {
      if (box.label && showsLabel(box)) show(box.id, box.label, standInLabel);
      // The crew's name on its banner pole, painted or not, wherever the pole stands.
      if (box.name && dressed.has(box.id)) show(`name:${box.id}`, box.name, bannerName);
    }
    for (const [key, text] of labels) {
      if (seen.has(key)) continue;
      text.destroy();
      labels.delete(key);
    }
  }

  let pitchFrom: number | null = null;

  function pitch(): void {
    if (destroyed) return;
    if (still) {
      // Reduced motion: the new camp is simply there, and the heroes wave.
      pitchFrom = null;
    } else {
      pitchFrom = elapsed;
    }
    for (const actor of actors.values()) moment("arrive", actor.def.id);
    tickPitch();
  }

  /** Every piece rises in turn, left to right, over `PITCH_S`. */
  let pitchSettled = true;
  function tickPitch(): void {
    if (pitchFrom === null && pitchSettled) {
      for (const d of dressed.values()) d.container.scale.set(d.laneScale * figureScale);
      return;
    }
    pitchSettled = pitchFrom === null;
    const order = [...pieces.values(), ...dressed.values()].sort((a, b) => a.container.x - b.container.x);
    order.forEach((p, i) => {
      if (pitchFrom === null) {
        p.pitch = 1;
        return;
      }
      const span = PITCH_S - PITCH_STAGGER_S * Math.min(order.length - 1, 8);
      const start = Math.min(i, 8) * PITCH_STAGGER_S;
      const t = Math.max(0, Math.min(1, (elapsed - pitchFrom! - start) / Math.max(0.3, span)));
      p.pitch = t * t * (3 - 2 * t);
    });
    for (const d of dressed.values()) d.container.scale.set(d.laneScale * figureScale * d.pitch);
    if (pitchFrom !== null && elapsed - pitchFrom >= PITCH_S) pitchFrom = null;
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    app.ticker.remove(tick);
    actors.clear();
    view.destroy({ children: true });
  }

  return {
    view,
    setFigures,
    setSeed,
    moment: moment as CampStage["moment"],
    setStill,
    resize,
    setInset,
    figures,
    activePieces,
    setDressing,
    pitch,
    pitching: () => pitchFrom !== null,
    destroy,
  };
}

/** A small stable hash of an id, for a figure's breathing phase. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
