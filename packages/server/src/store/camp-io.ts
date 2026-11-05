/**
 * The camp row both stores write (docs/camp.md §9), built in one place for the
 * reason `character-io.ts` gives: the contract suite runs against both stores,
 * so a row or a condition only one of them built would pass every test and
 * behave differently in prod.
 */

import { CAMP_VERSION } from "@kad/shared";
import type { CampWrite } from "./repository.ts";
import type { StoredItem } from "./character-io.ts";
import { CAMP_SK, HH } from "./keys.ts";

/** The item a `CampWrite` puts: the camp at the revision after the one read, stamped with `CAMP_VERSION`. */
export function campItem(write: CampWrite) {
  return {
    PK: HH(write.householdId),
    SK: CAMP_SK(write.crew),
    entity: "camp",
    v: CAMP_VERSION,
    data: { ...write.camp, v: CAMP_VERSION, revision: (write.expectedRevision ?? 0) + 1 },
  };
}

/**
 * Does the stored row still stand as `expectedRevision` read it? The memory
 * store's half of the condition DynamoRepository puts on the same write
 * (`campCondition`): absent when nothing was read, otherwise that revision.
 * Read off the raw item, unmigrated, as a DynamoDB condition would be.
 */
export function campHolds(stored: StoredItem | undefined, expectedRevision: number | null): boolean {
  if (expectedRevision === null) return stored === undefined;
  if (stored === undefined) return false;
  const revision = (stored.data as { revision?: unknown } | null)?.revision;
  return (typeof revision === "number" ? revision : 0) === expectedRevision;
}

/** DynamoDB's spelling of `campHolds`, for a Put of `campItem(write)`. */
export function campCondition(expectedRevision: number | null) {
  return expectedRevision === null
    ? { ConditionExpression: "attribute_not_exists(PK)" }
    : {
        ConditionExpression: "#d.#rev = :rev",
        ExpressionAttributeNames: { "#d": "data", "#rev": "revision" },
        ExpressionAttributeValues: { ":rev": expectedRevision },
      };
}
