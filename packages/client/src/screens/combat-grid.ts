/**
 * The phone's view of the combat board, as plain data.
 *
 * CombatPanel renders a DOM grid of the encounter — buttons where a tap is
 * legal, inert cells everywhere else (§7.2: illegal moves are not presented).
 * Everything it needs per cell is computed here, pure, so the mapping from
 * `EncounterState` to "what can she tap" is testable without a DOM.
 */

import type { Chapter, Combatant, EncounterState, PartyMember, Position } from "@kad/shared";
import { currentActorId, enemyArtId } from "@kad/shared";
import { facingFor, type Facing } from "../world/board-math";

export interface GridOccupant {
  readonly id: string;
  readonly side: "party" | "enemy";
  readonly down: boolean;
  readonly name: string;
  /** Icon id — the species for a party member, a foe glyph for a monster. */
  readonly icon: string;
  /** The combat clock is on this figure. */
  readonly active: boolean;
  /** Hearts left, written in the square's corner. */
  readonly hp: number;
  /** Which way the figure faces: toward the nearest opponent (board-math.ts). */
  readonly facing: Facing;
}

export interface GridCell {
  readonly x: number;
  readonly y: number;
  readonly blocked: boolean;
  readonly occupant: GridOccupant | null;
  /** Legal to tap right now — a move destination or an ability's tile. */
  readonly tappable: boolean;
  readonly selected: boolean;
  /**
   * How near a walk destination is, from 1 (one step away) down to 0 (the
   * edge of the reach); null for anything that is not a walk. The dot is
   * drawn at that size, so a corner four diagonals away reads as far rather
   * than as a neighbour: the reach is a square (diagonals cost 1, spec
   * §7.1), and a kid counting squares sees eight where the game charges
   * four. Size, not colour, so it survives colour blindness (spec §11).
   */
  readonly nearness: number | null;
}

/**
 * A combatant's name as a button reads it. Three wisps are all "Bramblewisp",
 * and "which one am I about to hit" has to survive that — enemy ids carry
 * their placement ordinal (`wisp#2`, encounter.ts), so it becomes part of the
 * label. Party names are already unique; they pass through untouched.
 */
export function combatantLabel(combatant: Combatant): string {
  if (combatant.side === "party") return combatant.name;
  const ordinal = combatant.id.split("#")[1];
  return ordinal ? `${combatant.name} ${ordinal}` : combatant.name;
}

/** The icon a figure carries on the grid and in target lists (spec §1.5). */
export function combatantIcon(combatant: Combatant, party: readonly PartyMember[]): string {
  if (combatant.side === "enemy") return "swords";
  return party.find((m) => m.character.id === combatant.id)?.character.species ?? "party";
}

/**
 * The whole board as row-major cells. `tappable` marks exactly the given
 * positions — the caller passes `legalMoves` destinations or a legal action's
 * tiles, never anything it derived itself. `selected` is a list because a
 * multi-tile ability (Bramble Wall) keeps every picked tile lit while the
 * next one is chosen.
 */
export function gridCells(
  encounter: EncounterState,
  party: readonly PartyMember[],
  tappable: readonly (Position & { readonly cost?: number })[],
  selected: readonly Position[],
): GridCell[] {
  const { board } = encounter;
  const activeId = currentActorId(encounter);
  const tapKeys = new Set(tappable.map((p) => `${p.x},${p.y}`));
  // Walk destinations carry a cost (`legalMoves`); an ability's tiles do not.
  const costs = new Map(
    tappable.filter((p) => p.cost !== undefined).map((p) => [`${p.x},${p.y}`, p.cost as number]),
  );
  const farthest = Math.max(1, ...costs.values());
  const selectedKeys = new Set(selected.map((p) => `${p.x},${p.y}`));
  const byId = new Map(encounter.combatants.map((c) => [c.id, c]));

  const occupants = new Map<string, GridOccupant>();
  for (const actor of board.actors) {
    const combatant = byId.get(actor.id);
    if (!combatant) continue;
    occupants.set(`${actor.x},${actor.y}`, {
      id: combatant.id,
      side: combatant.side,
      down: combatant.down,
      name: combatantLabel(combatant),
      icon: combatantIcon(combatant, party),
      active: combatant.id === activeId,
      hp: combatant.hp,
      // Art is drawn facing left; nobody sideways to face keeps it that way.
      facing: facingFor(encounter, combatant.id) ?? "left",
    });
  }

  const cells: GridCell[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const key = `${x},${y}`;
      cells.push({
        x,
        y,
        blocked: board.terrain[y * board.width + x] === "blocked",
        occupant: occupants.get(key) ?? null,
        tappable: tapKeys.has(key),
        selected: selectedKeys.has(key),
        nearness: nearnessOf(costs.get(key), farthest),
      });
    }
  }
  return cells;
}

/**
 * 1 for a step away, 0 for the farthest tile on offer, evenly between. A
 * reach of one step has nothing to grade, so everything in it is near.
 */
export function nearnessOf(cost: number | undefined, farthest: number): number | null {
  if (cost === undefined) return null;
  if (farthest <= 1) return 1;
  return 1 - (cost - 1) / (farthest - 1);
}

/**
 * A key that changes whenever the thing being asked changes — new actor, new
 * round, steps spent, action spent — so a pending selection can never be
 * confirmed against a turn it was not made in (the same job PlayerPanel's
 * promptKey does for prompts).
 */
export function turnKey(encounter: EncounterState | null): string {
  if (!encounter) return "none";
  return [
    currentActorId(encounter) ?? "nobody",
    encounter.round,
    encounter.turnIndex,
    encounter.stepsLeft,
    encounter.actionTaken,
  ].join(":");
}

/**
 * The square portrait a monster's grid cell shows, by combatant id, or null
 * when its art is unknown (the cell then falls back to a glyph). Enemy ids are
 * `<specId>#<n>` (encounter.ts) and the art hangs off the chapter's spec, the
 * same lookup the TV board makes for the full figure.
 */
export function enemyPortraitUrl(
  chapter: Chapter | null,
  sceneId: string | null,
  combatantId: string,
): string | null {
  if (!chapter || !sceneId) return null;
  const scene = chapter.scenes[sceneId];
  if (!scene || scene.type !== "encounter") return null;
  const specId = combatantId.split("#")[0] ?? combatantId;
  const spec = scene.enemies.find((e) => e.id === specId);
  const art = spec ? enemyArtId(spec) : null;
  if (!art) return null;
  const id = art.startsWith("enemies/") ? art.slice("enemies/".length) : art;
  return `/assets/entities/${id}/portrait.webp`;
}
