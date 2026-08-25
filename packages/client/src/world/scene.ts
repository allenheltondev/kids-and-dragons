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
  drawPlaceholder,
} from "./actor-art";
import { createRiveActor, type RiveActorHandle } from "./rive-actor";
import { advanceShake, shakeOffset, startShake, type Shake } from "./shake";
import {
  createNameplate,
  fitNameplate,
  nameplateBoxOf,
  nameplateLabel,
  type NameplateReading,
} from "./nameplate";
import type { EncounterEvent } from "@kad/shared";

export { characterArtUrl };

/**
 * How long the scene-step veil takes to lift after its window — after the
 * gated patch has applied, so the new scene is revealed rather than watched
 * arriving. Exported for the test that pins the swap stays covered.
 */
export const SCENE_STEP_TAIL_MS = 250;

/** The story scene is authored at this size and framed into whatever pane it gets. */
const DESIGN = { width: 1600, height: 900 } as const;
/** One camera "tile" of story space, in design units. See the header. */
export const STORY_TILE = 100;
const STORY_BOARD = { width: DESIGN.width / STORY_TILE, height: DESIGN.height / STORY_TILE } as const;

const GROUND_Y = DESIGN.height * 0.82;
/** A character's drawn height in design units at zoom 1. */
const ACTOR_HEIGHT = DESIGN.height * 0.46;
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
   * Where the story is happening (spec §6.2). The chapter's biome art replaces
   * the drawn stand-in behind the lineup; null, an unknown biome, or a missing
   * file all leave the stand-in in place. Idempotent — the same biome twice
   * costs one texture lookup, not a reload.
   */
  setBiome(biome: string | null): void;
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

  const backdropArt = drawBackdrop();
  backdrop.addChild(backdropArt);

  /** The biome whose art is on the backdrop, and the sprite drawing it. */
  let biomeId: string | null = null;
  let biomeSprite: Sprite | null = null;

  const actorsLayer = new Container();
  // Painter's order by zIndex, so the depth stagger in layoutActors() reads
  // right: the nearer (lower) actor draws in front, whatever order they joined.
  actorsLayer.sortableChildren = true;
  storyLayer.addChild(actorsLayer);

  const actors = new Map<string, Actor>();
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
    const activeId = currentActorId(encounterView.encounter);
    const actor = activeId
      ? encounterView.encounter.board.actors.find((a) => a.id === activeId)
      : null;
    return actor ? [{ x: actor.x, y: actor.y }] : [];
  }

  function applyCamera(dt: number): void {
    const inCombat = encounterView !== null;
    camState = setFocus(camState, inCombat ? boardFocus() : storyFocusTiles(target, [...actors.values()]));
    const cam = resolveCamera(camState, viewport);

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
    layer.x = viewport.width / 2 - camNow.x * camNow.scale;
    layer.y = viewport.height / 2 - camNow.y * camNow.scale;

    storyLayer.visible = !inCombat;
    boardWrap.visible = inCombat;
  }

  function layoutActors(): void {
    const list = [...actors.values()];
    const spacing = Math.min(DESIGN.width / (list.length + 1), DESIGN.width * 0.26);
    const start = DESIGN.width / 2 - (spacing * (list.length - 1)) / 2;
    // A name may be no wider than the slot its character stands in, less a
    // gutter — two nameplates that touch are one unreadable name, which is the
    // failure the nameplate was added to fix. The slot is only known here,
    // because it shrinks as the party grows.
    const slot = spacing * NAMEPLATE_SLOT;
    list.forEach((actor, index) => {
      if (actor.label) {
        actor.label.visible = nameplatesVisible;
        fitNameplate(actor.label, slot);
      }
      actor.x = start + spacing * index;
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

    applyCamera(dt);
    board?.tick(dt);

    // The jolt rides the whole stage — backdrop, lineup and board move as one
    // piece, which is what makes it read as the *camera* flinching rather
    // than the world sliding. Applied after the camera so the two never
    // argue about who owns the layer transforms.
    shakeState = advanceShake(shakeState, dt);
    const jolt = shakeOffset(shakeState, viewport.height);
    stage.position.set(jolt.x, jolt.y);

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

    for (const actor of actors.values()) {
      if (actor.rive) {
        // The rig owns the acting: idle is a clip, the fall is down/down_loop
        // driven by the contract's knockedDown boolean, and the procedural
        // bob and FALLEN_* pose would fight it. Connection fade still
        // applies — presence is the scene's fact, not the rig's.
        actor.rive.setKnockedDown(actor.down);
        actor.rive.tick(dt);
        actor.art.alpha = approach(actor.art.alpha, actor.connected ? 1 : 0.5, FADE_RATE, dt);
        continue;
      }
      if (actor.down) {
        // spec §7.3 — knocked down, never dead. They lie on the grid and wait
        // for someone to come get them.
        actor.art.rotation = approach(actor.art.rotation, FALLEN_ROTATION, DOWN_RATE, dt);
        actor.art.y = approach(actor.art.y, ACTOR_HEIGHT * 0.18, DOWN_RATE, dt);
        actor.art.alpha = approach(actor.art.alpha, FALLEN_ALPHA, DOWN_RATE, dt);
        continue;
      }
      const bob = Math.sin(elapsed * 1.6 + actor.phase);
      actor.art.rotation = approach(actor.art.rotation, bob * 0.02, BOB_RATE, dt);
      actor.art.y = bob * ACTOR_HEIGHT * 0.012;
      actor.art.alpha = approach(actor.art.alpha, actor.connected ? 1 : 0.5, FADE_RATE, dt);
    }
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
        camState = panBy(camState, viewport, { x: dx, y: dy });
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
          camState = zoomBy(camState, viewport, after / before, mid);
        }
        camState = panBy(camState, viewport, { x: mid.x - midBefore.x, y: mid.y - midBefore.y });
      }
    }

    pointers.set(event.pointerId, point);
  }

  function onPointerEnd(event: PointerEvent): void {
    pointers.delete(event.pointerId);
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    camState = zoomBy(camState, viewport, Math.exp(-event.deltaY * 0.0015), localPoint(event));
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
      viewport = { width, height };
      /*
       * Cover the pane with the *design rect*, not with the backdrop's bounds.
       * The drawn stand-in's ellipses deliberately bleed past the rect (they are
       * atmosphere, not geometry), so measuring `backdropArt.width` centres the
       * bleed instead of the picture — which with a real biome backdrop in there
       * showed up as a 200px band of nothing down one side of a 1280px TV.
       */
      const cover = Math.max(width / DESIGN.width, height / DESIGN.height);
      backdropArt.scale.set(cover);
      backdropArt.x = (width - DESIGN.width * cover) / 2;
      backdropArt.y = (height - DESIGN.height * cover) / 2;
      // The veil covers the pane, whatever the pane is right now. A margin of
      // one shake's amplitude so a jolt mid-step never shows a bright edge.
      stepVeil.clear().rect(-32, -32, width + 64, height + 64).fill({ color: 0x0a0820 });
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

    focusCamera(next) {
      target = next;
    },

    setNameplatesVisible(visible) {
      if (destroyed || visible === nameplatesVisible) return;
      nameplatesVisible = visible;
      for (const actor of actors.values()) {
        if (actor.label) actor.label.visible = visible;
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
      return { space: "story" as const, boxes };
    },

    setBiome(next) {
      if (destroyed || next === biomeId) return;
      biomeId = next;
      // A new place: take the old art down immediately. The drawn stand-in is
      // underneath it, so the gap while the next one loads is never a blank
      // screen — and staying in the last chapter's woods would be worse.
      biomeSprite?.destroy();
      biomeSprite = null;
      if (next === null) return;

      const wanted = next;
      void Assets.load<Texture>(biomeBackdropUrl(wanted))
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
        });
        camNow = null; // the ENCOUNTER_BEGAN beat covers the cut
      }
      if (!view && wasCombat) {
        camState = createCameraState({ board: STORY_BOARD, attention });
        camNow = null;
        heldEvents = [];
      }
      if (view) {
        board?.update(view);
        for (const held of heldEvents.splice(0)) {
          board?.playEvents(held.events, held.totalMs);
        }
      }
    },

    playCombatEvents(events, totalMs) {
      if (encounterView === null) {
        heldEvents.push({ events, totalMs });
        return;
      }
      board?.playEvents(events, totalMs);
    },

    shake(strength) {
      if (destroyed || prefersReducedMotion()) return;
      shakeState = startShake(shakeState, strength);
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
      for (const actor of actors.values()) {
        actor.rive?.destroy();
        actor.container.destroy({ children: true });
      }
      actors.clear();
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
function drawBackdrop(): Container {
  const container = new Container();
  const g = new Graphics();

  g.rect(0, 0, DESIGN.width, DESIGN.height).fill({ color: 0x141033 });
  g.ellipse(DESIGN.width * 0.5, GROUND_Y * 0.62, DESIGN.width * 0.42, DESIGN.height * 0.34)
    .fill({ color: 0x2a2159, alpha: 0.7 });
  g.ellipse(DESIGN.width * 0.18, GROUND_Y, DESIGN.width * 0.34, DESIGN.height * 0.22)
    .fill({ color: 0x1d2a3b, alpha: 0.8 });
  g.ellipse(DESIGN.width * 0.84, GROUND_Y, DESIGN.width * 0.32, DESIGN.height * 0.2)
    .fill({ color: 0x1d2a3b, alpha: 0.8 });
  g.rect(0, GROUND_Y, DESIGN.width, DESIGN.height - GROUND_Y).fill({ color: 0x0f1a1c });
  g.moveTo(0, GROUND_Y).lineTo(DESIGN.width, GROUND_Y).stroke({ width: 3, color: 0x3a2a1e, alpha: 0.9 });

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
