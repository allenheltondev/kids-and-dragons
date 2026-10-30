/**
 * The cast pages in ElevenLabs mode (docs/voice-cast.md): a character has an
 * ElevenLabs voice beside their Gemini one, picked from the account's voices by
 * ear; auditions, approvals and clashes follow whichever provider the page is on,
 * and the Gemini voice is never touched from there.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import type { CastFile, Fetch, ModelInfo } from "../bakeoff/providers.ts";
import { castPageData, createCastRoutes, providerOf, sheetCast, toldFor } from "./routes.ts";
import { reviewJson, reviewMarkdown } from "./review.ts";
import { buildSheet, decide, nextVoice, voiceClashes, voiceOf, type CastSheet, type ChapterLike } from "./sheet.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const VOICE_A = "21m00Tcm4TlvDq8ikWAM";
const VOICE_B = "AZnzlk1XvdvUeBnXmlld";

const sheetOf = (): CastSheet => ({
  accent: "General American",
  speakers: {
    narrator: { name: "Narrator", kind: "narrator", who: "A storyteller.", chapters: [], aliases: [], gemini: { voice: "Sulafat" }, lines: [{ text: "Once upon a time.", address: "x" }], speaks: true, status: "provisional" },
    wick: { name: "Old Wick", kind: "character", who: "an old lamplighter", chapters: ["c"], aliases: [], gemini: { voice: "Charon" }, lines: [{ text: "Mind the lamps.", address: "y" }], speaks: true, status: "provisional" },
    bun: { name: "Bun", kind: "character", who: "a goat kid", chapters: ["c"], aliases: [], gemini: { voice: "Leda" }, lines: [{ text: "Meh!", address: "z" }], speaks: true, status: "provisional" },
  },
});

const catalog: ModelInfo[] = [
  { provider: "elevenlabs", model: "eleven_v4", label: "ElevenLabs v4", tags: true },
  { provider: "elevenlabs", model: "eleven_multilingual_v2", label: "Multilingual v2", context: true },
  { provider: "gemini", model: "gemini-3.8-flash-tts", label: "Gemini 3.8 Flash TTS", tags: true },
];

describe("the sheet, in ElevenLabs mode", () => {
  it("reads a character's voice on a provider, and none until one is picked", () => {
    const sheet = sheetOf();
    expect(voiceOf(sheet.speakers.wick!)).toBe("Charon");
    expect(voiceOf(sheet.speakers.wick!, "elevenlabs")).toBe("");
    sheet.speakers.wick!.elevenlabs = { voiceId: VOICE_A, name: "Rachel" };
    expect(voiceOf(sheet.speakers.wick!, "elevenlabs")).toBe(VOICE_A);
    expect(voiceOf(sheet.speakers.wick!)).toBe("Charon");
  });

  it("warns about a shared voice on each provider on its own, and about nobody with no voice yet", () => {
    const sheet = sheetOf();
    // Nobody has an ElevenLabs voice: nothing to clash.
    expect(voiceClashes(sheet, "elevenlabs")).toEqual([]);
    sheet.speakers.wick!.elevenlabs = { voiceId: VOICE_A };
    sheet.speakers.bun!.elevenlabs = { voiceId: VOICE_A };
    expect(voiceClashes(sheet, "elevenlabs")).toEqual([{ chapter: "c", voice: VOICE_A, speakers: ["wick", "bun"] }]);
    // Their Gemini voices differ, so Gemini mode warns of nothing.
    expect(voiceClashes(sheet)).toEqual([]);
    // The narrator's voice is in every chapter.
    sheet.speakers.narrator!.elevenlabs = { voiceId: VOICE_B };
    sheet.speakers.bun!.elevenlabs = { voiceId: VOICE_B };
    expect(voiceClashes(sheet, "elevenlabs")).toContainEqual({ chapter: "c", voice: VOICE_B, speakers: ["narrator", "bun"] });
  });

  it("approves an ElevenLabs voice without touching the Gemini approval, and clears one that is rejected", () => {
    const sheet = sheetOf();
    sheet.speakers.wick!.elevenlabs = { voiceId: VOICE_A, name: "Rachel" };
    decide(sheet, "wick", "approved", "warm", "eleven_v4", "2026-10-30T00:00:00Z", "elevenlabs");
    expect(sheet.speakers.wick).toMatchObject({ status: "provisional", elevenlabs: { voiceId: VOICE_A, approved: true } });
    expect(sheet.speakers.wick!.history).toEqual([{ decision: "approved", provider: "elevenlabs", voice: VOICE_A, voiceName: "Rachel", notes: "warm", model: "eleven_v4", at: "2026-10-30T00:00:00Z" }]);

    decide(sheet, "wick", "rejected", "too bright", undefined, "2026-10-30T00:01:00Z", "elevenlabs");
    expect(sheet.speakers.wick!.elevenlabs).toBeUndefined();
    // The Gemini voice did not move.
    expect(sheet.speakers.wick!.gemini.voice).toBe("Charon");
    expect(sheet.speakers.wick!.history!.at(-1)).toMatchObject({ decision: "rejected", provider: "elevenlabs", voice: VOICE_A });
  });

  it("keeps ElevenLabs decisions out of the Gemini review, and lists them apart in its JSON", () => {
    const sheet = sheetOf();
    sheet.speakers.wick!.elevenlabs = { voiceId: VOICE_A, name: "Rachel" };
    decide(sheet, "wick", "approved", "warm", undefined, "2026-10-30T00:00:00Z", "elevenlabs");
    decide(sheet, "bun", "approved", "bouncy", undefined, "2026-10-30T00:00:00Z");
    const review = reviewJson(sheet);
    // Wick has only an ElevenLabs decision: as far as Gemini goes they are untouched, and nothing rejected leaks into the tally.
    expect(review.summary).toMatchObject({ approved: 1, untouched: 2 });
    expect(review.rejectedVoices).toEqual({});
    const wick = review.speakers.find((e) => e.id === "wick")!;
    expect(wick.history).toEqual([]);
    expect(wick.elevenlabs).toMatchObject({ voiceId: VOICE_A, name: "Rachel", approved: true, history: [{ decision: "approved", provider: "elevenlabs", voice: VOICE_A }] });
    expect(review.speakers.find((e) => e.id === "bun")!.elevenlabs).toBeUndefined();
    expect(reviewMarkdown(sheet)).not.toContain(VOICE_A);
  });

  it("lets only Gemini's own rejection notes steer Gemini's next voice", () => {
    const chapters: ChapterLike[] = [{ id: "c", voiceGuide: { npcVoices: { miller: "a miller; he grumbles", baker: "a baker; she hums" } } }];
    const make = (history: NonNullable<CastSheet["speakers"][string]["history"]>): CastSheet => {
      const sheet = buildSheet({ chapters, individuals: [], narration: [] }, null);
      sheet.speakers.miller!.history = history;
      return sheet;
    };
    const note = "too deep, should be a woman's voice";
    const base = nextVoice(make([]).speakers, "miller");
    // The same words about an ElevenLabs voice change nothing here.
    const elevenOnly = make([{ decision: "rejected", provider: "elevenlabs", voice: "VOICEAAAAAAA", notes: note, at: "2026-10-30T00:00:00Z" }]);
    expect(nextVoice(elevenOnly.speakers, "miller")).toBe(base);
    // About a Gemini voice they do steer it: this is what the line above is not allowed to do.
    const geminiToo = make([{ decision: "rejected", voice: "Charon", notes: note, at: "2026-10-30T00:00:00Z" }]);
    expect(nextVoice(geminiToo.speakers, "miller")).not.toBe(base);
  });

  it("will not decide on a voice nobody has picked", () => {
    expect(() => decide(sheetOf(), "wick", "approved", undefined, undefined, undefined, "elevenlabs")).toThrow(/no ElevenLabs voice/);
  });

  it("keeps an ElevenLabs voice across a rebuild", () => {
    const chapters: ChapterLike[] = [{ id: "c", voiceGuide: { npcVoices: { a: "a baker; she hums" } } }];
    const first = buildSheet({ chapters, individuals: [], narration: [] }, null);
    first.speakers.a!.elevenlabs = { voiceId: VOICE_A, name: "Rachel", approved: true };
    first.speakers.narrator!.elevenlabs = { voiceId: VOICE_B };
    const again = buildSheet({ chapters, individuals: [], narration: [] }, first);
    expect(again.speakers.a!.elevenlabs).toEqual({ voiceId: VOICE_A, name: "Rachel", approved: true });
    expect(again.speakers.narrator!.elevenlabs).toEqual({ voiceId: VOICE_B });
  });

  it("hands the planner an ElevenLabs voice only to those who have one", () => {
    const sheet = sheetOf();
    sheet.speakers.wick!.elevenlabs = { voiceId: VOICE_A, name: "Rachel" };
    const cast = { speakers: {}, delivery: {}, beats: {} } as unknown as CastFile;
    const planner = sheetCast(sheet, cast);
    expect(planner.speakers.wick!.elevenlabs).toEqual({ voiceId: VOICE_A, name: "Rachel" });
    expect(planner.speakers.bun!.elevenlabs).toBeUndefined();
    expect(planner.speakers.bun!.gemini).toEqual({ voice: "Leda" });
  });

  it("reads which provider a request is about, Gemini unless it says otherwise", () => {
    expect(providerOf("elevenlabs")).toBe("elevenlabs");
    expect(providerOf("gemini")).toBe("gemini");
    expect(providerOf(undefined)).toBe("gemini");
    expect(providerOf("openai")).toBe("gemini");
  });
});

describe("the cast page's routes, in ElevenLabs mode", () => {
  const cast = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;
  const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "pricing.json"), "utf8")) as Pricing;
  const setup = () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cast-eleven-"));
    const sheetPath = path.join(outDir, "cast.json");
    fs.writeFileSync(sheetPath, JSON.stringify(sheetOf()));
    const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const fetch: Fetch = async (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]).buffer, text: async () => "" };
    };
    const budget = { spent: 0, cap: 5 };
    const handle = createCastRoutes({ ws: { outDir, cast, pricing, today: "2026-10-30" }, sheetPath, catalog, fetch, chapterCampaigns: { c: "x" } }, budget);
    const saved = (): CastSheet => JSON.parse(fs.readFileSync(sheetPath, "utf8")) as CastSheet;
    return { handle, sent, budget, saved, sheetPath };
  };
  const pick = { id: "wick", provider: "elevenlabs", elevenlabs: { voiceId: VOICE_A, name: "  Rachel " } };

  it("offers every provider's models, and what each mode starts on", () => {
    const { sheetPath } = setup();
    const data = castPageData({ ws: { outDir: "", cast, pricing, today: "x" }, sheetPath, catalog, fetch: async () => { throw new Error("no"); }, chapterCampaigns: {} });
    expect(data.models.map((m) => m.provider).sort()).toEqual(["elevenlabs", "elevenlabs", "gemini"]);
    expect(data.defaultModels).toEqual({ gemini: "gemini-3.8-flash-tts", elevenlabs: "eleven_v4" });
  });

  it("saves a picked voice beside the Gemini one, tidies its name, and refuses what is not a voice id", async () => {
    const { handle, saved } = setup();
    expect((await handle("/api/cast/save", pick, {}))!.status).toBe(200);
    expect(saved().speakers.wick).toMatchObject({ gemini: { voice: "Charon" }, elevenlabs: { voiceId: VOICE_A, name: "Rachel" } });
    expect((await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", elevenlabs: { voiceId: "../../etc" } }, {}))!.status).toBe(400);
    expect((await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", elevenlabs: "Rachel" }, {}))!.status).toBe(400);
    // Taking it back leaves the Gemini voice alone.
    expect((await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", elevenlabs: null }, {}))!.status).toBe(200);
    expect(saved().speakers.wick).toMatchObject({ gemini: { voice: "Charon" } });
    expect(saved().speakers.wick!.elevenlabs).toBeUndefined();
  });

  it("approves and reopens the ElevenLabs voice on its own, and a different voice starts unapproved", async () => {
    const { handle, saved } = setup();
    expect((await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", status: "approved" }, {}))!.status).toBe(400);
    await handle("/api/cast/save", pick, {});
    await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", status: "approved" }, {});
    expect(saved().speakers.wick).toMatchObject({ status: "provisional", elevenlabs: { approved: true } });
    // Picking the same voice again keeps its approval; another does not.
    await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", elevenlabs: { voiceId: VOICE_A, name: "Rachel" } }, {});
    expect(saved().speakers.wick!.elevenlabs!.approved).toBe(true);
    await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", elevenlabs: { voiceId: VOICE_B } }, {});
    expect(saved().speakers.wick!.elevenlabs).toEqual({ voiceId: VOICE_B });
    await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", status: "approved" }, {});
    await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", status: "provisional" }, {});
    expect(saved().speakers.wick!.elevenlabs).toEqual({ voiceId: VOICE_B });
  });

  it("records an ElevenLabs decision under the ElevenLabs model, and says so when there is no voice to judge", async () => {
    const { handle, saved } = setup();
    const none = await handle("/api/cast/decide", { id: "wick", provider: "elevenlabs", decision: "approved" }, {});
    expect(none!.status).toBe(400);
    expect((none!.body as { error: string }).error).toMatch(/no ElevenLabs voice/);
    await handle("/api/cast/save", pick, {});
    expect((await handle("/api/cast/decide", { id: "wick", provider: "elevenlabs", decision: "approved", notes: "warm", model: "eleven_v4" }, {}))!.status).toBe(200);
    expect(saved().speakers.wick!.history![0]).toMatchObject({ decision: "approved", provider: "elevenlabs", voice: VOICE_A, model: "eleven_v4" });
    // A Gemini model id is not an ElevenLabs one: it is left off rather than recorded.
    await handle("/api/cast/decide", { id: "wick", provider: "elevenlabs", decision: "approved", model: "gemini-3.8-flash-tts" }, {});
    expect(saved().speakers.wick!.history!.at(-1)!.model).toBeUndefined();
  });

  it("will not render for someone with no ElevenLabs voice, and spends nothing", async () => {
    const { handle, sent, budget } = setup();
    const reply = await handle("/api/cast/render", { id: "wick", line: 0, provider: "elevenlabs", model: "eleven_v4" }, { elevenlabs: "xi" });
    expect(reply!.status).toBe(400);
    expect((reply!.body as { error: string }).error).toBe("Old Wick has no ElevenLabs voice yet: pick one for them first.");
    expect(sent).toEqual([]);
    expect(budget.spent).toBe(0);
  });

  it("renders an audition on ElevenLabs in the picked voice, with the account's key, inside the cap", async () => {
    const { handle, sent, budget } = setup();
    await handle("/api/cast/save", pick, {});
    const reply = await handle("/api/cast/render", { id: "wick", line: 0, provider: "elevenlabs", model: "eleven_v4" }, { elevenlabs: "xi-secret" });
    expect(reply!.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain(`/text-to-speech/${VOICE_A}`);
    expect(sent[0]!.headers["xi-api-key"]).toBe("xi-secret");
    expect(sent[0]!.body).toMatchObject({ model_id: "eleven_v4" });
    expect(String(sent[0]!.body.text)).toContain("Mind the lamps.");
    expect(budget.spent).toBeGreaterThan(0);
  });

  it("falls back to ElevenLabs' own default for a model of the wrong provider, and never calls Gemini", async () => {
    const { handle, sent } = setup();
    await handle("/api/cast/save", pick, {});
    await handle("/api/cast/render", { id: "wick", line: 0, provider: "elevenlabs", model: "gemini-3.8-flash-tts" }, { elevenlabs: "xi" });
    expect(sent.map((s) => s.url).every((url) => url.startsWith("https://api.elevenlabs.io/"))).toBe(true);
    expect(sent[0]!.body).toMatchObject({ model_id: "eleven_v4" });
  });

  it("shows only those who have a voice as having anything to hear, and warns of clashes on this provider", async () => {
    const { handle } = setup();
    await handle("/api/cast/save", pick, {});
    await handle("/api/cast/save", { id: "bun", provider: "elevenlabs", elevenlabs: { voiceId: VOICE_A } }, {});
    const state = (await handle("/api/cast/state", { provider: "elevenlabs", model: "eleven_v4" }, {}))!.body as { cells: Record<string, unknown[]>; clashes: Record<string, { chapter: string; with: string[] }[]>; estimate: { requests: number } };
    expect(state.cells.narrator).toEqual([]);
    expect(state.cells.wick).toHaveLength(1);
    expect(state.clashes.wick).toEqual([{ chapter: "c", with: ["bun"] }]);
    // Gemini mode, by contrast, hears everyone and sees no clash.
    const gemini = (await handle("/api/cast/state", { model: "gemini-3.8-flash-tts" }, {}))!.body as { cells: Record<string, unknown[]>; clashes: Record<string, unknown[]> };
    expect(gemini.cells.narrator).toHaveLength(1);
    expect(gemini.clashes.wick).toEqual([]);
  });

  it("tells what ElevenLabs gets for a line: the voice and the words, with no description", () => {
    const sheet = sheetOf();
    sheet.speakers.wick!.elevenlabs = { voiceId: VOICE_A };
    const base = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;
    const told = toldFor(sheet, base, "wick", "eleven_v4", catalog, "Mind the lamps.", "elevenlabs");
    expect(told).toMatchObject({ model: "eleven_v4", voice: VOICE_A, told: "" });
    expect(told.text).toContain("Mind the lamps.");
    expect(toldFor(sheet, base, "bun", "eleven_v4", catalog, "Meh!", "elevenlabs")).toMatchObject({ voice: "", told: "", text: "Meh!" });
  });
});
