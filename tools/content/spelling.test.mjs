/**
 * US spelling in player-facing text, docs/campaigns/gemfall-authoring.md
 * §4 Voice, as a test. Rules and the walker live in spelling-lint.mjs.
 * Failures name file, line, field, and the US spelling to use.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { checkText, scanDocument } from "./spelling-lint.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const jsonFiles = [
  ...readdirSync(join(REPO, "content", "chapters")).filter((f) => f.endsWith(".json")).map((f) => `content/chapters/${f}`),
  ...["field-guide", "bestiary", "items", "world"].map((n) => `content/${n}.json`),
];
const yamlFiles = readdirSync(join(REPO, "canon")).filter((f) => f.endsWith(".yaml")).map((f) => `canon/${f}`);

function scan(file, parse) {
  const raw = readFileSync(join(REPO, file), "utf8");
  return scanDocument(file, raw, parse(raw));
}

describe("US spelling in player-facing text", () => {
  it.each(jsonFiles)("%s", (file) => {
    expect(scan(file, JSON.parse)).toEqual([]);
  });
  it.each(yamlFiles)("%s", (file) => {
    expect(scan(file, (raw) => yaml.load(raw))).toEqual([]);
  });
});

describe("the spelling scanner", () => {
  const words = (s) => checkText(s).map((h) => h.word);

  it("flags British spellings with a US suggestion", () => {
    expect(checkText("The colourful harbour")).toMatchObject([
      { word: "colourful", suggestion: "colorful" },
      { word: "harbour", suggestion: "harbor" },
    ]);
    const cases = {
      favourite: "favorite", neighbours: "neighbors", centre: "center", theatre: "theater", metres: "meters",
      grey: "gray", travelled: "traveled", labelling: "labeling", marvellous: "marvelous", cancelled: "canceled",
      jeweller: "jeweler", realise: "realize", recognised: "recognized", practising: "practicing",
      offence: "offense", defence: "defense", licence: "license", catalogue: "catalog", judgement: "judgment",
      mum: "mom", whilst: "while", amongst: "among", cosy: "cozy",
    };
    for (const [bad, good] of Object.entries(cases)) {
      expect(checkText(`a ${bad} here`).map((h) => h.suggestion), bad).toEqual([good]);
    }
  });

  it("uses word boundaries and ignores US spellings", () => {
    expect(words("color, favor, hour, glamour, mumble, center, traveled, afterwards, surprise, promise")).toEqual([]);
  });

  it("honors the documented exceptions", () => {
    expect(words("Drink the Sunbloom Draught afterwards.")).toEqual([]);
  });

  it("scans text and skips ids and keys", () => {
    const doc = {
      id: "scene_harbour_wall",
      scenes: [
        {
          id: "scene_harbour_wall",
          narration: "A grey sky.",
          choices: [{ label: "Ask about rumours", goto: "check_rumours" }],
          variants: [{ flag: "colour_seen", text: "The colour fades." }],
        },
      ],
    };
    const raw = JSON.stringify(doc, null, 2);
    const out = scanDocument("sample.json", raw, doc);
    expect(out).toHaveLength(3);
    for (const line of out) expect(line).toMatch(/^sample\.json:\d+ field scenes\[0\]\./);
    expect(out[0]).toContain('"grey" -> use US spelling "gray"');
    expect(out[1]).toContain("choices[0].label");
    expect(out[2]).toContain("variants[0].text");
    const lineNo = (s) => Number(s.match(/:(\d+) field/)[1]);
    expect(raw.split("\n")[lineNo(out[0]) - 1]).toContain("grey");
    expect(raw.split("\n")[lineNo(out[2]) - 1]).toContain("colour fades");
  });
});
