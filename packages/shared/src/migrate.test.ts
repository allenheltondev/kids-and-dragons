import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_VERSION, StoredCharacterError, V4_CLASS_LADDER, migrateCharacter } from "./migrate.js";
import { newCharacter, resolveCharacter } from "./character.js";
import { assertRulesContent, levelForXp } from "./rules.js";
import { makeRules } from "./test-fixtures.js";
import type { CharacterProgress, ClassId, SpeciesId } from "./types/domain.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SHIPPED = assertRulesContent(JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")));

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

/**
 * A progress half as v1–v4 wrote it: no class or mastery, and the class moves
 * levelling had written so far in `unlockedActions`.
 */
function v4Half(half: CharacterProgress, unlockedActions: string[] = ["rally"]): Record<string, unknown> {
  const { class: _class, mastery: _mastery, ...rest } = half;
  return { ...rest, unlockedActions };
}

/** A row as v1–v4 wrote it: the class on the character, not on each half. */
function v4Row(): Record<string, unknown> {
  const { committed, ...rest } = current();
  return { ...rest, class: committed.class, committed: v4Half(committed) };
}

/** A row as it was written before `unspentPoints` and before versioning. */
function v0Row(): Record<string, unknown> {
  const { committed, ...rest } = v4Row();
  const { unspentPoints: _dropped, ...oldProgress } = committed as Record<string, unknown>;
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
    const { unspentPoints: _d, ...progress } = v4Half(current().committed);
    row["provisional"] = { ...progress, runId: "r_1" };

    const migrated = migrateCharacter(row, 0);
    expect(migrated.provisional?.unspentPoints).toBe(0);
    expect(migrated.provisional?.runId).toBe("r_1");
  });
});

describe("migrateCharacter — her finished campaigns (v3, #283)", () => {
  const line = { campaignId: "gemfall", outcome: "success", at: "2026-07-14T18:00:00.000Z", table: "h_club" };

  it("reads a v2 row, from before the record, as having finished nothing, and adds no key", () => {
    const migrated = migrateCharacter({ ...v4Row(), version: 3 }, 2);
    expect(migrated).not.toHaveProperty("finished");
  });

  it("keeps a current row's record exactly", () => {
    const character = { ...current(), finished: [line] };
    expect(migrateCharacter(character, CHARACTER_VERSION)).toEqual(character);
  });

  it("refuses a record it could only misread", () => {
    for (const finished of [{}, [{ ...line, outcome: "won" }], [{ ...line, table: "" }], ["gemfall"]]) {
      expect(() => migrateCharacter({ ...current(), finished }, CHARACTER_VERSION), JSON.stringify(finished)).toThrow(
        StoredCharacterError,
      );
    }
  });
});

describe("migrateCharacter — the practice (v4, #255)", () => {
  it("reads a v3 row, from before the practice, as not having played it, and adds no key", () => {
    const migrated = migrateCharacter(v4Row(), 3);
    expect(migrated).not.toHaveProperty("practiced");
  });

  it("keeps a current row's mark exactly", () => {
    const character = { ...current(), practiced: true as const };
    expect(migrateCharacter(character, CHARACTER_VERSION)).toEqual(character);
  });

  it("reads anything but true as not played, rather than inventing a mark", () => {
    for (const practiced of [false, "yes", 1, null]) {
      expect(migrateCharacter({ ...current(), practiced }, CHARACTER_VERSION)).not.toHaveProperty("practiced");
    }
  });
});

/*
 * v5 (#308): class moves come from the worn class's distinction, not level.
 * The guardrail is that no stored hero loses a move, so this holds the new
 * resolve against the old one on rows shaped the way v4 actually wrote them,
 * with the shipped rules. `v4Actions` is what `resolveCharacter` did at v4:
 * the signature, every unlock the XP's level reached, the species action, and
 * whatever stored `unlockedActions` the content still knew.
 */
function v4Actions(row: Record<string, unknown>, half: Record<string, unknown>): string[] {
  const classDef = SHIPPED.classes[row["class"] as ClassId];
  const species = SHIPPED.species[row["species"] as SpeciesId];
  const level = levelForXp(SHIPPED, half["xp"] as number);
  const known = new Set<string>();
  for (const c of Object.values(SHIPPED.classes)) {
    known.add(c.signature.id);
    for (const u of Object.values(c.unlocks)) known.add(u.id);
  }
  for (const sp of Object.values(SHIPPED.species)) known.add(sp.combatAction.id);
  const unlocks = Object.entries(classDef.unlocks)
    .filter(([at]) => level >= Number(at))
    .map(([, u]) => u.id);
  return [
    ...new Set([
      classDef.signature.id,
      ...unlocks,
      species.combatAction.id,
      ...(half["unlockedActions"] as string[]).filter((id) => known.has(id)),
    ]),
  ].sort();
}

/** A v4 row for `classId` at `xp`, its unlocks written the way v4's awardXp wrote them. */
function v4Hero(classId: ClassId, species: SpeciesId, xp: number, overrides: Record<string, unknown> = {}) {
  const classDef = SHIPPED.classes[classId];
  const level = levelForXp(SHIPPED, xp);
  const unlockedActions = [
    classDef.signature.id,
    ...Object.entries(classDef.unlocks).filter(([at]) => level >= Number(at)).map(([, u]) => u.id),
  ];
  return {
    id: `c_${classId}_${xp}`,
    householdId: "h_1",
    ownerPlayerId: "p_1",
    name: "Pip",
    species,
    class: classId,
    appearance: { palette: "dawn", accent: "gold" },
    committed: {
      level,
      xp,
      stats: { might: 1, quick: 2, clever: 1, heart: 3 },
      tier: "fledgling",
      unlockedActions,
      inventory: [],
      unspentPoints: 0,
      ...overrides,
    },
    provisional: null,
    questItems: [],
    souvenirs: [],
    createdAt: "2026-07-04T18:00:00.000Z",
    version: 7,
  };
}

function resolvedActions(row: Record<string, unknown>): string[] {
  return resolveCharacter(migrateCharacter(row, 4), SHIPPED, {}).actions.slice().sort();
}

describe("migrateCharacter — class mastery (v5, #308)", () => {
  const CLASSES = Object.keys(SHIPPED.classes) as ClassId[];
  const SPECIES = Object.keys(SHIPPED.species) as SpeciesId[];
  const THRESHOLDS = [0, ...SHIPPED.levelXp];

  it("freezes the v4 ladder exactly as the shipped rules have it", () => {
    // The step reads a frozen copy, not today's rules. While the rules still
    // say what v4 said, the copy must match them.
    for (const classId of CLASSES) {
      const ladder = Object.entries(SHIPPED.classes[classId].unlocks).sort(([a], [b]) => Number(a) - Number(b));
      expect(ladder.map(([at]) => Number(at)), classId).toEqual([3, 6, 9]);
      expect(ladder.map(([, u]) => u.id), classId).toEqual(V4_CLASS_LADDER.moves[classId]);
    }
    expect([3, 6, 9].map((level) => SHIPPED.levelXp[level - 2])).toEqual([...V4_CLASS_LADDER.xp]);
  });

  it("gives every stored hero, at every level of every class, exactly the moves it had", () => {
    for (const [i, classId] of CLASSES.entries()) {
      for (const xp of THRESHOLDS) {
        const row = v4Hero(classId, SPECIES[i % SPECIES.length]!, xp);
        expect(resolvedActions(row), `${classId} at ${xp} XP`).toEqual(v4Actions(row, row.committed));
      }
    }
  });

  it("gives a level 3, 6 and 9 hero Apprentice, Expert and Master in their own class only", () => {
    const rankAt = (xp: number) => migrateCharacter(v4Hero("thornguard", "bigfoot", xp), 4).committed;
    expect(rankAt(0).mastery).toEqual({ thornguard: { rank: "none", deeds: {} } });
    expect(rankAt(100).mastery).toEqual({ thornguard: { rank: "none", deeds: {} } });
    expect(rankAt(300).mastery).toEqual({ thornguard: { rank: "apprentice", deeds: {} } });
    expect(rankAt(1100).mastery).toEqual({ thornguard: { rank: "apprentice", deeds: {} } });
    expect(rankAt(1700).mastery).toEqual({ thornguard: { rank: "expert", deeds: {} } });
    expect(rankAt(4700).mastery).toEqual({ thornguard: { rank: "master", deeds: {} } });
    expect(rankAt(9999).mastery).toEqual({ thornguard: { rank: "master", deeds: {} } });
    expect(rankAt(300).class).toBe("thornguard");
  });

  it("gives exactly v4's moves when a row disagrees with itself", () => {
    // v4 resolved from XP and unlockedActions, never the stored level, so
    // neither may lose a move and the level may not add one.
    const cases: [string, Record<string, unknown>, string][] = [
      ["stored level behind XP", { level: 2, xp: 300 }, "apprentice"],
      ["stored level ahead of XP", { level: 6, xp: 700, unlockedActions: ["rally"] }, "apprentice"],
      // A move levelling wrote that the level alone would not show.
      ["unlockedActions ahead of level", { level: 4, xp: 700, unlockedActions: ["rally", "soothe", "chorus"] }, "expert"],
      // Created before unlocks were written at all.
      ["no unlockedActions", { level: 1, xp: 0, unlockedActions: [] }, "none"],
    ];
    for (const [name, overrides, rank] of cases) {
      const row = v4Hero("songkeeper", "unicorn", 0, overrides);
      expect(migrateCharacter(row, 4).committed.mastery, name).toEqual({ songkeeper: { rank, deeds: {} } });
      expect(resolvedActions(row), name).toEqual(v4Actions(row, row.committed));
    }
  });

  it("migrates each half on its own, so a campaign in flight keeps its gains and a failure keeps the rest", () => {
    const row = v4Hero("starweaver", "kitsune", 700);
    const provisional = { ...v4Hero("starweaver", "kitsune", 1700).committed, runId: "r_1" };
    const migrated = migrateCharacter({ ...row, provisional }, 4);

    expect(migrated.committed).toMatchObject({ class: "starweaver", mastery: { starweaver: { rank: "apprentice" } } });
    expect(migrated.provisional).toMatchObject({
      runId: "r_1",
      class: "starweaver",
      mastery: { starweaver: { rank: "expert" } },
    });
    expect(resolveCharacter(migrated, SHIPPED, {}).actions.slice().sort()).toEqual(v4Actions(row, provisional));
    expect(resolveCharacter({ ...migrated, provisional: null }, SHIPPED, {}).actions.slice().sort()).toEqual(
      v4Actions(row, row.committed),
    );
  });

  it("moves the class off the character and drops unlockedActions", () => {
    const migrated = migrateCharacter(v4Hero("duskrunner", "griffin", 4700), 4);
    expect(migrated).not.toHaveProperty("class");
    expect(migrated.committed).not.toHaveProperty("unlockedActions");
    expect(migrated.version).toBe(7);
  });

  it("leaves an unstamped row that is already in the v5 shape as it is", () => {
    const character = current();
    const row = {
      ...character,
      committed: { ...character.committed, mastery: { songkeeper: { rank: "expert" as const, deeds: { hearts: 4 } } } },
    };
    // The v1 step stamps the claim version, as it does on any v0 row.
    expect(migrateCharacter(row, undefined)).toEqual({ ...row, version: 0 });
  });

  it("migrates a v0 row all the way up", () => {
    const { unspentPoints: _u, ...committed } = v4Hero("songkeeper", "unicorn", 1700).committed;
    const migrated = migrateCharacter({ ...v4Hero("songkeeper", "unicorn", 1700), committed }, undefined);
    expect(migrated.committed).toMatchObject({ unspentPoints: 0, mastery: { songkeeper: { rank: "expert" } } });
  });

  it("refuses a rank it does not know rather than guessing the moves", () => {
    const character = current();
    for (const mastery of [{ songkeeper: { rank: "grandmaster", deeds: {} } }, { songkeeper: { deeds: {} } }]) {
      const row = { ...character, committed: { ...character.committed, mastery } };
      expect(() => migrateCharacter(row, CHARACTER_VERSION), JSON.stringify(mastery)).toThrow(/mastery\.songkeeper\.rank/);
    }
  });

  it("refuses a current row with no worn class", () => {
    const character = current();
    const { class: _class, ...committed } = character.committed;
    expect(() => migrateCharacter({ ...character, committed }, CHARACTER_VERSION)).toThrow(/committed\.class/);
  });

  it("keeps ranks and deed progress in every class through a read", () => {
    const character = current();
    const mastery = {
      songkeeper: { rank: "expert" as const, deeds: { hearts: 12 } },
      thornguard: { rank: "apprentice" as const, deeds: { shove: 2 } },
    };
    const row = { ...character, committed: { ...character.committed, class: "thornguard" as const, mastery } };
    expect(migrateCharacter(row, CHARACTER_VERSION).committed).toMatchObject({ class: "thornguard", mastery });
  });

  it("defaults absent deed progress, and absent mastery, to nothing earned", () => {
    const character = current();
    const { mastery: _m, ...noMastery } = character.committed;
    expect(migrateCharacter({ ...character, committed: noMastery }, CHARACTER_VERSION).committed.mastery).toEqual({});
    const row = { ...character, committed: { ...character.committed, mastery: { songkeeper: { rank: "none" } } } };
    expect(migrateCharacter(row, CHARACTER_VERSION).committed.mastery).toEqual({ songkeeper: { rank: "none", deeds: {} } });
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
