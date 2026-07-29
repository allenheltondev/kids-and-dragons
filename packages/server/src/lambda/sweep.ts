/**
 * The guest sweeper — what makes "anonymous play is not remembered" true.
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
 */

import { DynamoRepository } from "../store/dynamo-repository.ts";
import { requiredEnv } from "./runtime.ts";

/** Households deleted per invocation. The schedule catches up if it overflows. */
const BATCH = 25;

export interface SweepResult {
  scanned: number;
  deleted: string[];
  /** Claimed between the index query and the delete. Not an error — a save. */
  spared: string[];
  failed: { householdId: string; reason: string }[];
}

export async function handler(): Promise<SweepResult> {
  const repo = new DynamoRepository({ tableName: requiredEnv("TABLE_NAME") });
  const nowIso = new Date().toISOString();

  const expired = await repo.listExpiredGuestHouseholds(nowIso, BATCH);
  const result: SweepResult = { scanned: expired.length, deleted: [], spared: [], failed: [] };

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
      const deleted = await repo.deleteGuestHousehold(household.id, nowIso);
      if (deleted) result.deleted.push(household.id);
      else {
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

  console.log(
    `[sweep] scanned ${result.scanned}, deleted ${result.deleted.length}, ` +
      `spared ${result.spared.length}, failed ${result.failed.length}`,
  );
  return result;
}
