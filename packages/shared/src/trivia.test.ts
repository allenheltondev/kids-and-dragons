import { describe, expect, it } from "vitest";
import { deriveBadges } from "./kid-profile.js";
import type { BadgeInput } from "./kid-profile.js";
import { emptyLook } from "./hero-look.js";
import { readEarnedLook, triviaLookGrants, TRIVIA_LOOK_SOURCE } from "./look-unlocks.js";
import {
  availablePool,
  drawOptions,
  drawRound,
  emptyTriviaRecord,
  grantTriviaRungs,
  guidePagePicture,
  laddersEarned,
  markAnswer,
  mergeTriviaRecords,
  readTriviaRecord,
  triviaBadges,
  triviaBankOf,
  triviaCounts,
  triviaPicture,
  validShownOptions,
} from "./trivia.js";
import type { LookCatalog } from "./types/look.js";
import type { TriviaAnswer, TriviaLadder, TriviaQuestion, TriviaRecord } from "./types/trivia.js";

const q = (id: string, entry: string, also: string[] = []): TriviaQuestion => ({
  id,
  entry,
  ask: `About ${entry}?`,
  answer: "Right",
  wrong: ["W1", "W2", "W3", "W4", "W5"],
  also,
  link: "entry",
});

const BANK: TriviaQuestion[] = [
  q("creature.a.one", "creature.a"),
  q("creature.a.two", "creature.a", ["creature.b"]),
  q("creature.b.one", "creature.b"),
  q("biome.c.one", "biome.c"),
];

const LADDER: TriviaLadder = {
  rungs: [
    { at: 1, badge: { id: "trivia-1", name: "One", blurb: "One right." } },
    { at: 2, title: "the_learned" },
    { at: 3, badge: { id: "trivia-3", name: "Three", blurb: "Three right." } },
  ],
  firstTry: [{ at: 2, badge: { id: "trivia-first-2", name: "Sharp", blurb: "Two first try." } }],
};

const answer = (questionId: string, picked: string, over: Partial<TriviaAnswer> = {}): TriviaAnswer => ({
  questionId,
  optionsShown: ["W1", "Right", "W2", "W3"],
  picked,
  at: "2026-11-17T10:00:00.000Z",
  round: "r1",
  ...over,
});

const ids = (qs: readonly TriviaQuestion[]): string[] => qs.map((x) => x.id);

describe("availablePool (§4.1)", () => {
  it("holds only questions whose entry and every also are found", () => {
    expect(ids(availablePool(BANK, ["creature.a"], null, "r1"))).toEqual(["creature.a.one"]);
    expect(ids(availablePool(BANK, new Set(["creature.a", "creature.b"]), null, "r1"))).toEqual(["creature.a.one", "creature.a.two", "creature.b.one"]);
    expect(ids(availablePool(BANK, { "biome.c": { foundAt: "x" } }, null, "r1"))).toEqual(["biome.c.one"]);
  });

  it("drops what she has mastered, for good", () => {
    const record: TriviaRecord = { ...emptyTriviaRecord(), mastered: { "creature.a.one": { at: "t", firstTry: true } } };
    expect(ids(availablePool(BANK, ["creature.a"], record, "r9"))).toEqual([]);
  });

  it("cools a miss for the rest of its round, and has it back the next", () => {
    const record: TriviaRecord = { ...emptyTriviaRecord(), missed: { "creature.a.one": { at: "t", round: "r1" } } };
    expect(ids(availablePool(BANK, ["creature.a"], record, "r1"))).toEqual([]);
    expect(ids(availablePool(BANK, ["creature.a"], record, "r2"))).toEqual(["creature.a.one"]);
  });
});

describe("drawRound", () => {
  const many = Array.from({ length: 20 }, (_, i) => q(`creature.e${i}.q`, `creature.e${i}`));

  it("draws up to eight, without repeats, the same for a seed", () => {
    const round = drawRound(many, "seed-1");
    expect(round).toHaveLength(8);
    expect(new Set(ids(round)).size).toBe(8);
    expect(ids(drawRound(many, "seed-1"))).toEqual(ids(round));
    expect(ids(drawRound(many, "seed-2"))).not.toEqual(ids(round));
  });

  it("is shorter when the pool is, and empty for an empty pool", () => {
    expect(drawRound(many.slice(0, 3), "s")).toHaveLength(3);
    expect(drawRound([], "s")).toEqual([]);
    expect(drawRound(many, "s", 5)).toHaveLength(5);
  });

  it("leans a little toward the newest finds", () => {
    const foundAt: Record<string, string> = {};
    many.forEach((x, i) => (foundAt[x.entry] = new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
    const newest = new Set(ids(many.slice(10)));
    let fromNewest = 0;
    let total = 0;
    for (let s = 0; s < 400; s++) {
      for (const x of drawRound(many, `s${s}`, 5, foundAt)) {
        total += 1;
        if (newest.has(x.id)) fromNewest += 1;
      }
    }
    const share = fromNewest / total;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.75);
  });

  it("dates a question by the latest find among its pages, and reads the book's fieldGuide map", () => {
    const pool = [q("x.a.q", "x.a", ["x.b"]), q("x.c.q", "x.c")];
    const book = { "x.a": { foundAt: "2026-01-01T00:00:00Z" }, "x.b": { foundAt: "2026-06-01T00:00:00Z" }, "x.c": { foundAt: "2026-03-01T00:00:00Z" } };
    let first = 0;
    for (let s = 0; s < 300; s++) if (drawRound(pool, `t${s}`, 1, book)[0]!.id === "x.a.q") first += 1;
    expect(first).toBeGreaterThan(160);
  });
});

describe("drawOptions (§4.2)", () => {
  const question = { ...q("creature.a.one", "creature.a"), wrong: ["W1", "W2", "W3", "W4", "W5", "W6"] };

  it("shows the answer and three distinct wrong options, deterministic for a seed", () => {
    const shown = drawOptions(question, "r1:creature.a.one");
    expect(shown).toHaveLength(4);
    expect(shown).toContain("Right");
    expect(new Set(shown).size).toBe(4);
    expect(validShownOptions(question, shown)).toBe(true);
    expect(drawOptions(question, "r1:creature.a.one")).toEqual(shown);
  });

  it("draws the wrong options fresh and moves the answer", () => {
    const sets = new Set<string>();
    const places = new Set<number>();
    for (let s = 0; s < 50; s++) {
      const shown = drawOptions(question, `s${s}`);
      sets.add([...shown].sort().join("|"));
      places.add(shown.indexOf("Right"));
    }
    expect(sets.size).toBeGreaterThan(5);
    expect(places).toEqual(new Set([0, 1, 2, 3]));
  });

  it("knows a shown set the question could not have had", () => {
    expect(validShownOptions(question, ["W1", "W2", "W3", "W4"])).toBe(false);
    expect(validShownOptions(question, ["Right", "W2", "W3"])).toBe(false);
    expect(validShownOptions(question, ["Right", "W2", "W2", "W3"])).toBe(false);
    expect(validShownOptions(question, ["Right", "W2", "W3", "Made up"])).toBe(false);
    expect(validShownOptions(question, ["Right", "W2", "W3", "W4", "W5"])).toBe(false);
  });
});

describe("markAnswer (§4.2, §4.4, §6.2)", () => {
  const found = ["creature.a", "creature.b"];

  it("masters a right answer, on the first try when never missed", () => {
    const mark = markAnswer(emptyTriviaRecord(), answer("creature.a.one", "Right"), BANK, found);
    expect(mark).toMatchObject({ ok: true, correct: true, counts: true });
    expect(mark.record.mastered).toEqual({ "creature.a.one": { at: "2026-11-17T10:00:00.000Z", firstTry: true } });
  });

  it("records a miss with its round, then a later right answer masters it, not first try, and clears the miss", () => {
    const missed = markAnswer(emptyTriviaRecord(), answer("creature.a.one", "W1"), BANK, found);
    expect(missed).toMatchObject({ ok: true, correct: false, counts: false });
    expect(missed.record.missed).toEqual({ "creature.a.one": { at: "2026-11-17T10:00:00.000Z", round: "r1" } });
    const later = markAnswer(missed.record, answer("creature.a.one", "Right", { round: "r2", at: "2026-11-18T10:00:00.000Z" }), BANK, found);
    expect(later).toMatchObject({ ok: true, correct: true, counts: true });
    expect(later.record.mastered["creature.a.one"]).toEqual({ at: "2026-11-18T10:00:00.000Z", firstTry: false });
    expect(later.record.missed).toEqual({});
  });

  it("refuses a second try: a right answer in the round it was missed in (§4.2)", () => {
    const missed = markAnswer(emptyTriviaRecord(), answer("creature.a.one", "W1", { round: "r1" }), BANK, found).record;
    expect(markAnswer(missed, answer("creature.a.one", "Right", { round: "r1" }), BANK, found)).toEqual({ ok: false, reason: "retried", record: missed });
    // A resent miss changes nothing, and the next round may count it.
    expect(markAnswer(missed, answer("creature.a.one", "W1", { round: "r1" }), BANK, found)).toMatchObject({ ok: true, correct: false, counts: false, record: missed });
    expect(markAnswer(missed, answer("creature.a.one", "Right", { round: "r2" }), BANK, found)).toMatchObject({ ok: true, counts: true });
  });

  it("counts a mastered question only once, and never adds a miss to it", () => {
    const first = markAnswer(emptyTriviaRecord(), answer("creature.a.one", "Right"), BANK, found).record;
    const again = markAnswer(first, answer("creature.a.one", "Right"), BANK, found);
    expect(again).toMatchObject({ ok: true, correct: true, counts: false });
    expect(again.record).toBe(first);
    expect(markAnswer(first, answer("creature.a.one", "W1"), BANK, found).record).toBe(first);
  });

  it("never mutates the record it is given", () => {
    const record = emptyTriviaRecord();
    markAnswer(record, answer("creature.a.one", "Right"), BANK, found);
    markAnswer(record, answer("creature.a.one", "W1"), BANK, found);
    expect(record).toEqual(emptyTriviaRecord());
  });

  it("refuses an unknown question, an unfound page, a bad shown set and a pick not shown", () => {
    const record = emptyTriviaRecord();
    expect(markAnswer(record, answer("creature.z.one", "Right"), BANK, found)).toEqual({ ok: false, reason: "unknown-question", record });
    expect(markAnswer(record, answer("creature.a.two", "Right"), BANK, ["creature.a"])).toEqual({ ok: false, reason: "not-found", record });
    expect(markAnswer(record, answer("biome.c.one", "Right"), BANK, found)).toEqual({ ok: false, reason: "not-found", record });
    expect(markAnswer(record, answer("creature.a.one", "Right", { optionsShown: ["Right", "W1", "W2", "Fake"] }), BANK, found)).toEqual({ ok: false, reason: "bad-options", record });
    expect(markAnswer(record, answer("creature.a.one", "Right", { optionsShown: ["W4", "W1", "W2", "W3"] }), BANK, found)).toEqual({ ok: false, reason: "bad-options", record });
    expect(markAnswer(record, answer("creature.a.one", "W5"), BANK, found)).toEqual({ ok: false, reason: "not-shown", record });
  });
});

describe("mergeTriviaRecords", () => {
  it("unions mastery, the earliest winning, and a mastery clears a miss", () => {
    const a: TriviaRecord = {
      v: 1,
      mastered: { q1: { at: "2026-01-02", firstTry: false }, q2: { at: "2026-01-01", firstTry: true } },
      missed: { q3: { at: "2026-01-01", round: "a1" }, q4: { at: "2026-01-05", round: "a2" } },
      rungs: [10],
    };
    const b: TriviaRecord = {
      v: 1,
      mastered: { q1: { at: "2026-01-01", firstTry: true }, q3: { at: "2026-01-03", firstTry: false } },
      missed: { q4: { at: "2026-01-04", round: "b1" }, q2: { at: "2026-01-09", round: "b2" } },
      rungs: [25, 10],
    };
    const merged = mergeTriviaRecords(a, b);
    expect(merged.mastered).toEqual({ q1: { at: "2026-01-01", firstTry: true }, q2: { at: "2026-01-01", firstTry: true }, q3: { at: "2026-01-03", firstTry: false } });
    expect(merged.missed).toEqual({ q4: { at: "2026-01-05", round: "a2" } });
    expect(merged.rungs).toEqual([10, 25]);
    expect(mergeTriviaRecords(b, a)).toEqual(merged);
  });
});

describe("readTriviaRecord", () => {
  it("reads a good record and drops what is malformed", () => {
    expect(readTriviaRecord(null)).toEqual(emptyTriviaRecord());
    expect(readTriviaRecord({ v: 99, mastered: { q: { at: "t", firstTry: true } } })).toEqual(emptyTriviaRecord());
    expect(
      readTriviaRecord({
        v: 1,
        mastered: { q1: { at: "t", firstTry: true }, bad: { firstTry: true } },
        missed: { q1: { at: "t", round: "r" }, q2: { at: "t", round: "r" }, q3: { at: "t" } },
        rungs: [25, 10, 10, -1, "x"],
      }),
    ).toEqual({ v: 1, mastered: { q1: { at: "t", firstTry: true } }, missed: { q2: { at: "t", round: "r" } }, rungs: [10, 25] });
  });
});

describe("the ladder (§5)", () => {
  const record = (n: number, firstTry: number): TriviaRecord => {
    const mastered: TriviaRecord["mastered"] = {};
    for (let i = 0; i < n; i++) mastered[`q${i}`] = { at: "t", firstTry: i < firstTry };
    return { ...emptyTriviaRecord(), mastered };
  };

  it("counts mastered and first-try answers", () => {
    expect(triviaCounts(record(3, 1))).toEqual({ mastered: 3, firstTry: 1 });
  });

  it("names the rungs reached on each track", () => {
    expect(laddersEarned(record(0, 0), LADDER)).toEqual({ rungs: [], firstTry: [] });
    const earned = laddersEarned(record(2, 2), LADDER);
    expect(earned.rungs.map((r) => r.at)).toEqual([1, 2]);
    expect(earned.firstTry.map((r) => r.at)).toEqual([2]);
    expect(laddersEarned({ mastered: 3, firstTry: 0 }, LADDER).rungs.map((r) => r.at)).toEqual([1, 2, 3]);
  });

  it("grants each main rung once", () => {
    const first = grantTriviaRungs(record(2, 0), LADDER);
    expect(first.granted.map((r) => r.at)).toEqual([1, 2]);
    expect(first.record.rungs).toEqual([1, 2]);
    const again = grantTriviaRungs(first.record, LADDER);
    expect(again.granted).toEqual([]);
    expect(again.record).toBe(first.record);
    const more = grantTriviaRungs({ ...record(3, 0), rungs: first.record.rungs }, LADDER);
    expect(more.granted.map((r) => r.at)).toEqual([3]);
    expect(more.record.rungs).toEqual([1, 2, 3]);
  });

  it("gives badges from both tracks, and they sit after the find badges on her page", () => {
    expect(triviaBadges({ mastered: 3, firstTry: 2 }, LADDER).map((b) => b.id)).toEqual(["trivia-1", "trivia-3", "trivia-first-2"]);
    const input: BadgeInput = { homeHouseholdId: "h", finished: [], heroLevels: [], souvenirs: [], finds: 1 };
    expect(deriveBadges(input).map((b) => b.id)).toEqual(["finds-1"]);
    expect(deriveBadges({ ...input, trivia: { mastered: 1, firstTry: 0 } }).map((b) => b.id)).toEqual(["finds-1"]);
    expect(deriveBadges({ ...input, trivia: { mastered: 1, firstTry: 0 }, triviaLadder: LADDER }).map((b) => b.id)).toEqual(["finds-1", "trivia-1"]);
  });
});

describe("quiz looks (§5.1)", () => {
  const catalog: LookCatalog = {
    coats: [],
    specials: [],
    nameplates: [{ id: "plain", name: "Plain", unlock: { from: "starter" } }],
    titles: [
      { id: "the_bold", text: "the Bold", unlock: { from: "starter" } },
      { id: "the_learned", text: "the Learned", unlock: { from: "trivia", rung: 2 } },
      { id: "the_well_read", text: "the Well-Read", unlock: { from: "trivia", rung: 5 } },
    ],
  };

  it("grants the looks of the rungs she holds, from the quiz", () => {
    expect(triviaLookGrants(catalog, [1, 2])).toEqual([{ id: "the_learned", from: "trivia", rung: 2, source: TRIVIA_LOOK_SOURCE }]);
    expect(triviaLookGrants(catalog, [])).toEqual([]);
  });

  it("backfills a hero made later on read, with a receipt that says so", () => {
    const look = readEarnedLook(catalog, { look: undefined, species: "unicorn" }, { triviaRungs: [2, 5] });
    expect(look.unlocked).toEqual({
      the_learned: { from: "trivia", rung: 2, source: "From the quiz" },
      the_well_read: { from: "trivia", rung: 5, source: "From the quiz" },
    });
    expect(readEarnedLook(catalog, { look: emptyLook() }, {})).toEqual(emptyLook());
  });
});

describe("pictures (§3.5)", () => {
  const guide = {
    entries: {
      "creature.a": { id: "creature.a", category: "creatures" as const, kind: "creature" as const, title: "A", art: "/assets/entities/a/portrait.webp" },
      "class.thornguard": { id: "class.thornguard", category: "classes" as const, kind: "class" as const, title: "Thornguard" },
      "npc.b": { id: "npc.b", category: "peoples" as const, kind: "people" as const, title: "B" },
    },
  };

  it("is the page's art, a class page's gear portrait, or nothing", () => {
    expect(triviaPicture({ entry: "creature.a" }, guide)).toBe("/assets/entities/a/portrait.webp");
    expect(triviaPicture({ entry: "npc.b", image: "creature.a" }, guide)).toBe("/assets/entities/a/portrait.webp");
    expect(triviaPicture({ entry: "class.thornguard" }, guide)).toBe("/assets/gear-portraits/thornguard/sworn/bigfoot.png");
    expect(triviaPicture({ entry: "npc.b" }, guide)).toBeNull();
    expect(triviaPicture({ entry: "nobody" }, guide)).toBeNull();
    expect(guidePagePicture({ id: "class.mystery", kind: "class" })).toBeNull();
  });

  it("flattens bank files into one bank", () => {
    expect(ids(triviaBankOf([{ questions: BANK.slice(0, 1) }, { questions: BANK.slice(1) }]))).toEqual(ids(BANK));
  });
});
