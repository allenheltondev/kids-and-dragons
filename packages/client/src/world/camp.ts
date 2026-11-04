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
 *
 * Motion runs on frame time (`frameSeconds`), capped per frame, so a hidden
 * screen picks up where it was instead of replaying what it missed (§8.7).
 */

import { Assets, Container, Graphics, Rectangle, Sprite, Texture, type Application } from "pixi.js";
import { CAMP_KIT_STYLES, campKitStyle } from "./camp-kit-art";
import { campKitCanvas } from "./camp-kit-canvas";
import { campOwnedScale, campPieceOwner } from "./camp-ownership";
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
  campRoute,
  laneAt,
  laneOf,
  laneScaleAt,
  pieceHeightCm,
  standPoint,
  type CampAction,
  type CampFace,
  type CampLayout,
  type CampPartMotion,
  type CampSpot,
  type CampStandPoint,
  type RoutePoint,
} from "./camp-layout";
import {
  activeHotspots,
  actionPose,
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
import { createWanderPlanner, queueSpots, type WanderPlace, type WanderPlanner } from "./camp-wander";
import { stanceIdle } from "./idle-motion";
import { fitCanvas, NOMINAL_PAINT, paintAspect, STANCE_LIFT, STANCE_LIFT_CM } from "./figure-scale";
import { reducedMotion } from "../a11y/prefs";
import { BLEED_SOURCE, campBleed, campFit, campWindow, type CampFraming } from "./camp-framing";

/** Somebody in camp: a hero or a friend. */
export interface CampFigure {
  id: string;
  /** The cutout, or null for the "art pending" placeholder. */
  url: string | null;
  /** True height (figure-scale.ts `figureSize`). */
  heightCm: number;
  stance: CastStance;
  /** A hero's seat (0 to 3), whose bedroll is theirs. Friends have none. */
  seat?: number;
  /** Hero accent for their own bedroll; friends have no kit. */
  accent?: string;
}

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


type Place = WanderPlace;

interface Actor {
  def: CampFigure;
  container: Container;
  body: Container;
  art: Container;
  shadow: Container;
  sprite: Sprite | null;
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
  teleport: { place: Place; alpha: number; facing: 1 | -1 | null; then: (() => void) | null } | null;
  waveStart: number | null;
  releaseAt: number | null;
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
  shadow: Container;
  groundCount: number;
  mirrored: boolean;
  kitKey?: string;
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
    .then(showBackdrop, () => (fallback ? load(fallback).then(showBackdrop) : undefined))
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
    void load(assetUrl(piece.path))
      .then((texture) => {
        if (destroyed || entry.kitKey && entry.sprite) return;
        const sprite = new Sprite(texture);
        // Measured like a figure, so a campfire painted small in its canvas
        // is still its true height; the part follows the same fit.
        entry.fit = fitCanvas(heightPx, measurePaint(texture));
        fitPieceShadow(entry, texture);
        fitSprite(sprite, entry.fit, entry.mirrored);
        if (entry.partSprite) fitSprite(entry.partSprite, entry.fit);
        pending.destroy();
        entry.sprite = sprite;
        container.addChildAt(sprite, entry.groundCount);
      })
      .catch(() => undefined);
  }
  for (const moving of layout.frame.movingParts) {
    const piece = pieces.get(moving.piece);
    if (!piece || piece.part) continue;
    const part = new Container();
    part.label = `part:${moving.piece}`;
    piece.container.addChild(part);
    piece.part = part;
    piece.motion = moving.motion;
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
    });
  }

  // ---------------------------------------------------------------------------
  // Places
  // ---------------------------------------------------------------------------

  const pointPlace = (point: CampStandPoint): Place => ({ spot: { lane: point.lane, x: point.x }, point: point.id });

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

  /** A hero's own bedroll, or for a friend (or a hero with no bedroll free) the first free point. */
  function homeOf(actor: Actor): Place {
    const points = layout.frame.standPoints;
    const own = actor.def.seat === undefined ? undefined : points.find((p) => p.seat === actor.def.seat);
    if (own) return pointPlace(own);
    const held = heldPoints(actor);
    const free = points.find((p) => p.seat === undefined && !held.has(p.id)) ?? points.find((p) => !held.has(p.id));
    return free ? pointPlace(free) : { spot: { ...layout.frame.trailhead }, point: null };
  }

  /** Where the trail leaves camp, and which way. */
  function trailOut(): { side: 1 | -1; lane: string } {
    const t = layout.frame.trailhead;
    return { side: t.x >= 0.5 ? 1 : -1, lane: t.lane };
  }

  /** Heroes who tapped Ready, in the order they tapped (§8.5). */
  const queue: string[] = [];

  /** How wide a figure stands on the trailhead's lane, as a fraction of the canvas width. */
  function widthOnTrail(actor: Actor): number {
    const lane = laneOf(layout, layout.frame.trailhead.lane);
    return (actor.heightPx * figureScale * paintAspect(NOMINAL_PAINT) * lane.scale) / W;
  }

  /** Walk everyone in the queue to their place in it: the first at the trailhead, the rest behind. */
  function requeue(): void {
    const t = layout.frame.trailhead;
    const lane = laneOf(layout, t.lane);
    const line = queue.map((id) => actors.get(id)).filter((a): a is Actor => a !== undefined && !a.removing);
    const spots = queueSpots(t.x, trailOut().side, line.map(widthOnTrail), lane);
    line.forEach((actor, i) => {
      const x = spots[i]!;
      const headed = actor.teleport?.place.spot ?? actor.walkTo?.spot ?? { lane: actor.lane, x: actor.x / W };
      if (headed.lane === t.lane && Math.abs(headed.x - x) < 1e-6) return;
      direct(actor, { spot: { lane: t.lane, x }, point: null }, { face: trailOut().side });
    });
  }

  function leaveQueue(actor: Actor): void {
    const at = queue.indexOf(actor.def.id);
    if (at < 0) return;
    queue.splice(at, 1);
    requeue();
  }

  /** A route from where the actor stands now, even mid-crossing. */
  function routeFrom(actor: Actor, to: CampSpot): RoutePoint[] | null {
    const here = actor.x / W;
    if (actor.lane) return campRoute(layout, { lane: actor.lane, x: here }, to);
    // Between lanes on a crossing: carry on to the nearest lane, then go.
    const lanes = [...layout.lanes.values()];
    const nearest = lanes.reduce((a, b) => (Math.abs(b.y * H - actor.y) < Math.abs(a.y * H - actor.y) ? b : a));
    const rest = campRoute(layout, { lane: nearest.id, x: here }, to);
    return rest ? [{ x: here, y: actor.y / H, lane: null }, ...rest] : null;
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
    const home = homeOf(actor);
    placeAt(actor, home, null);
    planner.add({ id: def.id, ...(def.seat !== undefined ? { seat: def.seat } : {}) }, home);
    loadArt(actor);
    return actor;
  }

  /** Walk an actor along `route` to `to`, starting `delay` seconds from now. */
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
  function teleport(actor: Actor, place: Place, alpha: number, face: 1 | -1 | null, then: (() => void) | null = null): void {
    actor.walk = null;
    actor.walkTo = null;
    actor.onArrive = null;
    actor.teleport = { place, alpha, facing: face, then };
    actor.alphaTarget = 0;
    actor.waveStart = null;
  }

  /** Hand an actor to a moment: walk (or, still, fade) to `to`. */
  function direct(
    actor: Actor,
    to: Place,
    opts: { alpha?: number; face?: 1 | -1 | null; delay?: number; then?: () => void } = {},
  ): void {
    actor.releaseAt = null;
    actor.leaving = false;
    actor.arriveFacing = opts.face ?? null;
    const alpha = opts.alpha ?? 1;
    const route = still ? null : routeFrom(actor, to.spot);
    if (!route || actor.alpha < 0.05) {
      planner.direct(actor.def.id, to, null, 0);
      teleport(actor, to, alpha, opts.face ?? null, opts.then ?? null);
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
    if (actor.teleport && actor.alpha < 0.02) {
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
      const pose = actor.action ? actionPose(actor.action, since, still) : actionPose("rest", 0, true);
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
    easeFrame(dt);

    if (!still) {
      for (const walk of planner.advance(dt)) {
        const actor = actors.get(walk.id);
        if (!actor || actor.removing) continue;
        startWalk(actor, walk.route, walk.to, elapsed - (planner.clock - walk.startedAt));
      }
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
    for (const piece of pieces.values()) {
      piece.container.scale.set(piece.laneScale * figureScale * piece.ownerScale);
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
      piece.ownerScale = campOwnedScale(campPieceOwner(layout, definition, figures), measure);
      piece.container.scale.set(piece.laneScale * figureScale * piece.ownerScale);
    }
    for (const def of figures) {
      if (def.seat === undefined || !def.accent) continue;
      const point = layout.frame.standPoints.find(p => p.seat === def.seat && p.action === "rest");
      const piece = point?.hotspot ? pieces.get(point.hotspot) : undefined;
      if (!piece) continue;
      const key = `${def.id}:${def.accent}`;
      if (piece.kitKey === key) continue;
      piece.kitKey = key;
      const style = campKitStyle(def.id);
      void load(assetUrl(CAMP_KIT_STYLES[style].path.replace(/^\/assets\//, ""))).then(texture => {
        if (destroyed || piece.kitKey !== key) return;
        const source = texture.source?.resource as CanvasImageSource | undefined;
        const canvas = source ? campKitCanvas(source, style, def.accent!) : null;
        const sprite = new Sprite(canvas ? Texture.from(canvas) : texture);
        piece.fit = fitCanvas(piece.heightPx, measurePaint(canvas ? sprite.texture : texture));
        fitPieceShadow(piece, sprite.texture);
        fitSprite(sprite, piece.fit, piece.mirrored);
        piece.sprite?.destroy();
        piece.sprite = sprite;
        for (const child of [...piece.container.children]) {
          if (child instanceof Graphics && !child.label.startsWith("camp-ground-")) child.destroy();
        }
        piece.container.addChildAt(sprite, piece.groundCount);
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
    requeue();
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
        queue.push(actor.def.id);
        requeue();
        return;
      case "unready": {
        // Out of the line, and back to wandering from where they are headed.
        if (!queue.includes(actor.def.id)) return;
        leaveQueue(actor);
        const here: Place = actor.walkTo ?? { spot: { lane: actor.lane ?? layout.frame.trailhead.lane, x: actor.x / W }, point: actor.point };
        if (actor.walk) {
          planner.direct(actor.def.id, here, null, Math.max(0, actor.walkStart + actor.walk.duration - elapsed));
          const chained = actor.onArrive;
          actor.onArrive = () => {
            chained?.();
            planner.release(actor.def.id);
          };
        } else {
          planner.direct(actor.def.id, here, null, 0);
          planner.release(actor.def.id);
        }
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
    const fit = campFit(pane.width, campWindow(pane.height, insetTop, insetBottom), layout, heights);
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
