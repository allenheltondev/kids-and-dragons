/**
 * A hero's look (docs/hero-looks.md §3.2, §8; #664): `LOOK_EDIT` at the table,
 * and the look half of a book edit (camp-book.ts `editKitFromBook`).
 *
 * The look is on her own row (`Character.look`), beside her kit, and is
 * written the way the kit is (camp.ts `planKit`, `mutateKit`):
 *
 *   - **At the table** the write is planned on one read of her row and carried
 *     by the run's commit (`CommitInput.characters`), conditional on her row's
 *     version and claim as read, so the look and the run state showing it land
 *     together or not at all. The intent names the look's `revision`: a look
 *     changed since (the book, another phone) is refused as stale, and when the
 *     table's view of her look is behind her row, that refusal still commits
 *     the refreshed view (`LookEditResult.refresh`), so the phone that was
 *     refused shows the look as it now stands and its next tap lands.
 *   - **From the book** (`mutateLook`) each field applies over whatever is
 *     stored by then, the device winning, retried on a lost race.
 *
 * Either way, only her own player (or her own kid, from the book) changes it,
 * and every look named must be hers (hero-look.ts `lookEditProblem`). Lobby
 * and rests only at the table: a look is a downtime choice, like the kit.
 */

import {
  LOOK_VERSION,
  campMomentKind,
  lookEditChanges,
  lookIntentProblem,
  lookEditProblem,
  lookView,
  readLook,
  withLookEdit,
} from "@kad/shared";
import type { ActionResponse, Character, ClientIntent, HeroLook, LookCatalog, LookEdit, RunState } from "@kad/shared";
import type { CharacterWrite, RunRecord } from "../store/repository.ts";
import { rewrite } from "./claim.ts";
import { CAMP_WRITE_ATTEMPTS, type CampDeps, type CampWriteResult } from "./camp.ts";
import type { HandlerDeps } from "./deps.ts";

type EditError = NonNullable<ActionResponse["error"]>;

/**
 * What a `LOOK_EDIT` comes to. `ok`: the run state showing her new look and
 * the row write the commit carries. Refused: the error, and, when the table's
 * view of her look was behind her row, the state to commit anyway so the
 * refused phone refreshes (`refresh`).
 */
export type LookEditResult =
  | { ok: true; state: RunState; write: CharacterWrite }
  | { ok: false; error: EditError; refresh?: RunState };

const illegal = (message: string): { ok: false; error: EditError } => ({ ok: false, error: { code: "ILLEGAL", message } });

/** The edit an intent asks for: only the fields it names. */
export function lookEditOf(intent: { coat?: string | null; nameplate?: string | null; title?: string | null }): LookEdit {
  return {
    ...(intent.coat !== undefined ? { coat: intent.coat } : {}),
    ...(intent.nameplate !== undefined ? { nameplate: intent.nameplate } : {}),
    ...(intent.title !== undefined ? { title: intent.title } : {}),
  };
}

/** The run state with one seated hero's look as stored (or as she has none). */
function withPartyLook(state: RunState, characterId: string, look: HeroLook | null): RunState {
  return {
    ...state,
    party: state.party.map((m) => {
      if (m.character.id !== characterId) return m;
      const character = { ...m.character };
      if (look) character.look = lookView(look);
      else delete character.look;
      return { ...m, character };
    }),
  };
}

/** A hero's look, changed by her own player at the table (§3.2, §8.2). */
export async function prepareLookEdit(
  state: RunState,
  intent: Extract<ClientIntent, { type: "LOOK_EDIT" }>,
  playerId: string,
  run: Pick<RunRecord, "householdId">,
  deps: CampDeps,
): Promise<LookEditResult> {
  const malformed = lookIntentProblem(intent as unknown as Record<string, unknown>);
  if (malformed !== null) return illegal(`malformed LOOK_EDIT: ${malformed}`);
  const kind = campMomentKind(state);
  if (kind !== "lobby" && kind !== "rest") return illegal("A look changes in the lobby or at a rest stop.");
  const member = state.party.find((m) => m.character.id === intent.characterId);
  if (!member) return { ok: false, error: { code: "NOT_FOUND", message: "that hero is not at this table" } };
  if (member.playerId !== playerId || (state.removed ?? []).includes(playerId)) {
    return { ok: false, error: { code: "FORBIDDEN", message: "only a hero's own player changes her look" } };
  }
  const catalog = deps.content.looksCatalog();
  if (!catalog) return illegal("there are no looks in this content");

  const hero = await deps.repo.getCharacter(member.homeHouseholdId ?? run.householdId, intent.characterId);
  if (!hero) return { ok: false, error: { code: "NOT_FOUND", message: "that hero has not been saved yet" } };
  const stored = readLook(hero);
  if (stored.revision !== intent.revision) {
    // Changed elsewhere since (the book, another phone): the newer look stands.
    const error: EditError = { code: "STALE_DECISION", message: "Your look changed on another screen. Look again." };
    const shown = member.character.look?.revision ?? 0;
    return shown === stored.revision ? { ok: false, error } : { ok: false, error, refresh: withPartyLook(state, hero.id, hero.look ?? null) };
  }
  const edit = lookEditOf(intent);
  const problem = lookEditProblem(catalog, Object.keys(stored.unlocked), edit, hero.species);
  if (problem !== null) return illegal(problem);
  const written = writeLook(hero, stored, edit);
  return { ok: true, state: withPartyLook(state, hero.id, written.look), write: written.write };
}

/** Her row with an edit made to her look, its revision bumped, as a write conditional on the row read. */
function writeLook(hero: Character, stored: HeroLook, edit: LookEdit): { look: HeroLook; write: CharacterWrite } {
  const look: HeroLook = { ...withLookEdit(stored, edit), v: LOOK_VERSION, revision: stored.revision + 1 };
  return { look, write: rewrite(hero, { ...hero, look }) };
}

/**
 * Change one hero's look on her row as it stands now, outside any run (the
 * book): `fn` is handed her look and returns the edit to make, or null for
 * none. Retried on a lost race, each time from a fresh read, so a table's
 * commit in between is never lost.
 */
export async function mutateLook(
  homeHouseholdId: string,
  characterId: string,
  fn: (look: HeroLook, hero: Character) => LookEdit | null,
  deps: Pick<HandlerDeps, "repo">,
): Promise<CampWriteResult<HeroLook>> {
  let last: HeroLook | undefined;
  for (let attempt = 0; attempt < CAMP_WRITE_ATTEMPTS; attempt++) {
    const hero = await deps.repo.getCharacter(homeHouseholdId, characterId);
    if (!hero) return { ok: false, reason: "missing" };
    const stored = readLook(hero);
    const edit = fn(structuredClone(stored), hero);
    if (edit === null || !lookEditChanges(stored, edit)) return { ok: true, value: stored, changed: false };
    last = stored;
    const written = writeLook(hero, stored, edit);
    if (await deps.repo.writeCharacter(written.write)) return { ok: true, value: written.look, changed: true };
  }
  return { ok: false, reason: "conflict", ...(last ? { value: last } : {}) };
}

/** Why the book cannot make this look edit, by the table's own rule. */
export function bookLookProblem(catalog: LookCatalog, look: HeroLook, edit: LookEdit, hero: Pick<Character, "species">): string | null {
  return lookEditProblem(catalog, Object.keys(look.unlocked), edit, hero.species);
}
