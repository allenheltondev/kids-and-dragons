/**
 * The voice cost estimate: what is counted (inventory.ts) and the money math
 * (cost-model.ts). A wrong number here decides a provider, so both halves are
 * pinned with small hand-checked cases.
 */

import { describe, expect, it } from "vitest";
import { billedChars, chapterLines, campaignLines, helpLines, quotedChars, rendersOf } from "./inventory";
import { parseTokensPerSecond, quote, rateOn, type PricedModel, type SpeechAssumptions } from "./cost-model";

const OPTIONS = { facetsMax: 6 };

describe("what gets voiced", () => {
  const chapter = {
    id: "ch-01",
    campaignId: "camp",
    plate: { art: "x", narration: "A quiet road." },
    goal: { text: "Find the jar.", steps: [{ id: "a", label: "Not read aloud", flag: "f" }] },
    voiceGuide: { tone: "never voiced" },
    scenes: {
      s1: {
        type: "story",
        narration: "Hello {party}.",
        hint: "Tap a choice.",
        variants: [{ when: { flag: "f" }, text: "You have {facets} stones." }],
        choices: [{ id: "go", label: "Go on", icon: "arrow", goto: "c1" }],
      },
      c1: {
        type: "check",
        prompt: "Climb the wall",
        onSuccess: { goto: "s1", narration: "Up you go." },
        onFailure: { goto: "s1" },
      },
      i1: { type: "interaction", narration: "Catch!", interaction: { kind: "timing", cue: "Wait, then grab.", actionLabel: "Grab!" } },
      e1: {
        type: "encounter",
        narration: "A fight.",
        environment: { clock: { rounds: 3, label: "Rising water" } },
        onVictory: { goto: "s1", narration: "You win." },
      },
    },
  };

  const lines = chapterLines(chapter, OPTIONS);
  const byAddress = new Map(lines.map((line) => [line.address, line]));

  it("collects every spoken string, at its address", () => {
    expect([...byAddress.keys()].sort()).toEqual(
      [
        "ch-01/@goal",
        "ch-01/@plate",
        "ch-01/c1/onSuccess/narration",
        "ch-01/c1/prompt",
        "ch-01/e1/narration",
        "ch-01/e1/onVictory/narration",
        "ch-01/i1/interaction/cue",
        "ch-01/i1/narration",
        "ch-01/s1/choices/go/label",
        "ch-01/s1/hint",
        "ch-01/s1/narration",
        "ch-01/s1/variants/0",
      ].sort(),
    );
  });

  it("reads the goal with its lead-in, and keeps choice labels as their own kind", () => {
    expect(byAddress.get("ch-01/@goal")?.text).toBe("Your goal: Find the jar.");
    expect(byAddress.get("ch-01/s1/choices/go/label")?.kind).toBe("choice");
  });

  it("never voices UI labels, steps or the voice guide", () => {
    const texts = lines.map((line) => line.text);
    expect(texts).not.toContain("Rising water");
    expect(texts).not.toContain("Not read aloud");
    expect(texts).not.toContain("Grab!");
    expect(texts).not.toContain("never voiced");
  });

  it("renders a token line once per value", () => {
    expect(rendersOf("Hello {party}.", OPTIONS)).toBe(4);
    expect(rendersOf("You have {facets} stones.", OPTIONS)).toBe(7);
    expect(rendersOf("{party} have {facets}.", OPTIONS)).toBe(28);
    expect(billedChars(byAddress.get("ch-01/s1/narration")!)).toBe("Hello {party}.".length * 4);
  });

  it("collects the prologue, the Last time lines and help", () => {
    const campaign = campaignLines(
      { id: "camp", prologue: { plates: [{ art: "p", narration: "Once." }] }, lastTime: { $comment: "x", opener: "New night.", lines: { f: "You went north." } } },
      OPTIONS,
    );
    expect(campaign.map((line) => line.address)).toEqual(["camp/@prologue/0", "camp/@lastTime/opener", "camp/@lastTime/f"]);
    const help = helpLines({ version: 1, surfaces: { story: { icon: "scroll", text: "This is the story." } } }, OPTIONS);
    expect(help.map((line) => line.text)).toEqual(["This is the story."]);
  });

  it("counts the words inside quotes", () => {
    expect(quotedChars('"Hi," says Pib. "Bye."')).toBe("Hi,".length + "Bye.".length);
    expect(quotedChars("No one speaks.")).toBe(0);
  });
});

describe("the API math", () => {
  const speech: SpeechAssumptions = { charsPerSecond: 10, charsPerTextToken: 4, promptTokensPerRequest: 0, audioTokensPerSecond: 25 };
  const perChar: PricedModel = { id: "c", provider: "x", label: "C", billing: "characters", rates: [{ perThousandChars: 0.1 }], confirmed: true, source: "" };
  const perToken: PricedModel = {
    id: "t",
    provider: "y",
    label: "T",
    billing: "tokens",
    rates: [
      { until: "2026-12-31", inputPerMillion: 1, outputPerMillion: 10 },
      { from: "2027-01-01", inputPerMillion: 1, outputPerMillion: 20 },
    ],
    batchDiscount: 0.5,
    confirmed: true,
    source: "",
  };

  it("prices more audio tokens a second higher, so a cap can use the top of Google's 25 to 32 range", () => {
    const at = (audioTokensPerSecond: number) =>
      quote(perToken, { chars: 1_000_000, requests: 0 }, { ...speech, audioTokensPerSecond }, "2026-10-27")?.dollars ?? 0;
    // Input is a small share, so output (the audio) sets the price: 32 / 25 of it.
    expect(at(32)).toBeGreaterThan(at(25));
    expect(at(32) - 0.25).toBeCloseTo((at(25) - 0.25) * (32 / 25));
  });

  it("bills characters by the thousand", () => {
    expect(quote(perChar, { chars: 50_000, requests: 10 }, speech, "2026-10-27")?.dollars).toBeCloseTo(5);
  });

  it("bills tokens for the text in and the audio out", () => {
    // 1,000,000 chars: 250,000 text tokens ($0.25) and 100,000 s × 25 = 2.5M audio tokens ($25).
    expect(quote(perToken, { chars: 1_000_000, requests: 0 }, speech, "2026-10-27")?.dollars).toBeCloseTo(25.25);
  });

  it("follows a dated price change, and halves for batch", () => {
    expect(quote(perToken, { chars: 1_000_000, requests: 0 }, speech, "2027-01-01")?.dollars).toBeCloseTo(50.25);
    expect(quote(perToken, { chars: 1_000_000, requests: 0 }, speech, "2026-10-27", true)?.dollars).toBeCloseTo(12.625);
  });

  it("charges the style prompt on every request", () => {
    const withPrompt = { ...speech, promptTokensPerRequest: 100 };
    const a = quote(perToken, { chars: 0, requests: 10_000 }, withPrompt, "2026-10-27")?.dollars;
    expect(a).toBeCloseTo(1); // 1M prompt tokens at $1
  });

  it("has no price on a day no rate covers", () => {
    expect(rateOn([{ from: "2027-01-01" }], "2026-10-27")).toBeNull();
  });
});

describe("--tokens-per-second", () => {
  it("takes a finite number above zero", () => {
    expect(parseTokensPerSecond("25")).toBe(25);
    expect(parseTokensPerSecond("28.5")).toBe(28.5);
  });

  it("refuses what would make every quote nonsense", () => {
    for (const bad of ["Infinity", "-Infinity", "1e999", "NaN", "0", "-3", "", "  ", "abc"]) {
      expect(parseTokensPerSecond(bad), bad).toBeNull();
    }
  });
});
