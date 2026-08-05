import { describe, expect, it } from "vitest";
import { CHARACTER_VERSION, StoredCharacterError, migrateCharacter } from "./migrate.js";
import { newCharacter } from "./character.js";
import { makeRules } from "./test-fixtures.js";

function current() {
  return newCharacter({
    id: "c_1",
    householdId: "h_1",
    ownerPlayerId: "p_1",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 0, quick: 1, clever: 0, heart: 2 },
    appearance: { palette: "dawn", accent: "gold" },
    rules: makeRules(),
    now: "2026-07-04T18:00:00.000Z",
  });
}

/** A row as it was written before `unspentPoints` and before versioning. */
function v0Row(): Record<string, unknown> {
  const { committed, ...rest } = current();
  const { unspentPoints: _dropped, ...oldProgress } = committed;
  return { ...rest, committed: oldProgress };
}

describe("migrateCharacter — the v0 ladder", () => {
  it("defaults unspentPoints on a row written before the field existed", () => {
    /*
     * The whole reason this module exists. `getCharacter` used to cast, so an
     * old row handed back `unspentPoints: undefined` while TypeScript promised
     * a number — and `undefined + 1` corrupts a stat block at the first Rest
     * scene, weeks after the deploy that caused it.
     */
    const migrated = migrateCharacter(v0Row(), undefined);
    expect(migrated.committed.unspentPoints).toBe(0);
  });

  it("treats a missing version as v0 rather than giving up", () => {
    // Retrofittability is the point: no row in the store has ever been stamped,
    // so "unversioned" has to mean "the oldest one I know", not "unknown".
    expect(() => migrateCharacter(v0Row())).not.toThrow();
  });

  it("leaves a current row alone", () => {
    const character = current();
    expect(migrateCharacter(character, CHARACTER_VERSION)).toEqual(character);
  });

  it("migrates the provisional half too, not just committed", () => {
    // A campaign in flight is exactly when an upgrade lands mid-session, and a
    // provisional half left un-migrated reverts a character on commit.
    const row = v0Row();
    const { unspentPoints: _d, ...progress } = current().committed;
    row["provisional"] = { ...progress, runId: "r_1" };

    const migrated = migrateCharacter(row, 0);
    expect(migrated.provisional?.unspentPoints).toBe(0);
    expect(migrated.provisional?.runId).toBe("r_1");
  });
});

describe("migrateCharacter — refusals", () => {
  it("refuses a row from a version it does not understand", () => {
    /*
     * A newer deploy wrote it, an older one is reading it, which happens for
     * real during a rollout. A forward step we do not have could have moved a
     * field this build would then misread — and a character that loads *wrong*
     * is worse than one that does not load.
     */
    const migrateFutureRow = () => migrateCharacter(current(), CHARACTER_VERSION + 1);
    expect(migrateFutureRow).toThrow(StoredCharacterError);
    expect(migrateFutureRow).toThrow(/understands up to v/);
  });

  it("throws on a row with no committed progress", () => {
    // Structurally impossible, not merely missing. There is no defensible
    // default for "what level is she?" and guessing would be silently wrong.
    const { committed: _c, ...rest } = current();
    expect(() => migrateCharacter(rest, CHARACTER_VERSION)).toThrow(StoredCharacterError);
  });

  it("throws on a row with no committed stats", () => {
    const character = current();
    const { stats: _stats, ...committed } = character.committed;
    const row = { ...character, committed };

    expect(() => migrateCharacter(row, CHARACTER_VERSION)).toThrow(StoredCharacterError);
    expect(() => migrateCharacter(row, CHARACTER_VERSION)).toThrow(/committed\.stats/);
  });

  it("throws when a stat is missing rather than defaulting it to zero", () => {
    /*
     * The tempting default is 0, and it is the wrong one: it hands back a
     * character quietly weaker than the one that was saved, and nobody notices
     * until a roll comes up short weeks later.
     */
    const character = current();
    const stats = { ...character.committed.stats } as Record<string, number>;
    delete stats["heart"];
    const row = { ...character, committed: { ...character.committed, stats } };

    expect(() => migrateCharacter(row, CHARACTER_VERSION)).toThrow(/stats\.heart/);
  });

  it("throws on a row with no name and identifies the missing field", () => {
    // A stored row cannot be re-read from a schema file, so the error message
    // is the entire debugging surface.
    const { name: _name, ...row } = current();
    const migrateUnnamedRow = () => migrateCharacter(row, CHARACTER_VERSION);
    expect(migrateUnnamedRow).toThrow(StoredCharacterError);
    expect(migrateUnnamedRow).toThrow(/name/);
  });

  it("refuses something that is not an object at all", () => {
    for (const bad of [null, undefined, 42, "character", []]) {
      expect(() => migrateCharacter(bad, 0)).toThrow(StoredCharacterError);
    }
  });
});

describe("migrateCharacter — tolerances", () => {
  it("defaults the collections that are merely absent", () => {
    const character = current();
    const { questItems: _q, souvenirs: _s, ...row } = character;

    const migrated = migrateCharacter(row, CHARACTER_VERSION);
    expect(migrated.questItems).toEqual([]);
    expect(migrated.souvenirs).toEqual([]);
  });

  it("repairs a nonsense tier instead of refusing the character", () => {
    // `resolveCharacter()` recomputes tier from level and never trusts the
    // stored value, so a bad one here is cosmetic — refusing would turn a
    // harmless field into a character nobody can play.
    const row = { ...current(), committed: { ...current().committed, tier: "legendary" } };
    expect(migrateCharacter(row, CHARACTER_VERSION).committed.tier).toBe("fledgling");
  });
});
