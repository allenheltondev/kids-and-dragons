import { describe, expect, it } from "vitest";
import { attributeLines, attributeQuotes, buildSheet, type ChapterLike, type LineQuote, type NarrationLine, type UntaggedQuote } from "./cast/sheet";
import { scriptReport, sourceHash, type ScriptEntry, type ScriptFile } from "./script";
import { cutLine, draftEntry, refreshScript } from "./scriptdraft";

const chapters: ChapterLike[] = [
  {
    id: "h1",
    voiceGuide: { npcVoices: { pib: "a bramble sprite; he chirps", wisp: "a shy ghost; she whispers" } },
    scenes: {
      gate: { cast: [{ name: "Pib" }, { name: "Wisp" }] },
      alone: { cast: [{ name: "Pib" }] },
    },
  },
];
const GATE = "h1/gate/narration";
const ALONE = "h1/alone/narration";
const DOOR = "h1/door/narration";
const narration: NarrationLine[] = [
  { chapter: "h1", address: GATE, text: 'The gate creaks. "Welcome to the hedge," says Pib. "Mind the thorns." Wisp drifts past. "Hello," she whispers. "Hold on!" you call.' },
  { chapter: "h1", address: ALONE, text: 'Pib sits on a toadstool. A hush falls. "The hedge remembers everyone who passes."' },
  { chapter: "h1", address: DOOR, text: "The door is shut. Nobody says a word." },
];
const sources = { chapters, individuals: [], narration };
const speakers = new Set(["narrator", "party", "pib", "wisp"]);

const attributed = (): Map<string, LineQuote[]> => new Map(attributeLines(sources, null).map((line) => [line.address, line.quotes]));
const textOf = new Map(narration.map((line) => [line.address, line.text]));
const input = (lines: ReadonlyMap<string, string> = textOf) => ({ chapter: "h1", lines, quotes: attributed(), speakers });
const fresh = (file: ScriptFile, lines: ReadonlyMap<string, string> = textOf) => scriptReport(file as Record<string, unknown>, { chapter: "h1", lines, speakers });

describe("splitting a line at its quotes", () => {
  it("gives the narrator everything outside quotation marks, and each quote its own line", () => {
    const quotes = attributed().get(GATE)!;
    const cut = cutLine(GATE, textOf.get(GATE)!, quotes, speakers);
    expect(cut.lines).toEqual([
      { by: "narrator", text: "The gate creaks." },
      { by: "pib", text: '"Welcome to the hedge,"' },
      { by: "narrator", text: "says Pib." },
      { by: "pib", text: '"Mind the thorns."' },
      { by: "narrator", text: "Wisp drifts past." },
      { by: "wisp", text: '"Hello,"' },
      { by: "narrator", text: "she whispers." },
      { by: "party", text: '"Hold on!"' },
      { by: "narrator", text: "you call." },
    ]);
    expect(cut.attributed).toBe(4);
    expect(cut.needsPerson).toEqual([]);
  });

  it("keeps curly quotes and the authored spacing exactly as written", () => {
    const text = "Tansy waves.  “Over here,” she says.";
    const quotes: LineQuote[] = [{ start: 14, end: 26, id: "tansy", words: "Over here,", before: "", after: "" }];
    expect(text.slice(14, 26)).toBe("“Over here,”");
    expect(cutLine("x", text, quotes, new Set(["tansy"])).lines.map((line) => line.text)).toEqual(["Tansy waves.", "“Over here,”", "she says."]);
  });
});

describe("attribution comes from the cast sheet's attributor", () => {
  it("agrees with attributeQuotes and the sheet's own untagged list, quote for quote", () => {
    const here = [
      { id: "pib", names: ["Pib"], pronoun: "he" as const, here: true },
      { id: "wisp", names: ["Wisp"], pronoun: "she" as const, here: true },
    ];
    const byLine = attributed();
    expect(byLine.get(GATE)!.filter((q) => q.id !== null).map((q) => q.id)).toEqual(attributeQuotes(textOf.get(GATE)!, here).map((q) => q.id));
    const untagged: UntaggedQuote[] = [];
    buildSheet(sources, null, untagged);
    const loose = [...byLine.values()].flat().filter((q) => q.id === null).map((q) => q.words);
    expect(loose).toEqual(untagged.map((q) => q.words));
  });

  it("leaves a quote it cannot be sure of with the narrator and says it needs a person, guess and all", () => {
    const draft = draftEntry(ALONE, textOf.get(ALONE)!, attributed().get(ALONE)!, speakers);
    expect(draft.entry).toBeNull(); // nobody but the narrator: no entry, the narrator reads it all
    expect(draft.needsPerson).toEqual([{ address: ALONE, words: "The hedge remembers everyone who passes.", reason: "guess", guess: "pib" }]);
  });

  it("does not give a quote to someone the cast sheet does not have", () => {
    const draft = draftEntry(GATE, textOf.get(GATE)!, attributed().get(GATE)!, new Set(["narrator", "party", "pib"]));
    // Left with the narrator, it is one narrator line with the words either side of it.
    expect(draft.entry!.lines).toContainEqual({ by: "narrator", text: 'Wisp drifts past. "Hello," she whispers.' });
    expect(draft.needsPerson).toEqual([{ address: GATE, words: "Hello,", reason: "uncast", named: "wisp" }]);
  });
});

describe("refreshing a chapter's script", () => {
  it("drafts entries that rebuild the authored text exactly, every one unreviewed", () => {
    const { file, drafted } = refreshScript({}, input());
    expect(drafted).toEqual([GATE]);
    expect((file[GATE] as ScriptEntry).reviewed).toBe(false);
    const report = fresh(file);
    expect(report.problems).toEqual([]);
    expect(report.state[GATE]).toBe("fresh");
    expect(typeof file.$comment).toBe("string");
  });

  it("is idempotent: a second run over its own output changes nothing", () => {
    const first = refreshScript({}, input()).file;
    const second = refreshScript(first, input());
    expect(second.drafted).toEqual([]);
    expect(second.kept).toEqual([GATE]);
    expect(JSON.stringify(second.file)).toBe(JSON.stringify(first));
  });

  it("never rewrites a fresh entry, reviewed or not, even one a person cut differently", () => {
    const text = textOf.get(GATE)!;
    const person: ScriptEntry = { source: sourceHash(text), reviewed: true, lines: [{ by: "narrator", text: text.slice(0, 16) }, { by: "pib", text: text.slice(16), delivery: "excited" }] };
    const refresh = refreshScript({ [GATE]: person }, input());
    expect(refresh.file[GATE]).toBe(person);
    expect(refresh.kept).toEqual([GATE]);
  });

  it("re-cuts a stale entry from the new words, as a fresh unreviewed draft", () => {
    const old: ScriptEntry = { source: sourceHash("Older words."), reviewed: true, lines: [{ by: "pib", text: "Older words." }] };
    const refresh = refreshScript({ [GATE]: old }, input());
    expect(refresh.recut).toEqual([GATE]);
    expect(refresh.reviewedLost).toEqual([GATE]);
    expect((refresh.file[GATE] as ScriptEntry).source).toBe(sourceHash(textOf.get(GATE)!));
    expect((refresh.file[GATE] as ScriptEntry).reviewed).toBe(false);
    expect(fresh(refresh.file).state[GATE]).toBe("fresh");
  });

  it("drops a stale entry whose new words nobody but the narrator speaks", () => {
    const old: ScriptEntry = { source: sourceHash('"Hi," says Pib.'), lines: [{ by: "pib", text: '"Hi,"' }, { by: "narrator", text: "says Pib." }] };
    const refresh = refreshScript({ [DOOR]: old }, input());
    expect(refresh.dropped).toEqual([DOOR]);
    expect(refresh.file[DOOR]).toBeUndefined();
  });

  it("leaves broken and orphaned entries for a person and content:validate", () => {
    const text = textOf.get(GATE)!;
    const broken: ScriptEntry = { source: sourceHash(text), lines: [{ by: "narrator", text: "Something else entirely." }] };
    const orphan: ScriptEntry = { source: sourceHash("x"), lines: [{ by: "narrator", text: "x" }] };
    const refresh = refreshScript({ [GATE]: broken, "h1/gone/narration": orphan }, input());
    expect(refresh.broken).toEqual([GATE]);
    expect(refresh.orphaned).toEqual(["h1/gone/narration"]);
    expect(refresh.file[GATE]).toBe(broken);
    expect(refresh.file["h1/gone/narration"]).toBe(orphan);
  });
});
