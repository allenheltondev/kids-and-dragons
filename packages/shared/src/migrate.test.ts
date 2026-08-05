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

/*
 * Preservation, which is the other half of a migration and the half with no
 * symptom.
 *
 * Every case above asks what happens to a field that is *missing* — the
 * default fires, the character loads. None asks what happens to one that is
 * *present*, and that is where a migration does its damage: it reads the row,
 * writes a fresh one, and anything it forgets to carry across is gone with no
 * error, no log line, and nothing on screen until somebody notices weeks later
 * that a stat point they banked never arrived.
 *
 * Each of these was found by flipping the `typeof x === "number" ? x : default`
 * test in a defaulting expression, which swaps "keep it if it is good" for
 * "throw it away if it is good", and watching the whole suite stay green.
 */
describe("migrateCharacter — what it must not lose", () => {
  it("keeps banked stat points instead of resetting them to zero", () => {
    /*
     * The one that costs a child something she earned. `unspentPoints` is the
     * point a level owes her (spec §8.1); it survives in the store between
     * sessions and is spent at a Rest scene. Zeroing it on load is a silent
     * theft that looks exactly like never having levelled.
     */
    const character = current();
    const row = {
      ...character,
      committed: { ...character.committed, unspentPoints: 3 },
    };

    expect(migrateCharacter(row, CHARACTER_VERSION).committed.unspentPoints).toBe(3);
  });

  it("keeps banked stat points through the v0 ladder too", () => {
    // The v0 step defaults the field, and a row that already carries one must
    // come out the far side with the number it went in with.
    const v0 = v0Row() as Record<string, unknown>;
    const committed = v0["committed"] as Record<string, unknown>;
    const withPoints = { ...v0, committed: { ...committed, unspentPoints: 2 } };

    expect(migrateCharacter(withPoints, undefined).committed.unspentPoints).toBe(2);
  });

  it("keeps a souvenir's provenance", () => {
    /*
     * A souvenir is what a failed campaign leaves behind (spec §8.3) — the
     * proof that the attempt happened. `fromRun` and `earnedAt` are the whole
     * of that proof, and both default to `""`, so losing them turns a memento
     * into an anonymous entry that cannot be told from any other.
     */
    const character = current();
    const row = {
      ...character,
      souvenirs: [{ id: "s_1", fromRun: "r_88c", earnedAt: "2026-07-04T18:00:00.000Z" }],
    };

    expect(migrateCharacter(row, CHARACTER_VERSION).souvenirs[0]).toEqual({
      id: "s_1",
      fromRun: "r_88c",
      earnedAt: "2026-07-04T18:00:00.000Z",
    });
  });

  it("still tolerates a souvenir that never had a provenance", () => {
    // The defaults are there for old rows, and must keep working — this is the
    // half the tests above already implied, pinned so the fix for the case
    // above cannot be "demand the field".
    const character = current();
    const row = { ...character, souvenirs: [{ id: "s_1" }] };

    expect(migrateCharacter(row, CHARACTER_VERSION).souvenirs[0]).toEqual({
      id: "s_1",
      fromRun: "",
      earnedAt: "",
    });
  });
});

describe("migrateCharacter — the field guards, at their edges", () => {
  /*
   * Same two guards as `rules.ts`, same blind spot: each is `wrong type ||
   * wrong value`, and every case above only ever exercises the type half. A
   * stored row reaches these straight from DynamoDB, so what gets through is
   * what the rest of the game then does arithmetic on.
   */
  it("rejects a stored number that is not finite", () => {
    const character = current();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const row = { ...character, committed: { ...character.committed, xp: bad } };
      expect(() => migrateCharacter(row, CHARACTER_VERSION)).toThrow(StoredCharacterError);
    }
  });

  it("rejects an array where an object belongs", () => {
    // `typeof [] === "object"` and it is not null, so only the third clause
    // catches this — and a JSON round trip is exactly how a `{}` becomes a `[]`.
    const row = { ...current(), committed: [] };
    expect(() => migrateCharacter(row, CHARACTER_VERSION)).toThrow(StoredCharacterError);
  });

  it("names what it actually got, so a bad row can be found in the table", () => {
    // The message is the only thing an operator has: these rows are opaque
    // blobs, and "expected an object" without "(got an array)" means reading
    // the item by hand to learn what this one already knew.
    const row = { ...current(), committed: [] };
    expect(() => migrateCharacter(row, CHARACTER_VERSION)).toThrow(/got an array/);

    const nulled = { ...current(), committed: null };
    expect(() => migrateCharacter(nulled, CHARACTER_VERSION)).toThrow(/got null/);
  });
});
