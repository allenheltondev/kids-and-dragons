/**
 * The guarantees of docs/voice-narration-plan.md §4 ("The clip key"): what
 * changes a clip's key and, just as important, what does not.
 */

import { describe, expect, it } from "vitest";
import { clipKey, spokenForm } from "./clip-key";
import { desiredClips, type CastSheet } from "./desired";
import { classify } from "./lines";
import { clipStatus, countByState, toRender, type Lock, type Manifest } from "./manifest";
import { sourceHash, type ScriptFile } from "./script";
import type { VoiceLine } from "./inventory";

const OPTIONS = { facetsMax: 2 };
const CAST: CastSheet = {
  accent: "General American",
  speakers: {
    narrator: { who: "A warm storyteller.", gemini: { voice: "Sulafat" } },
    pib: { who: "A bramble sprite.", gemini: { voice: "Leda" } },
  },
};

const line = (address: string, text: string, chapter = "ch-01"): VoiceLine => ({ address, campaign: "c", chapter, kind: "narration", text, renders: 1 });
const wanted = (lines: VoiceLine[], cast = CAST, scripts = new Map<string, ScriptFile>()) =>
  desiredClips(classify(lines, OPTIONS), { cast, scripts });
const keysOf = (lines: VoiceLine[], cast = CAST, scripts = new Map<string, ScriptFile>()) =>
  Object.fromEntries(wanted(lines, cast, scripts).lines.map((l) => [`${l.address}|${l.variant}`, l.segments.map((s) => s.key)]));

const A = line("ch-01/a/narration", "The door is shut.");
const B = line("ch-01/b/narration", "The path ends at a wall of thorns.");

describe("the clip key", () => {
  it("changes for exactly the line whose text was edited", () => {
    const before = keysOf([A, B]);
    const after = keysOf([A, line(B.address, "The path ends at a wall of roses.")]);
    expect(after["ch-01/a/narration|"]).toEqual(before["ch-01/a/narration|"]);
    expect(after["ch-01/b/narration|"]).not.toEqual(before["ch-01/b/narration|"]);
  });

  it("changes for exactly the speaker whose voice was retuned", () => {
    const script: ScriptFile = {
      [B.address]: {
        source: sourceHash(B.text),
        lines: [
          { by: "narrator", text: "The path ends" },
          { by: "pib", text: "at a wall of thorns." },
        ],
      },
    };
    const scripts = new Map([["ch-01", script]]);
    const retuned: CastSheet = { ...CAST, speakers: { ...CAST.speakers, pib: { who: "A bramble sprite.", gemini: { voice: "Zephyr" } } } };
    const [narratorBefore, pibBefore] = keysOf([A, B], CAST, scripts)["ch-01/b/narration|"]!;
    const [narratorAfter, pibAfter] = keysOf([A, B], retuned, scripts)["ch-01/b/narration|"]!;
    expect(narratorAfter).toBe(narratorBefore);
    expect(pibAfter).not.toBe(pibBefore);
    expect(keysOf([A, B], retuned)["ch-01/a/narration|"]).toEqual(keysOf([A, B])["ch-01/a/narration|"]);
  });

  it("does not change when a scene is renamed or moved", () => {
    const moved = line("ch-02/elsewhere/narration", A.text, "ch-02");
    expect(Object.values(keysOf([moved]))).toEqual(Object.values(keysOf([A])));
  });

  it("is one clip for the same words in the same voice", () => {
    const twin = line("ch-01/c/narration", A.text);
    const keys = Object.values(keysOf([A, twin])).flat();
    expect(new Set(keys).size).toBe(1);
  });

  it("changes everywhere when the provider or model changes, and with the delivery", () => {
    const base = { provider: "gemini", model: "m1", voice: { voice: "Leda" }, text: "Hi." };
    expect(clipKey({ ...base, model: "m2" })).not.toBe(clipKey(base));
    expect(clipKey({ ...base, provider: "elevenlabs" })).not.toBe(clipKey(base));
    expect(clipKey({ ...base, delivery: "whisper" })).not.toBe(clipKey(base));
    // Field order in the voice config is not a change.
    expect(clipKey({ ...base, voice: { b: 1, a: 2 } })).toBe(clipKey({ ...base, voice: { a: 2, b: 1 } }));
  });

  it("keeps beats, which are sound, and applies the lexicon to the spoken words only", () => {
    expect(spokenForm("<sigh> Pib waits.", "", { Pib: "Pibb" })).toBe("<sigh> Pibb waits.");
    expect(spokenForm("Pibble waits.", "", { Pib: "Pibb" })).toBe("Pibble waits.");
    expect(spokenForm("{party} hold {facets} stones.", "party=2,facets=3")).toBe("both of you hold three stones.");
    expect(spokenForm("“Hi,” she said.", "")).toBe('"Hi," she said.');
  });

  it("makes one clip per token value of a templated line", () => {
    const keys = keysOf([line("ch-01/t/narration", "{party} go on.")]);
    expect(Object.keys(keys)).toHaveLength(4);
    expect(new Set(Object.values(keys).flat()).size).toBe(4);
  });
});

describe("who reads a line", () => {
  const script = (text: string, source = text): ScriptFile => ({
    [A.address]: { source: sourceHash(source), lines: [{ by: "pib", text }] },
  });

  it("is the narrator, whole, when there is no script", () => {
    const [only] = wanted([A]).lines;
    expect(only?.segments.map((s) => s.by)).toEqual(["narrator"]);
  });

  it("is the device voice, with no clips, when the script is stale", () => {
    const out = wanted([A], CAST, new Map([["ch-01", script("The door is shut.", "Older words.")]]));
    expect(out.lines).toEqual([]);
    expect(out.deviceVoice).toEqual([{ address: A.address, chapter: "ch-01", reason: "stale-script" }]);
  });

  it("is the device voice when the script does not rebuild the text or names someone uncast", () => {
    const wrong = wanted([A], CAST, new Map([["ch-01", script("The door is open.", A.text)]]));
    expect(wrong.deviceVoice[0]?.reason).toBe("broken-script");
    const ghost: ScriptFile = { [A.address]: { source: sourceHash(A.text), lines: [{ by: "ghost", text: A.text }] } };
    expect(wanted([A], CAST, new Map([["ch-01", ghost]])).deviceVoice[0]?.reason).toBe("uncast-speaker");
  });
});

describe("status", () => {
  const lines = [A, B];
  const desired = wanted(lines);
  const render = (d = desired): Manifest => {
    const m: Manifest = {};
    for (const l of d.lines) (m[l.address] ??= {})[l.variant] = l.segments.map((s) => ({ clip: s.key, ms: 1000 }));
    return m;
  };
  const none: Lock = { approved: {} };

  it("starts with everything missing, and a gate never fails on that", () => {
    const status = clipStatus(desired, {}, none);
    expect(countByState(status)).toEqual({ approved: 0, "awaiting-review": 0, stale: 0, missing: 2 });
  });

  it("moves rendered clips to awaiting review, then approved", () => {
    const manifest = render();
    expect(countByState(clipStatus(desired, manifest, none))["awaiting-review"]).toBe(2);
    const lock: Lock = { approved: Object.fromEntries(desired.lines.flatMap((l) => l.segments.map((s) => [s.key, {}]))) };
    expect(countByState(clipStatus(desired, manifest, lock)).approved).toBe(2);
  });

  it("changing one word makes exactly one clip stale, and the old one orphaned", () => {
    const manifest = render();
    const edited = wanted([A, line(B.address, "The path ends at a wall of roses.")]);
    const status = clipStatus(edited, manifest, none);
    expect(countByState(status)).toEqual({ approved: 0, "awaiting-review": 1, stale: 1, missing: 0 });
    expect(toRender(status)).toHaveLength(1);
    expect(status.orphaned).toHaveLength(1);
  });

  it("counts a clip shared by two lines once", () => {
    const status = clipStatus(wanted([A, line("ch-01/c/narration", A.text)]), {}, none);
    expect(status.clips).toHaveLength(1);
  });
});

describe("the manifest after a run", () => {
  const lengths = (keys: string[]) => new Map(keys.map((k) => [k, 1500]));
  const desired = wanted([A, B]);
  const keysOfLine = (address: string) => desired.lines.find((l) => l.address === address)!.segments.map((s) => s.key);

  it("gives a line an entry once all its clips exist, with their lengths", async () => {
    const { mergeManifest } = await import("./manifest");
    const merged = mergeManifest({}, desired.lines, lengths(keysOfLine(A.address)));
    expect(Object.keys(merged)).toEqual([A.address]);
    expect(merged[A.address]?.[""]).toEqual([{ clip: keysOfLine(A.address)[0], ms: 1500 }]);
  });

  it("keeps entries already there, and only prune drops what nothing asks for", async () => {
    const { mergeManifest } = await import("./manifest");
    const old = { "ch-01/gone/narration": { "": [{ clip: "0".repeat(64), ms: 10 }] } };
    expect(Object.keys(mergeManifest(old, desired.lines, new Map()))).toEqual(["ch-01/gone/narration"]);
    expect(mergeManifest(old, desired.lines, new Map(), true)).toEqual({});
  });

  it("is sorted, so the file diffs cleanly", async () => {
    const { mergeManifest } = await import("./manifest");
    const merged = mergeManifest({}, [...desired.lines].reverse(), lengths([...keysOfLine(A.address), ...keysOfLine(B.address)]));
    expect(Object.keys(merged)).toEqual([...Object.keys(merged)].sort());
  });
});
