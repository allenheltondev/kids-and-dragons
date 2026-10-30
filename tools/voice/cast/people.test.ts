/**
 * Casting a whole people at once (people.ts): one character's voice for the rest of their kind, kept to the sheet's
 * rule that two speakers in a chapter never share a voice.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import type { CastFile, Fetch } from "../bakeoff/providers.ts";
import { peersOf, shareVoice } from "./people.ts";
import { createCastRoutes } from "./routes.ts";
import type { CastEntry, CastSheet } from "./sheet.ts";

const entry = (name: string, chapters: string[], voice: string, over: Partial<CastEntry> = {}): CastEntry => ({
  name,
  kind: "character",
  who: `${name}, a yeti`,
  chapters,
  aliases: [],
  gemini: { voice },
  lines: [],
  speaks: true,
  status: "provisional",
  lineCount: 0,
  ...over,
});

/** Three yetis and a faun. Herder and builder never meet; keeper meets the builder; the faun meets everyone. */
const sheetOf = (): CastSheet => ({
  accent: "General American",
  speakers: {
    narrator: entry("Narrator", [], "Sulafat", { kind: "narrator" }),
    herder: entry("Yeti herder", ["c1"], "Charon", { lineCount: 50 }),
    builder: entry("Yeti builder", ["c2"], "Kore", { lineCount: 5 }),
    keeper: entry("Yeti keeper", ["c2", "c3"], "Puck", { lineCount: 9 }),
    faun: entry("Pellam", ["c1", "c2", "c3"], "Leda", { lineCount: 60 }),
  },
});
const keys = { narrator: null, herder: "yeti", builder: "yeti", keeper: "yeti", faun: "faun" };

describe("the rest of someone's people", () => {
  it("is the others of their kind, most lines first, never the narrator or the party", () => {
    const sheet = sheetOf();
    expect(peersOf(sheet, keys, "herder")).toEqual(["keeper", "builder"]);
    expect(peersOf(sheet, keys, "faun")).toEqual([]);
    expect(peersOf(sheet, { ...keys, narrator: "yeti" }, "herder")).toEqual(["keeper", "builder"]);
    expect(peersOf(sheet, keys, "narrator")).toEqual([]);
  });
});

describe("sharing a voice across a people", () => {
  it("gives it to those who never meet someone already on it, and says who was left, and why", () => {
    const sheet = sheetOf();
    // The keeper is first (more lines than the builder) and shares no chapter with the herder, so takes Charon; then
    // the builder meets the keeper in c2, who now has it.
    const result = shareVoice(sheet, "herder", ["keeper", "builder"], "gemini");
    expect(result.applied).toEqual(["keeper"]);
    expect(result.skipped).toEqual([{ id: "builder", why: "Yeti builder shares c2 with Yeti keeper, who has it" }]);
    expect(sheet.speakers.keeper!.gemini.voice).toBe("Charon");
    expect(sheet.speakers.builder!.gemini.voice).toBe("Kore");
    expect(sheet.speakers.herder!.gemini.voice).toBe("Charon");
  });

  it("never moves a voice somebody approved, and notes who already has it", () => {
    const sheet = sheetOf();
    sheet.speakers.keeper!.status = "approved";
    sheet.speakers.builder!.gemini = { voice: "Charon" };
    const result = shareVoice(sheet, "herder", ["keeper", "builder"], "gemini");
    expect(result.applied).toEqual([]);
    expect(result.already).toEqual(["builder"]);
    expect(result.skipped).toEqual([{ id: "keeper", why: "Yeti keeper has a voice you approved" }]);
    expect(sheet.speakers.keeper!.gemini.voice).toBe("Puck");
  });

  it("never replaces an ElevenLabs voice somebody picked, even before it is approved, though Gemini's builder-assigned ones may go", () => {
    const sheet = sheetOf();
    sheet.speakers.herder!.elevenlabs = { voiceId: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" };
    // Keeper picked Adam by ear and has not approved him yet. Nothing assigns an ElevenLabs voice, so this is a decision.
    sheet.speakers.keeper!.elevenlabs = { voiceId: "pNInz6obpgDQGcFmaJgB", name: "Adam" };
    const result = shareVoice(sheet, "herder", ["keeper", "builder"], "elevenlabs");
    expect(result.skipped).toEqual([{ id: "keeper", why: "Yeti keeper already has an ElevenLabs voice you picked (Adam)" }]);
    expect(sheet.speakers.keeper!.elevenlabs).toEqual({ voiceId: "pNInz6obpgDQGcFmaJgB", name: "Adam" });
    // The builder had none, and shares no chapter with the herder, so takes it.
    expect(result.applied).toEqual(["builder"]);
    // On Gemini the same unapproved keeper's Puck was only ever assigned, and is replaced (as the first test shows).
    expect(shareVoice(sheetOf(), "herder", ["keeper"], "gemini").applied).toEqual(["keeper"]);
  });

  it("names an ElevenLabs voice by its id when it has no name", () => {
    const sheet = sheetOf();
    sheet.speakers.herder!.elevenlabs = { voiceId: "21m00Tcm4TlvDq8ikWAM" };
    sheet.speakers.keeper!.elevenlabs = { voiceId: "pNInz6obpgDQGcFmaJgB" };
    expect(shareVoice(sheet, "herder", ["keeper"], "elevenlabs").skipped[0]!.why).toContain("(pNInz6obpgDQGcFmaJgB)");
  });

  it("will not put anyone on the narrator's voice, who is in every chapter", () => {
    const sheet = sheetOf();
    sheet.speakers.herder!.gemini = { voice: "Sulafat" };
    const result = shareVoice(sheet, "herder", ["keeper", "builder"], "gemini");
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((item) => item.id)).toEqual(["keeper", "builder"]);
    expect(result.skipped[0]!.why).toContain("Narrator");
  });

  it("copies an ElevenLabs voice with its name, unapproved, and leaves Gemini's alone", () => {
    const sheet = sheetOf();
    sheet.speakers.herder!.elevenlabs = { voiceId: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", approved: true };
    const result = shareVoice(sheet, "herder", ["keeper"], "elevenlabs");
    expect(result.applied).toEqual(["keeper"]);
    expect(sheet.speakers.keeper!.elevenlabs).toEqual({ voiceId: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" });
    expect(sheet.speakers.keeper!.gemini.voice).toBe("Puck");
    // Approved is a person's judgment of one voice for one character, so it does not travel.
    expect(sheet.speakers.keeper!.elevenlabs!.approved).toBeUndefined();
  });

  it("needs a voice to share", () => {
    const sheet = sheetOf();
    expect(() => shareVoice(sheet, "herder", ["keeper"], "elevenlabs")).toThrow(/no ElevenLabs voice to share/);
    expect(() => shareVoice(sheet, "nobody", [], "gemini")).toThrow(/nobody called nobody/);
  });
});

describe("the people route", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const cast = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;
  const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "pricing.json"), "utf8")) as Pricing;
  const setup = () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cast-people-"));
    const sheetPath = path.join(outDir, "cast.json");
    // The real sheet and canon, so who is a yeti and who is a griffin is the game's own answer.
    fs.copyFileSync(path.join(ROOT, "content", "voice", "cast.json"), sheetPath);
    const fetch: Fetch = async () => {
      throw new Error("no call");
    };
    const handle = createCastRoutes({ ws: { outDir, cast, pricing, today: "2026-10-30" }, sheetPath, catalog: [], fetch, chapterCampaigns: {}, root: ROOT }, { spent: 0, cap: 5 });
    return { handle, saved: (): CastSheet => JSON.parse(fs.readFileSync(sheetPath, "utf8")) as CastSheet };
  };
  type Plan = { applied: string[]; skipped: { id: string; why: string }[]; already: string[]; people: string; apply: boolean; entries?: Record<string, CastEntry> };

  it("says what would happen without changing anything, then does it when asked", async () => {
    const { handle, saved } = setup();
    const before = saved();
    const plan = (await handle("/api/cast/people", { id: "yeti_herder" }, {}))!.body as Plan;
    expect(plan).toMatchObject({ people: "yeti", apply: false });
    expect(plan.applied.length + plan.skipped.length + plan.already.length).toBeGreaterThan(3);
    expect(saved()).toEqual(before);

    const done = (await handle("/api/cast/people", { id: "yeti_herder", apply: true }, {}))!.body as Plan;
    expect(done.applied).toEqual(plan.applied);
    expect(Object.keys(done.entries!)).toEqual(plan.applied);
    const after = saved();
    const voice = after.speakers.yeti_herder!.gemini.voice;
    for (const id of plan.applied) expect(after.speakers[id]!.gemini.voice, id).toBe(voice);
    // Nobody who was left changed, and nobody in a chapter now shares a voice they did not before.
    for (const item of plan.skipped) expect(after.speakers[item.id]!.gemini.voice, item.id).toBe(before.speakers[item.id]!.gemini.voice);
  });

  it("refuses a character the sheet does not have, and one with no voice to share on that provider", async () => {
    const { handle } = setup();
    expect((await handle("/api/cast/people", { id: "nobody" }, {}))!.status).toBe(400);
    const none = await handle("/api/cast/people", { id: "yeti_herder", provider: "elevenlabs" }, {});
    expect(none!.status).toBe(400);
    expect((none!.body as { error: string }).error).toMatch(/no ElevenLabs voice to share/);
  });
});
