/**
 * Milestone kit pieces during play (docs/camp.md §5.4, #621): a hero who
 * reaches a new appearance tier unlocks that tier's tent, and one who earns a
 * class distinction unlocks its decoration. Written to her kit the moment it
 * lands, not left for the next read to derive, so nothing that happens after
 * (a failed campaign's revert, an abandoned chapter) can lose it.
 *
 * The same shape as the camp's finds (camp-finds.ts), for the same reasons:
 *
 *   - **Read off the step.** A tier lands at a chapter's end (the XP fold) and
 *     a rank at a fight's end (the engine's `landRanks`), and both show on the
 *     run's party, so the step's before and after say who moved. A hero whose
 *     tier, class or ranks did not change costs nothing.
 *   - **Written after the commit**, beside the camp's finds, through
 *     `mutateKit`: conditional on her row's version and claim, so it cannot
 *     undo the commit's write to her nor be undone by one. A rank the run has
 *     landed is on her row only at the chapter's end, so the run's view of her
 *     is read too (`resolvedStanding`).
 *   - **Once.** A piece already on her stored kit writes nothing, so a retry,
 *     a replay or a second room grants nothing new. An unpainted tier she
 *     reaches, which has no tent yet, is written as `HeroKit.highestTier`, so
 *     its tent still comes when its art ships (`readKit`), even after a revert.
 *   - **Never fails the turn.** A write that cannot land is logged; the next
 *     read still derives what she holds, and a failed campaign keeps it
 *     (`failCampaign`).
 *
 * What was new rides the broadcast as `kitUnlocks`, never the log, so her
 * phone says so once, after the transformation (client `kit-news.ts`).
 */

import { emptyKit, memberHome, milestoneKind, milestonePieces, resolvedStanding, withMilestones } from "@kad/shared";
import type { KitMilestoneUnlock, MilestoneStanding, PartyMember, RunState } from "@kad/shared";
import type { RunRecord } from "../store/repository.ts";
import { mutateKit, type CampDeps } from "./camp.ts";
import { iso } from "./deps.ts";

/** One hero whose standing moved this step: who she is, and what the run shows of her before and after. */
export interface MilestoneStep {
  member: PartyMember;
  before: MilestoneStanding;
  after: MilestoneStanding;
}

function standingKey(standing: MilestoneStanding): string {
  return JSON.stringify(standing);
}

/**
 * The seated heroes whose tier or ranks changed between `before` and `after`.
 * A hero not seated before is left out: her row already holds what she
 * brought, and her kit reads with it (`readKit`).
 */
export function stepMilestones(before: RunState, after: RunState): MilestoneStep[] {
  const steps: MilestoneStep[] = [];
  for (const member of after.party) {
    const was = before.party.find((m) => m.character.id === member.character.id);
    if (!was) continue;
    const from = resolvedStanding(was.character);
    const to = resolvedStanding(member.character);
    if (standingKey(from) !== standingKey(to)) steps.push({ member, before: from, after: to });
  }
  return steps;
}

/**
 * Write each moved hero's milestone pieces to her kit, at her home, and say
 * which were new because of this step. A piece she already had, or one
 * her row only now catches up on (an art drop since her last write), is
 * written but not announced.
 */
export async function claimMilestones(
  steps: readonly MilestoneStep[],
  input: { run: Pick<RunRecord, "id" | "householdId"> },
  deps: CampDeps,
): Promise<KitMilestoneUnlock[]> {
  if (steps.length === 0) return [];
  const at = iso(deps.now());
  const unlocks: KitMilestoneUnlock[] = [];
  for (const step of steps) {
    const characterId = step.member.character.id;
    // What this step earned: pieces the run shows now that it did not before.
    const earnedBefore = new Set(milestonePieces({}, [step.before]));
    const earned = milestonePieces({}, [step.after]).filter((id) => !earnedBefore.has(id));
    let fresh: string[] = [];
    try {
      const written = await mutateKit(
        memberHome(step.member, input.run.householdId),
        characterId,
        (_kit, hero) => {
          // Pure, and may run again on a fresher read: the last run is the one written.
          const stored = hero.kit ?? emptyKit();
          const next = withMilestones(stored, hero, at, [step.after]);
          fresh = Object.keys(next.unlocked).filter((id) => !Object.hasOwn(stored.unlocked, id));
          return next === stored ? null : next;
        },
        deps,
      );
      if (!written.ok) {
        if (written.reason !== "missing") console.error(`camp: milestones for hero ${characterId} were not written (${written.reason})`);
        continue;
      }
      if (!written.changed) continue;
    } catch (err) {
      console.error(`camp: writing milestones for hero ${characterId} in run ${input.run.id} failed:`, err);
      continue;
    }
    for (const pieceId of fresh) {
      const kind = milestoneKind(pieceId);
      if (kind && earned.includes(pieceId)) unlocks.push({ characterId, pieceId, kind });
    }
  }
  return unlocks;
}
