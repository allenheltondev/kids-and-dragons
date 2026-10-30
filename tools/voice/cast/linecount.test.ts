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
import { buildSheet, type CastSheet, type ChapterLike, type NarrationLine } from "./sheet.ts";

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
