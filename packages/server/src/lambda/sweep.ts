/**
 * The sweeper — what makes "anonymous play is not remembered" true, and an
 * owner's retention window (#252) true for a kid who stopped playing.
 *
 * Runs on a schedule, queries the `GUEST` partition of GSI1 for households whose
 * expiry has passed, and deletes each one along with everything under it. A
 * household that somebody signed in and claimed has no entry in that partition
 * at all (see `keys.ts`), so it is not merely skipped here — it is invisible to
 * this function, which is the property worth having for code whose whole job is
 * deleting families' characters.
 *
 * Bounded per run rather than looping to exhaustion: this is a family game, the
 * backlog is measured in tens, and a sweeper that cannot run long enough to be
 * dangerous is a sweeper that cannot be woken up at 2am by a bug in itself.
 *
 * Each household's kids are also taken out of the saves of the other tables
 * they visited (`forgetEverywhere`, #252), once the delete has landed: before
 * it, a family signing in at the last moment would keep their household and
 * still find their kids gone from a friend's game.
 */

import {
  forgetEverywhere,
  kidsOf,
  retryForgets,
  sweepIdleProfiles,
  type ForgetRetryResult,
  type IdleSweepResult,
} from "../handlers/retention.ts";
import { DynamoRepository } from "../store/dynamo-repository.ts";
import type { GameRepository } from "../store/repository.ts";
import { requiredEnv } from "./runtime.ts";

/** Households deleted per invocation. The schedule catches up if it overflows. */
const BATCH = 25;

export interface SweepResult {
  scanned: number;
  deleted: string[];
  /** Claimed between the index query and the delete. Not an error — a save. */
  spared: string[];
  failed: { householdId: string; reason: string }[];
  /** Kids past their household's retention window (#252). */
  idle: IdleSweepResult;
  /** Deletes whose scrub of other tables failed before, tried again (#252). */
  forgets: ForgetRetryResult;
}

export async function handler(): Promise<SweepResult> {
  return sweep(new DynamoRepository({ tableName: requiredEnv("TABLE_NAME") }), Date.now);
}

/** One sweep, against any store; the handler is this on DynamoDB. */
export async function sweep(repo: GameRepository, now: () => number): Promise<SweepResult> {
  const nowIso = new Date(now()).toISOString();

  const expired = await repo.listExpiredGuestHouseholds(nowIso, BATCH);
  const result: Omit<SweepResult, "idle" | "forgets"> = { scanned: expired.length, deleted: [], spared: [], failed: [] };

  for (const household of expired) {
    try {
      /*
       * The expiry check lives inside the delete, on purpose. An earlier
       * version read the household back here and skipped it if it had been
       * claimed — which reads like a guard and is not one: a sign-in landing
       * between that read and the delete still lost the characters, and it is
       * the exact window a family hits by signing in the moment they are
       * reminded the game is about to forget them.
       *
       * `deleteGuestHousehold` gates the whole operation on a conditional
       * write instead, and returns false when the claim got there first.
       */
      // Read before the delete takes the kids' visits with it, and each kid's
      // forget job written first, so a sweep that dies after the delete is
      // finished by the next one rather than lost with her visits.
      const kids = await kidsOf(household.id, "guest", { repo, now });
      for (const kid of kids) await repo.putForget(kid);
      const deleted = await repo.deleteGuestHousehold(household.id, nowIso);
      if (deleted) {
        result.deleted.push(household.id);
        await forgetEverywhere(kids, { repo, now });
      } else {
        for (const kid of kids) await repo.deleteForget(kid.playerId);
        console.log(`[sweep] sparing ${household.id}: claimed since the index query`);
        result.spared.push(household.id);
      }
    } catch (err) {
      // One bad household must not stop the rest of the sweep.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[sweep] could not delete ${household.id}: ${reason}`);
      result.failed.push({ householdId: household.id, reason });
    }
  }

  const idle = await sweepIdleProfiles({ repo, now });
  const forgets = await retryForgets({ repo, now });
  console.log(
    `[sweep] scanned ${result.scanned}, deleted ${result.deleted.length}, ` +
      `spared ${result.spared.length}, failed ${result.failed.length}; ` +
      `idle kids deleted ${idle.deleted.length}, kept ${idle.kept.length}, failed ${idle.failed.length}; ` +
      `forgets finished ${forgets.finished.length}, dropped ${forgets.dropped.length}, owed ${forgets.owed.length}`,
  );
  return { ...result, idle, forgets };
}
