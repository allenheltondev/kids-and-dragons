/**
 * The cast voice sheet (docs/voice-cast.md): who is in the game, which lines
 * are theirs, and voices that never collide in a chapter and never move once
 * a person has chosen them.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import { GEMINI_VOICES, type CastFile, type Fetch } from "../bakeoff/providers.ts";
import { auditionLines, createCastRoutes, sheetCast, STAND_IN } from "./routes.ts";
import { reviewJson, reviewMarkdown } from "./review.ts";
import { assignVoices, attributeQuotes, buildSheet, collectCharacters, decide, GEMINI_VOICE_TRAITS, genderOf, NARRATOR_VOICE, noteHints, quotesFor, rejectedVoices, traitsOf, voiceClashes, type CastSheet, type ChapterLike } from "./sheet.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SHEET = path.join(ROOT, "content", "voice", "cast.json");

describe("whose line is it", () => {
  const speakers = [
    { id: "pib", names: ["Pib"] },
    { id: "keeper", names: ["Seal-Keeper", "dragon"] },
  ];

  it("follows a name in the speech tag, before or after the quote", () => {
    expect(attributeQuotes('"I\'m Pib," says the sprite. Pib says, "Hello."', speakers)).toEqual([{ id: "pib", words: "Hello." }]);
    expect(attributeQuotes('"Help," says the dragon, trying out the word.', speakers)).toEqual([{ id: "keeper", words: "Help," }]);
  });

  it("gives a pronoun tag to whoever was named last, and remembers the pronoun", () => {
    const text = 'The Seal-Keeper lowers its head. "Everyone brings me stones," it says. Pib hides. "Not me," they say.';
    expect(attributeQuotes(text, speakers)).toEqual([
      { id: "keeper", words: "Everyone brings me stones,", pronoun: "it" },
      { id: "pib", words: "Not me,", pronoun: "they" },
    ]);
  });

  it("gives 'you say' to the party, and a follow-on quote to the same speaker", () => {
    const text = '"We came to help," you say. Pib nods. "I\'m Pib," they say. "I can\'t let them in."';
    expect(attributeQuotes(text, speakers).map((q) => q.id)).toEqual(["party", "pib", "pib"]);
  });

  it("gives a quote after an action beat to the speaker the beat is about, with the beat's pronoun", () => {
    expect(attributeQuotes('The Seal-Keeper shakes her head. "And travelers keep following it."', speakers)).toEqual([
      { id: "keeper", words: "And travelers keep following it.", pronoun: "she" },
    ]);
    expect(attributeQuotes('Pib points at the map. "Both show the river!"', speakers)).toEqual([{ id: "pib", words: "Both show the river!" }]);
    // "her hand" is somebody else's: the beat names whose quote it is, not whose pronoun.
    expect(attributeQuotes('Pib reaches toward her hand. "Enough."', speakers)).toEqual([{ id: "pib", words: "Enough." }]);
    // Two speakers in the beat, or a beat that is not about a speaker: nobody can be sure.
    expect(attributeQuotes('Pib hands the dragon a cup. "Thank you."', speakers)).toEqual([]);
    expect(attributeQuotes('The rain stops. "Finally."', speakers)).toEqual([]);
  });

  it("leaves a quote nobody is tagged for", () => {
    expect(quotesFor('A sign says "NO MESSING." Pib shrugs.', ["Pib"])).toEqual([]);
  });
});

describe("who is in the game", () => {
  const chapters: ChapterLike[] = [
    {
      id: "a-01",
      campaignId: "a",
      voiceGuide: { npcVoices: { pib: "a bramble sprite the size of a teapot; earnest", tidewell: "Professor Marrow Tidewell, a selkie scholar; she hurries", wisp: "a curious wisp who rhymes" } },
      scenes: { s: { cast: [{ figure: "x", name: "Pib" }, { figure: "y", name: "Professor Tidewell" }] } },
    },
    { id: "a-02", campaignId: "a", voiceGuide: { npcVoices: { pib: "a bramble sprite" } }, scenes: { s: { cast: [{ figure: "z", name: "Madame Fenn" }] } } },
    { id: "a-03", campaignId: "a", voiceGuide: { npcVoices: { coralie_fenn: "Madame Coralie Fenn, a merfolk gem-buyer" } } },
    { id: "b-01", campaignId: "b", voiceGuide: { npcVoices: { "Seren Wisp": "a curious young scholar" } }, scenes: { s: { cast: [{ figure: "w", name: "Master Orin Vale" }] } } },
    { id: "b-02", campaignId: "b", scenes: { s: { cast: [{ figure: "w", name: "Orin Vale" }] } } },
  ];
  const drafts = new Map(collectCharacters({ chapters, individuals: [{ id: "individual.pib", title: "Pib", pronouns: "they/them", speech_register: "Over-explains." }], narration: [] }).map((d) => [d.id, d]));

  it("is one entry per person across chapters, with canon's pronouns and register", () => {
    expect([...drafts.get("pib")!.chapters].sort()).toEqual(["a-01", "a-02"]);
    expect(drafts.get("pib")!.pronouns).toBe("they/them");
    expect(drafts.get("pib")!.who).toContain("Over-explains.");
  });

  it("names a voice note's subject, and joins a titled cast name to it", () => {
    expect(drafts.get("tidewell")!.name).toBe("Professor Marrow Tidewell");
    expect([...drafts.get("tidewell")!.aliases]).toContain("Professor Tidewell");
  });

  it("joins a shorter form of a proper name within a campaign, drops titles, and reads display-name keys", () => {
    expect([...drafts.get("orin_vale")!.chapters].sort()).toEqual(["b-01", "b-02"]);
    expect(drafts.has("seren_wisp")).toBe(true);
    // "Seren Wisp" is not Bramblewood's wisp: different campaigns, and "wisp" is what someone is, not who.
    expect([...drafts.get("wisp")!.chapters]).toEqual(["a-01"]);
  });

  it("joins a cast member to the voice notes their figure is named for, whatever the display name", () => {
    const renamed = new Map(collectCharacters({
      chapters: [{ id: "c-01", campaignId: "c", voiceGuide: { npcVoices: { nan_rummage: "a boggart", soup_woman: "kind, soft-spoken" } },
        scenes: { s: { cast: [{ figure: "cast/nan_rummage", name: "Nana Rummage" }, { figure: "cast/soup_woman", name: "Marigold" }] } } }],
      individuals: [], narration: [],
    }).map((d) => [d.id, d]));
    expect([...renamed.keys()].sort()).toEqual(["nan_rummage", "soup_woman"]);
    expect(renamed.get("nan_rummage")!.name).toBe("Nana Rummage");
    expect([...renamed.get("soup_woman")!.aliases]).toContain("Marigold");
  });

  it("guesses a voice's gender and size from pronouns and notes", () => {
    expect(genderOf({ name: "Hessa Wren", who: "warm, generous", pronouns: "she/her" })).toBe("f");
    expect(genderOf({ name: "Old Wick", who: "a very old frogfolk lamplighter; he croaks" })).toBe("m");
    expect(genderOf({ name: "Pib", who: "a sprite", pronouns: "they/them" })).toBeNull();
    expect(traitsOf({ name: "Mortar", who: "a stone troll noodle cook" })).toContain("big");
    expect(traitsOf({ name: "Flick", who: "a tiny wisp who loves tag" })).toContain("young");
  });
});

describe("voices", () => {
  const entry = (chapters: string[], voice = "", status: "provisional" | "approved" = "provisional") => ({
    name: "x",
    kind: "character" as const,
    who: "someone",
    chapters,
    aliases: [],
    gemini: { voice },
    lines: [],
    speaks: true,
    status,
  });

  it("never gives two speakers in one chapter the same voice, nor anyone the narrator's", () => {
    const speakers = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${String(i)}`, entry(["ch-1"])]));
    assignVoices(speakers, () => false);
    const voices = Object.values(speakers).map((e) => e.gemini.voice);
    expect(new Set(voices).size).toBe(25);
    expect(voices).not.toContain(NARRATOR_VOICE);
  });

  it("works around a voice somebody chose, and never moves it", () => {
    const speakers = { chosen: entry(["ch-1"], "Kore", "approved"), other: entry(["ch-1"]) };
    assignVoices(speakers, (id) => id === "chosen");
    expect(speakers.chosen.gemini.voice).toBe("Kore");
    expect(speakers.other.gemini.voice).not.toBe("Kore");
  });

  it("keeps every decision across a rebuild, an approved one's included, and a provisional one's voice", () => {
    const chapters: ChapterLike[] = [{ id: "c", voiceGuide: { npcVoices: { a: "a baker; she hums", b: "a miller; he grumbles" } } }];
    const first = buildSheet({ chapters, individuals: [], narration: [] }, null);
    first.speakers.a!.gemini.voice = "Gacrux";
    first.speakers.a!.status = "approved";
    first.speakers.a!.notes = "perfect";
    first.speakers.a!.accent = "Southern American";
    const bVoice = first.speakers.b!.gemini.voice;
    const again = buildSheet({ chapters, individuals: [], narration: [] }, first);
    expect(again.speakers.a).toEqual(first.speakers.a);
    expect(again.speakers.b!.gemini.voice).toBe(bVoice);
  });

  it("refreshes an approved character's chapters, so a clash in a new chapter is still caught", () => {
    const before: ChapterLike[] = [
      { id: "c1", voiceGuide: { npcVoices: { a: "a baker; she hums" } } },
      { id: "c2", voiceGuide: { npcVoices: { b: "a weaver; she sings" } } },
    ];
    const sheet = buildSheet({ chapters: before, individuals: [], narration: [] }, null);
    // Both approved on one voice: fine while they never meet.
    for (const id of ["a", "b"]) {
      sheet.speakers[id]!.gemini.voice = "Kore";
      sheet.speakers[id]!.status = "approved";
    }
    expect(voiceClashes(sheet)).toEqual([]);
    // A new chapter puts them in one scene.
    const after = [...before, { id: "c3", voiceGuide: { npcVoices: { a: "a baker; she hums", b: "a weaver; she sings" } } }];
    const rebuilt = buildSheet({ chapters: after, individuals: [], narration: [] }, sheet);
    expect(rebuilt.speakers.a!.chapters).toEqual(["c1", "c3"]);
    expect(rebuilt.speakers.a!.status).toBe("approved");
    expect(rebuilt.speakers.a!.gemini.voice).toBe("Kore");
    expect(voiceClashes(rebuilt)).toEqual([{ chapter: "c3", voice: "Kore", speakers: ["a", "b"] }]);
  });
});

describe("approving and rejecting", () => {
  const make = (): CastSheet => {
    const chapters: ChapterLike[] = [{ id: "c", voiceGuide: { npcVoices: { gran: "an old grandmother; she knits", kid: "a small boy; he bounces", baker: "a baker; she hums" } } }];
    return buildSheet({ chapters, individuals: [], narration: [] }, null);
  };

  it("reads plain words in a rejection as what the next voice needs", () => {
    expect(noteHints(["too old, needs to be younger"])).toMatchObject({ want: expect.arrayContaining(["young"]), avoid: ["old"] });
    expect(noteHints(["should be a woman's voice"]).gender).toBe("f");
    expect(noteHints(["deeper please"]).want).toContain("big");
    expect(noteHints(["fine, just not this one"])).toEqual({ gender: null, want: [], avoid: [] });
  });

  it("rejecting keeps the voice and the notes, and moves to a fitting voice never tried before", () => {
    const sheet = make();
    const first = sheet.speakers.gran!.gemini.voice;
    const entry = decide(sheet, "gran", "rejected", "too squeaky, she should sound older and softer", "gemini-3.8-flash-tts", "2026-10-27T00:00:00Z");
    expect(entry.history).toEqual([{ decision: "rejected", voice: first, notes: "too squeaky, she should sound older and softer", model: "gemini-3.8-flash-tts", at: "2026-10-27T00:00:00Z" }]);
    expect(entry.status).toBe("provisional");
    expect(entry.gemini.voice).not.toBe(first);
    expect(GEMINI_VOICE_TRAITS[entry.gemini.voice]!.gender).toBe("f");
    // Reject again and again: never back to a voice already turned down, never clashing in the chapter.
    for (let i = 0; i < 5; i += 1) decide(sheet, "gran", "rejected", "no", undefined);
    expect([...rejectedVoices(sheet.speakers.gran!)]).not.toContain(sheet.speakers.gran!.gemini.voice);
    expect(voiceClashes(sheet)).toEqual([]);
  });

  it("approving pins the voice, and a rebuild keeps every decision", () => {
    const sheet = make();
    decide(sheet, "kid", "rejected", "too deep", undefined);
    const kidVoice = sheet.speakers.kid!.gemini.voice;
    decide(sheet, "baker", "approved", "perfect", undefined);
    const chapters: ChapterLike[] = [{ id: "c", voiceGuide: { npcVoices: { gran: "an old grandmother; she knits", kid: "a small boy; he bounces", baker: "a baker; she hums" } } }];
    const again = buildSheet({ chapters, individuals: [], narration: [] }, sheet);
    expect(again.speakers.baker).toEqual(sheet.speakers.baker);
    expect(again.speakers.kid!.history).toEqual(sheet.speakers.kid!.history);
    expect(again.speakers.kid!.gemini.voice).toBe(kidVoice);
  });

  it("reports the review for people and for tools", () => {
    const sheet = make();
    const gran = sheet.speakers.gran!.gemini.voice;
    decide(sheet, "gran", "rejected", "too young", undefined, "2026-10-27T00:00:00Z");
    decide(sheet, "baker", "approved", "warm and right", undefined, "2026-10-27T00:00:00Z");
    const md = reviewMarkdown(sheet, "2026-10-27T00:00:00Z");
    expect(md).toContain("## Approved (1)");
    expect(md).toContain("| warm and right |");
    expect(md).toContain(`- ${gran}: "too young", 2026-10-27`);
    expect(md).toContain("## Voices rejected most");
    const json = reviewJson(sheet, "2026-10-27T00:00:00Z");
    expect(json.summary).toMatchObject({ approved: 1, rejectedNowRetrying: 1 });
    expect(json.rejectedVoices).toEqual({ [gran]: 1 });
    expect(json.speakers.find((s) => s.id === "gran")!.history[0]!.notes).toBe("too young");
  });
});

describe("the committed sheet", () => {
  const sheet = JSON.parse(fs.readFileSync(SHEET, "utf8")) as CastSheet;

  it("is the whole cast, every voice a Gemini voice, and nobody sharing one in a chapter", () => {
    expect(Object.keys(sheet.speakers).length).toBeGreaterThan(150);
    for (const [id, entry] of Object.entries(sheet.speakers)) expect(GEMINI_VOICES.some((v) => v.id === entry.gemini.voice), id).toBe(true);
    expect(voiceClashes(sheet)).toEqual([]);
    expect(sheet.speakers.narrator!.gemini.voice).toBe(NARRATOR_VOICE);
  });

  it("speaks American", () => {
    expect(sheet.accent).toMatch(/American/);
  });

  it("has real lines for the people we know speak", () => {
    // A speech tag mid-line splits a quote in two; the sheet joins it back up.
    expect(sheet.speakers.pib!.lines.map((l) => l.text)).toContain("I can only spare one. The hedge says you should choose it together.");
    expect(sheet.speakers.orin_vale!.pronouns).toBe("he/him");
    expect(sheet.speakers.coralie_fenn!.aliases).toContain("Madame Fenn");
  });

  it("gives every character a gender, says where it came from, and knows their figure", () => {
    for (const [id, entry] of Object.entries(sheet.speakers)) {
      if (entry.kind === "narrator" || entry.kind === "party") continue;
      expect(entry.gender, id).toBeDefined();
      expect(entry.genderFrom, id).toBeDefined();
    }
    expect(sheet.speakers.pib).toMatchObject({ gender: "nonbinary", genderFrom: "canon", figure: "cast/pib", canon: "individual.pib" });
  });
});

describe("the cast page's routes", () => {
  const cast = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;
  const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "pricing.json"), "utf8")) as Pricing;
  const sheet: CastSheet = {
    accent: "General American",
    speakers: {
      narrator: { name: "Narrator", kind: "narrator", who: "A storyteller.", chapters: [], aliases: [], gemini: { voice: "Sulafat" }, lines: [{ text: "Once upon a time.", address: "x" }], speaks: true, status: "provisional" },
      wick: { name: "Old Wick", kind: "character", who: "an old lamplighter", chapters: ["c"], aliases: [], gemini: { voice: "Charon" }, lines: [], speaks: true, status: "provisional" },
      bun: { name: "Bun", kind: "creature", who: "a goat kid; only bleats", chapters: ["c"], aliases: [], gemini: { voice: "Leda" }, lines: [], speaks: false, status: "provisional" },
    },
  };
  const setup = () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cast-"));
    const sheetPath = path.join(outDir, "cast.json");
    fs.writeFileSync(sheetPath, JSON.stringify(sheet));
    let sent: unknown = null;
    const fetch: Fetch = async (_url, init) => {
      sent = JSON.parse(init.body ?? "{}");
      const body = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.alloc(4800).toString("base64") } }] } }] });
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => body };
    };
    const budget = { spent: 0, cap: 5 };
    const handle = createCastRoutes({ ws: { outDir, cast, pricing, today: "2026-10-27" }, sheetPath, catalog: [], fetch, chapterCampaigns: { c: "x" } }, budget);
    return { handle, sheetPath, sentBody: () => sent, budget };
  };

  it("auditions someone with no line on a stand-in, and someone who doesn't speak on nothing", () => {
    expect(auditionLines("wick", sheet.speakers.wick!)).toEqual([{ text: STAND_IN.replace("{name}", "Old"), address: "cast/wick/stand-in", standIn: true }]);
    expect(auditionLines("bun", sheet.speakers.bun!)).toEqual([]);
  });

  it("renders an audition in the character's voice, with their accent in the style", async () => {
    const { handle, sentBody, budget } = setup();
    const reply = await handle("/api/cast/render", { id: "narrator", line: 0, model: "gemini-3.8-flash-tts" }, { gemini: "k" });
    expect(reply!.status).toBe(200);
    const body = sentBody() as { contents: { parts: { text: string; speechMetadata: { style: string } }[] }[]; generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } } };
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Sulafat");
    expect(body.contents[0]!.parts[0]!.text).toBe("Once upon a time.");
    expect(body.contents[0]!.parts[0]!.speechMetadata.style).toContain("Accent: General American.");
    expect(budget.spent).toBeGreaterThan(0);
  });

  it("saves a chosen voice and approval to the sheet, and refuses a voice Gemini does not have", async () => {
    const { handle, sheetPath } = setup();
    expect((await handle("/api/cast/save", { id: "wick", voice: "Algenib", status: "approved", notes: "gravelly" }, {}))!.status).toBe(200);
    const saved = JSON.parse(fs.readFileSync(sheetPath, "utf8")) as CastSheet;
    expect(saved.speakers.wick).toMatchObject({ gemini: { voice: "Algenib" }, status: "approved", notes: "gravelly" });
    expect((await handle("/api/cast/save", { id: "wick", voice: "Bob" }, {}))!.status).toBe(400);
  });

  it("records decisions and serves the review", async () => {
    const { handle, sheetPath } = setup();
    expect((await handle("/api/cast/decide", { id: "wick", decision: "maybe" }, {}))!.status).toBe(400);
    const rejected = await handle("/api/cast/decide", { id: "wick", decision: "rejected", notes: "too young, needs gravel", model: "gemini-3.8-flash-tts" }, {});
    expect(rejected!.status).toBe(200);
    const saved = JSON.parse(fs.readFileSync(sheetPath, "utf8")) as CastSheet;
    expect(saved.speakers.wick!.history![0]).toMatchObject({ decision: "rejected", voice: "Charon", notes: "too young, needs gravel" });
    expect(saved.speakers.wick!.gemini.voice).not.toBe("Charon");
    const review = (await handle("/api/cast/review", {}, {}))!.body as { markdown: string; json: { summary: { rejectedNowRetrying: number } } };
    expect(review.markdown).toContain('Charon: "too young, needs gravel"');
    expect(review.json.summary.rejectedNowRetrying).toBe(1);
  });

  it("builds the planner's cast from the sheet", () => {
    const planner = sheetCast(sheet, cast);
    expect(planner.accent).toBe("General American");
    expect(planner.speakers.wick).toEqual({ describe: "Old Wick: an old lamplighter", gemini: { voice: "Charon" } });
    expect(planner.beats).toBe(cast.beats);
  });
});
