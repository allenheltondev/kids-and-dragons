/** The game's one door to a provider, with ElevenLabs behind it (no network: a fake fetch). */

import { describe, expect, it } from "vitest";
import { ELEVENLABS, type CastSheet } from "./desired";
import { makeSynthesizer, type DeliveryTables } from "./synth";

const TABLES: DeliveryTables = {
  delivery: { whisper: { style: "whispering", tag: "[whispers]" } },
  beats: { sigh: { eleven: "[sighs]", elevenClassic: "", gemini: "<sigh>", geminiPrompt: "[sighs]" } },
} as unknown as DeliveryTables;

const CAST: CastSheet = {
  accent: "General American",
  speakers: {
    narrator: { who: "A warm storyteller.", elevenlabs: { voiceId: "voice-narrator" } },
    pip: { who: "A young man.", elevenlabs: { voiceId: "voice-pip" }, accent: "British", direction: "eager, quick" },
    mute: { who: "Nobody has chosen a voice." },
  },
};

function harness() {
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const synth = makeSynthesizer({
    provider: ELEVENLABS,
    cast: CAST,
    tables: TABLES,
    keys: { elevenlabs: "sk-test" },
    fetch: (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
        text: () => Promise.resolve(""),
      });
    },
  });
  return { sent, synth };
}

describe("the ElevenLabs synthesizer", () => {
  it("speaks a line in its speaker's voice, with their accent and direction as tags, and hands back MP3", async () => {
    const { sent, synth } = harness();
    const said = await synth({ key: "k1", by: "pip", text: "Hello there." });
    expect(said.ext).toBe("mp3");
    expect([...said.audio]).toEqual([1, 2, 3]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain("/text-to-speech/voice-pip");
    expect(sent[0]!.headers["xi-api-key"]).toBe("sk-test");
    expect(sent[0]!.body.model_id).toBe("eleven_v4");
    expect(sent[0]!.body.text).toBe("[British accent] [eager, quick] Hello there.");
  });

  it("adds the line's own delivery after the character's tags", async () => {
    const { sent, synth } = harness();
    await synth({ key: "k2", by: "pip", text: "Shh.", delivery: "whisper" });
    expect(sent[0]!.body.text).toBe("[British accent] [eager, quick] [whispers] Shh.");
  });

  it("reads a narrator with no tags as the plain words", async () => {
    const { sent, synth } = harness();
    await synth({ key: "k3", by: "narrator", text: "The door is shut." });
    expect(sent[0]!.url).toContain("/text-to-speech/voice-narrator");
    expect(sent[0]!.body.text).toBe("The door is shut.");
  });

  it("refuses a speaker with no ElevenLabs voice rather than borrowing one", async () => {
    const { sent, synth } = harness();
    await expect(synth({ key: "k4", by: "mute", text: "Hello." })).rejects.toThrow(/no ElevenLabs voice/);
    expect(sent).toHaveLength(0);
  });

  it("refuses an unfilled token", async () => {
    const { synth } = harness();
    await expect(synth({ key: "k5", by: "narrator", text: "Go on, {party}." })).rejects.toThrow(/unfilled token/);
  });
});
