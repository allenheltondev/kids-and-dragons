/**
 * The cast pages' shared voice mode (mode.ts). The script is what both pages embed, so it is run here as the
 * pages run it: defined once, called as plain functions.
 */

import { describe, expect, it } from "vitest";
import { MODE_CSS, MODE_HEADER_HTML, MODE_SCRIPT } from "./mode.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the script is plain JavaScript with no types of its own. */
const mode = new Function(`${MODE_SCRIPT}\nreturn KadMode;`)() as any;

const data = {
  models: [
    { provider: "gemini", model: "gemini-3.8-flash-tts", label: "Gemini 3.8" },
    { provider: "elevenlabs", model: "eleven_v4", label: "v4" },
    { provider: "elevenlabs", model: "eleven_v3", label: "v3" },
  ],
  defaultModels: { gemini: "gemini-3.8-flash-tts", elevenlabs: "eleven_v4" },
};
const geminiVoices = [
  { id: "Kore", about: "firm", gender: "f" },
  { id: "Puck", about: "upbeat", gender: "m" },
];
const elevenVoices = [
  { id: "VOICEAAAAAAA", name: "Rachel", about: "premade, calm" },
  { id: "VOICEBBBBBBB", name: "Adam", about: "premade, deep" },
];
const entry = (over: Record<string, unknown> = {}) => ({ name: "Wick", gemini: { voice: "Kore" }, status: "provisional", history: [], ...over });

describe("the cast pages' voice mode", () => {
  it("starts in Gemini mode, with each mode's own model", () => {
    const prefs = mode.normalize({}, data);
    expect(prefs).toEqual({ provider: "gemini", models: { gemini: "gemini-3.8-flash-tts", elevenlabs: "eleven_v4" } });
    expect(mode.model(prefs)).toBe("gemini-3.8-flash-tts");
    expect(mode.modelsFor({ provider: "elevenlabs" }, data).map((m: { model: string }) => m.model)).toEqual(["eleven_v4", "eleven_v3"]);
  });

  it("carries over the one model an older page remembered, and drops one the provider no longer offers", () => {
    expect(mode.normalize({ model: "gemini-3.8-flash-tts", provider: "elevenlabs", models: { elevenlabs: "eleven_gone" } }, data)).toEqual({
      provider: "elevenlabs",
      models: { gemini: "gemini-3.8-flash-tts", elevenlabs: "eleven_v4" },
    });
    expect(mode.normalize({ provider: "elevenlabs", models: { elevenlabs: "eleven_v3" } }, data).models.elevenlabs).toBe("eleven_v3");
    expect(mode.providerOf({ provider: "anything else" })).toBe("gemini");
  });

  it("reads a character's voice, name and approval in each mode on its own", () => {
    const wick = entry({ status: "approved", elevenlabs: { voiceId: "VOICEAAAAAAA", name: "Rachel" } });
    expect(mode.voiceId(wick, "gemini")).toBe("Kore");
    expect(mode.voiceId(wick, "elevenlabs")).toBe("VOICEAAAAAAA");
    expect(mode.voiceName(wick, "elevenlabs")).toBe("Rachel");
    expect(mode.approved(wick, "gemini")).toBe(true);
    expect(mode.approved(wick, "elevenlabs")).toBe(false);
    expect(mode.voiceId(entry(), "elevenlabs")).toBe("");
    expect(mode.voiceName(entry({ elevenlabs: { voiceId: "VOICEBBBBBBB" } }), "elevenlabs")).toBe("VOICEBBBBBBB");
  });

  it("keeps each mode's decisions apart, a decision with no provider being a Gemini one", () => {
    const wick = entry({
      history: [
        { decision: "rejected", voice: "Puck", notes: "too young", at: "2026-10-01T00:00:00Z" },
        { decision: "rejected", provider: "elevenlabs", voice: "VOICEBBBBBBB", voiceName: "Adam", notes: "too deep", at: "2026-10-02T00:00:00Z" },
      ],
    });
    expect(mode.history(wick, "gemini")).toHaveLength(1);
    expect(mode.history(wick, "elevenlabs")).toHaveLength(1);
    expect(mode.historyLine(wick.history[1])).toBe('Rejected Adam: "too deep" · 2026-10-02');
    expect(mode.historyLine(wick.history[0])).toBe('Rejected Puck: "too young" · 2026-10-01');
    expect(mode.lastRejected(wick, "elevenlabs")).toBe(true);
    expect(mode.untouched(wick, "elevenlabs")).toBe(false);
    expect(mode.untouched(entry(), "elevenlabs")).toBe(true);
    // Approved in one mode is not "rejected, try again" in it.
    expect(mode.lastRejected(entry({ status: "approved", history: wick.history }), "gemini")).toBe(false);
  });

  it("counts who shares a voice in a mode, and nobody for a voice not yet picked", () => {
    const speakers = {
      a: entry({ elevenlabs: { voiceId: "VOICEAAAAAAA" } }),
      b: entry({ elevenlabs: { voiceId: "VOICEAAAAAAA" } }),
      c: entry({ gemini: { voice: "Puck" } }),
    };
    expect(mode.uses(speakers, "elevenlabs")).toEqual({ VOICEAAAAAAA: 2 });
    expect(mode.uses(speakers, "gemini")).toEqual({ Kore: 2, Puck: 1 });
  });

  it("offers Gemini's voices, or the account's with a blank to start from", () => {
    expect(mode.voiceOptions("gemini", entry(), geminiVoices, []).map((o: { value: string }) => o.value)).toEqual(["Kore", "Puck"]);
    expect(mode.voiceOptions("gemini", entry(), geminiVoices, [])[0].label).toBe("Kore · firm · woman");
    const options = mode.voiceOptions("elevenlabs", entry(), geminiVoices, elevenVoices);
    expect(options.map((o: { value: string }) => o.value)).toEqual(["", "VOICEAAAAAAA", "VOICEBBBBBBB"]);
    expect(options[1].label).toBe("Rachel · premade, calm");
  });

  it("leaves out an ElevenLabs voice they were rejected in, and still shows one that has left the account", () => {
    const turnedDown = entry({ history: [{ decision: "rejected", provider: "elevenlabs", voice: "VOICEBBBBBBB", at: "2026-10-02T00:00:00Z" }] });
    expect(mode.voiceOptions("elevenlabs", turnedDown, geminiVoices, elevenVoices).map((o: { value: string }) => o.value)).toEqual(["", "VOICEAAAAAAA"]);
    const gone = entry({ elevenlabs: { voiceId: "VOICEZZZZZZZ", name: "Old friend" } });
    const options = mode.voiceOptions("elevenlabs", gone, geminiVoices, elevenVoices);
    expect(options[1]).toEqual({ value: "VOICEZZZZZZZ", label: "Old friend (not on this account)" });
    expect(options).toHaveLength(4);
  });

  it("builds the request that saves a pick in each mode, with a blank taking it back", () => {
    expect(mode.pickBody("gemini", "wick", "Puck", [])).toEqual({ id: "wick", provider: "gemini", voice: "Puck" });
    expect(mode.pickBody("elevenlabs", "wick", "VOICEAAAAAAA", elevenVoices)).toEqual({ id: "wick", provider: "elevenlabs", elevenlabs: { voiceId: "VOICEAAAAAAA", name: "Rachel" } });
    expect(mode.pickBody("elevenlabs", "wick", "", elevenVoices)).toEqual({ id: "wick", provider: "elevenlabs", elevenlabs: null });
  });

  it("sends both keys, and labels the key box for the mode", () => {
    expect(mode.keyHeaders({ gemini: "g", elevenlabs: "e" })).toEqual({ "x-gemini-key": "g", "x-elevenlabs-key": "e" });
    expect(mode.keyHeaders({})).toEqual({ "x-gemini-key": "", "x-elevenlabs-key": "" });
    expect(mode.keyLabel({ provider: "elevenlabs" })).toBe("ElevenLabs API key");
    expect(mode.keyLabel({})).toBe("Gemini API key");
  });

  it("gives both pages a switch to put in their header, and the styles for it", () => {
    for (const id of ["modeGemini", "modeEleven", "model", "key", "modeNote"]) expect(MODE_HEADER_HTML).toContain(`id="${id}"`);
    expect(MODE_CSS).toContain(".mode");
    // Embedded in a page's script, so it must not close it.
    expect(MODE_SCRIPT).not.toMatch(/<\/script/i);
  });
});
