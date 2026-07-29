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
  failed: { householdId: string; reason: string }[];
}

export async function handler(): Promise<SweepResult> {
  const repo = new DynamoRepository({ tableName: requiredEnv("TABLE_NAME") });
  const nowIso = new Date().toISOString();

  const expired = await repo.listExpiredGuestHouseholds(nowIso, BATCH);
  const result: SweepResult = { scanned: expired.length, deleted: [], failed: [] };

  for (const household of expired) {
    /*
     * Re-read before deleting. The list came from an index query that may be
     * moments old, and the interesting race is a real one: somebody signs in
     * during the seconds between the query and the delete, and this function
     * would otherwise delete the household they just claimed — losing exactly
     * the characters the sign-in was for.
     */
    const current = await repo.getHousehold(household.id);
    if (!current || !current.guest) {
      console.log(`[sweep] skipping ${household.id}: claimed since the query`);
      continue;
    }
    if (current.expiresAt && current.expiresAt > nowIso) {
      console.log(`[sweep] skipping ${household.id}: expiry moved`);
      continue;
    }

    try {
      await repo.deleteHousehold(current.id);
      result.deleted.push(current.id);
    } catch (err) {
      // One bad household must not stop the rest of the sweep.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[sweep] could not delete ${current.id}: ${reason}`);
      result.failed.push({ householdId: current.id, reason });
    }
  }

  console.log(
    `[sweep] scanned ${result.scanned}, deleted ${result.deleted.length}, failed ${result.failed.length}`,
  );
  return result;
}
