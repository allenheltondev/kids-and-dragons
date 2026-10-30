/**
 * How many lines each character has to speak (docs/voice-cast.md): every quote the narration gives them, counted
 * in full, where `lines` is only the few worth auditioning on. The cast pages sort by it, to put the characters
 * with the most to say first.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { castOrder, castPageData } from "./routes.ts";
import { reviewJson } from "./review.ts";
import { attributeQuotes, buildSheet, looksSpoken, withSceneRoles, type CastSheet, type ChapterLike, type LooseQuote, type NarrationLine } from "./sheet.ts";

const chapters: ChapterLike[] = [
  { id: "c1", voiceGuide: { npcVoices: { pib: "a bramble sprite; he chirps", wisp: "a shy ghost; she whispers", mute: "a goat; only bleats" } } },
  { id: "c2", voiceGuide: { npcVoices: { pib: "a bramble sprite; he chirps" } } },
];

const said = (chapter: string, scene: string, who: string, n: number): NarrationLine => ({ chapter, address: `${chapter}/${scene}/narration`, text: `${who} says, "Line number ${String(n)} is spoken aloud."` });

const narration: NarrationLine[] = [
  // Pib speaks seven times across two chapters, wisp twice, and the party once.
  ...[1, 2, 3, 4].map((n) => said("c1", `s${String(n)}`, "Pib", n)),
  ...[5, 6, 7].map((n) => said("c2", `s${String(n)}`, "Pib", n)),
  said("c1", "w1", "Wisp", 1),
  said("c1", "w2", "Wisp", 2),
  { chapter: "c1", address: "c1/p1/narration", text: '"We came to help," you say.' },
  { chapter: "c1", address: "c1/n1/narration", text: "The path ends at a wall of thorns." },
];

const sheetOf = (previous: CastSheet | null = null): CastSheet => buildSheet({ chapters, individuals: [], narration }, previous);

describe("counting each character's spoken lines", () => {
  it("counts every line they speak, where the audition lines are only the best three", () => {
    const sheet = sheetOf();
    expect(sheet.speakers.pib!.lineCount).toBe(7);
    expect(sheet.speakers.pib!.lines).toHaveLength(3);
    expect(sheet.speakers.wisp!.lineCount).toBe(2);
    expect(sheet.speakers.wisp!.lines).toHaveLength(2);
  });

  it("counts someone nobody quotes as none, rather than leaving the field out", () => {
    expect(sheetOf().speakers.mute!.lineCount).toBe(0);
  });

  it("counts the party's 'you say' lines, and gives the narrator every line of narration", () => {
    const sheet = sheetOf();
    expect(sheet.speakers.party!.lineCount).toBe(1);
    expect(sheet.speakers.narrator!.lineCount).toBe(narration.length);
  });

  it("refreshes the count on a rebuild, narrator and party included, and keeps what a person decided", () => {
    const first = sheetOf();
    first.speakers.pib!.status = "approved";
    first.speakers.pib!.lineCount = 99;
    first.speakers.narrator!.lineCount = 1;
    first.speakers.party!.lineCount = 99;
    const again = sheetOf(first);
    expect(again.speakers.pib).toMatchObject({ status: "approved", lineCount: 7 });
    expect(again.speakers.narrator!.lineCount).toBe(narration.length);
    expect(again.speakers.party!.lineCount).toBe(1);
  });

  it("walks the narrator, the party, then whoever speaks most, ties going to the most chapters", () => {
    const sheet = sheetOf();
    expect(castOrder(sheet).slice(0, 4)).toEqual(["narrator", "party", "pib", "wisp"]);
    // Fewer chapters but more lines still comes first; the same lines, the most chapters.
    sheet.speakers.wisp!.lineCount = 7;
    sheet.speakers.wisp!.chapters = ["c1"];
    expect(castOrder(sheet).slice(2, 4)).toEqual(["pib", "wisp"]);
    sheet.speakers.wisp!.lineCount = 8;
    expect(castOrder(sheet).slice(2, 4)).toEqual(["wisp", "pib"]);
  });

  it("serves the count to the pages with each character", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cast-lines-"));
    const sheetPath = path.join(dir, "cast.json");
    fs.writeFileSync(sheetPath, JSON.stringify(sheetOf()));
    const data = castPageData({ ws: { outDir: dir, cast: { speakers: {}, delivery: {}, beats: {} } as never, pricing: { models: [] } as never, today: "2026-10-30" }, sheetPath, catalog: [], fetch: async () => { throw new Error("no"); }, chapterCampaigns: {} }, { profiles: false });
    expect(Object.fromEntries(Object.entries(data.speakers).map(([id, e]) => [id, e.lineCount]))).toEqual({ narrator: narration.length, party: 1, pib: 7, wisp: 2, mute: 0 });
    // The count is not the audition list: the page shows both.
    expect(data.auditions.pib).toHaveLength(3);
  });

  it("puts the count in the review export", () => {
    const review = reviewJson(sheetOf());
    expect(Object.fromEntries(review.speakers.map((e) => [e.id, e.lines]))).toMatchObject({ pib: 7, wisp: 2, mute: 0 });
  });
});

describe("guessing at quotes nobody is tagged for", () => {
  const loose = (words: string, before = "", after = ""): LooseQuote => ({ words, before, after });

  it("reports the quotes it could not give to anyone, with the words either side", () => {
    const sink: LooseQuote[] = [];
    const found = attributeQuotes('The path ends at a wall of thorns. "Mind the brambles." Then it hums.', [{ id: "pib", names: ["Pib"] }], sink);
    expect(found).toEqual([]);
    expect(sink).toEqual([{ words: "Mind the brambles.", before: "The path ends at a wall of thorns. ", after: " Then it hums." }]);
  });

  it("takes a sentence someone said, and not a fragment, a quoted phrase, a sign or the party", () => {
    expect(looksSpoken(loose("Going, then.", "At dawn, Mortar watches you pass. "))).toBe(true);
    expect(looksSpoken(loose("for keeping the argument going."))).toBe(false); // a fragment
    expect(looksSpoken(loose("Mine,"))).toBe(false); // one word
    expect(looksSpoken(loose("slightly used rumors.", "A boggart in a coat of other coats sells "))).toBe(false); // sold, not said
    expect(looksSpoken(loose("NO MESSING.", "A sign on the gate reads "))).toBe(false);
    expect(looksSpoken(loose("Now you're Sunward,", "You sing the verse back to Hob. "))).toBe(false);
    expect(looksSpoken(loose("We will see.", "", ", you say, and mean it."))).toBe(false);
    // The same words a sentence earlier are not a sign: the cue must be in the quote's own sentence.
    expect(looksSpoken(loose("Then we are home.", "The grandmother reads the founder's plaque twice. "))).toBe(true);
  });

  const hedge: ChapterLike[] = [
    {
      id: "h1",
      voiceGuide: { npcVoices: { pib: "a bramble sprite; he chirps", wisp: "a shy ghost; she whispers" } },
      scenes: {
        // One speaker here: Pib. Two there: nobody can say who.
        alone: { cast: [{ name: "Pib" }] },
        crowd: { cast: [{ name: "Pib" }, { name: "Wisp" }] },
      },
    },
  ];
  const guessing: NarrationLine[] = [
    { chapter: "h1", address: "h1/alone/narration", text: 'Pib says, "Welcome to the hedge." The hedge rustles. "Mind the brambles on your way in."' },
    { chapter: "h1", address: "h1/alone/narration", text: 'A hush falls. "The hedge remembers everyone who passes."' },
    { chapter: "h1", address: "h1/alone/narration", text: 'A sign nailed to the gate reads "KEEP OUT."' },
    { chapter: "h1", address: "h1/crowd/narration", text: 'A hush falls. "Somebody here is humming."' },
  ];
  const sheet = buildSheet({ chapters: hedge, individuals: [], narration: guessing }, null);

  it("counts them for the one who is alone in the scene, apart from the tagged lines", () => {
    const pib = sheet.speakers.pib!;
    // One tagged line (his two back-to-back quotes are one line, as they are said), and one guess; the sign is neither.
    expect(pib.lineCount).toBe(2);
    expect(pib.guessedLines).toBe(1);
    // Only the tagged line is offered to audition on: a guess is never a sample of their voice.
    expect(pib.lines.map((line) => line.text)).toEqual(["Welcome to the hedge. Mind the brambles on your way in."]);
  });

  it("leaves a crowded scene's quotes uncounted, and a sign alone", () => {
    expect(sheet.speakers.wisp!.lineCount).toBe(0);
    expect(sheet.speakers.wisp!.guessedLines).toBeUndefined();
  });

  it("does not guess when someone else is named right beside the quote", () => {
    const withWisp = buildSheet({ chapters: hedge, individuals: [], narration: [{ chapter: "h1", address: "h1/alone/narration", text: 'Wisp drifts past the gate. "The hedge remembers everyone who passes."' }] }, null);
    expect(withWisp.speakers.pib!.lineCount).toBe(0);
  });
});

describe("naming someone by what they are, in the scene they are in", () => {
  const names = new Map([["cousins", "Gullet's Cousins"], ["gullet", "Gullet"], ["drover_a", "Centaur drover"], ["drover_b", "Faun drover"]]);
  const speakers = [{ id: "cousins", names: ["Gullet's Cousins"] }, { id: "gullet", names: ["Gullet"] }, { id: "drover_a", names: ["Centaur drover"] }, { id: "drover_b", names: ["Faun drover"] }];
  const rolesOf = (here: string[], id: string): readonly string[] => withSceneRoles(speakers, new Set(here), names).find((speaker) => speaker.id === id)!.names;

  it("lets the last word of a name stand for them where nobody else in the scene shares it", () => {
    expect(rolesOf(["cousins", "gullet"], "cousins")).toEqual(["Gullet's Cousins", "cousins", "cousin"]);
    // Two drovers in one scene: "the drover" is nobody's, but "the centaur drover" still is.
    expect(rolesOf(["drover_a", "drover_b"], "drover_a")).toEqual(["Centaur drover"]);
    // Someone not in the scene keeps just their own names.
    expect(rolesOf(["gullet"], "cousins")).toEqual(["Gullet's Cousins"]);
    expect(withSceneRoles(speakers, undefined, names)).toEqual(speakers);
  });

  it("reads 'says a cousin' and 'groans the guide' as tags, and a bare 'the drover says' only when one drover is there", () => {
    const here = withSceneRoles(speakers, new Set(["cousins", "gullet"]), names);
    expect(attributeQuotes('"Tall lady with cords," says a cousin. "Never stopped jogging."', here).map((q) => q.id)).toEqual(["cousins", "cousins"]);
    expect(attributeQuotes('"My cousin," groans the cousin.', here).map((q) => q.id)).toEqual(["cousins"]);
    const drovers = withSceneRoles(speakers, new Set(["drover_a", "drover_b"]), names);
    const loose: LooseQuote[] = [];
    expect(attributeQuotes('"Toll refund," the drover says.', drovers, loose)).toEqual([]);
    expect(loose).toHaveLength(1);
    expect(attributeQuotes('"Toll refund," the centaur drover says.', drovers).map((q) => q.id)).toEqual(["drover_a"]);
  });
});

describe("a scene variant that carries on from the scene's narration", () => {
  const speakers = [{ id: "pellam", names: ["Pellam"] }];
  const base = 'Pellam opens the ledger. "Here it is."';
  const variant = '"Pockets," he reads. "A great many pockets."';

  it("takes its 'he' from who the narration last named, and counts only its own quotes", () => {
    const loose: LooseQuote[] = [];
    const alone = attributeQuotes(variant, speakers, loose);
    expect(alone).toEqual([]);
    expect(loose).toHaveLength(2);
    const sink: LooseQuote[] = [];
    const joined = attributeQuotes(`${base} ${variant}`, speakers, sink, base.length + 1);
    expect(joined.map((q) => [q.id, q.words])).toEqual([["pellam", "Pockets,"], ["pellam", "A great many pockets."]]);
    expect(sink).toEqual([]);
  });
});
