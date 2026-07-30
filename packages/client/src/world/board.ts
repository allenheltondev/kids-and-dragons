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
 * the patch; a beat we skip (roll, protected, dazed — no art yet) costs
 * spectacle, never truth.
 *
 * TILE ART: sliced from `assets/biomes/<biome>/tiles.png` — row 0 is the four
 * floor variants, row 1 the four blocked variants (asset-brief §4.5). A sheet
 * that fails to load falls back to flat-coloured tiles in the theme palette,
 * with blocked tiles hatched — the same "a placeholder looks like a
 * placeholder" rule the character sprites follow. The variant per tile is a
 * deterministic hash of its coordinates so every client lays the same floor.
 * ---------------------------------------------------------------------------
 */

import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type {
  Combatant,
  EncounterEvent,
  EncounterState,
  PartyMember,
  Position,
} from "@kad/shared";
import { currentActor, currentActorId, legalMoves } from "@kad/shared";
import {
  ANCHOR_X,
  ANCHOR_Y,
  CANVAS,
  DOWN_RATE,
  FALLEN_ALPHA,
  FALLEN_ROTATION,
  WALK_RATE,
  approach,
  characterArtUrl,
  drawPlaceholder,
  enemyArtUrl,
} from "./actor-art";

import { BOARD_TILE_PX, beatOffsetsMs, tileVariant } from "./board-math";

export { BOARD_TILE_PX } from "./board-math";

/** A figure's drawn height. Taller than a tile on purpose: creatures overlap
    the tile behind them, which is what the row z-sort exists to make read. */
const ACTOR_HEIGHT = BOARD_TILE_PX * 1.7;

/** Where feet sit inside a tile — low, so the figure reads as *on* it. */
const FEET_Y = 0.82;

/** Everything `update()` needs, gathered by PixiStage from the store. */
export interface BoardViewState {
  readonly encounter: EncounterState;
  /** The chapter's biome, for the tile sheet. Null falls back to flat tiles. */
  readonly biome: string | null;
  /** Enemy spec id → authored art id ("enemies/will_o_wisp"). */
  readonly enemyArt: Readonly<Record<string, string>>;
  /** For species/tier art lookup by character id. */
  readonly party: readonly PartyMember[];
}

export interface BoardLayer {
  readonly container: Container;
  update(view: BoardViewState): void;
  /** Play a COMBAT_SEQUENCE's beats, spaced across the presentation hold. */
  playEvents(events: readonly EncounterEvent[], totalMs: number): void;
  /** Called from the scene's ticker — this module adds no ticker of its own,
      so PixiStage's stopped-when-hidden discipline holds for free. */
  tick(dtSeconds: number): void;
  destroy(): void;
}

interface BoardActor {
  container: Container;
  art: Container;
  id: string;
  side: "party" | "enemy";
  down: boolean;
  /** Board-pixel position of the feet; the container approaches it. */
  targetX: number;
  targetY: number;
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
}

const FLOATER_LIFE_S = 1.1;
const FLOATER_RISE = BOARD_TILE_PX * 0.5;

export function createBoardLayer(): BoardLayer {
  const container = new Container();
  const tilesLayer = new Container();
  const highlightLayer = new Graphics();
  const actorsLayer = new Container();
  // Painter's order by zIndex: feet further down the board draw in front.
  actorsLayer.sortableChildren = true;
  const floatLayer = new Container();
  container.addChild(tilesLayer, highlightLayer, actorsLayer, floatLayer);

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
  /** The last moves drawn, as a cheap signature. */
  let movesKey = "";

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
    const task = Assets.load<Texture>(`/assets/biomes/${biome}/tiles.png`)
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

  function artUrlFor(combatant: Combatant, current: BoardViewState): string | null {
    if (combatant.side === "party") {
      const member = current.party.find((m) => m.character.id === combatant.id);
      if (!member) return null;
      return characterArtUrl(member.character.species, member.character.tier);
    }
    // Enemy ids are `<specId>#<n>` (encounter.ts); the art hangs off the spec.
    const specId = combatant.id.split("#")[0] ?? combatant.id;
    const art = current.enemyArt[specId];
    return art ? enemyArtUrl(art) : null;
  }

  function makeActor(combatant: Combatant, at: Position, current: BoardViewState): BoardActor {
    const actorContainer = new Container();
    const art = new Container();
    actorContainer.addChild(art);
    actorsLayer.addChild(actorContainer);

    const placeholder = drawPlaceholder(ACTOR_HEIGHT);
    art.addChild(placeholder);

    const feet = feetOf(at);
    const actor: BoardActor = {
      container: actorContainer,
      art,
      id: combatant.id,
      side: combatant.side,
      down: combatant.down,
      targetX: feet.x,
      targetY: feet.y,
    };
    actorContainer.x = feet.x;
    actorContainer.y = feet.y;
    actorContainer.zIndex = feet.y;

    // Same rule as the story lineup: always ask for the file, keep the
    // placeholder when it is not there. A list of "delivered art" goes stale;
    // a 404 cannot.
    const url = artUrlFor(combatant, current);
    if (url) {
      void Assets.load<Texture>(url)
        .then((texture) => {
          // Identity, not id — a stale resolve must not draw into a destroyed
          // container after the fight rebuilt this figure.
          if (destroyed || actors.get(combatant.id) !== actor) return;
          const sprite = new Sprite(texture);
          sprite.anchor.set(ANCHOR_X, ANCHOR_Y);
          sprite.scale.set(ACTOR_HEIGHT / CANVAS.height);
          art.removeChildren();
          placeholder.destroy();
          art.addChild(sprite);
        })
        .catch(() => {
          /* keep the placeholder: a missing enemy must never blank the board */
        });
    }

    return actor;
  }

  function syncActors(current: BoardViewState): void {
    const { encounter } = current;
    const seen = new Set<string>();

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
        existing.targetX = feet.x;
        existing.targetY = feet.y;
        continue;
      }
      actors.set(combatant.id, makeActor(combatant, gridActor, current));
    }

    for (const [id, actor] of [...actors.entries()]) {
      if (seen.has(id)) continue;
      actor.container.destroy({ children: true });
      actors.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Highlights — §7.2 "reachable tiles highlighted", straight from legalMoves
  // -------------------------------------------------------------------------

  function drawHighlights(encounter: EncounterState): void {
    // Only a party figure's reach is the table's business; a monster's would
    // telegraph the AI and clutter the board (the server drives it anyway).
    const actor = currentActor(encounter);
    const moves = actor?.side === "party" ? legalMoves(encounter) : [];
    const key = moves.map((m) => `${m.x},${m.y}`).join(";");
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
  }

  // -------------------------------------------------------------------------
  // Beats
  // -------------------------------------------------------------------------

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

  function playBeat(event: EncounterEvent): void {
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
      case "roll":
      case "protected":
      case "dazed":
        // Effect-sheet territory (brief step 4) — deliberately no art yet.
        // The state they change still arrives on the patch.
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
      drawHighlights(encounter);
    },

    playEvents(events, totalMs) {
      if (destroyed) return;
      const offsets = beatOffsetsMs(events.length, totalMs);
      events.forEach((event, i) => {
        pending.push({ at: clock + (offsets[i] ?? 0) / 1000, event });
      });
    },

    tick(dtSeconds: number) {
      if (destroyed) return;
      clock += dtSeconds;
      pulse += dtSeconds;

      // Due beats, in order. The queue is short (≤ a round of events) and
      // append-only between ticks, so a filter pass is fine.
      for (let i = 0; i < pending.length; ) {
        const beat = pending[i];
        if (beat && beat.at <= clock) {
          pending.splice(i, 1);
          playBeat(beat.event);
        } else {
          i += 1;
        }
      }

      for (const actor of actors.values()) {
        actor.container.x = approach(actor.container.x, actor.targetX, WALK_RATE, dtSeconds);
        actor.container.y = approach(actor.container.y, actor.targetY, WALK_RATE, dtSeconds);
        actor.container.zIndex = actor.container.y;
        if (actor.down) {
          // spec §7.3 — knocked down, never dead. They lie on the grid and
          // wait for someone to come get them. Same pose as the lineup.
          actor.art.rotation = approach(actor.art.rotation, FALLEN_ROTATION, DOWN_RATE, dtSeconds);
          actor.art.alpha = approach(actor.art.alpha, FALLEN_ALPHA, DOWN_RATE, dtSeconds);
        } else {
          actor.art.rotation = approach(actor.art.rotation, 0, DOWN_RATE, dtSeconds);
          actor.art.alpha = approach(actor.art.alpha, 1, DOWN_RATE, dtSeconds);
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

    destroy() {
      destroyed = true;
      pending.length = 0;
      for (const floater of floaters) floater.text.destroy();
      floaters.length = 0;
      for (const actor of actors.values()) actor.container.destroy({ children: true });
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
