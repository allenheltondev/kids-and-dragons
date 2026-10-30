/**
 * Designing a new ElevenLabs voice for a character (design.ts, the /api/cast/design routes, voiceDesigner in mode.ts):
 * the brief worked out from the sheet, the cap that holds the previews, and the save that changes the account.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import { DESIGN_LIMITS, createDesignedVoice, designVoice, type CastFile, type Fetch } from "../bakeoff/providers.ts";
import { designBrief, designDescription, designProblem, designText } from "./design.ts";
import { createCastRoutes, STAND_IN } from "./routes.ts";
import type { CastEntry, CastSheet } from "./sheet.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const entry = (over: Partial<CastEntry> = {}): CastEntry => ({
  name: "Old Wick",
  kind: "character",
  who: "Old Wick, a stone troll ferryman; gruff and dry, kind underneath",
  chapters: ["c1"],
  aliases: [],
  gemini: { voice: "Charon" },
  lines: [],
  speaks: true,
  status: "provisional",
  ...over,
});
const sheetOf = (wick = entry()): CastSheet => ({ accent: "General American, the way a warm American storyteller reads aloud", speakers: { wick } });

describe("what a designed voice is asked for", () => {
  it("describes the character as the sheet knows them: a man's or a woman's voice, who they are, the direction and the accent", () => {
    const text = designDescription(sheetOf(), entry({ gender: "male", direction: "a touch slower than usual", accent: "Scottish (Highland)" }));
    expect(text).toContain("A man's voice");
    expect(text).toContain("a stone troll ferryman");
    expect(text).toContain("a touch slower than usual.");
    expect(text).toContain("Accent: Scottish (Highland).");
    expect(designDescription(sheetOf(), entry({ pronouns: "she/her" }))).toContain("A woman's voice");
    expect(designDescription(sheetOf(), entry())).toContain("A voice for a character");
  });

  it("uses the sheet's own accent when they have none, and keeps a character's name out of it", () => {
    const text = designDescription(sheetOf(), entry());
    expect(text).toContain("Accent: General American.");
    // A name the model might take for a real person is a way to get a voice that sounds like one.
    expect(text).not.toMatch(/\bWick\b/);
    expect(text).toMatch(/without ever being scary/);
  });

  it("stays inside what ElevenLabs takes, however long the notes run", () => {
    const long = entry({ who: `A very long set of notes. ${"Gruff and slow and full of weather. ".repeat(60)}` });
    const text = designDescription(sheetOf(long), long);
    expect(text.length).toBeLessThanOrEqual(DESIGN_LIMITS.description.max);
    expect(text).toContain("Accent: General American.");
    expect(text.length).toBeGreaterThanOrEqual(DESIGN_LIMITS.description.min);
  });

  it("makes the sample text out of their own lines, topped up with the stand-in line when they have too few", () => {
    const lines = [{ text: "Mind the weir, it bites at the knees.", address: "c1/a" }, { text: "Nobody crosses twice for free, young one.", address: "c1/b" }, { text: "Hold the rope and do not look down at the water.", address: "c1/c" }];
    const own = designText(entry({ lines }), STAND_IN);
    expect(own).toBe(lines.map((l) => l.text).join(" "));
    expect(own.length).toBeGreaterThanOrEqual(DESIGN_LIMITS.text.min);
    const few = designText(entry({ lines: [lines[0]!] }), STAND_IN);
    expect(few.startsWith(lines[0]!.text)).toBe(true);
    expect(few).toContain("I'm Old Wick");
    expect(few.length).toBeGreaterThanOrEqual(DESIGN_LIMITS.text.min);
    const none = designText(entry(), STAND_IN);
    expect(none.length).toBeGreaterThanOrEqual(DESIGN_LIMITS.text.min);
    expect(none.length).toBeLessThanOrEqual(DESIGN_LIMITS.text.max);
  });

  it("checks both against ElevenLabs' limits", () => {
    const brief = designBrief(sheetOf(), entry(), STAND_IN);
    expect(designProblem(brief.description, brief.text)).toBeNull();
    expect(designProblem("short", brief.text)).toMatch(/description must be 20 to 1000/);
    expect(designProblem(brief.description, "short")).toMatch(/sample text must be 100 to 1000/);
  });
});

describe("the ElevenLabs calls", () => {
  const reply = (body: unknown, status = 200): Awaited<ReturnType<Fetch>> => ({ ok: status < 400, status, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => JSON.stringify(body) });

  it("designs a voice into playable previews, and sends nothing but the description and the words", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return reply({ previews: [{ generated_voice_id: "GEN1", audio_base_64: "AAAA", media_type: "audio/mpeg", duration_secs: 4.2 }, { generated_voice_id: "GEN2", audio_base_64: "BBBB" }] });
    };
    const previews = await designVoice({ elevenlabs: "k" }, { description: "d".repeat(30), text: "t".repeat(120) }, fetch);
    expect(previews).toEqual([
      { generatedVoiceId: "GEN1", audio: "data:audio/mpeg;base64,AAAA", seconds: 4.2 },
      { generatedVoiceId: "GEN2", audio: "data:audio/mpeg;base64,BBBB" },
    ]);
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-voice/design");
    expect(calls[0]!.body).toEqual({ voice_description: "d".repeat(30), text: "t".repeat(120), auto_generate_text: false });
  });

  it("saves a preview to the account and returns the id it was given", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return reply({ voice_id: "NEWVOICE1234" });
    };
    expect(await createDesignedVoice({ elevenlabs: "k" }, { generatedVoiceId: "GEN1", name: "Wick", description: "gruff" }, fetch)).toBe("NEWVOICE1234");
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-voice");
    expect(calls[0]!.body).toEqual({ voice_name: "Wick", voice_description: "gruff", generated_voice_id: "GEN1" });
    await expect(createDesignedVoice({ elevenlabs: "k" }, { generatedVoiceId: "GEN1", name: "W", description: "d" }, async () => reply({}))).rejects.toThrow(/did not say its id/);
  });
});

describe("the design routes", () => {
  const cast = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;
  const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "pricing.json"), "utf8")) as Pricing;
  const catalog = [{ provider: "elevenlabs" as const, model: "eleven_v4", label: "v4", tags: true }];
  const setup = (cap = 5, fail = false) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cast-design-"));
    const sheetPath = path.join(outDir, "cast.json");
    fs.writeFileSync(sheetPath, JSON.stringify(sheetOf()));
    const urls: string[] = [];
    const fetch: Fetch = async (url) => {
      urls.push(url);
      if (fail) return { ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => JSON.stringify({ detail: { message: "boom" } }) };
      return url.endsWith("/text-to-voice") ? { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => JSON.stringify({ voice_id: "NEWVOICE1234" }) } : { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => JSON.stringify({ previews: [{ generated_voice_id: "GEN1ABCDEF", audio_base_64: "AAAA" }] }) };
    };
    const budget = { spent: 0, cap };
    const handle = createCastRoutes({ ws: { outDir, cast, pricing, today: "2026-10-30" }, sheetPath, catalog, fetch, chapterCampaigns: {} }, budget);
    return { handle, budget, urls, saved: (): CastSheet => JSON.parse(fs.readFileSync(sheetPath, "utf8")) as CastSheet };
  };
  const brief = async (handle: ReturnType<typeof setup>["handle"]) => (await handle("/api/cast/design/brief", { id: "wick" }, {}))!.body as { description: string; text: string; dollars: number | null; previews: number };

  it("gives the brief and its price without spending or calling anyone", async () => {
    const { handle, budget, urls } = setup();
    const body = await brief(handle);
    expect(body.description).toContain("a stone troll ferryman");
    expect(body.previews).toBe(3);
    expect(body.dollars).toBeGreaterThan(0);
    expect(budget.spent).toBe(0);
    expect(urls).toEqual([]);
    expect((await handle("/api/cast/design/brief", { id: "nobody" }, {}))!.status).toBe(400);
  });

  it("previews inside the cap, charging for it, and refuses what is out of bounds or past the cap", async () => {
    const { handle, budget } = setup();
    const { description, text, dollars } = await brief(handle);
    const done = await handle("/api/cast/design/preview", { id: "wick", description, text }, { elevenlabs: "k" });
    expect(done!.status).toBe(200);
    expect(budget.spent).toBeCloseTo(dollars!, 6);
    expect(((done!.body as { previews: unknown[] }).previews)).toHaveLength(1);
    expect((await handle("/api/cast/design/preview", { id: "wick", description: "too short", text }, { elevenlabs: "k" }))!.status).toBe(400);

    const tight = setup(0);
    const refused = await tight.handle("/api/cast/design/preview", { id: "wick", description, text }, { elevenlabs: "k" });
    expect(refused!.status).toBe(402);
    expect(tight.urls).toEqual([]);
    expect(tight.budget.spent).toBe(0);
  });

  it("does not charge for a design that failed", async () => {
    const { handle, budget } = setup(5, true);
    const { description, text } = await brief(handle);
    const result = await handle("/api/cast/design/preview", { id: "wick", description, text }, { elevenlabs: "k" });
    expect(result!.status).toBe(502);
    expect(budget.spent).toBe(0);
  });

  it("saves the chosen voice to the account, gives it to the character as not yet approved, and needs a name", async () => {
    const { handle, saved, urls } = setup();
    // A voice they had, approved: a new one starts unapproved.
    await handle("/api/cast/save", { id: "wick", provider: "elevenlabs", elevenlabs: { voiceId: "OLDVOICE1234", name: "Rachel" } }, {});
    expect((await handle("/api/cast/design/save", { id: "wick", generatedVoiceId: "GEN1ABCDEF", name: "  ", description: "d" }, { elevenlabs: "k" }))!.status).toBe(400);
    expect((await handle("/api/cast/design/save", { id: "wick", generatedVoiceId: "../x", name: "Wick", description: "d" }, { elevenlabs: "k" }))!.status).toBe(400);
    expect(urls).toEqual([]);
    const done = await handle("/api/cast/design/save", { id: "wick", generatedVoiceId: "GEN1ABCDEF", name: " Wick  the ferryman ", description: "gruff" }, { elevenlabs: "k" });
    expect(done!.status).toBe(200);
    expect(saved().speakers.wick!.elevenlabs).toEqual({ voiceId: "NEWVOICE1234", name: "Wick the ferryman" });
    expect(saved().speakers.wick!.gemini).toEqual({ voice: "Charon" });
    expect((done!.body as { voice: { id: string } }).voice.id).toBe("NEWVOICE1234");
  });
});
