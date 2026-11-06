/** `voice:verify` and `voice:generate` must work out the same clip keys, or verify calls every good clip wrong. */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ELEVENLABS, type CastSheet } from "./desired";
import { classify } from "./lines";
import type { Pricing } from "./cost-model";
import { desire, type World } from "./world";

const CAST: CastSheet = { speakers: { narrator: { who: "A warm storyteller.", elevenlabs: { voiceId: "voice-narrator" } } } };

function world(): World {
  const lines = classify([{ address: "ch/a/narration", campaign: "c", chapter: "ch", kind: "narration", text: "The door is shut.", renders: 1 }], { facetsMax: 2 });
  return { facetsMax: 2, cast: CAST, scripts: new Map(), manifests: new Map(), lock: { approved: {} }, lexicon: {}, tables: { delivery: {}, beats: {} } as never, groups: new Map([["ch", lines]]) };
}

describe("the provider every voice command defaults to", () => {
  it("is ElevenLabs for verify, which names none, exactly as generate and status name it", () => {
    const pricing = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "pricing.json"), "utf8")) as Pricing;
    // generate and status turn `--model eleven_v4` into { provider, model: apiModel ?? id } from pricing.json.
    const priced = pricing.models.find((m) => m.id === ELEVENLABS.model || m.apiModel === ELEVENLABS.model);
    expect(priced).toBeDefined();
    const named = { provider: priced!.provider, model: priced!.apiModel ?? priced!.id };
    expect(named).toEqual(ELEVENLABS);

    const keys = (d: ReturnType<typeof desire>) => d.lines.flatMap((l) => l.segments.map((s) => s.key));
    expect(keys(desire(world(), "ch"))).toHaveLength(1);
    expect(keys(desire(world(), "ch"))).toEqual(keys(desire(world(), "ch", named)));
  });
});
