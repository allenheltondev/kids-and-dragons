import { describe, expect, it } from "vitest";

import {
  NARRATION_TOKENS,
  composeNarration,
  composeNarrationPieces,
  narrationPartsOf,
  fillTokens,
  numberWord,
  partyPhrase,
  revelationsOf,
} from "./narration.js";
import { resolveCharacter } from "./character.js";
import type { ChoiceParty } from "./chapter-graph.js";
import type { Chapter, NarrationVariant } from "./types/chapter.js";
import type { ResolvedCharacter } from "./types/domain.js";
import { makeCharacter, makeItems, makeRules } from "./test-fixtures.js";

const rules = makeRules();
const items = makeItems();

function member(id: string, quest: string[] = []): ResolvedCharacter {
  const m = resolveCharacter(makeCharacter({ id }), rules, items);
  m.questItems = [...quest];
  return m;
}

function partyOf(size: number, facets = 0, flags: Record<string, boolean> = {}): ChoiceParty {
  const facetIds = Array.from({ length: facets }, (_, i) => `facet_${i}`);
  return {
    members: Array.from({ length: size }, (_, i) => member(`c_${i + 1}`, i === 0 ? facetIds : [])),
    flags,
  };
}

const BASE = "The door is shut.";

describe("composeNarration", () => {
  it("returns the base untouched with no variants", () => {
    expect(composeNarration(BASE, undefined, partyOf(1))).toBe(BASE);
    expect(composeNarration(BASE, [], partyOf(1))).toBe(BASE);
  });

  it("appends one matching variant after the base", () => {
    const variants: NarrationVariant[] = [{ when: { flag: "lit" }, text: "A lamp glows." }];
    expect(composeNarration(BASE, variants, partyOf(1, 0, { lit: true }))).toBe(
      `${BASE}\n\nA lamp glows.`,
    );
  });

  it("appends several matches in authored order, skipping the ones that fail", () => {
    const variants: NarrationVariant[] = [
      { when: { flag: "lit" }, text: "A lamp glows." },
      { when: { flag: "never" }, text: "Nope." },
      { when: { partySize: { min: 2 } }, text: "You stand together." },
      { when: {}, text: "It is late." },
    ];
    expect(composeNarration(BASE, variants, partyOf(2, 0, { lit: true }))).toBe(
      [BASE, "A lamp glows.", "You stand together.", "It is late."].join("\n\n"),
    );
  });

  it("puts at: start before the base, in authored order, and end after", () => {
    const variants: NarrationVariant[] = [
      { when: {}, text: "After.", at: "end" },
      { when: {}, text: "First.", at: "start" },
      { when: {}, text: "Second.", at: "start" },
    ];
    expect(composeNarration(BASE, variants, partyOf(1))).toBe(
      ["First.", "Second.", BASE, "After."].join("\n\n"),
    );
  });

  it("replace drops the base and keeps the other matches around it", () => {
    const variants: NarrationVariant[] = [
      { when: {}, text: "Before.", at: "start" },
      { when: { count: { of: "facet_*", min: 1 } }, text: "The door knows your stone.", replace: true },
      { when: {}, text: "After." },
    ];
    expect(composeNarration(BASE, variants, partyOf(1, 1))).toBe(
      ["Before.", "The door knows your stone.", "After."].join("\n\n"),
    );
    // Not matching, it replaces nothing.
    expect(composeNarration(BASE, variants, partyOf(1, 0))).toBe(
      ["Before.", BASE, "After."].join("\n\n"),
    );
  });

  it("several matching replaces: the first wins, deterministically", () => {
    const variants: NarrationVariant[] = [
      { when: {}, text: "One.", replace: true },
      { when: {}, text: "Two.", replace: true },
    ];
    expect(composeNarration(BASE, variants, partyOf(1))).toBe("One.");
  });

  it("returns the base when nothing matches", () => {
    const variants: NarrationVariant[] = [
      { when: { flag: "lit" }, text: "A lamp glows." },
      { when: { partySize: { min: 4 } }, text: "Crowded.", replace: true },
    ];
    expect(composeNarration(BASE, variants, partyOf(3))).toBe(BASE);
  });

  it("composes over an empty base without a stray paragraph break", () => {
    const variants: NarrationVariant[] = [{ when: {}, text: "Only this." }];
    expect(composeNarration("", variants, partyOf(1))).toBe("Only this.");
  });
});

describe("numberWord", () => {
  it("spells 0 as no and 1 to 14 as words, digits beyond", () => {
    expect(numberWord(0)).toBe("no");
    expect(numberWord(1)).toBe("one");
    expect(numberWord(2)).toBe("two");
    expect(numberWord(14)).toBe("fourteen");
    expect(numberWord(15)).toBe("15");
    expect(numberWord(100)).toBe("100");
  });
});

describe("partyPhrase", () => {
  it("names the party by size", () => {
    expect([1, 2, 3, 4].map(partyPhrase)).toEqual([
      "you",
      "both of you",
      "all three of you",
      "all four of you",
    ]);
  });
});

describe("fillTokens", () => {
  it("fills {party} at party sizes 1 to 4", () => {
    expect([1, 2, 3, 4].map((n) => fillTokens("The path waits for {party}.", partyOf(n)))).toEqual([
      "The path waits for you.",
      "The path waits for both of you.",
      "The path waits for all three of you.",
      "The path waits for all four of you.",
    ]);
  });

  it("fills {facets} at 0, 1 and 14", () => {
    const line = "You carry {facets} facets.";
    expect(fillTokens(line, partyOf(1, 0))).toBe("You carry no facets.");
    expect(fillTokens(line, partyOf(1, 1))).toBe("You carry one facets.");
    expect(fillTokens(line, partyOf(3, 14))).toBe("You carry fourteen facets.");
  });

  it("counts a facet two members both hold once, and ignores other items", () => {
    const party: ChoiceParty = {
      members: [member("c_1", ["facet_ember", "rusted_key"]), member("c_2", ["facet_ember"])],
    };
    expect(fillTokens("{facets}", party)).toBe("one");
  });

  it("fills every occurrence, and leaves unknown tokens as written", () => {
    expect(fillTokens("{party}, {party}! {nope} {facets}", partyOf(2, 2))).toBe(
      "both of you, both of you! {nope} two",
    );
    expect(fillTokens("no tokens here", partyOf(1))).toBe("no tokens here");
  });

  it("knows exactly the tokens it fills", () => {
    expect([...NARRATION_TOKENS]).toEqual(["facets", "party"]);
  });
});

describe("revelationsOf (the end-of-chapter recap)", () => {
  const scenes = {
    s_start: { type: "story", narration: "A road.", choices: [] },
    s_truth: {
      type: "story",
      priority: 1,
      narration: "The gems are a seal, and {party} know it now.",
      variants: [{ when: { flag: "lit" }, text: "The lamp shows it plainly." }],
      choices: [],
    },
    s_clue: { type: "story", priority: 2, narration: "A clue.", choices: [] },
    s_test: { type: "check", priority: 1, prompt: "Read the stone.", choices: [] },
  } as unknown as Chapter["scenes"];

  it("retells each visited p1 once, in order, in its own words", () => {
    const visited = ["s_start", "s_test", "s_truth", "s_clue", "s_truth", "s_missing"];
    expect(revelationsOf({ scenes }, visited, partyOf(2, 0, { lit: true }))).toEqual([
      "Read the stone.",
      "The gems are a seal, and both of you know it now.\n\nThe lamp shows it plainly.",
    ]);
  });

  it("is empty for a road with no revelation on it", () => {
    expect(revelationsOf({ scenes }, ["s_start", "s_clue"], partyOf(1))).toEqual([]);
  });
});

describe("narration parts", () => {
  const variants: NarrationVariant[] = [
    { when: { flag: "lit" }, text: "A lamp burns.", at: "start" },
    { when: { flag: "lit" }, text: "{party} may enter." },
  ];

  it("joins back to composeNarration, whatever variants hold", () => {
    for (const flags of [{}, { lit: true }]) {
      const party = partyOf(2, 0, flags);
      expect(composeNarrationPieces(BASE, variants, party).join("\n\n")).toBe(composeNarration(BASE, variants, party));
    }
  });

  it("keeps each piece as authored and notes the token values it carries", () => {
    const party = partyOf(3, 2, { lit: true });
    const pieces = composeNarrationPieces(BASE, variants, party);
    expect(pieces).toEqual(["A lamp burns.", BASE, "{party} may enter."]);
    expect(narrationPartsOf(pieces, party)).toEqual([
      { line: "A lamp burns." },
      { line: BASE },
      { line: "{party} may enter.", token: { party: "3" } },
    ]);
    expect(narrationPartsOf(["{facets} stones, {party}."], party)).toEqual([
      { line: "{facets} stones, {party}.", token: { facets: "2", party: "3" } },
    ]);
  });

  it("leaves out a blank piece", () => {
    expect(narrationPartsOf(["", "  ", BASE], partyOf(1))).toEqual([{ line: BASE }]);
  });
});
