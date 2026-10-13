/**
 * The household's Field Guide record — what the family has discovered.
 *
 * Stored as `HH#<householdId>` / `FIELDGUIDE` and **permanent**: it is the
 * household's, not a run's, so it outlives every campaign (and is deleted only
 * with a guest household, by the sweeper). Permanent means it needs a read-path
 * migration ladder from day one (architecture §3.2), same mechanism as
 * `migrateCharacter`.
 *
 * Only a *record of finding* lives here. What a canon id means (its name,
 * picture, lore) is content, not data — it comes from the content pack, so a
 * rename never touches a stored row.
 */

/** Bump together with a new step in `STEPS`; a bump without a step throws on read. */
export const FIELD_GUIDE_VERSION = 1;

/** One discovery. First finder wins and is never overwritten. */
export interface FieldGuideFind {
  firstFoundBy: string;
  /** ISO timestamp. */
  foundAt: string;
  /** The run it was found in, when known. */
  runId?: string;
}

export interface FieldGuideRecord {
  v: number;
  entries: Record<string, FieldGuideFind>;
}

/** What a caller reports when something is discovered. */
export interface FieldGuideDiscovery {
  canonId: string;
  playerId: string;
  runId?: string;
  /** Defaults to "now" in the repository. */
  foundAt?: string;
}

export class StoredFieldGuideError extends Error {
  override name = "StoredFieldGuideError";
}

export function emptyFieldGuide(): FieldGuideRecord {
  return { v: FIELD_GUIDE_VERSION, entries: {} };
}

type Step = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * One rung per version: takes a row at `n` and returns it at `n + 1`. Steps work
 * on the shape as it was then, hence `unknown`. v1 is the first version, so the
 * only rung is v0 → v1 for a row stored without a stamp; it has nothing to fix.
 */
const STEPS: Record<number, Step> = {
  0: (raw) => raw,
};

/**
 * Storage → domain. `data` is the item's payload (`{ entries }`), `version` the
 * `v` off the envelope; `undefined` is v0, not "unknown".
 */
export function migrateFieldGuide(data: unknown, version = 0): FieldGuideRecord {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new StoredFieldGuideError("fieldGuide: stored row is not an object");
  }
  if (version > FIELD_GUIDE_VERSION) {
    // Written by a newer deploy mid-rollout. Refuse rather than misread it.
    throw new StoredFieldGuideError(
      `fieldGuide: stored at v${version}, this build understands up to v${FIELD_GUIDE_VERSION}`,
    );
  }
  let raw = data as Record<string, unknown>;
  for (let v = version; v < FIELD_GUIDE_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new StoredFieldGuideError(`fieldGuide: no migration step from v${v} to v${v + 1}`);
    raw = step(raw);
  }
  return assertFieldGuide(raw);
}

function assertFieldGuide(raw: Record<string, unknown>): FieldGuideRecord {
  const rawEntries = raw["entries"] ?? {};
  if (typeof rawEntries !== "object" || rawEntries === null || Array.isArray(rawEntries)) {
    throw new StoredFieldGuideError("fieldGuide: entries must be an object");
  }
  const entries: Record<string, FieldGuideFind> = {};
  for (const [canonId, value] of Object.entries(rawEntries)) {
    if (typeof value !== "object" || value === null) {
      throw new StoredFieldGuideError(`fieldGuide: entry ${canonId} must be an object`);
    }
    const e = value as Record<string, unknown>;
    if (typeof e["firstFoundBy"] !== "string" || typeof e["foundAt"] !== "string") {
      throw new StoredFieldGuideError(`fieldGuide: entry ${canonId} needs firstFoundBy and foundAt`);
    }
    entries[canonId] = {
      firstFoundBy: e["firstFoundBy"],
      foundAt: e["foundAt"],
      ...(typeof e["runId"] === "string" ? { runId: e["runId"] } : {}),
    };
  }
  return { v: FIELD_GUIDE_VERSION, entries };
}
