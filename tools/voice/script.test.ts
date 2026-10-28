import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DELIVERIES, normalizeSpoken, scriptReport, sourceHash, stripBeats, type ScriptEntry } from "./script";

const ADDRESS = "ch-01/s1/narration";
const TEXT = 'The captain grins. "We owe you one," says the captain, "and sailors pay their debts."';
const context = {
  chapter: "ch-01",
  lines: new Map([[ADDRESS, TEXT]]),
  speakers: new Set(["narrator", "captain"]),
};
const cut: ScriptEntry = {
  source: sourceHash(TEXT),
  lines: [
    { by: "narrator", text: "The captain grins." },
    { by: "captain", text: '"We owe you one,"', delivery: "hearty" },
    { by: "narrator", text: "says the captain," },
    { by: "captain#cap", text: '<pause> "and sailors pay their debts."' },
  ],
};

describe("normalizing", () => {
  it("ignores curly quotes and spacing, so cosmetic edits do not stale a script", () => {
    expect(sourceHash("“Hi,”  she said.")).toBe(sourceHash('"Hi," she said.'));
    expect(normalizeSpoken("a\n\n b")).toBe("a b");
  });
  it("drops delivery beats and leaves words alone", () => {
    expect(stripBeats("<sigh> Well [laughs] yes <long pause>")).toBe(" Well  yes ");
    expect(stripBeats("a < b and b > c")).toBe("a < b and b > c");
  });
});

describe("a script", () => {
  it("is fresh when its lines rebuild the text, beats aside", () => {
    const report = scriptReport({ [ADDRESS]: cut }, context);
    expect(report.problems).toEqual([]);
    expect(report.state[ADDRESS]).toBe("fresh");
  });

  it("is broken when the audio would say something the screen does not", () => {
    const lines = [...cut.lines.slice(0, 3), { by: "captain", text: '"and sailors never pay."' }];
    const report = scriptReport({ [ADDRESS]: { ...cut, lines } }, context);
    expect(report.state[ADDRESS]).toBe("broken");
    expect(report.problems[0]?.message).toMatch(/do not equal the authored text/);
  });

  it("is broken when a line is by someone who is not cast", () => {
    const lines = [{ by: "ghost", text: TEXT }];
    const report = scriptReport({ [ADDRESS]: { ...cut, lines } }, context);
    expect(report.problems).toEqual([{ at: `${ADDRESS}/lines/0`, message: 'line 0 is by "ghost", who is not in the cast' }]);
  });

  it("is broken outside its own chapter", () => {
    const report = scriptReport({ "other-01/s1/narration": cut }, context);
    expect(report.state["other-01/s1/narration"]).toBe("broken");
  });

  it("is stale, not broken, when the text changed since it was cut", () => {
    const edited = { ...context, lines: new Map([[ADDRESS, `${TEXT} Off they go.`]]) };
    const report = scriptReport({ [ADDRESS]: cut }, edited);
    expect(report.problems).toEqual([]);
    expect(report.stale).toEqual([ADDRESS]);
    expect(report.state[ADDRESS]).toBe("stale");
  });

  it("is orphaned when the line is gone, and a $comment is not an entry", () => {
    const report = scriptReport({ $comment: "x", "ch-01/gone/narration": cut }, context);
    expect(report.orphaned).toEqual(["ch-01/gone/narration"]);
    expect(report.problems).toEqual([]);
  });
});

describe("delivery vocabulary", () => {
  it("is the same list in the schema and in code", () => {
    const schema = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../schemas/voice-script.schema.json"), "utf8"));
    expect(schema.$defs.entry.properties.lines.items.properties.delivery.enum).toEqual([...DELIVERIES]);
  });
});
