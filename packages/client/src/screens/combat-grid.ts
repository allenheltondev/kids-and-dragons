/**
 * The phone's view of the combat board, as plain data.
 *
 * CombatPanel renders a DOM grid of the encounter — buttons where a tap is
 * legal, inert cells everywhere else (§7.2: illegal moves are not presented).
 * Everything it needs per cell is computed here, pure, so the mapping from
 * `EncounterState` to "what can she tap" is testable without a DOM.
 */

import type { Chapter, Combatant, EncounterState, PartyMember, Position } from "@kad/shared";
import { NUMBED_BUFF_ID, currentActorId, enemyArtId, environmentView } from "@kad/shared";
import { facingFor, type Facing } from "../world/board-math";
import { CAPTIVE_ICON, EXIT_ICON, hazardIcon, objectiveIcon } from "./environment-copy";

/**
 * What the ground on a square is, in a fight with an environment (#201): a
 * hazard, a rift exit, or the captive. One per square — the authoring check
 * never lets two share one. Carried as a glyph and words, never a colour.
 */
export interface GridFeature {
  readonly kind: "hazard" | "exit" | "captive" | "objective";
  readonly label: string;
  /** icons.tsx name — the shape that marks the square. */
  readonly icon: string;
  /** A hazard burning this round, an exit open this round, a captive still waiting. */
  readonly active: boolean;
}

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
  /** A puffed-up enemy (#227): hitting it stings. Public, like hearts. Absent otherwise. */
  readonly puffed?: true;
}

/**
 * Is `occupantId` the hero on this phone, and Numbed (#227)? The lasting
 * marker belongs to the stung player's phone only: `viewerId` is the hero the
 * phone belongs to, and nobody else's figure ever asks for it.
 */
export function isNumbedHero(encounter: EncounterState, viewerId: string | null, occupantId: string): boolean {
  if (viewerId === null || viewerId !== occupantId) return false;
  return (encounter.buffs ?? []).some((buff) => buff.heroId === viewerId && buff.id === NUMBED_BUFF_ID);
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
  /** The environment's mark on this square (#201). Absent in an ordinary fight. */
  readonly feature?: GridFeature;
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
  /** How each figure was facing last time, kept when `facingFor` has no answer. */
  previousFacing: Readonly<Record<string, Facing>> = {},
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
      ...(combatant.puffed !== undefined && !combatant.down ? { puffed: true as const } : {}),
      // Straight above or below its nearest foe, or with nobody left, a
      // figure keeps the way it was facing, the same rule the TV board
      // follows (board.ts), so the two surfaces never disagree. A figure
      // seen for the first time starts as drawn, facing left, as it does
      // there too.
      facing: facingFor(encounter, combatant.id) ?? previousFacing[combatant.id] ?? "left",
    });
  }

  const features = featuresOf(encounter);

  const cells: GridCell[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const key = `${x},${y}`;
      const feature = features.get(key);
      cells.push({
        x,
        y,
        blocked: board.terrain[y * board.width + x] === "blocked",
        occupant: occupants.get(key) ?? null,
        tappable: tapKeys.has(key),
        selected: selectedKeys.has(key),
        nearness: nearnessOf(costs.get(key), farthest),
        ...(feature ? { feature } : {}),
      });
    }
  }
  return cells;
}

/**
 * Every square the environment marks, by `"x,y"`. Empty without one. A
 * captive who has been freed or lost is no longer on the board, and an exit
 * that has closed for good is no longer a way out, so neither is marked.
 */
function featuresOf(encounter: EncounterState): Map<string, GridFeature> {
  const out = new Map<string, GridFeature>();
  const view = environmentView(encounter);
  if (!view) return out;
  for (const hazard of view.hazards) {
    // Burnt out for good: no longer a mark on the ground.
    if (hazard.gone) continue;
    for (const t of hazard.tiles) {
      out.set(`${t.x},${t.y}`, { kind: "hazard", label: hazard.label, icon: hazardIcon(hazard.kind), active: hazard.active });
    }
  }
  for (const exit of view.exits) {
    if (exit.gone) continue;
    for (const t of exit.tiles) {
      out.set(`${t.x},${t.y}`, { kind: "exit", label: exit.label, icon: EXIT_ICON, active: exit.open });
    }
  }
  // Ground to hold and tears to close (#220), quiet once done.
  for (const objective of view.objectives) {
    for (const t of objective.tiles) {
      out.set(`${t.x},${t.y}`, { kind: "objective", label: objective.label, icon: objectiveIcon(objective.kind), active: !objective.done });
    }
  }
  for (const captive of view.captives) {
    if (captive.status !== "waiting") continue;
    const { at, name } = captive;
    out.set(`${at.x},${at.y}`, { kind: "captive", label: name, icon: CAPTIVE_ICON, active: true });
  }
  return out;
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
  if (art.startsWith("cast/")) return `/assets/${art}/assembled.png`;
  const id = art.startsWith("enemies/") ? art.slice("enemies/".length) : art;
  return `/assets/entities/${id}/portrait.webp`;
}
