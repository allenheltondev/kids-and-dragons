/**
 * The Pixi scene: a backdrop, the party standing in it — and, when a fight is
 * on, the combat board (world/board.ts) in its place.
 *
 * ---------------------------------------------------------------------------
 * RIGS FIRST, PNGs AND SINE WAVES AS THE FALLBACK
 *
 * Rive is the animation runtime (architecture §1), and the rigs exist now —
 * all 24 species/tier sets, built by rive-mcp against the manifest's
 * rigContract and delivered beside each tier's `assembled.png`. An actor asks
 * for the rig (world/rive-actor.ts) and drops it into exactly the seams this
 * header always promised — `setParty`, the knocked-down state, `focusCamera`
 * — with the static PNG + procedural motion kept as the fallback for a rig
 * that is missing or will not load. The combat board (world/board.ts) still
 * draws PNG cutouts; that is the next seam.
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

import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { PartyMember, Position } from "@kad/shared";
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
  CANVAS,
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
  measureFootprint,
  shadowOffset,
  type Footprint,
} from "./actor-art";
import { sceneBackdropUrl } from "./art-paths";
import { createRiveActor, type RiveActorHandle } from "./rive-actor";
import { focusHolds, type FocusHold } from "./attention";
import {
  advanceShake,
  impactBeats,
  SHAKE_MAX_FRACTION,
  shakeOffset,
  startShake,
  type Shake,
} from "./shake";
import {
  createNameplate,
  fitNameplate,
  nameplateBoxOf,
  nameplateLabel,
  type NameplateReading,
} from "./nameplate";
import type { EncounterEvent } from "@kad/shared";
import { stageSlots, type StageCastMember } from "./cast";
import { storyStageHeight } from "./stage-inset";

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
   * How many CSS px along the bottom of the pane the story text covers
   * (world/stage-inset.ts). The story camera frames the stage into the rest,
   * so nobody stands behind a paragraph. The fight board ignores it.
   */
  setStageInset(bottomPx: number): void;
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
  /**
   * The camera's attention key (world/camera.ts header): a manual pan/pinch
   * survives everything except this key changing — callers set it to
   * "who this device is being asked to act as", so the board comes back
   * exactly when a question needs answering and at no other time.
   */
  setCameraAttention(key: string): void;
  destroy(): void;
}

interface Actor {
  container: Container;
  art: Container;
  characterId: string;
  /** Which asset this actor was built from. See `visualKeyOf`. */
  visualKey: string;
  /**
   * The name under their feet — who this is, when two players picked the same
   * species (nameplate.ts). Null for a name with nothing in it. A sibling of
   * `art` rather than a child: the art rotates and fades and the label must
   * not go with it.
   */
  label: Text | null;
  /** What `label` is currently saying, so a renamed character is spotted
      without measuring a Text every patch. */
  labelText: string | null;
  phase: number;
  down: boolean;
  connected: boolean;
  /** Design-space position of the actor's feet. */
  x: number;
  y: number;
  /**
   * The rigged figure, once its `.riv` loads. While set, the rig owns the
   * acting — idle breathing, the fall, the get-up — and the procedural bob
   * and FALLEN_* pose below stay away from it.
   */
  rive: RiveActorHandle | null;
  /** The contact shadow, a sibling of `art` so it neither turns nor falls. */
  shadow: Graphics;
  /** How far right of the anchor the feet are, as drawn (facing left). The
      shadow follows `art.scale.x` across, so it stays under them on a turn. */
  shadowX: number;
}

/** Somebody standing opposite the party (world/cast.ts). */
interface CastActor {
  key: string;
  container: Container;
  art: Container;
  label: Text | null;
  shadow: Graphics;
  scale: number;
  /** For one of a group: 0 or 1, the odd ones standing a step back. */
  row?: number;
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
 * drawing the Fledgling rig for the rest of the session — the transformation
 * cutscene playing over a figure that visibly never transformed.
 *
 * Class matters only when it selects a delivered manifest.rigVariants build;
 * `characterWorldArtUrl` folds that exact distinction into the key without
 * rebuilding an undeclared class/species/tier combination onto the same base
 * rig. Appearance is deliberately *not* in here. Nothing about a figure is drawn
 * from it any more — the runtime recolour is gone and every rig wears the
 * colours it was authored in (`nameplate.ts` explains why) — so folding it in
 * would throw a megabyte of rig away and reload an identical one because
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
  /** -1 = facing right, toward a cast on the right; 1 = as drawn. */
  let facing = 1;
  /** CSS px of pane the narration plate covers. See setStageInset. */
  let insetBottom = 0;
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
      motion gets none, scheduled or immediate alike. */
  function jolt(strength: number): void {
    if (prefersReducedMotion()) return;
    shakeState = startShake(shakeState, strength);
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
   * The rect the camera frames into. The board gets the whole pane; the story
   * gets the part above the narration plate, so the figures stand clear of
   * the words instead of behind them.
   */
  function cameraViewport(): Viewport {
    if (encounterView !== null) return viewport;
    return { width: viewport.width, height: storyStageHeight(viewport.width, viewport.height, insetBottom) };
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
    layer.y = frame.height / 2 - camNow.y * camNow.scale;

    storyLayer.visible = !inCombat;
    boardWrap.visible = inCombat;

    // The painting's floor under the figures' feet (backdropFit). In a fight
    // the board is the floor, and the painting just covers the pane.
    const feetY = inCombat ? 0 : layer.y + GROUND_Y * layer.scale.y;
    const fit = backdropFit(viewport, feetY, frame.height, backdropBleed);
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

  function layoutActors(): void {
    const list = [...actors.values()];
    const cast = [...castActors.values()].filter((member) => !member.leaving);
    // Lay out across what the camera actually shows, not just the design
    // rect: a TV's stage above the plate is far wider than 16:9, and spending
    // that width on spacing is what keeps three heroes and a centaur from
    // standing in each other.
    const width = stageWidth();
    const left = (DESIGN.width - width) / 2;
    const slots = stageSlots(
      list.length,
      cast.map((member) => member.scale),
      width,
      cast.map((member) => member.row !== undefined),
    );
    slots.party = slots.party.map((x) => x + left);
    slots.cast = slots.cast.map((x) => x + left);
    // Heroes are drawn facing left; with company on the right they turn round.
    facing = cast.length > 0 ? -1 : 1;
    // A name may be no wider than the slot its character stands in, less a
    // gutter — two nameplates that touch are one unreadable name, which is the
    // failure the nameplate was added to fix. The slot is only known here,
    // because it shrinks as the party grows.
    const slot = slots.partySlot * NAMEPLATE_SLOT;
    cast.forEach((member, index) => {
      member.x = slots.cast[index] ?? member.x;
      if (member.label) {
        member.label.visible = nameplatesVisible;
        fitNameplate(member.label, (slots.castSlots[index] ?? slot) * NAMEPLATE_SLOT);
      }
    });
    list.forEach((actor, index) => {
      if (actor.label) {
        actor.label.visible = nameplatesVisible;
        fitNameplate(actor.label, slot);
      }
      actor.x = slots.party[index] ?? actor.x;
      // A shallow depth stagger so three characters read as a group rather than
      // a row of stickers. Allen's Chapter 2 lineup composition replaces this.
      actor.y = GROUND_Y + (index % 2 === 0 ? 0 : DESIGN.height * 0.03);
      actor.container.x = actor.x;
      actor.container.y = actor.y;
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

    applyCamera(dt);
    board?.tick(dt);

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
        victoryGlow.alpha = VICTORY_PEAK * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
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

    for (const actor of actors.values()) {
      // Turning to face whoever is here: a quick squash through edge-on, which
      // reads as the figure turning round rather than flipping.
      actor.art.scale.x = approach(actor.art.scale.x, facing, TURN_RATE, dt);
      actor.shadow.x = actor.shadowX * actor.art.scale.x;
      if (actor.rive) {
        // The rig owns the acting: idle is a clip, the fall is down/down_loop
        // driven by the contract's knockedDown boolean, and the procedural
        // bob and FALLEN_* pose would fight it. Connection fade still
        // applies — presence is the scene's fact, not the rig's.
        actor.rive.setKnockedDown(actor.down);
        actor.rive.tick(dt);
        actor.art.scale.y = 1;
        actor.shadow.scale.set(breathingShadowScale(actor.down ? 0 : actor.rive.breath()));
        actor.art.alpha = approach(actor.art.alpha, actor.connected ? 1 : 0.5, FADE_RATE, dt);
        continue;
      }
      if (actor.down) {
        // spec §7.3 — knocked down, never dead. They lie on the grid and wait
        // for someone to come get them.
        actor.art.rotation = approach(actor.art.rotation, FALLEN_ROTATION, DOWN_RATE, dt);
        actor.art.y = approach(actor.art.y, ACTOR_HEIGHT * 0.18, DOWN_RATE, dt);
        actor.art.scale.y = approach(actor.art.scale.y, 1, DOWN_RATE, dt);
        actor.shadow.scale.set(1);
        actor.art.alpha = approach(actor.art.alpha, FALLEN_ALPHA, DOWN_RATE, dt);
        continue;
      }
      // Breathing, not bobbing: the art is anchored at the feet, so a
      // stretch on y swells the body and leaves the feet on their shadow.
      // Lifting the whole figure is what made the lineup look like it hovered.
      const bob = Math.sin(elapsed * 1.6 + actor.phase);
      actor.art.rotation = approach(actor.art.rotation, bob * 0.02, BOB_RATE, dt);
      actor.art.y = approach(actor.art.y, 0, DOWN_RATE, dt);
      actor.art.scale.y = 1 + bob * 0.015;
      // The shadow tightens as the body rises and spreads as it settles.
      actor.shadow.scale.set(breathingShadowScale(actor.art.scale.y - 1));
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
      const rowY = GROUND_Y - (member.row ?? 0) * DESIGN.height * 0.025;
      member.container.y = rowY;
      member.container.zIndex = rowY - 1;
      member.art.alpha = member.presence;
      member.shadow.alpha = member.presence;
      if (member.label) member.label.alpha = member.presence;
      if (!still) {
        // Breathing about the feet — see the party's bob in tick().
        const bob = Math.sin(elapsed * 1.3 + member.phase);
        member.art.scale.y = 1 + bob * 0.012;
        member.shadow.scale.set(breathingShadowScale(member.art.scale.y - 1));
      }
    }
  }

  function makeCastActor(member: StageCastMember): CastActor {
    const container = new Container();
    const art = new Container();
    container.addChild(art);
    actorsLayer.addChild(container);
    const height = ACTOR_HEIGHT * member.scale;
    // Fitted to the feet once the art is here and can be measured; until
    // then, a modest one at the anchor (it fades in with the figure anyway).
    const shadow = drawContactShadow(height, null, SCENE_SHADOW_SQUASH);
    container.addChildAt(shadow, 0);
    const label =
      member.name === null
        ? null
        : createNameplate(member.name, { typeHeight: ACTOR_HEIGHT, figureHeight: height, maxWidth: ACTOR_HEIGHT });
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
      scale: member.scale,
      ...(member.crowd ? { row: member.crowd.index % 2 } : {}),
      x: DESIGN.width,
      presence: 0,
      leaving: false,
      phase: Math.random() * Math.PI * 2,
    };
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
        // Canvas-relative, like the party's PNGs: every figure is drawn to the
        // same 1024 canvas, so scale alone says sprite or centaur.
        sprite.scale.set(height / texture.height);
        art.addChild(sprite);
        actor.shadow = refitShadow(container, actor.shadow, height, measureFootprint(texture));
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
      rive: null,
      shadow,
      shadowX: 0,
    };

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
          sprite.scale.set(ACTOR_HEIGHT / CANVAS.height);
          art.removeChildren();
          placeholder.destroy();
          art.addChild(sprite);
          const footprint = measureFootprint(texture);
          actor.shadow = refitShadow(container, actor.shadow, ACTOR_HEIGHT, footprint);
          actor.shadowX = shadowOffset(ACTOR_HEIGHT, footprint);
        })
        .catch(() => {
          /* keep the placeholder: a missing tier must never blank the stage */
        });
    };

    // The rig first, the PNG when there isn't one — same never-goes-stale
    // reasoning as the PNG load: ask for the file, fall back when it is not
    // there. The rig carries its own acting.
    void createRiveActor(species, tier, ACTOR_HEIGHT, characterClass)
      .then((rive) => {
        if (destroyed || actors.get(id) !== actor) {
          rive?.destroy();
          return;
        }
        if (!rive) {
          loadPng();
          return;
        }
        art.removeChildren();
        placeholder.destroy();
        // The rig plays its own fall, so hand it the state it joined in and
        // clear any procedural pose the placeholder was eased into.
        art.rotation = 0;
        art.y = 0;
        rive.setKnockedDown(actor.down);
        art.addChild(rive.sprite);
        actor.rive = rive;
      })
      .catch(loadPng);

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
          /*
           * Same character, different body — a tier crossed. Rebuild rather
           * than mutate: the rig file and the sprite are both decided at load
           * (rive-actor.ts), so there is nothing on a live actor to patch.
           * Dropping the Rive handle first, then the container, is the same
           * order `destroy()` uses and for the same reason — the C++ objects
           * are not the Pixi tree's to collect.
           */
          existing.rive?.destroy();
          existing.container.destroy({ children: true });
          actors.delete(id);
        }
        actors.set(id, makeActor(member));
      }

      for (const [id, actor] of [...actors.entries()]) {
        if (seen.has(id)) continue;
        // Rive handles are C++ objects; the container destroy only reaches
        // the sprite. Delete the runtime half first, then the tree.
        actor.rive?.destroy();
        actor.container.destroy({ children: true });
        actors.delete(id);
      }

      layoutActors();
    },

    setCast(members) {
      if (destroyed) return;
      const wanted = new Set(members.map((member) => member.key));
      for (const member of castActors.values()) {
        if (!wanted.has(member.key)) member.leaving = true;
      }
      for (const member of members) {
        const existing = castActors.get(member.key);
        if (existing && !existing.leaving) continue;
        if (existing) {
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
      insetBottom = Math.max(0, bottomPx);
      layoutActors();
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
          // comes back centred on zero and nothing can be compared.
          const box = nameplateBoxOf(actor.label!);
          return { ...box, x: actor.container.x + box.x, y: actor.container.y + box.y };
        });
      for (const member of castActors.values()) {
        if (member.leaving || member.label === null || !member.label.visible) continue;
        const box = nameplateBoxOf(member.label);
        boxes.push({ ...box, x: member.x + box.x, y: GROUND_Y + box.y });
      }
      return { space: "story" as const, boxes };
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
        actor.rive?.destroy();
        actor.container.destroy({ children: true });
      }
      actors.clear();
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
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
