/**
 * The Pixi scene: a backdrop and the party standing in it.
 *
 * ---------------------------------------------------------------------------
 * WHY STATIC PNGs AND SINE WAVES
 *
 * Rive is the animation runtime (architecture §1) and Allen owns the rigs —
 * one skeleton per species, skinned per tier (roadmap Chapter 1/5). Until those
 * exist, this draws the committed tier PNGs and moves them procedurally. That
 * is a deliberate placeholder, not a design: `setParty`, the knocked-down
 * state, and `focusCamera` are the seams a Rive-backed actor drops into without
 * the callers changing.
 *
 * Art conventions come from assets/manifest.json, which is the contract the
 * verifier enforces: a 1024×1024 canvas with the character's ground contact at
 * (512, 900). That origin is why the sprite anchor is 0.5 / 0.879 rather than
 * centred — actors are positioned by where their feet touch the floor, so a
 * Mythic unicorn and a Fledgling one stand on the same line.
 *
 * Only `unicorn` art exists today, in all four tiers. Every other species gets
 * an obviously-unfinished silhouette: a placeholder that looks like a
 * placeholder is a to-do, a broken image is a bug report.
 * ---------------------------------------------------------------------------
 */

import { Application, Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { PartyMember, SpeciesId, TierId } from "@kad/shared";

/** assets/manifest.json → canvas. */
const CANVAS = { width: 1024, height: 1024, originX: 512, originY: 900 } as const;
const ANCHOR_X = CANVAS.originX / CANVAS.width;
const ANCHOR_Y = CANVAS.originY / CANVAS.height;

/** The scene is authored at this size and letterboxed into whatever pane it gets. */
const DESIGN = { width: 1600, height: 900 } as const;
const GROUND_Y = DESIGN.height * 0.82;
/** A character's drawn height in design units at zoom 1. */
const ACTOR_HEIGHT = DESIGN.height * 0.46;

/** Everything Allen has delivered so far. Extend as tiers land. */
const SPECIES_WITH_ART: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["unicorn"]);

export function characterArtUrl(species: SpeciesId, tier: TierId): string {
  return `/assets/characters/${species}/${tier}/assembled.png`;
}

export function hasArt(species: SpeciesId): boolean {
  return SPECIES_WITH_ART.has(species);
}

export type FocusTarget =
  | { kind: "party" }
  | { kind: "character"; characterId: string }
  | { kind: "point"; x: number; y: number; zoom?: number };

export interface PartyScene {
  resize(width: number, height: number): void;
  setParty(members: readonly PartyMember[]): void;
  /**
   * Frame something. Unconditional on every surface (architecture §4.6 rule 3):
   * a 10×8 grid in a 60%-height portrait pane is unreadable at full extent, and
   * the TV gets the same camera for free. Combat drives this in Chapter 4; the
   * seam exists now so it isn't retrofitted through the render loop later.
   */
  focusCamera(target: FocusTarget): void;
  destroy(): void;
}

interface Actor {
  container: Container;
  art: Container;
  characterId: string;
  phase: number;
  down: boolean;
  connected: boolean;
  /** Design-space position of the actor's feet. */
  x: number;
  y: number;
}

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

const LERP = 0.12;

export function createScene(app: Application): PartyScene {
  const stage = app.stage;

  const backdrop = new Container();
  const camera = new Container();
  stage.addChild(backdrop, camera);

  const backdropArt = drawBackdrop();
  backdrop.addChild(backdropArt);

  const actorsLayer = new Container();
  camera.addChild(actorsLayer);

  const actors = new Map<string, Actor>();
  let destroyed = false;
  let elapsed = 0;

  let viewport: { width: number; height: number } = { width: DESIGN.width, height: DESIGN.height };
  let fitScale = 1;
  let target: FocusTarget = { kind: "party" };
  let camNow: CameraState = { x: DESIGN.width / 2, y: DESIGN.height / 2, zoom: 1 };
  let camWant: CameraState = { ...camNow };

  function layoutActors(): void {
    const list = [...actors.values()];
    const spacing = Math.min(DESIGN.width / (list.length + 1), DESIGN.width * 0.26);
    const start = DESIGN.width / 2 - (spacing * (list.length - 1)) / 2;
    list.forEach((actor, index) => {
      actor.x = start + spacing * index;
      // A shallow depth stagger so three characters read as a group rather than
      // a row of stickers. Allen's Chapter 2 lineup composition replaces this.
      actor.y = GROUND_Y + (index % 2 === 0 ? 0 : DESIGN.height * 0.03);
      actor.container.x = actor.x;
      actor.container.y = actor.y;
    });
  }

  function resolveCamera(): CameraState {
    if (target.kind === "point") {
      return { x: target.x, y: target.y, zoom: target.zoom ?? 1.6 };
    }
    if (target.kind === "character") {
      const actor = actors.get(target.characterId);
      if (actor) return { x: actor.x, y: actor.y - ACTOR_HEIGHT * 0.45, zoom: 1.7 };
    }
    return { x: DESIGN.width / 2, y: DESIGN.height / 2, zoom: 1 };
  }

  function applyCamera(): void {
    camera.scale.set(fitScale * camNow.zoom);
    camera.x = viewport.width / 2 - camNow.x * fitScale * camNow.zoom;
    camera.y = viewport.height / 2 - camNow.y * fitScale * camNow.zoom;
  }

  function tick(): void {
    if (destroyed) return;
    const dt = app.ticker.deltaMS / 1000;
    elapsed += dt;

    camWant = resolveCamera();
    camNow = {
      x: camNow.x + (camWant.x - camNow.x) * LERP,
      y: camNow.y + (camWant.y - camNow.y) * LERP,
      zoom: camNow.zoom + (camWant.zoom - camNow.zoom) * LERP,
    };
    applyCamera();

    for (const actor of actors.values()) {
      if (actor.down) {
        // spec §7.3 — knocked down, never dead. They lie on the grid and wait
        // for someone to come get them.
        actor.art.rotation += (-1.25 - actor.art.rotation) * 0.18;
        actor.art.y += (ACTOR_HEIGHT * 0.18 - actor.art.y) * 0.18;
        actor.art.alpha += (0.75 - actor.art.alpha) * 0.18;
        continue;
      }
      const bob = Math.sin(elapsed * 1.6 + actor.phase);
      actor.art.rotation += (bob * 0.02 - actor.art.rotation) * 0.2;
      actor.art.y = bob * ACTOR_HEIGHT * 0.012;
      actor.art.alpha += ((actor.connected ? 1 : 0.5) - actor.art.alpha) * 0.15;
    }
  }

  app.ticker.add(tick);

  function makeActor(member: PartyMember): Actor {
    const container = new Container();
    const art = new Container();
    container.addChild(art);
    actorsLayer.addChild(container);

    const placeholder = drawPlaceholder(ACTOR_HEIGHT);
    art.addChild(placeholder);

    const { species, tier, id } = member.character;
    if (hasArt(species)) {
      void Assets.load<Texture>(characterArtUrl(species, tier))
        .then((texture) => {
          if (destroyed || !actors.has(id)) return;
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
    }

    return {
      container,
      art,
      characterId: id,
      phase: Math.random() * Math.PI * 2,
      down: member.down,
      connected: member.connected,
      x: 0,
      y: GROUND_Y,
    };
  }

  return {
    resize(width, height) {
      viewport = { width, height };
      // Contain, not cover: the party must never be cropped out of a short pane.
      fitScale = Math.min(width / DESIGN.width, height / DESIGN.height);
      backdropArt.scale.set(Math.max(width / DESIGN.width, height / DESIGN.height));
      backdropArt.x = (width - backdropArt.width) / 2;
      backdropArt.y = (height - backdropArt.height) / 2;
      applyCamera();
    },

    setParty(members) {
      if (destroyed) return;
      const seen = new Set<string>();

      for (const member of members) {
        const id = member.character.id;
        seen.add(id);
        const existing = actors.get(id);
        if (existing) {
          existing.down = member.down;
          existing.connected = member.connected;
          continue;
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

    focusCamera(next) {
      target = next;
    },

    destroy() {
      destroyed = true;
      app.ticker.remove(tick);
      for (const actor of actors.values()) actor.container.destroy({ children: true });
      actors.clear();
      backdrop.destroy({ children: true });
      camera.destroy({ children: true });
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

/**
 * A silhouette that reads as "art pending" at a glance — hatched fill, dashed
 * outline. Five of six species land here until Chapter 1's commissions arrive.
 */
function drawPlaceholder(height: number): Graphics {
  const g = new Graphics();
  const w = height * 0.52;
  const h = height;

  g.roundRect(-w / 2, -h, w, h * 0.62, w * 0.3).fill({ color: 0x2b2a45 });
  g.circle(0, -h * 0.78, w * 0.34).fill({ color: 0x2b2a45 });
  g.roundRect(-w * 0.3, -h * 0.38, w * 0.22, h * 0.38, w * 0.1).fill({ color: 0x2b2a45 });
  g.roundRect(w * 0.08, -h * 0.38, w * 0.22, h * 0.38, w * 0.1).fill({ color: 0x2b2a45 });

  for (let i = 0; i < 7; i += 1) {
    const y = -h + (h / 7) * i;
    g.moveTo(-w / 2, y).lineTo(w / 2, y - h / 14).stroke({ width: 2, color: 0x6c7ab0, alpha: 0.35 });
  }

  g.roundRect(-w / 2, -h, w, h, w * 0.2).stroke({
    width: 3,
    color: 0x8b6cf5,
    alpha: 0.75,
  });

  return g;
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
