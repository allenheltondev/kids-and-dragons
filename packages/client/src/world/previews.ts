/**
 * What the shared screen lights up while a player is still deciding
 * (`IntentPreview`, protocol.ts).
 *
 * Previews arrive live and are never part of the mirror, so one can outlive
 * the moment it described — a turn that ended, a choice the story moved past.
 * Everything here is filtered against the state the screen is showing, which
 * is what lets a stale preview simply stop drawing instead of needing an undo
 * message that might itself get lost.
 */

import {
  UNIVERSAL_ABILITIES,
  combatantById,
  currentActor,
  positionOf,
  type AbilityCatalog,
  type EncounterState,
  type IntentPreview,
  type ItemCatalog,
  type Position,
  type RunState,
} from "@kad/shared";
import { combatantLabel } from "../screens/combat-grid";

export type CombatPreview = Exclude<IntentPreview, { kind: "choice" }>;

export interface TablePreviews {
  /** The fighter whose turn it is, and what they have picked so far. */
  combat: { playerId: string; name: string; preview: CombatPreview } | null;
  /** Story option id → who is leaning toward it, in seat order. */
  choices: Readonly<Record<string, readonly string[]>>;
}

const NONE: TablePreviews = { combat: null, choices: {} };

export function tablePreviews(
  state: RunState | null,
  previews: Readonly<Record<string, IntentPreview>>,
): TablePreviews {
  // Nobody picking is the usual case, and it needs nothing read off the state.
  if (state === null || Object.keys(previews).length === 0) return NONE;

  const encounter = state.encounter ?? null;
  if (encounter) {
    // Only the fighter whose turn it is can be about to do anything.
    const active = currentActor(encounter);
    if (active === null || active.side !== "party") return NONE;
    const member = state.party.find((m) => m.character.id === active.id);
    const preview = member ? previews[member.playerId] : undefined;
    if (!member || !preview || preview.kind === "choice") return NONE;
    return { combat: { playerId: member.playerId, name: member.character.name, preview }, choices: {} };
  }

  const prompt = state.prompt;
  if (prompt === null || prompt.kind !== "choice") return NONE;
  const offered = new Set(prompt.options.map((o) => o.id));
  const choices: Record<string, string[]> = {};
  for (const member of state.party) {
    const preview = previews[member.playerId];
    if (preview?.kind !== "choice" || !offered.has(preview.choiceId)) continue;
    (choices[preview.choiceId] ??= []).push(member.character.name);
  }
  return { combat: null, choices };
}

/** The tiles and figures a combat preview points at, for the board to ring. */
export interface BoardAim {
  tiles: readonly Position[];
  targets: readonly Position[];
}

export function boardAim(encounter: EncounterState, preview: CombatPreview | null): BoardAim | null {
  if (preview === null) return null;
  const at = (ids: readonly string[] | undefined): Position[] =>
    (ids ?? []).map((id) => positionOf(encounter, id)).filter((p): p is Position => p !== null);
  switch (preview.kind) {
    case "move":
      return { tiles: [preview.to], targets: [] };
    case "action":
      return { tiles: preview.tiles ?? [], targets: at(preview.targetIds) };
    case "item":
      return { tiles: [], targets: at(preview.targetId ? [preview.targetId] : []) };
    case "end_turn":
      return null;
  }
}

/** One line for the table: "Fire Bolt → Bog Wisp", "Walking", "Ending the turn". */
export function describeCombatPreview(
  preview: CombatPreview,
  encounter: EncounterState,
  abilities: AbilityCatalog | null,
  items: ItemCatalog | null,
): string {
  const names = (ids: readonly string[]): string =>
    ids
      .map((id) => combatantById(encounter, id))
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map(combatantLabel)
      .join(" and ");
  switch (preview.kind) {
    case "move":
      return "Walking here";
    case "end_turn":
      return "Ending the turn";
    case "item": {
      const name = `Use ${items?.[preview.itemId]?.name ?? preview.itemId}`;
      const who = preview.targetId ? names([preview.targetId]) : "";
      return who === "" ? name : `${name} → ${who}`;
    }
    case "action": {
      const name =
        abilities?.[preview.abilityId]?.name ?? UNIVERSAL_ABILITIES[preview.abilityId]?.name ?? preview.abilityId;
      const who = names(preview.targetIds ?? []);
      return who === "" ? name : `${name} → ${who}`;
    }
  }
}
