/**
 * Character profiles (docs/voice-cast.md): a character's picture and canon,
 * their gender and where it came from, edits to the canon that change one
 * value and nothing else, and the profile page's routes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import type { CastFile, Fetch } from "../bakeoff/providers.ts";
import { CanonEditError, editIndividual, editVoiceNote } from "./canon-edit.ts";
import { imageOf, loadProfiles, looksFromBrief } from "./profile.ts";
import { castOrder, createCastRoutes, toldFor } from "./routes.ts";
import { GEMINI_VOICE_TRAITS, derivedGender, type CastSheet } from "./sheet.ts";
import { rebuildSheet } from "./sources.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const CANON = `schema_version: "2.0"
# A comment a parse-and-dump would lose.
individuals:
  - id: individual.pip
    title: "Pip"
    home: location.bramblewood
    people: npc.harvest_sprite
    role: hedge_keeper
    pronouns: "they/them"
    height_cm: 25
    short_description: >-
      A sprite the size of a teapot.
    speech_register: >-
      Earnest. Over-explains. Offers you things
      you did not ask for.
    canon_constraints: >-
      Never opens the hedge for strangers.

  - id: individual.nell
    title: "Nell"
    speech_register: >-
      Brisk and kind.

  - id: individual.marda
    title: "Marda"
    pronouns: "she/her"
    speech_register: >-
      Unhurried.
`;

/** A tiny repository: two chapters (one Gemfall), canon, an art manifest, the brief and a painting. */
function fakeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cast-profile-"));
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const scene = (narration: string, cast: { figure: string; name: string }[]) => ({ narration, cast, choices: [] });
  write(
    "content/chapters/a-01.json",
    `${JSON.stringify(
      {
        id: "a-01",
        campaignId: "a",
        scenes: {
          s1: scene('Pip waves. "Hello there, heroes," they say.', [{ figure: "cast/pip", name: "Pip" }]),
          s2: scene('"Mind the step," says Gruff. "It bites."', [{ figure: "entities/troll", name: "Gruff" }]),
          s3: scene('Nell waves you over. "Welcome in," she says.', [{ figure: "cast/nell", name: "Nell" }]),
        },
        voiceGuide: { npcVoices: { pip: "a bramble sprite the size of a teapot; earnest", gruff: "a bridge troll; deep and slow", wisp: "a shy wisp", nell: "a baker" } },
      },
      null,
      2,
    )}\n`,
  );
  // Hand-formatted on purpose: an edit must not reformat the file.
  write("content/chapters/gemfall-01.json", `{ "id": "gemfall-01", "campaignId": "gemfall",\n  "scenes": {},\n  "voiceGuide": { "npcVoices": {\n    "pip": "Pip again, visiting"\n  } } }\n`);
  fs.mkdirSync(path.join(root, "content", "campaigns"), { recursive: true });
  write("canon/individuals.yaml", CANON);
  write("assets/manifest.json", JSON.stringify({ castFigures: [{ id: "pip", name: "Pip", basis: "harvest_sprite", scale: "tiny", heightCm: 25, stance: "standing" }] }));
  write("assets/cast/pip/assembled.png", "png");
  write("assets/entities/troll/portrait.webp", "webp");
  write("docs/briefs/story-cast-art.md", "| id | name(s) in content | basis | scale | look |\n|---|---|---|---|---|\n| `pip` | Pip | harvest_sprite | tiny | a teapot-sized bramble sprite in a coat of hedge clippings |\n");
  return root;
}

describe("a character's gender", () => {
  it("comes from pronouns first, then the notes' words, and says where from", () => {
    expect(derivedGender({ name: "Pip", who: "", pronouns: "they/them" })).toEqual({ gender: "nonbinary", genderFrom: "canon" });
    expect(derivedGender({ name: "Marda", who: "", pronouns: "she/her" }, "narration")).toEqual({ gender: "female", genderFrom: "narration" });
    expect(derivedGender({ name: "Old Gran", who: "a grandmother who knits" })).toEqual({ gender: "female", genderFrom: "notes" });
    expect(derivedGender({ name: "Gruff", who: "a bridge troll" })).toEqual({ gender: "unknown", genderFrom: "none" });
  });

  it("is on every character the sheet builds, with their figure and where their voice notes live", () => {
    const root = fakeRepo();
    const sheet = rebuildSheet(root, path.join(root, "content", "voice", "cast.json"));
    expect(sheet.speakers.pip).toMatchObject({ gender: "nonbinary", genderFrom: "canon", figure: "cast/pip", canon: "individual.pip" });
    expect(sheet.speakers.pip!.voiceNotes).toEqual([{ chapter: "a-01", key: "pip" }, { chapter: "gemfall-01", key: "pip" }]);
    expect(sheet.speakers.gruff).toMatchObject({ figure: "entities/troll" });
  });

  it("set by a person, survives a rebuild and steers the voice", async () => {
    const root = fakeRepo();
    const sheetPath = path.join(root, "content", "voice", "cast.json");
    rebuildSheet(root, sheetPath);
    const { handle } = routes(root, sheetPath);
    const reply = await handle("/api/cast/save", { id: "gruff", gender: "female" }, {});
    const entry = (reply!.body as { entry: CastSheet["speakers"][string] }).entry;
    expect(entry).toMatchObject({ gender: "female", genderFrom: "person" });
    expect(GEMINI_VOICE_TRAITS[entry.gemini.voice]!.gender).toBe("f");
    const rebuilt = rebuildSheet(root, sheetPath);
    expect(rebuilt.speakers.gruff).toMatchObject({ gender: "female", genderFrom: "person", gemini: { voice: entry.gemini.voice } });
    // "auto" hands it back to the content.
    await handle("/api/cast/save", { id: "gruff", gender: "auto" }, {});
    expect(rebuildSheet(root, sheetPath).speakers.gruff).toMatchObject({ gender: "unknown", genderFrom: "none" });
    expect((await handle("/api/cast/save", { id: "gruff", gender: "robot" }, {}))!.status).toBe(400);
  });

  it("handed back to the content, credits the narration when that is where a canon individual's pronouns came from", async () => {
    const root = fakeRepo();
    const sheetPath = path.join(root, "content", "voice", "cast.json");
    const sheet = rebuildSheet(root, sheetPath);
    // In canon, but canon gives no pronouns: the narration's "she says" does.
    expect(sheet.speakers.nell).toMatchObject({ canon: "individual.nell", pronouns: "she/her", pronounsFrom: "narration", gender: "female", genderFrom: "narration" });
    const { handle } = routes(root, sheetPath);
    await handle("/api/cast/save", { id: "nell", gender: "male" }, {});
    const reply = await handle("/api/cast/save", { id: "nell", gender: "auto" }, {});
    expect((reply!.body as { entry: object }).entry).toMatchObject({ gender: "female", genderFrom: "narration" });
    // And canon's own pronouns are credited to canon.
    await handle("/api/cast/save", { id: "pip", gender: "female" }, {});
    const pip = await handle("/api/cast/save", { id: "pip", gender: "auto" }, {});
    expect((pip!.body as { entry: object }).entry).toMatchObject({ gender: "nonbinary", genderFrom: "canon" });
  });

  it("leaves an approved voice where it is when the gender changes", async () => {
    const root = fakeRepo();
    const sheetPath = path.join(root, "content", "voice", "cast.json");
    const sheet = rebuildSheet(root, sheetPath);
    const voice = sheet.speakers.gruff!.gemini.voice;
    const { handle } = routes(root, sheetPath);
    await handle("/api/cast/decide", { id: "gruff", decision: "approved" }, {});
    const reply = await handle("/api/cast/save", { id: "gruff", gender: GEMINI_VOICE_TRAITS[voice]!.gender === "f" ? "male" : "female" }, {});
    expect(reply!.body).not.toHaveProperty("moved");
    expect((reply!.body as { entry: { gemini: { voice: string } } }).entry.gemini.voice).toBe(voice);
  });
});

describe("a character's profile", () => {
  it("has their painting, their look from the art brief, and their canon", () => {
    const root = fakeRepo();
    const sheet = rebuildSheet(root, path.join(root, "content", "voice", "cast.json"));
    const profiles = loadProfiles(root, sheet);
    expect(profiles.pip).toMatchObject({
      image: "cast/pip/assembled.png",
      imageIsGeneric: false,
      facts: { basis: "harvest sprite", heightCm: 25, look: "a teapot-sized bramble sprite in a coat of hedge clippings" },
      canon: { id: "individual.pip", home: "bramblewood", role: "hedge keeper", people: "harvest sprite" },
    });
    expect(profiles.pip!.canon!.fields.speech_register).toBe("Earnest. Over-explains. Offers you things you did not ask for.");
    expect(profiles.pip!.voiceNotes.map((n) => [n.chapter, n.pinned])).toEqual([["a-01", false], ["gemfall-01", true]]);
    // Drawn as any troll: the painting is the people's, not theirs.
    expect(profiles.gruff).toMatchObject({ image: "entities/troll/portrait.webp", imageIsGeneric: true, facts: { basis: "troll" } });
    expect(profiles.wisp!.image).toBeNull();
  });

  it("serves only paintings", () => {
    const root = fakeRepo();
    expect(imageOf(root, "cast/pip")).toBe("cast/pip/assembled.png");
    expect(imageOf(root, "../secrets")).toBeNull();
    expect(imageOf(root, "cast/nobody")).toBeNull();
  });

  it("reads the art brief's look column", () => {
    expect(looksFromBrief(fs.readFileSync(path.join(ROOT, "docs", "briefs", "story-cast-art.md"), "utf8")).get("coralie_fenn")).toMatch(/barrel on wheels/);
  });

  it("walks the narrator, the party, then the most recurring characters first", () => {
    const root = fakeRepo();
    const order = castOrder(rebuildSheet(root, path.join(root, "content", "voice", "cast.json")));
    expect(order.slice(0, 3)).toEqual(["narrator", "party", "pip"]);
  });
});

describe("editing the canon", () => {
  it("changes one voice note and leaves every other byte of the chapter alone", () => {
    const root = fakeRepo();
    const file = path.join(root, "content", "chapters", "gemfall-01.json");
    const before = fs.readFileSync(file, "utf8");
    const result = editVoiceNote(root, file, "pip", "Pip again, visiting, and   humming");
    expect(result).toEqual({ file: path.join("content", "chapters", "gemfall-01.json"), before: "Pip again, visiting", after: "Pip again, visiting, and humming", pinned: true });
    expect(fs.readFileSync(file, "utf8")).toBe(before.replace('"Pip again, visiting"', '"Pip again, visiting, and humming"'));
    expect(() => editVoiceNote(root, file, "nobody", "x")).toThrow(CanonEditError);
    expect(() => editVoiceNote(root, file, "pip", "   ")).toThrow(CanonEditError);
  });

  it("rewrites one field of a canon individual, keeping comments and every other field", () => {
    const root = fakeRepo();
    const file = path.join(root, "canon", "individuals.yaml");
    editIndividual(root, file, "individual.pip", "speech_register", "Earnest. Over-explains everything twice, then offers you a honeycake you did not ask for and looks hurt if you say no.");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("# A comment a parse-and-dump would lose.");
    expect(text).toContain("    speech_register: >-\n      Earnest. Over-explains everything twice, then offers you a honeycake you\n      did not ask for and looks hurt if you say no.\n    canon_constraints:");
    const doc = yaml.load(text) as { individuals: Record<string, unknown>[] };
    expect(doc.individuals[0]).toMatchObject({ canon_constraints: "Never opens the hedge for strangers.", short_description: "A sprite the size of a teapot." });
    const marda = (d: typeof doc) => d.individuals.find((person) => person.id === "individual.marda");
    expect(marda(doc)).toMatchObject({ speech_register: "Unhurried." });
    // The last field of the last individual too.
    editIndividual(root, file, "individual.marda", "speech_register", "Unhurried, and never repeats herself.");
    expect(marda(yaml.load(fs.readFileSync(file, "utf8")) as typeof doc)!.speech_register).toBe("Unhurried, and never repeats herself.");
    editIndividual(root, file, "individual.marda", "pronouns", "they/them");
    expect(fs.readFileSync(file, "utf8")).toContain('    pronouns: "they/them"\n');
    expect(() => editIndividual(root, file, "individual.marda", "pronouns", "whoever")).toThrow(CanonEditError);
    expect(() => editIndividual(root, file, "individual.marda", "canon_status", "x")).toThrow(CanonEditError);
  });

  it("from the page: writes the file, rebuilds the sheet and keeps every decision", async () => {
    const root = fakeRepo();
    const sheetPath = path.join(root, "content", "voice", "cast.json");
    rebuildSheet(root, sheetPath);
    const { handle } = routes(root, sheetPath);
    await handle("/api/cast/decide", { id: "pip", decision: "approved", notes: "that's them" }, {});
    const reply = await handle("/api/cast/canon", { id: "pip", kind: "individual", field: "speech_register", text: "Earnest, and hums while working." }, {});
    expect(reply!.status).toBe(200);
    const body = reply!.body as { edit: { file: string }; entry: CastSheet["speakers"][string]; profile: { canon: { fields: Record<string, string> } } };
    expect(body.edit.file).toBe(path.join("canon", "individuals.yaml"));
    expect(body.entry.who).toContain("Earnest, and hums while working.");
    expect(body.entry).toMatchObject({ status: "approved", history: [{ decision: "approved", notes: "that's them" }] });
    expect(body.profile.canon.fields.speech_register).toBe("Earnest, and hums while working.");

    const note = await handle("/api/cast/canon", { id: "pip", kind: "voiceNote", chapter: "a-01", key: "pip", text: "a bramble sprite; earnest and hums" }, {});
    expect((note!.body as { entry: { who: string } }).entry.who).toContain("a bramble sprite; earnest and hums");
    // Nobody else's note, and nothing outside the character's own.
    expect((await handle("/api/cast/canon", { id: "pip", kind: "voiceNote", chapter: "a-01", key: "gruff", text: "x" }, {}))!.status).toBe(400);
    expect((await handle("/api/cast/canon", { id: "gruff", kind: "individual", field: "speech_register", text: "x" }, {}))!.status).toBe(400);
  });
});

describe("the profile page's routes", () => {
  it("says a typed line in the character's voice, and only looks until asked to render", async () => {
    const root = fakeRepo();
    const sheetPath = path.join(root, "content", "voice", "cast.json");
    rebuildSheet(root, sheetPath);
    const { handle, sent, budget } = routes(root, sheetPath);
    const look = await handle("/api/cast/say", { id: "pip", text: "Mind the thorns!" }, { gemini: "k" });
    expect(look!.status).toBe(200);
    expect(sent()).toBeNull();
    const said = await handle("/api/cast/say", { id: "pip", text: "Mind the thorns!", render: true }, { gemini: "k" });
    expect(said!.status).toBe(200);
    expect((sent() as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text).toBe("Mind the thorns!");
    expect(budget.spent).toBeGreaterThan(0);
    expect((await handle("/api/cast/say", { id: "pip", text: "x".repeat(401), render: true }, {}))!.status).toBe(400);
    expect((await handle("/api/cast/say", { id: "pip", text: "  " }, {}))!.status).toBe(400);
  });

  it("shows what the model is told: the style with the accent, or the 3.1 prompt", () => {
    const root = fakeRepo();
    const sheet = rebuildSheet(root, path.join(root, "content", "voice", "cast.json"));
    const told = toldFor(sheet, bakeoffCast(), "pip", "gemini-3.8-flash-tts", [], "Hello.");
    expect(told).toMatchObject({ model: "gemini-3.8-flash-tts", text: "Hello." });
    expect(told.told).toMatch(/^Pip: a bramble sprite.*Accent: General American/);
    expect(toldFor(sheet, bakeoffCast(), "pip", "gemini-3.1-flash-tts-preview", [], "Hello.").told).toContain("# AUDIO PROFILE");
  });
});

const bakeoffCast = (): CastFile => JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;

function routes(root: string, sheetPath: string) {
  const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "pricing.json"), "utf8")) as Pricing;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cast-clips-"));
  let sent: unknown = null;
  const fetch: Fetch = async (_url, init) => {
    sent = JSON.parse(init.body ?? "{}");
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.alloc(4800).toString("base64") } }] } }] });
    return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => body };
  };
  const budget = { spent: 0, cap: 5 };
  const handle = createCastRoutes({ ws: { outDir, cast: bakeoffCast(), pricing, today: "2026-10-27" }, sheetPath, catalog: [], fetch, chapterCampaigns: { "a-01": "a", "gemfall-01": "gemfall" }, root }, budget);
  return { handle, sent: () => sent, budget };
}
