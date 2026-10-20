/**
 * The combat board — spec §7.1, docs/briefs/combat-rendering.md step 2.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 *
 * This is the *spectacle* half of a fight: tiles, figures, the active-actor
 * ring, reachable-tile highlights, damage numbers. Input lives on the phone
 * (screens/CombatPanel.tsx) — a Pixi hit-test on a 35px tile is a miss waiting
 * to happen, and §2.1 makes the TV a pure display anyway, so nothing here is
 * tappable. It is also a pure *reader* of state: `update()` takes the mirrored
 * `EncounterState` and draws it; nothing here fetches, polls, or keeps combat
 * state of its own (brief, trap 2).
 *
 * COORDINATES: everything in this container is drawn in *board pixels* — one
 * tile is `BOARD_TILE_PX` square, tile (x, y) at (x·128, y·128) — which is the
 * native size of the biome tile sheets (asset-brief §4.5: 128×128 tiles in a
 * 4×4 sheet). The camera (world/camera.ts, applied by scene.ts) turns board
 * tiles into screen pixels; this module never sees a viewport.
 *
 * EVENTS VS STATE: a `COMBAT_SEQUENCE` presentation carries the beats (moved,
 * roll, damage, down…) and its patch is *held* until the hold elapses
 * (sync/channel.ts). So the beats are played here optimistically — a figure
 * starts walking when its `moved` event's moment arrives, a damage number pops
 * on the `damage` beat — and the patch that lands afterwards is the authority
 * that confirms where everybody ended up. A beat we play wrong is corrected by
 * the patch; a beat we skip costs spectacle, never truth.
 *
 * FIGURES: heroes and enemies use finished transparent illustrations. Shared
 * procedural motion keeps feet planted while the board handles travel, falls,
 * targeting, damage numbers and spell effects.
 *
 * TILE ART: sliced from `assets/biomes/<biome>/tiles.png` — row 0 is the four
 * floor variants, row 1 the four blocked variants (asset-brief §4.5). A sheet
 * that fails to load falls back to flat-coloured tiles in the theme palette,
 * with blocked tiles hatched — the same "a placeholder looks like a
 * placeholder" rule the character sprites follow. The variant per tile is a
 * deterministic hash of its coordinates so every client lays the same floor.
 *
 * THE PLACE FIGHTING BACK (#201): a fight with an `environment` gets one more
 * layer over the floor — hazard ground, rift exits, the captive's square —
 * decided square by square in world/environment-overlay.ts and only stroked
 * here, in procedural shapes (no art: the overlay must read on every biome's
 * sheet and on the flat fallback alike). A fight without one never builds the
 * layer, so its scene graph is node for node what it was. A hero who steps
 * through an exit fades out on the `escaped` beat and leaves the board with the
 * patch, the way a beaten monster does (§7.3); the clock and the words for
 * each beat are the shared screen's DOM (screens/RiftStatus.tsx), not Pixi
 * text, so they stay sharp and size with the pane.
 * ---------------------------------------------------------------------------
 */

import { reducedMotion } from "../a11y/prefs";
import { stanceIdle } from "./idle-motion";
import {
  drawnHeight,
  figureSize,
  fitCanvas,
  heightFit,
  NOMINAL_PAINT,
  STANCE_LIFT,
  type PaintBox,
  type StageMeasure,
} from "./figure-scale";
import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type {
  Board,
  CastStance,
  Combatant,
  EncounterEvent,
  EncounterState,
  PartyMember,
  Position,
} from "@kad/shared";
import { captivesOf, currentActor, currentActorId, legalMoves } from "@kad/shared";
import {
  ANCHOR_X,
  ANCHOR_Y,
  DOWN_RATE,
  FALLEN_ALPHA,
  FALLEN_ROTATION,
  WALK_RATE,
  approach,
  biomeTilesUrl,
  characterWorldArtUrl,
  drawContactShadow,
  drawPlaceholder,
  enemyArtUrl,
  breathingShadowScale,
  groundedFootprint,
  measurePaint,
  measureFootprint,
  shadowOffset,
  type Footprint,
} from "./actor-art";

import {
  createNameplate,
  fitNameplate,
  nameplateBoxOf,
  nameplateGap,
  nameplateLabel,
  type NameplateBox,
} from "./nameplate";
import { BOARD_TILE_PX, beatOffsetsMs, facingFor, naturalPath, tileVariant } from "./board-math";
import { dashedSquare, environmentOverlay, type OverlayTile } from "./environment-overlay";
import type { BoardAim } from "./previews";

export { BOARD_TILE_PX } from "./board-math";

/** A figure's canvas height before its size is known. Taller than a tile on
    purpose: creatures overlap the tile behind them, which is what the row
    z-sort exists to make read. */
const ACTOR_HEIGHT = BOARD_TILE_PX * 1.7;

/**
 * The board's measure for true relative size (#362, figure-scale.ts): 1.1
 * board pixels a centimeter, so a 160 cm hero paints about 1.4 tiles tall,
 * where every figure stood before sizes. The tallest combatant may reach 2.7
 * tiles; past that the whole board's figures shrink together, so proportion
 * holds. Nothing paints shorter than 0.55 of a tile, which at natural scale is
 * a 64 cm figure: a will-o'-wisp or a bone crawler fights at the floor, not
 * as a speck on its square.
 */
export const BOARD_MEASURE: StageMeasure = { pxPerCm: 1.1, headroom: BOARD_TILE_PX * 2.7, floor: BOARD_TILE_PX * 0.55 };

/**
 * A board stance: the board's ground is the board, so a swimmer fights
 * standing on its square (there is no water line to draw), and anything in the
 * air is lifted and casts a smaller shadow, as on the story stage.
 */
function boardStance(stance: CastStance): CastStance {
  return stance === "swimming" ? "standing" : stance;
}

/** The shadow a board stance casts, as on the story stage (scene.ts STANCE_SHADOW). */
const BOARD_STANCE_SHADOW: Readonly<Record<CastStance, number>> = {
  standing: 1,
  hovering: 0.6,
  flying: 0.45,
  swimming: 1,
};
/**
 * How fast a figure turns round (1/s). The same squash-through-edge-on the
 * story lineup uses (scene.ts), so a figure turns the same way on both
 * stages.
 */
const TURN_RATE = 9;

/** Where feet sit inside a tile — low, so the figure reads as *on* it. */
const FEET_Y = 0.82;

/**
 * How wide a party figure's nameplate may be, in board pixels.
 *
 * Strictly *under* one tile, and that is the whole point: tiles are one tile
 * apart, so a cap of 0.9 leaves a tenth of a tile of gutter between the names
 * of two figures standing side by side, and no arrangement of the party can
 * close it. A cap of 1.1 "a tile and a little" looked generous and read as
 * `SparklehoofSkyclaw` the moment two of them shared a row — the same gutter
 * reasoning the story lineup applies to its own slot (scene.ts).
 *
 * Party figures only: an enemy's label would be a spec id, and three goblins
 * are told apart by where they are standing, not by which one is which
 * (spec §7.3 — a beaten one simply leaves).
 */
const NAMEPLATE_MAX_WIDTH = BOARD_TILE_PX * 0.9;

/**
 * What the nameplate is sized against here — a tile, not the figure.
 *
 * The story lineup takes it from the figure's own height, and for one figure
 * standing in a 1600×900 rect that is the right relationship. A board is a
 * different picture: the same figure is a much smaller share of a 10×8 grid,
 * so the same fraction produced a name half the on-screen size of the lineup's
 * and marginal on a TV at full board extent. A tile is the board's unit of
 * measure, so sizing against it is what keeps the name the same *readable*
 * thing on both surfaces even though the arithmetic differs.
 */
const NAMEPLATE_TYPE_HEIGHT = BOARD_TILE_PX * 2.4;

/** The drop below the feet, from `ACTOR_HEIGHT` and not from the type size —
    a name in `nameLayer` is positioned in board space rather than inside its
    actor, so it needs the number, but it must be the *same* number the label
    was built with. `nameplateGap` is the one place that formula lives. */
const NAMEPLATE_OFFSET_Y = nameplateGap(ACTOR_HEIGHT);

/** A hero whose player stepped away (#258): the story lineup's fade (scene.ts). */
const AWAY_ALPHA = 0.5;

/** Whether this figure is a hero whose player has stepped away (#258). */
function isAway(party: readonly PartyMember[], combatantId: string): boolean {
  return party.some((m) => m.character.id === combatantId && !m.connected);
}

/**
 * A walk follows its route a square at a time, at this speed, rather than
 * gliding straight to the destination. Diagonals cost one step (spec §7.1),
 * and watching a hero cut corner to corner is how the table learns that a
 * far-looking square was only four steps away.
 */
const ROUTE_SPEED_PX = BOARD_TILE_PX * 7;
/** How long a footprint stays on a square the walk crossed. */
const TRAIL_LIFE_S = 1.6;

/** Everything `update()` needs, gathered by PixiStage from the store. */
export interface BoardViewState {
  readonly encounter: EncounterState;
  /** The chapter's biome, for the tile sheet. Null falls back to flat tiles. */
  readonly biome: string | null;
  /** Enemy spec id → authored art id ("enemies/will_o_wisp"). */
  readonly enemyArt: Readonly<Record<string, string>>;
  /** For species/tier art lookup by character id. */
  readonly party: readonly PartyMember[];
  /**
   * What the fighter whose turn it is has picked on their phone but not
   * confirmed (world/previews.ts) — ringed so the table sees it coming.
   */
  readonly aim?: BoardAim | null;
}

export interface BoardLayer {
  readonly container: Container;
  update(view: BoardViewState): void;
  /** Play a COMBAT_SEQUENCE's beats, spaced across the presentation hold. */
  playEvents(events: readonly EncounterEvent[], totalMs: number): void;
  /** Called from the scene's ticker — this module adds no ticker of its own,
      so PixiStage's stopped-when-hidden discipline holds for free. */
  tick(dtSeconds: number): void;
  /** The party names currently drawn, as boxes in board pixels. See
      `NameplateBox` for why this is readable at all. */
  nameplateBoxes(): NameplateBox[];
  /** Each figure's drawn `art.scale.x`, by id: 1 as drawn (facing left),
      -1 turned to face right, in between while turning. For tests. */
  facings(): Record<string, number>;
  /** The footprints still on the floor, in board pixels. For tests. */
  trailMarks(): { x: number; y: number }[];
  /** Each figure's drawn (painted) height in board pixels, and its stance, by id (#362). For tests. */
  figureSizes(): Record<string, { height: number; stance: CastStance }>;
  destroy(): void;
}

interface BoardActor {
  container: Container;
  art: Container;
  /** How tall this figure really is, and how it stands (#362). */
  heightCm: number;
  stance: CastStance;
  /** A hero is measured against the nominal box (figure-scale.ts). */
  hero: boolean;
  paint: PaintBox | null;
  footprint: Footprint | null;
  sprite: Sprite | null;
  /** Drawn painted height in board pixels, its canvas, and the canvas the shadow was drawn for. */
  height: number;
  canvas: number;
  shadowCanvas: number;
  /** The contact shadow, a sibling of `art` (see makeActor). */
  shadow: Graphics;
  /** How far right of the anchor the feet are, as drawn (facing left). The
      shadow follows `art.scale.x` across, so it stays under them on a turn. */
  shadowX: number;
  id: string;
  side: "party" | "enemy";
  /**
   * A hero whose player stepped away (#258): drawn faded, standing, never in
   * the knocked-down pose. The same fade the story lineup gives (scene.ts).
   */
  away: boolean;
  down: boolean;
  /** Board-pixel position of the feet; the container approaches it. */
  targetX: number;
  targetY: number;
  /**
   * The name under a party figure's feet — who this is, when two players
   * picked the same species (nameplate.ts). Null for a monster, and for a name
   * with nothing in it. A sibling of `art` rather than a child: the art
   * rotates and fades for the fallen pose, and a name is most wanted at
   * exactly the moment somebody is asking who is down.
   */
  label: Text | null;
  /**
   * "PUFFED" over a puffed-up enemy (#227) - words on a dark pill, for the
   * whole room to read from the sofa. Made when it puffs and destroyed when it
   * deflates, so a figure that never puffs has no extra child at all.
   */
  puffBadge: Container | null;
  /** What `label` is currently saying, so a renamed character is spotted
      without measuring a Text every patch. */
  labelText: string | null;
  /**
   * `art.scale.x`'s target: 1 as drawn (facing left), -1 turned to face
   * right. Set from `facingFor` on every patch, so a figure squares up to
   * whoever is nearest rather than staring at the left edge all fight.
   */
  facing: 1 | -1;
  /** Stable phase for this actor's idle breath. */
  phase: number;
  /**
   * The squares still to cross on a walk, as board-pixel feet positions,
   * nearest first. While non-empty the figure walks them at a steady pace
   * and drops a footprint on each; empty, it eases to `targetX/Y` as before.
   */
  route: { x: number; y: number }[];
  /**
   * Stepped through a rift exit (#201): the `escaped` beat sets it, `tick`
   * fades the figure and its name out, and the patch behind the beat takes
   * it off the board. Never set in a fight without an environment.
   */
  leaving: boolean;
}

/** A footprint on a square a walk crossed, fading out. */
interface TrailMark {
  x: number;
  y: number;
  age: number;
}

interface Floater {
  text: Text;
  age: number;
  x: number;
  y: number;
}

interface PendingBeat {
  at: number;
  event: EncounterEvent;
  /** A walk's squares, worked out when the sequence arrived (`playEvents`). */
  route?: readonly Position[];
}

/** The board looks down on its squares, so its shadows are rounder than the
    lineup's. */
const BOARD_SHADOW_SQUASH = 0.3;

/**
 * A figure's shadow on its square: fitted to the feet when the art has been
 * measured, a modest one at the anchor otherwise (a rig, a placeholder).
 * `height` is the figure's canvas height on screen.
 */
function drawShadow(side: string, height: number, footprint: Footprint | null): Graphics {
  return drawContactShadow(height, footprint, BOARD_SHADOW_SQUASH, side === "party" ? 1 : 0.9);
}

/** How long a figure's art may take before its stand-in is drawn instead. */
const PLACEHOLDER_GRACE_MS = 700;

/** The picked-not-confirmed mark — a cool cyan against the reach's gold. */
const AIM_COLOR = 0x6fe6ff;

const FLOATER_LIFE_S = 1.1;
const FLOATER_RISE = BOARD_TILE_PX * 0.5;

/** How fast a hero who stepped through an exit fades away (1/s). */
const LEAVE_RATE = 5;

export function createBoardLayer(): BoardLayer {
  const container = new Container();
  const tilesLayer = new Container();
  const highlightLayer = new Graphics();
  const actorsLayer = new Container();
  // Painter's order by zIndex: feet further down the board draw in front.
  actorsLayer.sortableChildren = true;
  /*
   * Names ride above every figure, not inside the one they belong to.
   *
   * They were children of their actor's container at first, which put them in
   * the depth sort — correct-looking, and wrong. Three party members start a
   * fight clustered on adjacent tiles, so the figure in front cropped the name
   * behind it to its last few letters: "…lehoof" where "Sparklehoof" should
   * be, in the opening frame of every encounter. A name half-eaten by a
   * teammate is worse than no name, and it fails hardest in exactly the case
   * the name exists for. So they get their own layer, positions followed per
   * frame in `tick`, on the same reasoning `floatLayer` sits above this one:
   * a label nobody can read is a label that is not there.
   */
  const nameLayer = new Container();
  const floatLayer = new Container();
  // Footprints on the floor, under every figure and over the reach glow.
  const trailLayer = new Graphics();
  container.addChild(tilesLayer, highlightLayer, trailLayer, actorsLayer, nameLayer, floatLayer);
  const trail: TrailMark[] = [];

  const activeRing = new Graphics();
  activeRing.visible = false;
  actorsLayer.addChild(activeRing);

  const actors = new Map<string, BoardActor>();
  const floaters: Floater[] = [];
  const pending: PendingBeat[] = [];

  let destroyed = false;
  let clock = 0;
  let pulse = 0;

  let view: BoardViewState | null = null;
  /** What the tiles were last built from, so update() rebuilds only on change. */
  let builtTerrain: readonly string[] | null = null;
  let builtBiome: string | null = null;
  /** The fight the actors were last synced for (`EncounterState.startedAt`). */
  let builtFight: number | null | undefined = undefined;
  /** The last moves drawn, as a cheap signature. */
  let movesKey = "";
  /**
   * The environment's marks (#201), over the floor and under the reach. Null
   * — not an empty layer — in a fight without an environment, so such a fight
   * has exactly the tree it always had.
   */
  let envLayer: Container | null = null;
  /** What `envLayer` was last drawn from (`EnvironmentOverlay.key`). */
  let envKey = "";

  // -------------------------------------------------------------------------
  // Tiles
  // -------------------------------------------------------------------------

  /**
   * The tile sheet for a biome, sliced. Cached as a promise so a re-entry into
   * the same biome does not refetch, and a failure caches as null so a missing
   * sheet is one 404, not one per rebuild.
   */
  const sheets = new Map<string, Promise<{ floor: Texture[]; blocked: Texture[] } | null>>();

  function tileSheet(biome: string): Promise<{ floor: Texture[]; blocked: Texture[] } | null> {
    const cached = sheets.get(biome);
    if (cached) return cached;
    const task = Assets.load<Texture>(biomeTilesUrl(biome))
      .then((sheet) => {
        const slice = (row: number, col: number) =>
          new Texture({
            source: sheet.source,
            frame: new Rectangle(col * BOARD_TILE_PX, row * BOARD_TILE_PX, BOARD_TILE_PX, BOARD_TILE_PX),
          });
        return {
          // asset-brief §4.5: floor ×4 then blocked ×4, in a 4×4 sheet.
          floor: [0, 1, 2, 3].map((col) => slice(0, col)),
          blocked: [0, 1, 2, 3].map((col) => slice(1, col)),
        };
      })
      .catch(() => null);
    sheets.set(biome, task);
    return task;
  }

  function buildTiles(encounter: EncounterState, biome: string | null): void {
    const { board } = encounter;
    builtTerrain = board.terrain;
    builtBiome = biome;
    drawFallbackTiles(tilesLayer, encounter);

    if (!biome) return;
    const wanted = board.terrain;
    void tileSheet(biome).then((sliced) => {
      // The fight may have moved on (or ended) while the sheet downloaded.
      if (destroyed || !sliced || builtTerrain !== wanted) return;
      tilesLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
      for (let y = 0; y < board.height; y++) {
        for (let x = 0; x < board.width; x++) {
          const blocked = board.terrain[y * board.width + x] === "blocked";
          const set = blocked ? sliced.blocked : sliced.floor;
          const sprite = new Sprite(set[tileVariant(x, y)]);
          sprite.x = x * BOARD_TILE_PX;
          sprite.y = y * BOARD_TILE_PX;
          tilesLayer.addChild(sprite);
        }
      }
      tilesLayer.addChild(drawGridLines(board.width, board.height));
      // Art or not, a wall must read as a wall from three metres (spec §11:
      // shape, never colour alone) — the inset ring marks every blocked tile.
      tilesLayer.addChild(drawBlockedMarkers(encounter));
    });
  }

  // -------------------------------------------------------------------------
  // Actors
  // -------------------------------------------------------------------------

  function feetOf(at: Position): { x: number; y: number } {
    return { x: (at.x + 0.5) * BOARD_TILE_PX, y: (at.y + FEET_Y) * BOARD_TILE_PX };
  }

  /** The art id behind an enemy (`will_o_wisp`), with the authored `enemies/` convention stripped. */
  function enemyArtId(combatant: Combatant, current: BoardViewState): string {
    const specId = combatant.id.split("#")[0] ?? combatant.id;
    const art = current.enemyArt[specId] ?? "";
    return art.startsWith("enemies/") ? art.slice("enemies/".length) : art;
  }

  /**
   * Every figure on the board at its true height relative to the others
   * (#362): natural scale, unless the tallest would pass `BOARD_MEASURE`'s
   * headroom, in which case everybody shrinks together; the tiny stand at the
   * floor. Run when the cast of the fight changes and as each cutout lands.
   */
  function sizeActors(): void {
    const standing = [...actors.values()].filter((actor) => !actor.leaving);
    const k = heightFit(standing, BOARD_MEASURE);
    for (const actor of actors.values()) {
      actor.height = drawnHeight(actor, k, BOARD_MEASURE);
      const fit = fitCanvas(actor.height, actor.paint, actor.hero ? NOMINAL_PAINT : actor.paint);
      actor.canvas = fit.canvas;
      if (actor.sprite) {
        actor.sprite.scale.set(fit.canvas / actor.sprite.texture.height);
        actor.sprite.y = fit.offsetY;
      }
      actor.shadowX = shadowOffset(fit.canvas, actor.footprint);
    }
  }

  function artUrlFor(combatant: Combatant, current: BoardViewState): string | null {
    if (combatant.side === "party") {
      const member = current.party.find((m) => m.character.id === combatant.id);
      if (!member) return null;
      return characterWorldArtUrl(
        member.character.species,
        member.character.tier,
        member.character.class,
      );
    }
    // Enemy ids are `<specId>#<n>` (encounter.ts); the art hangs off the spec.
    const specId = combatant.id.split("#")[0] ?? combatant.id;
    const art = current.enemyArt[specId];
    return art ? enemyArtUrl(art) : null;
  }

  function makeActor(combatant: Combatant, at: Position, current: BoardViewState): BoardActor {
    const actorContainer = new Container();
    const art = new Container();
    // A soft shadow on the tile under the feet. It sits outside `art` so a
    // fallen figure's tilt and fade leave it where it is: it is what puts a
    // flat cutout *on* the board rather than pasted over it.
    // Hidden until there is a figure to cast it: a shadow on an empty tile
    // while the art loads read as a hole in the board.
    const shadow = drawShadow(combatant.side, ACTOR_HEIGHT, null);
    shadow.visible = false;
    actorContainer.addChild(shadow, art);
    actorsLayer.addChild(actorContainer);

    // The stand-in only shows if the art is genuinely late or missing. Drawn
    // at once, it flashed up as a row of dark blocks at the start of every
    // fight on the TV for the beat it took the cutouts to load.
    const placeholder = drawPlaceholder(ACTOR_HEIGHT);
    placeholder.visible = false;
    art.addChild(placeholder);
    const reveal = setTimeout(() => {
      if (!placeholder.destroyed) placeholder.visible = true;
      if (!shadow.destroyed) shadow.visible = true;
    }, PLACEHOLDER_GRACE_MS);

    const feet = feetOf(at);
    const named =
      combatant.side === "party"
        ? current.party.find((m) => m.character.id === combatant.id)?.character.name ?? ""
        : "";
    const label = createNameplate(named, {
      typeHeight: NAMEPLATE_TYPE_HEIGHT,
      figureHeight: ACTOR_HEIGHT,
      maxWidth: NAMEPLATE_MAX_WIDTH,
    });
    if (label) {
      label.x = feet.x;
      label.y = feet.y + NAMEPLATE_OFFSET_Y;
      nameLayer.addChild(label);
    }

    // How tall this figure really is (#362): a hero's species, or the canon
    // creature behind the enemy's art.
    const size = combatant.side === "party"
      ? figureSize(`characters/${current.party.find((m) => m.character.id === combatant.id)?.character.species ?? ""}`)
      : figureSize(`entities/${enemyArtId(combatant, current)}`);
    const actor: BoardActor = {
      container: actorContainer,
      art,
      heightCm: size.heightCm,
      stance: boardStance(size.stance),
      hero: combatant.side === "party",
      paint: null,
      footprint: null,
      sprite: null,
      height: ACTOR_HEIGHT * (NOMINAL_PAINT.bottom - NOMINAL_PAINT.top),
      canvas: ACTOR_HEIGHT,
      shadowCanvas: ACTOR_HEIGHT,
      shadow,
      shadowX: 0,
      id: combatant.id,
      side: combatant.side,
      down: combatant.down,
      away: isAway(current.party, combatant.id),
      targetX: feet.x,
      targetY: feet.y,
      label,
      puffBadge: null,
      labelText: nameplateLabel(named),
      phase: Math.random() * Math.PI * 2,
      facing: facingFor(current.encounter, combatant.id) === "right" ? -1 : 1,
      route: [],
      leaving: false,
    };
    // Arrive already facing the right way; turning is for mid-fight.
    art.scale.x = actor.facing;
    actorContainer.x = feet.x;
    actorContainer.y = feet.y;
    actorContainer.zIndex = feet.y;

    // Same rule as the story lineup: always ask for the file, keep the
    // placeholder when it is not there. A list of "delivered art" goes stale;
    // a 404 cannot.
    const loadCutout = (): void => {
      const url = artUrlFor(combatant, current);
      if (!url) return;
      void Assets.load<Texture>(url)
        .then((texture) => {
          // Identity, not id — a stale resolve must not draw into a destroyed
          // container after the fight rebuilt this figure.
          if (destroyed || actors.get(combatant.id) !== actor) return;
          const sprite = new Sprite(texture);
          sprite.anchor.set(ANCHOR_X, ANCHOR_Y);
          clearTimeout(reveal);
          art.removeChildren();
          placeholder.destroy();
          art.addChild(sprite);
          // Some art fills a fifth of its canvas (a will-o'-wisp is a small
          // flame by design): the painting is measured, and the canvas scaled
          // so the painting is the figure's true height (sizeActors).
          actor.sprite = sprite;
          actor.paint = measurePaint(texture);
          actor.footprint = groundedFootprint(measureFootprint(texture), actor.paint);
          sizeActors();
          // Refit the shadow to where this figure's feet really are: most art
          // does not stand on the canvas centre line, and a shadow beside the
          // feet is what made figures look like they were hovering.
          const fitted = drawShadow(combatant.side, actor.canvas, actor.footprint);
          actorContainer.addChildAt(fitted, actorContainer.getChildIndex(actor.shadow));
          actor.shadow.destroy();
          actor.shadow = fitted;
          actor.shadowCanvas = actor.canvas;
          fitted.x = actor.shadowX * art.scale.x;
          // Fades up through the same easing that stands a fallen figure back
          // up (tick), so a figure arrives rather than appearing.
          if (!actor.down) art.alpha = 0;
        })
        .catch(() => {
          // Keep the placeholder, and show it now: a missing enemy must never
          // blank the board.
          clearTimeout(reveal);
          if (!placeholder.destroyed) placeholder.visible = true;
          if (!actor.shadow.destroyed) actor.shadow.visible = true;
        });
    };

    loadCutout();

    return actor;
  }

  function syncActors(current: BoardViewState): void {
    const { encounter } = current;
    const seen = new Set<string>();
    /*
     * A new fight starts every figure's facing fresh, even one whose id the
     * last fight also used (heroes always, `wisp#1` often): the board
     * outlives fights, and a facing earned in the last one would otherwise
     * carry into this one, where a refreshed TV or the phone grid would
     * start it from scratch and disagree.
     */
    const fight = encounter.startedAt ?? null;
    const newFight = fight !== builtFight;
    builtFight = fight;

    for (const combatant of encounter.combatants) {
      // Positions live once, on the board's actors (grid.ts). A beaten enemy
      // has left the board (§7.3) and simply stops being drawn.
      const gridActor = encounter.board.actors.find((a) => a.id === combatant.id);
      if (!gridActor) continue;
      seen.add(combatant.id);

      const existing = actors.get(combatant.id);
      const feet = feetOf(gridActor);
      if (existing) {
        existing.down = combatant.down;
        existing.away = isAway(current.party, combatant.id);
        setPuffed(existing, combatant.puffed !== undefined && !combatant.down);
        existing.targetX = feet.x;
        existing.targetY = feet.y;
        // A walk still on its way to where the patch says is left to finish;
        // a route to anywhere else is stale and gives way to the patch.
        const end = existing.route[existing.route.length - 1];
        if (end && (end.x !== feet.x || end.y !== feet.y)) existing.route = [];
        const facing = facingFor(encounter, combatant.id);
        if (facing !== null) existing.facing = facing === "right" ? -1 : 1;
        else if (newFight) existing.facing = 1;
        // A new fight arrives already facing; turning is for mid-fight.
        if (newFight) existing.art.scale.x = existing.facing;
        // A fade the last fight began (an `escaped` beat, #201) is that fight's.
        if (newFight) existing.leaving = false;
        // This module draws what it is given and keeps nothing of its own
        // (see the header), and a name is state like any other.
        //
        // Re-fit after the rewrite, not just the text. The *cap* is the tile
        // and does not change; the width of what is in the label does, so a
        // short name replaced by a long one would keep the old scale and
        // overrun into the next tile — the `SparklehoofSkyclaw` collision
        // NAMEPLATE_MAX_WIDTH exists to prevent, reintroduced by the one path
        // that skipped the fit.
        if (existing.label) {
          const name = nameplateLabel(
            current.party.find((m) => m.character.id === combatant.id)?.character.name ?? "",
          );
          if (name !== null && name !== existing.labelText) {
            existing.labelText = name;
            existing.label.text = name;
            fitNameplate(existing.label, NAMEPLATE_MAX_WIDTH);
          }
        }
        continue;
      }
      const made = makeActor(combatant, gridActor, current);
      actors.set(combatant.id, made);
      setPuffed(made, combatant.puffed !== undefined && !combatant.down);
    }

    for (const [id, actor] of [...actors.entries()]) {
      if (seen.has(id)) continue;
      actor.container.destroy({ children: true });
      // The name is not in that container (see `nameLayer`), so it does not
      // come down with it — a beaten figure would leave its label on the grid.
      actor.label?.destroy();
      actors.delete(id);
    }
    // Who is on the board decides how big everybody is drawn.
    sizeActors();
  }

  // -------------------------------------------------------------------------
  // Highlights — §7.2 "reachable tiles highlighted", straight from legalMoves
  // -------------------------------------------------------------------------

  function drawHighlights(encounter: EncounterState, aim: BoardAim | null): void {
    // Only a party figure's reach is the table's business; a monster's would
    // telegraph the AI and clutter the board (the server drives it anyway).
    const actor = currentActor(encounter);
    const moves = actor?.side === "party" ? legalMoves(encounter) : [];
    const spots = (list: readonly Position[]) => list.map((m) => `${m.x},${m.y}`).join(";");
    const key = `${spots(moves)}|${spots(aim?.tiles ?? [])}|${spots(aim?.targets ?? [])}`;
    if (key === movesKey) return;
    movesKey = key;

    highlightLayer.clear();
    for (const move of moves) {
      const pad = BOARD_TILE_PX * 0.08;
      highlightLayer
        .roundRect(
          move.x * BOARD_TILE_PX + pad,
          move.y * BOARD_TILE_PX + pad,
          BOARD_TILE_PX - pad * 2,
          BOARD_TILE_PX - pad * 2,
          BOARD_TILE_PX * 0.12,
        )
        .fill({ color: 0xffc95c, alpha: 0.14 })
        .stroke({ width: 3, color: 0xffc95c, alpha: 0.55 });
    }

    // The picked-but-not-confirmed tile and figures: brighter and thicker than
    // the reach, in a colour of their own, so "where she *could* go" and
    // "where she is about to go" never read as the same mark.
    for (const tile of aim?.tiles ?? []) {
      const pad = BOARD_TILE_PX * 0.04;
      highlightLayer
        .roundRect(
          tile.x * BOARD_TILE_PX + pad,
          tile.y * BOARD_TILE_PX + pad,
          BOARD_TILE_PX - pad * 2,
          BOARD_TILE_PX - pad * 2,
          BOARD_TILE_PX * 0.14,
        )
        .fill({ color: AIM_COLOR, alpha: 0.32 })
        .stroke({ width: 6, color: AIM_COLOR, alpha: 0.95 });
    }
    for (const target of aim?.targets ?? []) {
      highlightLayer
        .circle(
          (target.x + 0.5) * BOARD_TILE_PX,
          (target.y + 0.5) * BOARD_TILE_PX,
          BOARD_TILE_PX * 0.46,
        )
        .fill({ color: AIM_COLOR, alpha: 0.22 })
        .stroke({ width: 6, color: AIM_COLOR, alpha: 0.95 });
    }
  }

  // -------------------------------------------------------------------------
  // The environment (#201) — see world/environment-overlay.ts
  // -------------------------------------------------------------------------

  function drawEnvironment(encounter: EncounterState): void {
    const overlay = environmentOverlay(encounter);
    if (!overlay) {
      // A new fight without one, on a board that drew one before.
      if (envLayer) {
        envLayer.destroy({ children: true });
        envLayer = null;
        envKey = "";
      }
      return;
    }
    if (!envLayer) {
      envLayer = new Container();
      envLayer.label = "environment";
      // Over the floor (art or fallback), under the reach and the figures:
      // ground, not furniture.
      container.addChildAt(envLayer, container.getChildIndex(tilesLayer) + 1);
    }
    if (overlay.key === envKey) return;
    envKey = overlay.key;
    envLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const g = new Graphics();
    envLayer.addChild(g);
    for (const tile of overlay.tiles) {
      drawOverlayTile(g, tile);
      if (tile.count !== undefined) envLayer.addChild(drawCountBadge(g, tile));
    }
  }

  // -------------------------------------------------------------------------
  // Beats
  // -------------------------------------------------------------------------

  /** Shows or takes down an enemy's puffed badge (#227). A child of the figure's container, above its head. */
  function setPuffed(actor: BoardActor, on: boolean): void {
    if (!on) {
      if (actor.puffBadge) {
        actor.puffBadge.destroy({ children: true });
        actor.puffBadge = null;
      }
      return;
    }
    if (actor.puffBadge) return;
    const badge = new Container();
    const text = new Text({
      text: "PUFFED",
      style: { fontFamily: "system-ui, sans-serif", fontWeight: "900", fontSize: BOARD_TILE_PX * 0.26, fill: 0xffffff },
    });
    text.anchor.set(0.5, 0.5);
    const pill = new Graphics();
    const w = text.width + BOARD_TILE_PX * 0.3;
    const h = text.height + BOARD_TILE_PX * 0.08;
    pill.roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: 0x120f26, alpha: 0.92 }).stroke({ width: 3, color: 0xffc95c });
    badge.addChild(pill, text);
    badge.y = -ACTOR_HEIGHT - h / 2;
    actor.container.addChild(badge);
    actor.puffBadge = badge;
  }

  function spawnFloater(actorId: string, label: string, color: number): void {
    const actor = actors.get(actorId);
    if (!actor) return;
    const text = new Text({
      text: label,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontWeight: "900",
        fontSize: BOARD_TILE_PX * 0.42,
        fill: color,
        stroke: { color: 0x120f26, width: 6 },
      },
    });
    text.anchor.set(0.5, 1);
    // The number lives in the band *above* the figure — the effect contract
    // reserves the top 64px of the 256px effect frame for exactly this
    // (assets/manifest.json $effectToleranceComment), so nothing an effect
    // sheet ever draws can sit behind it.
    const x = actor.container.x;
    const y = actor.targetY - ACTOR_HEIGHT - BOARD_TILE_PX * 0.05;
    text.x = x;
    text.y = y;
    floatLayer.addChild(text);
    floaters.push({ text, age: 0, x, y });
  }

  /** A floater over a square rather than a figure — the captive's (#201). */
  function spawnTileFloater(at: Position, label: string, color: number): void {
    const text = new Text({
      text: label,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontWeight: "900",
        fontSize: BOARD_TILE_PX * 0.42,
        fill: color,
        stroke: { color: 0x120f26, width: 6 },
      },
    });
    text.anchor.set(0.5, 1);
    const x = (at.x + 0.5) * BOARD_TILE_PX;
    const y = at.y * BOARD_TILE_PX;
    text.x = x;
    text.y = y;
    floatLayer.addChild(text);
    floaters.push({ text, age: 0, x, y });
  }

  function playBeat(event: EncounterEvent, route?: readonly Position[]): void {
    switch (event.type) {
      case "moved":
      case "shoved": {
        // Optimistic: start the walk when the beat lands. The patch behind the
        // presentation confirms the same destination moments later.
        const actor = actors.get(event.actorId);
        if (actor) {
          const feet = feetOf(event.to);
          actor.targetX = feet.x;
          actor.targetY = feet.y;
          // A walk takes its route, square by square; a shove is a straight
          // push. The route was worked out when the sequence arrived
          // (`playEvents`), never here: by the time a beat plays on a slow
          // frame, the patch behind it may already have landed.
          actor.route = event.type === "moved" && route ? route.slice(1).map(feetOf) : [];
        }
        return;
      }
      case "damage":
        spawnFloater(event.actorId, `-${event.amount}`, 0xff6b6b);
        return;
      case "heal":
        spawnFloater(event.actorId, `+${event.amount}`, 0x4ad991);
        return;
      case "down": {
        const actor = actors.get(event.actorId);
        if (actor) actor.down = true;
        return;
      }
      case "revived": {
        const actor = actors.get(event.actorId);
        if (actor) actor.down = false;
        spawnFloater(event.actorId, "+1", 0x4ad991);
        return;
      }
      case "bonus":
        spawnFloater(event.actorId, `+${event.amount}`, 0xffc95c);
        return;
      case "numbed":
        // A numbing sting (#227), in words: colour alone never carries it. The
        // lasting marker is the stung player's own phone, not the board.
        spawnFloater(event.actorId, "Numbed", 0xb7b0d8);
        return;
      case "puffed":
        spawnFloater(event.actorId, "Puffed!", 0xffc95c);
        return;
      case "slowed":
        // Sticky ground (#220), in words like Numbed.
        spawnFloater(event.actorId, "Slowed", 0xb7b0d8);
        return;
      case "roll": {
        // The swing's number, over the one who swung: the d20 + stat against
        // Guard that decides a hit was rolled on the server and shown
        // nowhere, so a miss looked like a figure waving at the air. The
        // victim's damage number follows on the next beat, over them.
        const { roll } = event;
        const hit = roll.result === "hit" || roll.result === "success";
        spawnFloater(roll.characterId, hit ? `${roll.total} hit!` : `${roll.total} miss`, hit ? 0xffc95c : 0xb7b0d8);
        return;
      }
      case "protected":
      case "evaded":
      case "warded":
      case "dazed":
      case "rooted":
      case "encore":
      case "walled":
        // State-only feedback; the patch carries the lasting condition.
        return;
      // The place fighting back (#201). Only a fight with an environment
      // ever carries these beats.
      case "escaped": {
        // Through the tear: the figure fades out where it stands, and the
        // patch behind the beat takes it off the board.
        const actor = actors.get(event.actorId);
        if (actor) actor.leaving = true;
        return;
      }
      case "relocated": {
        // The rift picks a monster up and puts it down elsewhere: a straight
        // slide, like a shove — nobody chose to walk there.
        const actor = actors.get(event.actorId);
        if (actor) {
          const feet = feetOf(event.to);
          actor.targetX = feet.x;
          actor.targetY = feet.y;
          actor.route = [];
        }
        return;
      }
      case "freed":
      case "captiveLost":
      case "captiveDragged": {
        const spec = view?.encounter.environment?.spec;
        const at = spec ? captivesOf(spec)[event.captive ?? 0]?.at : undefined;
        if (at) {
          if (event.type === "freed") spawnTileFloater(at, "Free!", 0x4ad991);
          else if (event.type === "captiveLost") spawnTileFloater(at, "Lost", 0xb7b0d8);
          else spawnTileFloater(at, `${event.hp} left`, 0xff6b6b);
        }
        return;
      }
      case "hazard":
      case "riftClock":
      case "surge":
        // The hurt itself arrives as ordinary `damage` beats right behind
        // these, with their numbers; the words are RiftStatus's caption.
        return;
    }
  }

  // -------------------------------------------------------------------------

  return {
    container,

    update(next: BoardViewState) {
      if (destroyed) return;
      view = next;
      const { encounter, biome } = next;
      if (encounter.board.terrain !== builtTerrain || biome !== builtBiome) {
        buildTiles(encounter, biome);
      }
      syncActors(next);
      drawEnvironment(encounter);
      drawHighlights(encounter, next.aim ?? null);
    },

    playEvents(events, totalMs) {
      if (destroyed) return;
      const offsets = beatOffsetsMs(events.length, totalMs);
      const routes = view ? walkRoutes(view.encounter.board, events) : [];
      events.forEach((event, i) => {
        const route = routes[i];
        pending.push({ at: clock + (offsets[i] ?? 0) / 1000, event, ...(route ? { route } : {}) });
      });
    },

    tick(dtSeconds: number) {
      if (destroyed) return;
      const still = reducedMotion();
      clock += dtSeconds;
      pulse += dtSeconds;

      // Due beats, in order. The queue is short (≤ a round of events) and
      // append-only between ticks, so a filter pass is fine.
      for (let i = 0; i < pending.length; ) {
        const beat = pending[i];
        if (beat && beat.at <= clock) {
          pending.splice(i, 1);
          playBeat(beat.event, beat.route);
        } else {
          i += 1;
        }
      }

      for (const actor of actors.values()) {
        const next = actor.route[0];
        if (next) {
          // Square by square at a steady pace, a footprint on each one.
          const dx = next.x - actor.container.x;
          const dy = next.y - actor.container.y;
          const left = Math.hypot(dx, dy);
          const stride = ROUTE_SPEED_PX * dtSeconds;
          if (left <= stride) {
            actor.container.x = next.x;
            actor.container.y = next.y;
            actor.route.shift();
            trail.push({ x: next.x, y: next.y, age: 0 });
          } else {
            actor.container.x += (dx / left) * stride;
            actor.container.y += (dy / left) * stride;
          }
        } else {
          actor.container.x = approach(actor.container.x, actor.targetX, WALK_RATE, dtSeconds);
          actor.container.y = approach(actor.container.y, actor.targetY, WALK_RATE, dtSeconds);
        }
        actor.container.zIndex = actor.container.y;
        // The name lives in its own layer, so it has to be carried rather than
        // dragged: it follows the eased position, not the target, or it would
        // arrive a tile ahead of the figure it belongs to.
        // A raised figure's name goes up with it, under its body (#362).
        const lift = actor.down ? 0 : STANCE_LIFT[actor.stance] * actor.height;
        if (actor.label) {
          actor.label.x = actor.container.x;
          actor.label.y = actor.container.y + NAMEPLATE_OFFSET_Y - lift;
        }
        // Turning to face the nearest opponent: a quick squash through
        // edge-on, which reads as the figure turning round rather than
        // flipping (the lineup does the same, scene.ts).
        actor.art.scale.x = approach(actor.art.scale.x, actor.facing, TURN_RATE, dtSeconds);
        actor.shadow.x = actor.shadowX * actor.art.scale.x;
        if (actor.leaving) {
          // Through the tear (#201): fading out, name and shadow with it,
          // until the patch takes the figure off the board.
          actor.art.alpha = approach(actor.art.alpha, 0, LEAVE_RATE, dtSeconds);
          actor.shadow.alpha = actor.art.alpha;
          if (actor.label) actor.label.alpha = actor.art.alpha;
          continue;
        }
        // The breath, the bob or the drift, by stance (#362); a fallen flyer
        // is on the ground like anybody else.
        const idle = stanceIdle(actor.stance, pulse, actor.phase, still || actor.down);
        const reach = Math.max(actor.height, BOARD_TILE_PX);
        actor.art.scale.y = 1 + idle.breath;
        actor.art.x = idle.dx * reach;
        actor.art.y = approach(actor.art.y, idle.dy * reach - lift, DOWN_RATE, dtSeconds);
        actor.shadow.scale.set(
          (actor.canvas / actor.shadowCanvas) * (actor.down ? 1 : BOARD_STANCE_SHADOW[actor.stance]) *
            idle.shadow * breathingShadowScale(idle.breath),
        );
        if (actor.down) {
          // spec §7.3 — knocked down, never dead. They lie on the grid and
          // wait for someone to come get them. Same pose as the lineup.
          actor.art.rotation = approach(actor.art.rotation, FALLEN_ROTATION, DOWN_RATE, dtSeconds);
          actor.art.alpha = approach(actor.art.alpha, FALLEN_ALPHA, DOWN_RATE, dtSeconds);
        } else {
          actor.art.rotation = approach(actor.art.rotation, idle.rotation, DOWN_RATE, dtSeconds);
          actor.art.alpha = approach(actor.art.alpha, actor.away ? AWAY_ALPHA : 1, DOWN_RATE, dtSeconds);
        }
      }

      // The turn marker: a pulsing ring under whoever the clock is on.
      const activeId = view ? currentActorId(view.encounter) : null;
      const active = activeId ? actors.get(activeId) : null;
      if (active) {
        activeRing.visible = true;
        activeRing.zIndex = active.container.y - 1;
        activeRing.clear();
        activeRing
          .ellipse(
            active.container.x,
            active.container.y + BOARD_TILE_PX * 0.02,
            BOARD_TILE_PX * 0.42,
            BOARD_TILE_PX * 0.18,
          )
          .stroke({ width: 5, color: 0xffc95c, alpha: 0.55 + 0.35 * Math.sin(pulse * 4) });
      } else {
        activeRing.visible = false;
      }

      // Footprints fade where they were left.
      for (let i = trail.length - 1; i >= 0; i--) {
        const mark = trail[i];
        if (!mark) continue;
        mark.age += dtSeconds;
        if (mark.age >= TRAIL_LIFE_S) trail.splice(i, 1);
      }
      trailLayer.clear();
      for (const mark of trail) {
        trailLayer
          .ellipse(mark.x, mark.y, BOARD_TILE_PX * 0.22, BOARD_TILE_PX * 0.1)
          .fill({ color: 0xffc95c, alpha: 0.85 * (1 - mark.age / TRAIL_LIFE_S) });
      }

      for (let i = floaters.length - 1; i >= 0; i--) {
        const floater = floaters[i];
        if (!floater) continue;
        floater.age += dtSeconds;
        const t = floater.age / FLOATER_LIFE_S;
        if (t >= 1) {
          floater.text.destroy();
          floaters.splice(i, 1);
          continue;
        }
        floater.text.y = floater.y - FLOATER_RISE * t;
        floater.text.alpha = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.6) / 0.4);
      }
    },

    nameplateBoxes() {
      return [...actors.values()]
        .filter((a) => a.label !== null && a.label.visible)
        .map((a) => nameplateBoxOf(a.label!));
    },

    facings() {
      return Object.fromEntries([...actors.values()].map((a) => [a.id, a.art.scale.x]));
    },

    figureSizes() {
      return Object.fromEntries([...actors.values()].map((a) => [a.id, { height: a.height, stance: a.stance }]));
    },

    trailMarks() {
      return trail.map((m) => ({ x: m.x, y: m.y }));
    },

    destroy() {
      destroyed = true;
      pending.length = 0;
      trail.length = 0;
      for (const floater of floaters) floater.text.destroy();
      floaters.length = 0;
      for (const actor of actors.values()) {
        actor.container.destroy({ children: true });
        // Released here rather than left to `container.destroy` below, so the
        // one thing an actor owns outside its own subtree is owned in the
        // same place as everything else it owns. Destroying detaches it from
        // `nameLayer`, so the sweep below cannot reach it twice.
        actor.label?.destroy();
      }
      actors.clear();
      container.destroy({ children: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback + furniture drawing
// ---------------------------------------------------------------------------

/**
 * Flat tiles in the theme palette — what a board looks like before (or
 * without) its biome sheet. Checkered so single steps are countable, blocked
 * hatched so a wall reads by shape, not shade (spec §11).
 */
/**
 * The squares each walk in a sequence crosses, by event index, start included.
 *
 * Worked out the moment a sequence arrives, against the board in view, which
 * at that moment is always the one from before it: the patch waits behind the
 * presentation (sync/channel.ts). Walks are replayed in order on a scratch
 * board, so in a monster round the second wisp's route goes round where the
 * first one ended up, and a Bramble Wall grown earlier in the sequence
 * blocks the walks after it. A shove moves the board without a route; anything that
 * cannot be routed (a figure the board no longer has) simply has none, and
 * slides straight.
 */
export function walkRoutes(
  board: Board,
  events: readonly EncounterEvent[],
): (readonly Position[] | undefined)[] {
  let working = board;
  return events.map((event) => {
    // Bramble Wall grows mid-sequence, and the monsters' walks that follow it
    // in the same sequence went round it: so must the routes drawn for them.
    if (event.type === "walled") {
      const at = event.at.y * working.width + event.at.x;
      const terrain = [...working.terrain];
      terrain[at] = "blocked";
      working = { ...working, terrain };
      return undefined;
    }
    // The rift moves figures too (#201): a relocation lands a monster
    // somewhere new and an escape takes a hero off the board, and the walks
    // after them in the same sequence go from — and through — the result.
    if (event.type === "relocated") {
      working = {
        ...working,
        actors: working.actors.map((a) => (a.id === event.actorId ? { ...a, x: event.to.x, y: event.to.y } : a)),
      };
      return undefined;
    }
    if (event.type === "escaped") {
      working = { ...working, actors: working.actors.filter((a) => a.id !== event.actorId) };
      return undefined;
    }
    if (event.type !== "moved" && event.type !== "shoved") return undefined;
    const from = working.actors.find((a) => a.id === event.actorId);
    if (!from) return undefined;
    const path = event.type === "moved" ? naturalPath(working, from, event.to) : null;
    working = {
      ...working,
      actors: working.actors.map((a) => (a.id === event.actorId ? { ...a, x: event.to.x, y: event.to.y } : a)),
    };
    return path ?? undefined;
  });
}

function drawFallbackTiles(layer: Container, encounter: EncounterState): void {
  layer.removeChildren().forEach((child) => child.destroy({ children: true }));
  const { board } = encounter;
  const g = new Graphics();
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const blocked = board.terrain[y * board.width + x] === "blocked";
      const even = (x + y) % 2 === 0;
      g.rect(x * BOARD_TILE_PX, y * BOARD_TILE_PX, BOARD_TILE_PX, BOARD_TILE_PX).fill({
        color: blocked ? 0x120f26 : even ? 0x1d2a3b : 0x22304a,
      });
      if (blocked) {
        for (let i = 0; i < 4; i++) {
          const offset = (BOARD_TILE_PX / 4) * (i + 0.5);
          g.moveTo(x * BOARD_TILE_PX + offset, y * BOARD_TILE_PX)
            .lineTo(x * BOARD_TILE_PX, y * BOARD_TILE_PX + offset)
            .stroke({ width: 3, color: 0x3a3468, alpha: 0.8 });
          g.moveTo((x + 1) * BOARD_TILE_PX - offset, (y + 1) * BOARD_TILE_PX)
            .lineTo((x + 1) * BOARD_TILE_PX, (y + 1) * BOARD_TILE_PX - offset)
            .stroke({ width: 3, color: 0x3a3468, alpha: 0.8 });
        }
      }
    }
  }
  layer.addChild(g);
  layer.addChild(drawGridLines(board.width, board.height));
  layer.addChild(drawBlockedMarkers(encounter));
}

/** Thin lines so "how many steps is that" is countable from the couch. */
function drawGridLines(width: number, height: number): Graphics {
  const g = new Graphics();
  for (let x = 0; x <= width; x++) {
    g.moveTo(x * BOARD_TILE_PX, 0)
      .lineTo(x * BOARD_TILE_PX, height * BOARD_TILE_PX)
      .stroke({ width: 2, color: 0x0d0b1a, alpha: 0.35 });
  }
  for (let y = 0; y <= height; y++) {
    g.moveTo(0, y * BOARD_TILE_PX)
      .lineTo(width * BOARD_TILE_PX, y * BOARD_TILE_PX)
      .stroke({ width: 2, color: 0x0d0b1a, alpha: 0.35 });
  }
  return g;
}

/** An inset ring on every wall, over art or fallback alike — the tile sheets
    vary in how loudly row 1 says "blocked", and this must not depend on it. */
function drawBlockedMarkers(encounter: EncounterState): Graphics {
  const g = new Graphics();
  const { board } = encounter;
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.terrain[y * board.width + x] !== "blocked") continue;
      const pad = BOARD_TILE_PX * 0.12;
      g.roundRect(
        x * BOARD_TILE_PX + pad,
        y * BOARD_TILE_PX + pad,
        BOARD_TILE_PX - pad * 2,
        BOARD_TILE_PX - pad * 2,
        BOARD_TILE_PX * 0.1,
      ).stroke({ width: 3, color: 0x0d0b1a, alpha: 0.5 });
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// The environment's marks (#201) — shapes first, colour second (spec §11)
// ---------------------------------------------------------------------------

/** Per glyph. A hint for the eye that already knows the shape, never the tell. */
const ENV_COLOR = {
  fire: 0xff8a3d,
  thorns: 0x8bd66b,
  rift: 0xc8a2ff,
  exit: 0xfff1a8,
  captive: 0xff9ec4,
  objective: 0x4ad991,
} as const;
/** The dark the board's other marks outline in, so a glyph reads on any floor. */
const ENV_INK = 0x120f26;

/**
 * One marked square. `active` ground is tinted and fully drawn; `pending` is
 * the same shape, faint and untinted ("soon"); an exit that is `gone` is faint
 * and crossed out. The captive's square gets a plate of its own first: it is
 * walled for the fight, and without one it read as one more blocked tile.
 */
function drawOverlayTile(g: Graphics, tile: OverlayTile): void {
  const T = BOARD_TILE_PX;
  const x = tile.x * T;
  const y = tile.y * T;
  const color = ENV_COLOR[tile.glyph];
  const live = tile.state === "active" || tile.state === "waiting";
  const alpha = live ? 1 : tile.state === "freed" ? 0.85 : 0.42;

  if (tile.kind === "hazard") {
    if (live) g.rect(x, y, T, T).fill({ color, alpha: 0.2 });
    // A dashed border — the phone grid's hazard outline, at TV weight.
    for (const d of dashedSquare(x + T * 0.06, y + T * 0.06, T * 0.88, T * 0.14, T * 0.08)) {
      g.moveTo(d.x1, d.y1).lineTo(d.x2, d.y2);
    }
    g.stroke({ width: live ? 6 : 4, color, alpha });
    if (tile.glyph === "fire") {
      drawFlame(g, x + T * 0.27, y + T * 0.36, T * 0.16, color, alpha);
      drawFlame(g, x + T * 0.73, y + T * 0.36, T * 0.16, color, alpha);
      drawFlame(g, x + T * 0.5, y + T * 0.7, T * 0.2, color, alpha);
    } else if (tile.glyph === "thorns") {
      drawThorns(g, x, y, color, alpha);
    } else {
      drawSpark(g, x + T * 0.5, y + T * 0.5, T * 0.26, color, alpha);
      drawSpark(g, x + T * 0.22, y + T * 0.24, T * 0.1, color, alpha);
      drawSpark(g, x + T * 0.78, y + T * 0.76, T * 0.1, color, alpha);
    }
    return;
  }

  if (tile.kind === "exit") {
    if (live) g.roundRect(x + T * 0.05, y + T * 0.05, T * 0.9, T * 0.9, T * 0.1).fill({ color, alpha: 0.18 });
    // The doubled border the phone grid gives an exit.
    g.roundRect(x + T * 0.05, y + T * 0.05, T * 0.9, T * 0.9, T * 0.1).stroke({ width: 6, color, alpha });
    g.roundRect(x + T * 0.15, y + T * 0.15, T * 0.7, T * 0.7, T * 0.06).stroke({ width: 3, color, alpha });
    // Two chevrons pointing out of the board: this way out.
    const cx = x + T * 0.5;
    for (const dy of [0.38, 0.58]) {
      g.moveTo(cx - T * 0.18, y + T * (dy + 0.1))
        .lineTo(cx, y + T * (dy - 0.06))
        .lineTo(cx + T * 0.18, y + T * (dy + 0.1));
    }
    g.stroke({ width: 10, color: ENV_INK, alpha: alpha * 0.7, cap: "round", join: "round" });
    for (const dy of [0.38, 0.58]) {
      g.moveTo(cx - T * 0.18, y + T * (dy + 0.1))
        .lineTo(cx, y + T * (dy - 0.06))
        .lineTo(cx + T * 0.18, y + T * (dy + 0.1));
    }
    g.stroke({ width: 6, color, alpha, cap: "round", join: "round" });
    if (tile.state === "gone") {
      // Shut for good: crossed out.
      g.moveTo(x + T * 0.2, y + T * 0.2).lineTo(x + T * 0.8, y + T * 0.8);
      g.moveTo(x + T * 0.8, y + T * 0.2).lineTo(x + T * 0.2, y + T * 0.8);
      g.stroke({ width: 7, color: ENV_INK, alpha: 0.75, cap: "round" });
    }
    return;
  }

  if (tile.kind === "objective") {
    // A solid ring with a diamond inside (#220): ground to stand on, a tear
    // to close. Done, it goes faint and wears a tick.
    const done = tile.state === "done";
    const a = done ? 0.42 : 1;
    if (!done) g.rect(x, y, T, T).fill({ color, alpha: 0.16 });
    g.circle(x + T * 0.5, y + T * 0.5, T * 0.4).stroke({ width: 6, color, alpha: a });
    g.moveTo(x + T * 0.5, y + T * 0.28)
      .lineTo(x + T * 0.72, y + T * 0.5)
      .lineTo(x + T * 0.5, y + T * 0.72)
      .lineTo(x + T * 0.28, y + T * 0.5)
      .closePath();
    g.fill({ color, alpha: a * 0.85 }).stroke({ width: 4, color: ENV_INK, alpha: 0.8 });
    if (done) {
      g.moveTo(x + T * 0.3, y + T * 0.52).lineTo(x + T * 0.45, y + T * 0.66).lineTo(x + T * 0.72, y + T * 0.34);
      g.stroke({ width: 8, color: 0xffffff, alpha: 0.95, cap: "round", join: "round" });
    }
    return;
  }

  // The captive.
  const cx = x + T * 0.5;
  const cy = y + T * 0.5;
  g.roundRect(x + T * 0.06, y + T * 0.06, T * 0.88, T * 0.88, T * 0.12).fill({
    color: ENV_INK,
    alpha: tile.state === "waiting" ? 0.82 : 0.35,
  });
  if (tile.state === "lost") {
    // An empty, broken outline: they were here.
    drawHeart(g, cx, cy, T * 0.26);
    g.stroke({ width: 6, color, alpha });
    g.moveTo(cx, cy - T * 0.12).lineTo(cx - T * 0.05, cy).lineTo(cx + T * 0.05, cy + T * 0.08).lineTo(cx, cy + T * 0.2);
    g.stroke({ width: 5, color: ENV_INK, alpha: 0.9 });
    return;
  }
  drawHeart(g, cx, cy, T * 0.26);
  g.fill({ color, alpha }).stroke({ width: 4, color: ENV_INK, alpha: 0.8 });
  if (tile.state === "waiting") {
    // Behind bars — caught, not walled.
    for (const bx of [0.24, 0.41, 0.59, 0.76]) {
      g.moveTo(x + T * bx, y + T * 0.14).lineTo(x + T * bx, y + T * 0.86);
    }
    g.moveTo(x + T * 0.18, y + T * 0.14).lineTo(x + T * 0.82, y + T * 0.14);
    g.moveTo(x + T * 0.18, y + T * 0.86).lineTo(x + T * 0.82, y + T * 0.86);
    g.stroke({ width: 7, color: 0xd9d3f2, alpha: 0.95, cap: "round" });
  } else {
    // Freed: the bars are gone, and a spark says why.
    drawSpark(g, x + T * 0.76, y + T * 0.24, T * 0.12, 0xfff1a8, 0.95);
  }
}

/**
 * The rounds a square is counting down, in a dark disc in its top-right
 * corner, big enough to read from the sofa. The disc goes into `g`; the
 * numeral is returned for the caller to add over it.
 */
function drawCountBadge(g: Graphics, tile: OverlayTile): Text {
  const T = BOARD_TILE_PX;
  const cx = (tile.x + 0.8) * T;
  const cy = (tile.y + 0.2) * T;
  g.circle(cx, cy, T * 0.18).fill({ color: ENV_INK, alpha: 0.92 }).stroke({ width: 4, color: ENV_COLOR[tile.glyph] });
  const text = new Text({
    text: String(tile.count),
    style: {
      fontFamily: "system-ui, sans-serif",
      fontWeight: "900",
      fontSize: T * 0.28,
      fill: 0xffffff,
    },
  });
  text.anchor.set(0.5, 0.5);
  text.x = cx;
  text.y = cy;
  return text;
}

function drawFlame(g: Graphics, cx: number, cy: number, s: number, color: number, alpha: number): void {
  const flame = (k: number): void => {
    g.moveTo(cx, cy - s * k)
      .bezierCurveTo(cx + s * 0.15 * k, cy - s * 0.55 * k, cx + s * 0.62 * k, cy - s * 0.25 * k, cx + s * 0.52 * k, cy + s * 0.28 * k)
      .bezierCurveTo(cx + s * 0.42 * k, cy + s * 0.66 * k, cx - s * 0.42 * k, cy + s * 0.66 * k, cx - s * 0.52 * k, cy + s * 0.28 * k)
      .bezierCurveTo(cx - s * 0.62 * k, cy - s * 0.25 * k, cx - s * 0.15 * k, cy - s * 0.55 * k, cx, cy - s * k)
      .closePath();
  };
  flame(1);
  g.fill({ color, alpha }).stroke({ width: 3, color: ENV_INK, alpha: alpha * 0.8 });
  // The hot heart of it, so a flame is a flame and not a teardrop.
  flame(0.5);
  g.fill({ color: 0xffe08a, alpha });
}

/** A stem across the square with spikes off both sides. */
function drawThorns(g: Graphics, x: number, y: number, color: number, alpha: number): void {
  const T = BOARD_TILE_PX;
  const stems: [number, number, number, number][] = [
    [0.12, 0.72, 0.88, 0.3],
    [0.2, 0.92, 0.62, 0.66],
  ];
  for (const [ax, ay, bx, by] of stems) {
    const x1 = x + T * ax;
    const y1 = y + T * ay;
    const x2 = x + T * bx;
    const y2 = y + T * by;
    g.moveTo(x1, y1).lineTo(x2, y2);
    g.stroke({ width: 7, color: ENV_INK, alpha: alpha * 0.7, cap: "round" });
    g.moveTo(x1, y1).lineTo(x2, y2);
    g.stroke({ width: 4, color, alpha, cap: "round" });
    // Spikes: triangles on alternate sides, pointing along the stem.
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const spikes = Math.max(2, Math.round(len / (T * 0.2)));
    for (let i = 1; i <= spikes; i++) {
      const t = i / (spikes + 1);
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      const side = i % 2 === 0 ? 1 : -1;
      const nx = -uy * side;
      const ny = ux * side;
      g.poly([
        px - ux * T * 0.05, py - uy * T * 0.05,
        px + ux * T * 0.05, py + uy * T * 0.05,
        px + nx * T * 0.13 + ux * T * 0.05, py + ny * T * 0.13 + uy * T * 0.05,
      ]);
      g.fill({ color, alpha }).stroke({ width: 2, color: ENV_INK, alpha: alpha * 0.8 });
    }
  }
}

/** A four-pointed spark: the rift's own mark. */
function drawSpark(g: Graphics, cx: number, cy: number, r: number, color: number, alpha: number): void {
  g.star(cx, cy, 4, r, r * 0.3).fill({ color, alpha }).stroke({ width: 3, color: ENV_INK, alpha: alpha * 0.8 });
}

/** A heart's path, point down, `s` about half its width. Caller fills or strokes. */
function drawHeart(g: Graphics, cx: number, cy: number, s: number): void {
  g.moveTo(cx, cy + s * 0.9)
    .bezierCurveTo(cx - s * 1.3, cy + s * 0.05, cx - s * 0.65, cy - s * 0.95, cx, cy - s * 0.35)
    .bezierCurveTo(cx + s * 0.65, cy - s * 0.95, cx + s * 1.3, cy + s * 0.05, cx, cy + s * 0.9)
    .closePath();
}
