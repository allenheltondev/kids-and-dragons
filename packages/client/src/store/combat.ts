/**
 * The client's half of the combat rules boundary — pure helpers, no store.
 *
 * `legalActions` / `legalMoves` (packages/shared/src/encounter.ts) run fine in
 * the browser: they are pure reads over the mirrored `EncounterState`. What
 * the client has to supply is the `EncounterContext` they take — the rules,
 * the ability catalog, and an `Rng` the *listing* functions never draw from.
 * This module builds that context, parses the catalog the server serves at
 * `/content/abilities.json`, and answers "is it my turn" — the three pieces
 * the combat screens share.
 *
 * None of this re-derives legality. §7.2's guarantee — "illegal moves are not
 * presented, so they can't be attempted" — is `legalActions` itself, the same
 * function the server validates with; the phone renders its output verbatim
 * and the server refuses anything stale (brief, trap 2).
 */

import type {
  AbilityCatalog,
  CombatAbility,
  EncounterContext,
  RulesContent,
  Rng,
  RunState,
} from "@kad/shared";
import { EFFECT_VERBS, currentActor } from "@kad/shared";

/**
 * A deterministic stand-in for the context's `rng` slot. Listing legal actions
 * rolls nothing — dice are rolled in Lambda, never in the browser (dice.ts) —
 * so this exists purely to satisfy the type. It returns a constant rather
 * than throwing because a *preview* path that one day touches it should show
 * a boring number, not take the table down; and a constant is deterministic,
 * so nothing the client renders can ever depend on local randomness.
 */
export const PREVIEW_RNG: Rng = { next: () => 0.5 };

/** The context `legalActions` wants, from what the store has loaded. */
export function combatContext(rules: RulesContent, abilities: AbilityCatalog): EncounterContext {
  return { rules, abilities, rng: PREVIEW_RNG };
}

/**
 * `content/abilities.json` → the catalog `legalActions` takes.
 *
 * The file wraps the catalog (`{ version, abilities }`) and carries authoring
 * `$comment`s at every level, so this peels the wrapper and keeps only entries
 * whose every effect names a verb the engine implements — the same check the
 * server's loader makes at startup. An entry with an unknown verb is dropped,
 * not thrown on: the server would refuse the action anyway, and a phone that
 * crashes on stale content is worse than a phone missing one button.
 */
export function parseAbilityCatalog(raw: unknown): AbilityCatalog {
  if (typeof raw !== "object" || raw === null) return {};
  const wrapped = (raw as { abilities?: unknown }).abilities;
  const entries = typeof wrapped === "object" && wrapped !== null ? wrapped : raw;

  const out: Record<string, CombatAbility> = {};
  for (const [id, value] of Object.entries(entries as Record<string, unknown>)) {
    if (id.startsWith("$")) continue; // $comment and friends
    if (typeof value !== "object" || value === null) continue;
    const ability = value as CombatAbility;
    if (typeof ability.name !== "string" || typeof ability.icon !== "string") continue;
    if (typeof ability.target !== "object" || ability.target === null) continue;
    if (!Array.isArray(ability.effects)) continue;
    const verbsKnown = ability.effects.every((spec) => {
      const effect = (spec as { effect?: { type?: unknown } } | null)?.effect;
      return (
        typeof effect?.type === "string" &&
        (EFFECT_VERBS as readonly string[]).includes(effect.type)
      );
    });
    if (!verbsKnown) continue;
    out[id] = { ...ability, id };
  }
  return out;
}

/**
 * Is this device's player the one the combat clock is on?
 *
 * The check mirrors the server's `requireTurn` (engine.ts): the active figure
 * must be a party member, and that member must belong to this player. A
 * display client (`playerId === ""`) is never up — the TV has no authority
 * (spec §2.1) — and `currentActor` already answers null for a knocked-down
 * figure, so a downed character's phone correctly waits.
 */
export function isMyCombatTurn(state: RunState | null, playerId: string): boolean {
  if (!state?.encounter || !playerId) return false;
  const actor = currentActor(state.encounter);
  if (!actor || actor.side !== "party") return false;
  const member = state.party.find((m) => m.character.id === actor.id);
  return member?.playerId === playerId;
}
