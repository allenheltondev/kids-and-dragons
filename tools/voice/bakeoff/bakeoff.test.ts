/**
 * The voice bake-off harness (docs/voice-bakeoff.md): the samples still match
 * the game, the requests are what each provider expects, nothing is sent
 * twice, and the budget is enforced before anything is sent.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import { runBakeoff, type BakeoffOptions } from "./bakeoff.ts";
import { pcmToWav, plan, send, type CastFile, type Engine, type Fetch, type Job } from "./providers.ts";
import { contentLines, fillSampleTokens, readSampleFile, resolveSamples, type Sample } from "./samples.ts";

const HERE = import.meta.dirname;
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(HERE, file), "utf8")) as T;
const cast = read<CastFile>("cast.json");
const engines = read<{ engines: Engine[] }>("engines.json").engines;
const pricing = read<Pricing>("../pricing.json");
const file = readSampleFile();
const lines = contentLines();
const { samples, problems } = resolveSamples(file, lines);
const byId = (id: string): Sample => samples.find((s) => s.id === id)!;
const engine = (id: string): Engine => engines.find((e) => e.id === id)!;
const jobs = (e: Engine, s: Sample, take = 1): Job[] => {
  const planned = plan(e, cast, s, take);
  if (!Array.isArray(planned)) throw new Error(planned.reason);
  return planned;
};

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
      for (const line of sample.lines) if (line.delivery) expect(cast.delivery[line.delivery], `${sample.id}: ${line.delivery}`).toBeDefined();
    }
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

describe("the requests", () => {
  const faun = byId("faun-whisper");

  it("ElevenLabs v3: one request per line, in the speaker's voice, with the delivery tag", () => {
    const planned = jobs(engine("elevenlabs-v3"), faun);
    expect(planned).toHaveLength(faun.lines.length);
    const whisper = planned[1]!;
    expect(whisper.request.url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${cast.speakers.faun!.elevenlabs!.voiceId}?output_format=mp3_44100_128`);
    expect(whisper.request.body).toMatchObject({ text: "[whispers] \"Wagons,\"", model_id: "eleven_v3", seed: 1201 });
    expect(whisper.chars).toBe("[whispers] \"Wagons,\"".length);
  });

  it("a second take is a fresh roll, cached separately", () => {
    const [one] = jobs(engine("elevenlabs-v3"), faun, 1);
    const [two] = jobs(engine("elevenlabs-v3"), faun, 2);
    expect((two!.request.body as { seed: number }).seed).toBe(1202);
    expect(two!.key).not.toBe(one!.key);
  });

  it("ElevenLabs v2 sends the neighboring lines as context and no tags", () => {
    const [, second] = jobs(engine("elevenlabs-v2"), faun);
    const body = second!.request.body as Record<string, string>;
    expect(body.text).toBe("\"Wagons,\"");
    expect(body.previous_text).toBe(faun.lines[0]!.text);
    expect(body.next_text?.startsWith("she whispers.")).toBe(true);
  });

  it("Gemini: the prebuilt voice, and a prompt carrying the character and the delivery", () => {
    const [, whisper] = jobs(engine("gemini-3.8-flash"), faun);
    expect(whisper!.request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent");
    const body = whisper!.request.body as { contents: { parts: { text: string }[] }[]; generationConfig: { responseModalities: string[]; speechConfig: unknown } };
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig).toEqual({ voiceConfig: { prebuiltVoiceConfig: { voiceName: "Achernar" } } });
    const prompt = body.contents[0]!.parts[0]!.text;
    expect(prompt).toContain(cast.speakers.faun!.describe);
    expect(prompt).toContain("Whisper");
    expect(prompt.endsWith("\"Wagons,\"")).toBe(true);
  });

  it("Gemini's two-speaker mode takes a two-voice sample whole, and says why it cannot take more", () => {
    const [whole] = jobs(engine("gemini-3.8-flash-dialogue"), faun);
    const config = (whole!.request.body as { generationConfig: { speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: { speaker: string }[] } } } })
      .generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
    expect(config.map((c) => c.speaker)).toEqual(["Narrator", "Faun"]);
    const refused = plan(engine("gemini-3.8-flash-dialogue"), cast, byId("rumor-fire"), 1);
    expect(Array.isArray(refused)).toBe(false);
    expect((refused as { reason: string }).reason).toMatch(/takes two voices/);
  });

  it("ElevenLabs dialogue sends every line with its own voice in one request", () => {
    const [whole] = jobs(engine("elevenlabs-v3-dialogue"), byId("rumor-fire"));
    const inputs = (whole!.request.body as { inputs: { voice_id: string }[] }).inputs;
    expect(inputs).toHaveLength(byId("rumor-fire").lines.length);
    expect(whole!.request.url).toContain("/text-to-dialogue");
  });

  it("never puts an API key in a request it plans", () => {
    for (const e of engines) for (const s of samples) for (const job of Array.isArray(plan(e, cast, s, 1)) ? (plan(e, cast, s, 1) as Job[]) : []) {
      expect(JSON.stringify(job.request)).not.toMatch(/xi-api-key|x-goog-api-key/);
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

describe("sending", () => {
  it("adds the key only when sending, and keeps ElevenLabs' mp3", async () => {
    const [job] = jobs(engine("elevenlabs-v3"), byId("hedge-wall"));
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
    const [job] = jobs(engine("gemini-3.8-flash"), byId("hedge-wall"));
    const pcm = Buffer.alloc(480);
    const fetch: Fetch = async () =>
      response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }] }));
    const audio = await send(job!, { gemini: "secret" }, fetch);
    expect(audio.ext).toBe("wav");
    expect(audio.bytes.equals(pcmToWav(pcm, 24000))).toBe(true);
  });

  it("fails with the provider's own words", async () => {
    const [job] = jobs(engine("gemini-3.8-flash"), byId("hedge-wall"));
    const fetch: Fetch = async () => response("model not found", 404);
    await expect(send(job!, { gemini: "secret" }, fetch)).rejects.toThrow("HTTP 404: model not found");
    await expect(send(job!, {}, fetch)).rejects.toThrow("No API key for gemini");
  });
});

describe("a run", () => {
  const base = (outDir: string, overrides: Partial<BakeoffOptions> = {}): BakeoffOptions => ({
    outDir,
    engines,
    selected: ["fake"],
    samples: [byId("hedge-wall"), byId("pib-intro")],
    tiers: file.tiers,
    cast,
    pricing,
    takes: 1,
    maxDollars: 5,
    dryRun: false,
    concurrency: 2,
    keys: {},
    fetch: async () => {
      throw new Error("no network in tests");
    },
    today: "2026-10-27",
    log: () => undefined,
    ...overrides,
  });

  it("renders, writes the page, and renders nothing twice", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-"));
    const first = await runBakeoff(base(out));
    expect(first).toMatchObject({ rendered: 5, cached: 0, failed: 0 });
    const results = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
    expect(results.cells.fake["pib-intro"].takes[0].clips.map((c: { lines: number[] }) => c.lines)).toEqual([[0], [1], [2], [3]]);
    expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toContain("Voice bake-off");
    const again = await runBakeoff(base(out));
    expect(again).toMatchObject({ rendered: 0, cached: 5 });
  });

  it("refuses to start over the cap, before sending anything", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-"));
    let calls = 0;
    const outcome = await runBakeoff(
      base(out, {
        selected: ["elevenlabs-v3"],
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

  it("records a failure in its cell instead of stopping the run", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-"));
    const outcome = await runBakeoff(
      base(out, { selected: ["gemini-3.8-flash"], samples: [byId("hedge-wall")], keys: { gemini: "k" }, fetch: async () => response("bad model id", 404) }),
    );
    expect(outcome).toMatchObject({ rendered: 0, failed: 1 });
    const results = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
    expect(results.cells["gemini-3.8-flash"]["hedge-wall"].takes[0].error).toBe("HTTP 404: bad model id");
  });
});
