/**
 * Finds during play (docs/camp.md §5.1, §5.4, §12.2; #618): the step that
 * applied a `findForCamp` or `findForKit` effect is claimed from storage the
 * moment it commits.
 *
 * The same shape as the Field Guide's finds (field-guide.ts), and for the same
 * reason: the engine is pure and replayable, and a camp or a kit is a
 * permanent write outside the run. So the engine only records the find on the
 * run (`RunState.campFinds`), and this reads it off the step, before against
 * after, and claims it after the commit, beside the book's write:
 *
 *   - **Saved when found.** Claimed on the step that found it, not at the
 *     chapter's end, so a room that closes a scene later has lost nothing.
 *     A step that loses the seq race committed nothing and claims nothing.
 *   - **Once.** A crew find goes through `claimReward`: the piece and the
 *     reward's receipt land in one conditional write, so a retry, a replay, a
 *     reconnect, a second route into the same place or a second room finds the
 *     receipt and gets nothing. A piece the crew already owns from another
 *     reward pays 1 Dash Cash instead (§5.1).
 *   - **A kit find is the hero's** (§12.1): each hero seated when it was found
 *     gets her own copy on her own row (`mutateKit`), at her home. A hero who
 *     already has it gets nothing, and Dash Cash is never paid for one. Her
 *     copy records the reward it came from, and holding the piece is what
 *     makes a second claim give nothing, so a replay cannot farm it either.
 *   - **Never fails the turn.** A claim that cannot be written is logged and
 *     reported as nothing; the step it rode has already happened.
 *
 * Replaying the event log rebuilds `campFinds` exactly and claims nothing:
 * only `applyAction`, after a commit, ever calls `claimCampFinds`.
 */

import { memberHome } from "@kad/shared";
import type { CampClaimResult, CampFind, CampRecord, RunState } from "@kad/shared";
import type { RunRecord } from "../store/repository.ts";
import { claimReward, mutateKit, type CampDeps } from "./camp.ts";
import { iso } from "./deps.ts";
import { discoveryHousehold } from "./field-guide.ts";

/**
 * The finds `after` recorded that `before` had not. `chapterStarted` means
 * `after` is a fresh chapter, whose every find is new; otherwise the list only
 * grows within a chapter, and a step that changes chapter without starting one
 * (back to the lobby) found nothing.
 */
export function stepCampFinds(before: RunState, after: RunState, chapterStarted: boolean): CampFind[] {
  const found = after.campFinds ?? [];
  if (found.length === 0) return [];
  if (chapterStarted) return [...found];
  if (before.chapterId !== after.chapterId) return [];
  const had = new Set((before.campFinds ?? []).map((find) => find.rewardId));
  return found.filter((find) => !had.has(find.rewardId));
}

/** The crew's camp with one find applied: the piece, or 1 Dash Cash for a piece it already owns (§5.1). */
export function withCampFind(camp: CampRecord, find: CampFind, at: string): { camp: CampRecord; result: "piece" | "dashCash" } {
  if (Object.hasOwn(camp.owned, find.pieceId)) return { camp: { ...camp, dashCash: camp.dashCash + 1 }, result: "dashCash" };
  return {
    camp: { ...camp, owned: { ...camp.owned, [find.pieceId]: { from: "found", rewardId: find.rewardId, at } } },
    result: "piece",
  };
}

/**
 * Claim the step's finds, in the order found, and say what each did. The
 * camp is the run's household's and crew's (`RunState.crew`; absent is the
 * first crew), once that household is settled (`discoveryHousehold`: a room
 * no phone has claimed yet records nothing).
 */
export async function claimCampFinds(
  finds: readonly CampFind[],
  input: { run: Pick<RunRecord, "id" | "householdId">; state: RunState },
  deps: CampDeps,
): Promise<CampClaimResult[]> {
  if (finds.length === 0) return [];
  const { run, state } = input;
  let householdId: string | null;
  try {
    householdId = await discoveryHousehold(run, state, deps);
  } catch (err) {
    console.error(`camp: could not settle run ${run.id}'s household; its finds are not claimed:`, err);
    return [];
  }
  if (!householdId) return [];
  const results: CampClaimResult[] = [];
  for (const find of finds) {
    try {
      results.push(find.kind === "camp" ? await claimCrewFind(householdId, state, find, deps) : await claimKitFind(householdId, state, find, deps));
    } catch (err) {
      console.error(`camp: claiming ${find.rewardId} for run ${run.id} failed:`, err);
    }
  }
  return results;
}

async function claimCrewFind(householdId: string, state: RunState, find: CampFind, deps: CampDeps): Promise<CampClaimResult> {
  const at = iso(deps.now());
  let result: "piece" | "dashCash" = "piece";
  const claimed = await claimReward(
    householdId,
    state.crew,
    find.rewardId,
    (camp) => {
      // Pure, and may run again on a fresher read: the last run is the one written.
      const applied = withCampFind(camp, find, at);
      result = applied.result;
      return applied.camp;
    },
    deps,
    { runId: state.runId },
  );
  const base = { rewardId: find.rewardId, kind: "camp" as const, pieceId: find.pieceId };
  if (!claimed.ok) {
    console.error(`camp: ${find.rewardId} was not claimed (${claimed.reason})`);
    return { ...base, result: "none" };
  }
  return { ...base, result: claimed.value.claimed ? result : "none" };
}

async function claimKitFind(householdId: string, state: RunState, find: CampFind, deps: CampDeps): Promise<CampClaimResult> {
  const at = iso(deps.now());
  const got: string[] = [];
  for (const characterId of find.heroes ?? []) {
    const member = state.party.find((m) => m.character.id === characterId);
    const home = member ? memberHome(member, householdId) : householdId;
    const written = await mutateKit(
      home,
      characterId,
      (kit) =>
        Object.hasOwn(kit.unlocked, find.pieceId)
          ? null
          : { ...kit, unlocked: { ...kit.unlocked, [find.pieceId]: { from: "found", rewardId: find.rewardId, at } } },
      deps,
    );
    if (written.ok && written.changed) got.push(characterId);
    else if (!written.ok) console.error(`camp: ${find.rewardId} for hero ${characterId} was not written (${written.reason})`);
  }
  return { rewardId: find.rewardId, kind: "kit", pieceId: find.pieceId, result: "kit", heroes: got };
}
