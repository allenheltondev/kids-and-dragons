/**
 * The voice bake-off harness (docs/voice-bakeoff.md): the samples still match
 * the game, the requests are what each provider expects, nothing is sent
 * twice, the budget is enforced before anything is sent, and the live page's
 * server keeps keys and other sites out.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import { cellOf, estimate, runBakeoff, type BatchOptions, type Workspace } from "./bakeoff.ts";
import { engineOf, familyOf, listModels, listVoices, pcmToWav, plan, send, spoken, type CastFile, type EngineConfig, type Fetch, type Job, type ModelInfo } from "./providers.ts";
import { beatsIn, contentLines, fillSampleTokens, readSampleFile, resolveSamples, withoutBeats, type Sample } from "./samples.ts";
import { castWith, createBakeoffServer } from "./server.ts";

const HERE = import.meta.dirname;
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(HERE, file), "utf8")) as T;
const cast = read<CastFile>("cast.json");
const { models: catalog, presets } = read<{ models: ModelInfo[]; presets: EngineConfig[] }>("engines.json");
const pricing = read<Pricing>("../pricing.json");
const file = readSampleFile();
const lines = contentLines();
const { samples, problems } = resolveSamples(file, lines);
const byId = (id: string): Sample => samples.find((s) => s.id === id)!;
const column = (provider: EngineConfig["provider"], model: string, mode: EngineConfig["mode"] = "lines", delivery: EngineConfig["delivery"] = "tag", context = false) =>
  engineOf({ provider, model, mode, delivery, context }, catalog);
const jobs = (config: ReturnType<typeof column>, s: Sample, take = 1): Job[] => {
  const planned = plan(config, cast, s, take);
  if (!Array.isArray(planned)) throw new Error(planned.reason);
  return planned;
};
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-"));
const workspace = (outDir = tmp()): Workspace => ({ outDir, cast, pricing, today: "2026-10-27" });

describe("the samples", () => {
  it("still match the words in content/", () => {
    expect(problems).toEqual([]);
    expect(samples).toHaveLength(file.samples.length);
  });

  it("cover every tier, from one narrator to a long two-voice passage", () => {
    for (const tier of Object.keys(file.tiers)) expect(samples.some((s) => s.tier === tier), tier).toBe(true);
    expect(byId("hedge-wall").speakers).toEqual(["narrator"]);
    expect(byId("sheeple-ridge").speakers.length).toBeGreaterThanOrEqual(4);
  });

  it("are all cast, for every provider", () => {
    for (const sample of samples) {
      for (const by of sample.speakers) {
        expect(cast.speakers[by]?.elevenlabs?.voiceId, `${sample.id}: ${by}`).toBeTruthy();
        expect(cast.speakers[by]?.gemini?.voice, `${sample.id}: ${by}`).toBeTruthy();
      }
      for (const line of sample.lines) {
        if (line.delivery) expect(cast.delivery[line.delivery], `${sample.id}: ${line.delivery}`).toMatchObject({ tag: expect.any(String), style: expect.any(String) });
        for (const beat of beatsIn(line.text)) expect(cast.beats[beat], `${sample.id}: <${beat}>`).toBeDefined();
      }
    }
  });

  it("use beats, which never count against the words on screen", () => {
    const used = new Set(samples.flatMap((s) => s.lines.flatMap((line) => beatsIn(line.text))));
    expect([...used].sort()).toEqual(["breath", "chuckle", "gasp", "laugh", "long pause", "pause", "sigh"]);
    expect(withoutBeats("\"Help,\" <pause>")).toBe("\"Help,\"");
  });

  it("fill tokens the way the engine does", () => {
    expect(fillSampleTokens("for {party}", { party: 4 })).toBe("for all four of you");
    expect(fillSampleTokens("{facets} stones", { facets: 3 })).toBe("three stones");
    expect(byId("hessa-soup").lines[0]!.text).toContain("ladles a bowl for both of you,");
  });

  it("refuse a script that no longer joins to the authored words", () => {
    const edited = { ...file, samples: [{ ...file.samples.find((s) => s.id === "pib-intro")!, script: [{ by: "pib", text: "\"I'm Pib.\"" }] }] };
    const result = resolveSamples(edited, lines);
    expect(result.samples).toEqual([]);
    expect(result.problems[0]).toMatch(/pib-intro: the script no longer joins/);
  });
});

describe("the models and presets", () => {
  it("price every researched model that is not the fake", () => {
    for (const model of catalog.filter((m) => m.provider !== "fake")) {
      expect(pricing.models.some((p) => p.provider === model.provider && p.apiModel === model.model), model.model).toBe(true);
    }
  });

  it("only preset what a model can do", () => {
    for (const preset of presets) {
      const model = catalog.find((m) => m.provider === preset.provider && m.model === preset.model);
      expect(model, preset.model).toBeDefined();
      if (preset.mode === "dialogue") expect(model!.dialogue, preset.model).toBe(true);
      if (preset.delivery === "instruction") expect(model!.instruction, preset.model).toBe(true);
    }
  });

  it("knows which family writes expression which way", () => {
    expect(familyOf({ provider: "elevenlabs", model: "eleven_v4" })).toBe("eleven");
    expect(familyOf({ provider: "elevenlabs", model: "eleven_flash_v2_5" })).toBe("elevenClassic");
    expect(familyOf({ provider: "gemini", model: "gemini-3.8-flash-lite-tts" })).toBe("gemini");
    expect(familyOf({ provider: "gemini", model: "gemini-4.0-flash-tts" })).toBe("gemini");
    expect(familyOf({ provider: "gemini", model: "gemini-3.1-flash-tts-preview" })).toBe("geminiPrompt");
    expect(familyOf({ provider: "gemini", model: "gemini-2.5-flash-preview-tts" })).toBe("geminiPrompt");
  });

  it("names a column by everything that changes its sound", () => {
    const engine = column("elevenlabs", "eleven_multilingual_v2", "lines", "none", true);
    expect(engine.id).toBe("elevenlabs:eleven_multilingual_v2:lines:none:context");
    expect(engine.label).toBe("Multilingual v2, plain, context");
    expect(engine.settings).toMatchObject({ style: 0.2 });
    expect(column("elevenlabs", "eleven_v4").settings).toEqual({ stability: 0.5, similarity_boost: 0.75 });
  });
});

describe("the requests", () => {
  const faun = byId("faun-whisper");

  it("ElevenLabs v4: one request per line, in the speaker's voice, with the delivery tag", () => {
    const planned = jobs(column("elevenlabs", "eleven_v4"), faun);
    expect(planned).toHaveLength(faun.lines.length);
    const whisper = planned[1]!;
    expect(whisper.request.url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${cast.speakers.faun!.elevenlabs!.voiceId}?output_format=mp3_44100_128`);
    expect(whisper.request.body).toMatchObject({ text: "[whispers] \"Wagons,\"", model_id: "eleven_v4", seed: 1201 });
    expect(whisper.chars).toBe("[whispers] \"Wagons,\"".length);
  });

  it("a second take is a fresh roll, cached separately", () => {
    const [one] = jobs(column("elevenlabs", "eleven_v4"), faun, 1);
    const [two] = jobs(column("elevenlabs", "eleven_v4"), faun, 2);
    expect((two!.request.body as { seed: number }).seed).toBe(1202);
    expect(two!.key).not.toBe(one!.key);
  });

  it("ElevenLabs v2 sends the neighboring lines as context, and pauses as SSML breaks", () => {
    const [, second] = jobs(column("elevenlabs", "eleven_multilingual_v2", "lines", "tag", true), faun);
    const body = second!.request.body as Record<string, string>;
    expect(body.text).toBe("\"Wagons,\"");
    expect(body.previous_text).toBe(faun.lines[0]!.text);
    expect(body.next_text?.startsWith("she whispers.")).toBe(true);
    expect(body.next_text).not.toContain("<chuckle>");
    const [pause] = jobs(column("elevenlabs", "eleven_multilingual_v2", "lines", "tag"), byId("closer-look"));
    expect((pause!.request.body as { text: string }).text).toBe("You lean in for a closer look, <break time=\"1.4s\" /> and the closer look opens its mouth.");
  });

  it("writes each beat the way each family takes it, or leaves it out", () => {
    const keeper = byId("seal-keeper");
    const line = keeper.lines[4]!; // <breath> "Everyone who climbs…", grave
    expect(line.text.startsWith("<breath>")).toBe(true);
    expect(spoken(column("elevenlabs", "eleven_v4"), cast, line)).toBe("[slowly] [inhales] \"Everyone who climbs my mountain brings me stones,\"");
    expect(spoken(column("elevenlabs", "eleven_flash_v2_5"), cast, line)).toBe("\"Everyone who climbs my mountain brings me stones,\"");
    expect(spoken(column("gemini", "gemini-3.8-flash-tts"), cast, line)).toBe("<breath> \"Everyone who climbs my mountain brings me stones,\"");
    // Gemini 3.1: never two tags side by side, so the delivery and the beat become one direction.
    expect(spoken(column("gemini", "gemini-3.1-flash-tts-preview"), cast, line)).toBe("[slowly, then breath] \"Everyone who climbs my mountain brings me stones,\"");
    expect(spoken(column("elevenlabs", "eleven_v4", "lines", "none"), cast, line)).toBe("\"Everyone who climbs my mountain brings me stones,\"");
  });

  it("Gemini 3.8: only the words and vocal tags in the text; the character and delivery in speechMetadata.style", () => {
    const [, whisper] = jobs(column("gemini", "gemini-3.8-flash-tts"), faun);
    expect(whisper!.request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent");
    const body = whisper!.request.body as { contents: { parts: { text: string; speechMetadata?: { style: string } }[] }[]; generationConfig: { responseModalities: string[]; speechConfig: unknown } };
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig).toEqual({ voiceConfig: { prebuiltVoiceConfig: { voiceName: "Achernar" } } });
    const part = body.contents[0]!.parts[0]!;
    // 3.8 speaks every word it is sent: no brackets, no preamble.
    expect(part.text).toBe("\"Wagons,\"");
    expect(part.speechMetadata!.style).toContain(cast.speakers.faun!.describe);
    expect(part.speechMetadata!.style).toContain("whispering, but clearly");
    const [, , , , , chuckle] = jobs(column("gemini", "gemini-3.8-flash-tts"), faun);
    expect((chuckle!.request.body as typeof body).contents[0]!.parts[0]!.text).toContain("though. <chuckle> It only");
    const [plain] = jobs(column("gemini", "gemini-3.8-flash-tts", "lines", "none"), faun);
    expect((plain!.request.body as typeof body).contents[0]!.parts[0]!.speechMetadata).toBeUndefined();
  });

  it("Gemini 3.1: the documented prompt, with tags in the transcript or the delivery in director's notes", () => {
    const [, tagged] = jobs(column("gemini", "gemini-3.1-flash-tts-preview"), faun);
    const tagPrompt = (tagged!.request.body as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text;
    expect(tagPrompt).toMatch(/^Synthesize speech for the transcript below\./);
    expect(tagPrompt).toContain("# AUDIO PROFILE: Faun\n" + cast.speakers.faun!.describe);
    expect(tagPrompt).toContain("## THE SCENE");
    expect(tagPrompt.endsWith("## TRANSCRIPT\n[whispers] \"Wagons,\"")).toBe(true);

    const [, noted] = jobs(column("gemini", "gemini-3.1-flash-tts-preview", "lines", "instruction"), faun);
    const notePrompt = (noted!.request.body as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text;
    expect(notePrompt).toContain("- Faun, line 1: whispering, but clearly");
    expect(notePrompt.endsWith("## TRANSCRIPT\n\"Wagons,\"")).toBe(true);
  });

  it("refuses director's notes on Gemini 3.8, which would read them aloud", () => {
    const refused = plan(column("gemini", "gemini-3.8-flash-tts", "lines", "instruction"), cast, faun, 1);
    expect((refused as { reason: string }).reason).toMatch(/would read them aloud/);
  });

  it("Gemini's two-speaker mode takes a two-voice sample whole, and says why it cannot take more", () => {
    const [whole] = jobs(column("gemini", "gemini-3.8-flash-tts", "dialogue"), faun);
    const body = whole!.request.body as {
      contents: { parts: { text: string; speechMetadata: { speaker: string; style?: string } }[] }[];
      generationConfig: { speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: { speaker: string }[] } } };
    };
    expect(body.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.map((c) => c.speaker)).toEqual(["Narrator", "Faun"]);
    // One part per turn, each naming its speaker and carrying its own style.
    expect(body.contents[0]!.parts.map((p) => p.speechMetadata.speaker)).toEqual(["Narrator", "Faun", "Narrator", "Faun", "Narrator", "Faun"]);
    expect(body.contents[0]!.parts[1]!.text).toBe("\"Wagons,\"");
    const refused = plan(column("gemini", "gemini-3.8-flash-tts", "dialogue"), cast, byId("rumor-fire"), 1);
    expect(Array.isArray(refused)).toBe(false);
    expect((refused as { reason: string }).reason).toMatch(/takes two voices/);
  });

  it("ElevenLabs dialogue sends every line with its own voice in one request", () => {
    const [whole] = jobs(column("elevenlabs", "eleven_v3", "dialogue"), byId("rumor-fire"));
    const inputs = (whole!.request.body as { inputs: { voice_id: string }[] }).inputs;
    expect(inputs).toHaveLength(byId("rumor-fire").lines.length);
    expect(whole!.request.url).toContain("/text-to-dialogue");
  });

  it("a recast voice is a different request", () => {
    const engine = column("gemini", "gemini-3.8-flash-tts");
    const [before] = jobs(engine, byId("hedge-wall"));
    const recast = castWith(cast, { narrator: { gemini: "Kore" } });
    const after = plan(engine, recast, byId("hedge-wall"), 1) as Job[];
    expect(after[0]!.key).not.toBe(before!.key);
    expect(castWith(cast, { nobody: { gemini: "Kore" } })).toEqual(cast);
  });

  it("never puts an API key in a request it plans", () => {
    for (const preset of presets) {
      for (const s of samples) {
        const planned = plan(engineOf(preset, catalog), cast, s, 1);
        if (Array.isArray(planned)) for (const job of planned) expect(JSON.stringify(job.request)).not.toMatch(/xi-api-key|x-goog-api-key/);
      }
    }
  });
});

function response(body: Buffer | string, status = 200): Awaited<ReturnType<Fetch>> {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  return {
    ok: status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
    text: async () => bytes.toString("utf8"),
  };
}

describe("talking to the providers", () => {
  it("adds the key only when sending, and keeps ElevenLabs' mp3", async () => {
    const [job] = jobs(column("elevenlabs", "eleven_v4"), byId("hedge-wall"));
    let headers: Record<string, string> = {};
    const fetch: Fetch = async (_url, init) => {
      headers = init.headers;
      return response(Buffer.from("ID3fake"));
    };
    const audio = await send(job!, { elevenlabs: "secret" }, fetch);
    expect(headers["xi-api-key"]).toBe("secret");
    expect(audio).toEqual({ bytes: Buffer.from("ID3fake"), ext: "mp3" });
  });

  it("wraps Gemini's PCM in a WAV at the rate it names", async () => {
    const [job] = jobs(column("gemini", "gemini-3.8-flash-tts"), byId("hedge-wall"));
    const pcm = Buffer.alloc(480);
    const fetch: Fetch = async () =>
      response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }] }));
    const audio = await send(job!, { gemini: "secret" }, fetch);
    expect(audio.ext).toBe("wav");
    expect(audio.bytes.equals(pcmToWav(pcm, 24000))).toBe(true);
  });

  it("fails with the provider's own words", async () => {
    const [job] = jobs(column("gemini", "gemini-3.8-flash-tts"), byId("hedge-wall"));
    const fetch: Fetch = async () => response("model not found", 404);
    await expect(send(job!, { gemini: "secret" }, fetch)).rejects.toThrow("HTTP 404: model not found");
    await expect(send(job!, {}, fetch)).rejects.toThrow("No API key for Gemini");
  });

  it("lists a key's speech models: ElevenLabs by capability, Gemini by name, across pages", async () => {
    const eleven: Fetch = async (url) => {
      expect(url).toBe("https://api.elevenlabs.io/v1/models");
      return response(JSON.stringify([
        { model_id: "eleven_v4", name: "Eleven v4", can_do_text_to_speech: true },
        { model_id: "eleven_english_sts_v2", name: "Speech to speech", can_do_text_to_speech: false },
      ]));
    };
    expect((await listModels("elevenlabs", { elevenlabs: "k" }, eleven)).map((m) => [m.model, m.tags])).toEqual([["eleven_v4", true]]);

    const pages = [
      { models: [{ name: "models/gemini-3.8-flash" }, { name: "models/gemini-3.8-flash-tts", displayName: "Gemini 3.8 Flash TTS" }], nextPageToken: "p2" },
      { models: [{ name: "models/gemini-3.8-flash-lite-tts" }] },
    ];
    let call = 0;
    const gemini: Fetch = async (url) => {
      expect(url).toContain(call === 0 ? "pageSize=1000" : "pageToken=p2");
      return response(JSON.stringify(pages[call++]));
    };
    expect((await listModels("gemini", { gemini: "k" }, gemini)).map((m) => m.model)).toEqual(["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);
  });

  it("lists an ElevenLabs account's voices, and Gemini's prebuilt ones without a call", async () => {
    const fetch: Fetch = async () => response(JSON.stringify({ voices: [{ voice_id: "v1", name: "Ada", category: "premade", labels: { age: "young" } }] }));
    expect(await listVoices("elevenlabs", { elevenlabs: "k" }, fetch)).toEqual([{ id: "v1", name: "Ada", about: "premade, young" }]);
    const gemini = await listVoices("gemini", {}, async () => { throw new Error("no call"); });
    expect(gemini.find((v) => v.id === "Sulafat")?.about).toBe("warm");
  });
});

describe("a command-line run", () => {
  const fake = column("fake", "tone");
  const base = (ws: Workspace, overrides: Partial<BatchOptions> = {}): BatchOptions => ({
    ws,
    engines: [fake],
    samples: [byId("hedge-wall"), byId("pib-intro")],
    tiers: file.tiers,
    takes: 1,
    maxDollars: 5,
    dryRun: false,
    concurrency: 2,
    keys: {},
    fetch: async () => {
      throw new Error("no network in tests");
    },
    log: () => undefined,
    ...overrides,
  });

  it("renders, writes the page, and renders nothing twice", async () => {
    const ws = workspace();
    expect(await runBakeoff(base(ws))).toMatchObject({ rendered: 5, cached: 0, failed: 0 });
    const results = JSON.parse(fs.readFileSync(path.join(ws.outDir, "results.json"), "utf8"));
    expect(results.cells[fake.id]["pib-intro"].takes[0].clips.map((c: { lines: number[] }) => c.lines)).toEqual([[0], [1], [2], [3]]);
    expect(fs.readFileSync(path.join(ws.outDir, "index.html"), "utf8")).toContain("Voice bake-off");
    expect(await runBakeoff(base(ws))).toMatchObject({ rendered: 0, cached: 5 });
  });

  it("refuses to start over the cap, before sending anything", async () => {
    let calls = 0;
    const outcome = await runBakeoff(
      base(workspace(), {
        engines: [column("elevenlabs", "eleven_v4")],
        keys: { elevenlabs: "secret" },
        maxDollars: 0.001,
        fetch: async () => {
          calls += 1;
          return response("");
        },
      }),
    );
    expect(outcome.refused).toMatch(/over the \$0\.00 cap/);
    expect(outcome.dollars).toBeGreaterThan(0);
    expect(calls).toBe(0);
  });

  it("refuses a column pricing.json has no price for, rather than counting it as free", async () => {
    let calls = 0;
    const outcome = await runBakeoff(
      base(workspace(), {
        engines: [column("elevenlabs", "eleven_v5_alpha")],
        keys: { elevenlabs: "secret" },
        maxDollars: 1000,
        fetch: async () => {
          calls += 1;
          return response("");
        },
      }),
    );
    expect(outcome.refused).toMatch(/No price in tools\/voice\/pricing\.json for elevenlabs:eleven_v5_alpha/);
    expect(calls).toBe(0);
  });

  it("records a failure in its cell instead of stopping the run", async () => {
    const ws = workspace();
    const engine = column("gemini", "gemini-3.8-flash-tts");
    const outcome = await runBakeoff(base(ws, { engines: [engine], samples: [byId("hedge-wall")], keys: { gemini: "k" }, fetch: async () => response("bad model id", 404) }));
    expect(outcome).toMatchObject({ rendered: 0, failed: 1 });
    expect(cellOf(engine, byId("hedge-wall"), 1, ws).takes![0]).toMatchObject({ pending: true, error: "HTTP 404: bad model id" });
  });
});

describe("the live page's server", () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => { for (const s of servers.splice(0)) s.close(); });

  async function start(fetch: Fetch, maxDollars = 5) {
    const ws = workspace();
    const { server, token } = createBakeoffServer({ ws, samples, tiers: file.tiers, catalog, presets, envKeys: {}, fetch, maxDollars, token: "t0k" });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    servers.push(server);
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
      globalThis.fetch(base + route, { method: "POST", headers: { "content-type": "application/json", "x-bakeoff-token": token, ...headers }, body: JSON.stringify(body) });
    return { ws, base, post };
  }

  it("serves the live page with its token, and refuses API calls without it", async () => {
    const { base, post } = await start(async () => response(""));
    const page = await (await globalThis.fetch(base + "/")).text();
    expect(page).toContain("\"token\":\"t0k\"");
    expect((await post("/api/columns", { engines: [] }, { "x-bakeoff-token": "wrong" })).status).toBe(403);
  });

  it("prices columns and renders a cell with the key the page sent, which never reaches disk", async () => {
    const seen: string[] = [];
    const fetch: Fetch = async (_url, init) => {
      seen.push(init.headers["xi-api-key"] ?? "");
      return response(Buffer.from("ID3audio"));
    };
    const { ws, base, post } = await start(fetch);
    const engine = { provider: "elevenlabs", model: "eleven_v4", mode: "lines", delivery: "tag" };
    const columns = (await (await post("/api/columns", { engines: [engine], takes: 1 })).json()) as { engines: { id: string }[]; estimates: { dollars: number }[] };
    expect(columns.engines[0]?.id).toBe("elevenlabs:eleven_v4:lines:tag");
    expect(columns.estimates[0]?.dollars).toBeGreaterThan(0);

    const rendered = (await (await post("/api/render", { engine, sample: "closer-look", takes: 1 }, { "x-elevenlabs-key": "pasted-key" })).json()) as { cell: { takes: { clips: { file: string }[] }[] }; spent: number };
    expect(seen).toEqual(["pasted-key"]);
    expect(rendered.cell.takes[0]?.clips).toHaveLength(1);
    expect(rendered.spent).toBeGreaterThan(0);
    const clip = await globalThis.fetch(base + "/" + rendered.cell.takes[0]!.clips[0]!.file);
    expect(clip.headers.get("content-type")).toBe("audio/mpeg");

    const written = fs.readdirSync(path.join(ws.outDir, "clips")).map((name) => fs.readFileSync(path.join(ws.outDir, "clips", name), "utf8")).join("");
    expect(written).not.toContain("pasted-key");
  });

  it("refuses a render past the session's cap, and a model id that is not one", async () => {
    let calls = 0;
    const { post } = await start(async () => { calls += 1; return response(Buffer.from("x")); }, 0);
    const engine = { provider: "elevenlabs", model: "eleven_v4", mode: "lines", delivery: "tag" };
    const refused = await post("/api/render", { engine, sample: "closer-look" }, { "x-elevenlabs-key": "k" });
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { error: string }).error).toMatch(/cap/);
    const bad = await post("/api/render", { engine: { ...engine, model: "../../v1/user" }, sample: "closer-look" }, { "x-elevenlabs-key": "k" });
    expect(bad.status).toBe(400);
    expect(calls).toBe(0);
  });

  it("never renders an unpriced live model as free: only at an approved rate, and still under the cap", async () => {
    let calls = 0;
    const { post } = await start(async () => { calls += 1; return response(Buffer.from("ID3audio")); }, 1);
    // A model the key lists live but pricing.json does not know.
    const engine = { provider: "elevenlabs", model: "eleven_v5_alpha", mode: "lines", delivery: "tag" };
    const keyed = { "x-elevenlabs-key": "k" };

    const refused = await post("/api/render", { engine, sample: "closer-look" }, keyed);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/no price for eleven_v5_alpha/);
    expect(calls).toBe(0);

    const tooDear = await post("/api/render", { engine, sample: "closer-look", approvedRate: 1000 }, keyed);
    expect(tooDear.status).toBe(402);
    expect(calls).toBe(0);

    const ok = await post("/api/render", { engine, sample: "closer-look", approvedRate: 0.2 }, keyed);
    expect(ok.status).toBe(200);
    const chars = byId("closer-look").lines[0]!.text.length;
    expect(((await ok.json()) as { spent: number }).spent).toBeCloseTo((chars / 1000) * 0.2);
    expect(calls).toBe(1);
  });

  it("estimates nothing left once a column is rendered", async () => {
    const { ws, post } = await start(async () => response(""));
    const engine = { provider: "fake", model: "tone", mode: "lines", delivery: "tag" };
    await post("/api/render", { engine, sample: "hedge-wall" });
    const fakeEngine = engineOf(engine as EngineConfig, catalog);
    expect(estimate(fakeEngine, [byId("hedge-wall")], 1, ws).requests).toBe(0);
  });
});
