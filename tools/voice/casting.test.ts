/** Casting from the voice bank: accents by place, candidates, picks and writing them to the sheet. */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT_LABELS, AMERICAN_VARIETY, PEOPLE_ACCENTS, REGION_ACCENTS, REGION_IDEAS, accentFor, americanFor } from "./cast/accents.ts";
import { accentsFor, applyAccents, assign, candidatesFor, castingProblems, firstPicks, libraryAccent, rowAccent, searchWords, settleAdded, shortlistPage, toAdd, type Casting, type CastingVoice, type Sheet } from "./casting";

const row = (over: Partial<CastingVoice> = {}): CastingVoice => ({ id: "kad-yeti-deep", gender: "male", people: "yeti", prompt: "", search: "deep slow gentle", speakers: ["hummock"], ...over });

function fixture(): { sheet: Sheet; casting: Casting } {
  return {
    sheet: {
      speakers: {
        narrator: { kind: "narrator", elevenlabs: { voiceId: "jessica", approved: true } },
        party: { kind: "party" },
        hummock: { lineCount: 32, accent: "Heavy Southern" },
        drift: { lineCount: 4 },
        pellam: { lineCount: 59 },
        stranger: { lineCount: 2 },
        bun: { speaks: false },
      },
    },
    casting: {
      locked: ["narrator"],
      peopleOf: { pellam: "skywardens" },
      voices: [row({ speakers: ["hummock", "drift"] }), row({ id: "kad-pellam", people: "griffin", speakers: ["pellam"] }), row({ id: "kad-folk", people: undefined, speakers: ["stranger"] }), row({ id: "kad-party", people: undefined, speakers: ["party"] })],
      noVoice: ["bun"],
    },
  };
}

const PLACED = { hummock: { people: "yeti", biomes: ["biome.glacier_of_origins", "biome.frostfang_peaks"] }, drift: { people: null, biomes: [] }, pellam: { people: "griffin", biomes: ["biome.frostfang_peaks"] } };

describe("accents by place", () => {
  it("has one accent the pages offer for every place on the map", () => {
    expect(Object.keys(REGION_ACCENTS).sort()).toEqual(Object.keys(REGION_IDEAS).sort());
    for (const accent of [...Object.values(REGION_ACCENTS), ...Object.values(PEOPLE_ACCENTS), ...AMERICAN_VARIETY]) expect(ACCENT_LABELS).toContain(accent);
  });

  it("takes a people's first place, a people's own accent over that, and a varied American for the unplaced", () => {
    expect(accentFor("hummock", "yeti", ["biome.glacier_of_origins", "biome.frostfang_peaks"])).toBe("Alaskan Inuit English");
    expect(accentFor("bram_lock", "bigfoot", [])).toBe("New England American");
    expect(AMERICAN_VARIETY).toContain(accentFor("stranger", null, []));
  });

  it("gives the unplaced the same American every time, and more than one between them", () => {
    expect(americanFor("dilly")).toBe(americanFor("dilly"));
    expect(new Set(["dilly", "alder", "cook", "odo", "tour_guide", "map_seller"].map(americanFor)).size).toBeGreaterThan(1);
  });

  it("overrules a hand-set accent, leaves the narrator and party alone, and places a speaker by their row", () => {
    const { sheet, casting } = fixture();
    const accents = accentsFor(sheet, casting, PLACED);
    expect(accents.get("hummock")).toBe("Alaskan Inuit English");
    expect(accents.get("drift")).toBe("Alaskan Inuit English");
    expect(accents.get("pellam")).toBe("New York American");
    expect(accents.has("narrator")).toBe(false);
    expect(accents.has("party")).toBe(false);
    expect(accents.has("bun")).toBe(false);
    const changes = applyAccents(sheet, accents);
    expect(changes).toContainEqual({ id: "hummock", from: "Heavy Southern", to: "Alaskan Inuit English" });
    expect(sheet.speakers.hummock!.accent).toBe("Alaskan Inuit English");
    expect(applyAccents(sheet, accents)).toEqual([]);
  });

  it("asks the library for a voice with the accent when it has the word, and an American one otherwise", () => {
    expect(libraryAccent("Cockney (London)")).toBe("british");
    expect(libraryAccent("Australian")).toBe("australian");
    expect(libraryAccent("Appalachian American")).toBe("american");
    expect(libraryAccent("Alaskan Inuit English")).toBe("american");
    expect(libraryAccent(undefined)).toBe("american");
  });

  it("suits a shared voice to the accent most of its lines are in", () => {
    const { sheet } = fixture();
    const accents = new Map([["hummock", "Texan"], ["drift", "Welsh"]]);
    expect(rowAccent(row({ speakers: ["hummock", "drift"] }), sheet, accents)).toBe("Texan");
  });
});

describe("candidates", () => {
  const library = [
    { id: "a", ownerId: "o", name: "Plain", about: "narration", gender: "m" as const, added: 900 },
    { id: "b", ownerId: "o", name: "Deep", about: "slow gentle", gender: "m" as const, added: 5 },
    { id: "c", ownerId: "o", name: "Deep Slow Gentle", about: "", gender: "f" as const, added: 999 },
    { id: "jessica", ownerId: "o", name: "Deep Slow Gentle", about: "", gender: "m" as const },
  ];

  it("ranks by fit, then by how many added it, keeps to the gender and never offers the narrator's voice", () => {
    expect(candidatesFor(row(), [], library, new Set(["jessica"])).map((c) => c.voiceId)).toEqual(["b", "a"]);
  });

  it("puts an account voice first when it fits as well, since it costs no slot, and behind a better library voice", () => {
    const found = candidatesFor(row(), [{ id: "brian", name: "Brian", about: "deep slow gentle, american", gender: "m" }], library, new Set());
    expect(found[0]).toMatchObject({ voiceId: "brian" });
    expect(found[0]!.ownerId).toBeUndefined();
    expect(candidatesFor(row(), [{ id: "brian", name: "Brian", about: "deep, american", gender: "m" }], library, new Set())[0]).toMatchObject({ voiceId: "b" });
  });

  it("never offers a voice unfit for children, favors storytellers over ads, and marks down the wrong age", () => {
    const voices = [
      { id: "horror", ownerId: "o", name: "Jack - Deep Dark Horror Narrator", about: "deep slow gentle", gender: "m" as const },
      { id: "ad", ownerId: "o", name: "Deep", about: "advertisement", gender: "m" as const },
      { id: "story", ownerId: "o", name: "Deep", about: "slow, narrative_story", gender: "m" as const },
      { id: "kid", ownerId: "o", name: "Deep", about: "slow, gentle, young", gender: "m" as const },
    ];
    expect(candidatesFor(row({ search: "deep slow gentle old" }), [], voices, new Set()).map((c) => c.voiceId)).toEqual(["story", "kid", "ad"]);
    expect(searchWords(row({ search: "elderly woman gravelly formal" }))).toEqual(["old", "gravelly", "formal"]);
    const tempting = [{ id: "jean", ownerId: "o", name: "Jean - Alluring and Playful Femme Fatale", about: "deep slow gentle", gender: "m" as const }];
    expect(candidatesFor(row(), [], tempting, new Set())).toEqual([]);
  });

  it("keeps account voices to the row's accent, and puts one that shares no words last, as a stand-in", () => {
    const account = [
      { id: "george", name: "George - Warm Storyteller", about: "deep, british, narrative_story", gender: "m" as const },
      { id: "rachel", name: "Grandma Rachel", about: "wise, us southern, narrative_story", gender: "m" as const },
      { id: "brian", name: "Brian", about: "deep, american", gender: "m" as const },
    ];
    const plain = [{ id: "lib", ownerId: "o", name: "Plain", about: "", gender: "m" as const }];
    expect(candidatesFor(row(), account, plain, new Set(), "american").map((c) => c.voiceId)).toEqual(["brian", "lib", "rachel"]);
    expect(candidatesFor(row(), account, [], new Set(), "british").map((c) => c.voiceId)).toEqual(["george"]);
  });

  it("never picks one voice for two rows, and the row with most lines chooses first", () => {
    const candidate = (voiceId: string) => ({ voiceId, name: voiceId, about: "" });
    const picks = firstPicks([
      { row: row({ id: "small" }), lines: 1, candidates: [candidate("x"), candidate("y")] },
      { row: row({ id: "big" }), lines: 50, candidates: [candidate("x")] },
      { row: row({ id: "stuck" }), lines: 0, candidates: [candidate("x")] },
    ]);
    expect(picks.big!.voiceId).toBe("x");
    expect(picks.small!.voiceId).toBe("y");
    expect(picks.stuck).toBeUndefined();
  });

  it("spends the free slots on the rows with most lines, then takes only voices the account has", () => {
    const library = (voiceId: string) => ({ voiceId, name: voiceId, about: "", ownerId: "o" });
    const owned = { voiceId: "brian", name: "Brian", about: "" };
    const picks = firstPicks(
      [
        { row: row({ id: "big" }), lines: 50, candidates: [library("x"), owned] },
        { row: row({ id: "small" }), lines: 3, candidates: [library("y"), owned] },
        { row: row({ id: "tiny" }), lines: 1, candidates: [library("z")] },
      ],
      1,
    );
    expect(picks.big!.voiceId).toBe("x");
    expect(picks.small!.voiceId).toBe("brian");
    expect(picks.tiny).toBeUndefined();
  });

  it("lets a row with nothing new share a picked voice, but only in an accent that voice does not speak yet", () => {
    const owned = (voiceId: string) => ({ voiceId, name: voiceId, about: "" });
    const picks = firstPicks([
      { row: row({ id: "big" }), lines: 50, accent: "Texan", candidates: [owned("x")] },
      { row: row({ id: "same" }), lines: 3, accent: "Texan", candidates: [owned("x")] },
      { row: row({ id: "other" }), lines: 2, accent: "Southern American", candidates: [owned("x")] },
      { row: row({ id: "also" }), lines: 1, accent: "Southern American", candidates: [owned("x")] },
    ]);
    expect(picks.big!.voiceId).toBe("x");
    expect(picks.same).toBeUndefined();
    expect(picks.other!.voiceId).toBe("x");
    expect(picks.also).toBeUndefined();
  });

  it("adds only library picks the account lacks, under either id or name", () => {
    const picks = { one: { voiceId: "a", name: "A", about: "", ownerId: "o" }, two: { voiceId: "b", name: "B", about: "", ownerId: "o" }, three: { voiceId: "c", name: "C", about: "", ownerId: "o" }, four: { voiceId: "d", name: "D", about: "" } };
    expect(toAdd(picks, [{ id: "b", name: "B" }, { id: "z", name: "three" }]).map(([id]) => id)).toEqual(["one"]);
  });

  it("adds a voice two rows share once, and gives both rows the account's copy", () => {
    const maria = { voiceId: "maria", name: "Maria Moody", about: "", ownerId: "o" };
    const picks = { "kad-yeti-herder": { ...maria }, "kad-manticore-elder": { ...maria } };
    expect(toAdd(picks, []).map(([id]) => id)).toEqual(["kad-yeti-herder"]);
    settleAdded(picks, "maria", { voiceId: "new", name: "kad-yeti-herder" });
    expect(picks["kad-manticore-elder"]).toEqual({ voiceId: "new", name: "kad-yeti-herder", about: "" });
    expect(toAdd(picks, [{ id: "new", name: "kad-yeti-herder" }])).toEqual([]);
  });

  it("escapes what the library says about a voice on the page", () => {
    const page = shortlistPage([{ row: row(), accent: "Texan", names: ["Hummock"], candidates: [{ voiceId: "a", name: "<script>", about: "" }] }], {});
    expect(page).not.toContain("<script>alert");
    expect(page).toContain("&lt;script&gt;");
  });
});

describe("assigning picks", () => {
  const pick = { voiceId: "v", name: "kad-yeti-deep", about: "" };

  it("voices the whole row, unapproved unless a person heard it, and says which rows have no pick", () => {
    const { sheet, casting } = fixture();
    const result = assign(sheet, casting, { "kad-yeti-deep": pick }, { approve: false });
    expect(result.assigned).toEqual(["hummock", "drift"]);
    expect(result.unpicked).toContain("kad-pellam");
    expect(sheet.speakers.drift!.elevenlabs).toEqual({ voiceId: "v", name: "kad-yeti-deep" });
    assign(sheet, casting, { "kad-yeti-deep": pick }, { approve: true });
    expect(sheet.speakers.drift!.elevenlabs?.approved).toBe(true);
  });

  it("replaces a voice picked earlier, but never a locked speaker's", () => {
    const { sheet, casting } = fixture();
    sheet.speakers.hummock!.elevenlabs = { voiceId: "brian", approved: true };
    casting.voices[0]!.speakers.push("narrator");
    assign(sheet, casting, { "kad-yeti-deep": pick }, { approve: false });
    expect(sheet.speakers.hummock!.elevenlabs).toEqual({ voiceId: "v", name: "kad-yeti-deep" });
    expect(sheet.speakers.narrator!.elevenlabs?.voiceId).toBe("jessica");
  });
});

describe("the casting file", () => {
  it("places everyone on the sheet once, and locks the narrator", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    const read = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(root, "content", "voice", file), "utf8"));
    const casting = read("casting.json") as Casting;
    expect(castingProblems(read("cast.json") as Sheet, casting)).toEqual([]);
    expect(casting.locked).toEqual(["narrator"]);
  });

  it("names who is missing, doubled or locked", () => {
    const { sheet, casting } = fixture();
    casting.voices[0]!.speakers.push("pellam", "narrator", "ghost");
    casting.noVoice = [];
    const problems = castingProblems(sheet, casting).join("\n");
    expect(problems).toMatch(/pellam is on both/);
    expect(problems).toMatch(/names narrator, who is locked/);
    expect(problems).toMatch(/ghost, who is not on the sheet/);
    expect(problems).toMatch(/bun is on the sheet but nowhere/);
  });
});
