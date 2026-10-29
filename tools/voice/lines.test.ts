import { describe, expect, it } from "vitest";
import type { VoiceLine } from "./inventory";
import { classify, duplicateAddresses, refuseNameBearing, variantsOf } from "./lines";

const OPTIONS = { facetsMax: 2 };
const line = (address: string, text: string): VoiceLine => ({ address, campaign: "c", chapter: "ch", kind: "narration", text, renders: 1 });

describe("token expansion", () => {
  it("is one clip for plain text", () => {
    expect(variantsOf("Hello.", OPTIONS)).toEqual([""]);
  });
  it("is one clip per party size and per facet count", () => {
    expect(variantsOf("{party} go.", OPTIONS)).toEqual(["party=1", "party=2", "party=3", "party=4"]);
    expect(variantsOf("{facets} stones.", OPTIONS)).toEqual(["facets=0", "facets=1", "facets=2"]);
    expect(variantsOf("{party} hold {facets}.", OPTIONS)).toHaveLength(12);
  });
});

describe("classification", () => {
  it("calls a line templated only when a token multiplies it", () => {
    const [plain, tokened] = classify([line("a", "Hi."), line("b", "{party} hi.")], OPTIONS);
    expect(plain?.class).toBe("recorded");
    expect(tokened?.class).toBe("templated");
  });
});

describe("addresses", () => {
  it("reports an address used twice", () => {
    expect(duplicateAddresses([line("a", "x"), line("b", "y"), line("a", "z")])).toEqual(["a"]);
  });
});

describe("the {facets} bound", () => {
  it("is every great stone the content can hand out, and the engine can say them all", async () => {
    const { facetsMaxOf } = await import("./load");
    expect(facetsMaxOf({ items: [{ id: "facet_a" }, { id: "facet_b" }] }, [{ grants: "facet_a", also: "facet_c" }])).toBe(3);
    expect(facetsMaxOf({ id: "not_a_facet", pattern: "facet_*" })).toBe(0);
  });

  it("covers the whole shipped catalog: a party holding every facet has a clip", async () => {
    const { loadContent, reachableFacets } = await import("./load");
    const max = reachableFacets(loadContent());
    expect(max).toBeGreaterThanOrEqual(14);
    // The top count is a rendered variant, not an omitted one.
    expect(variantsOf("{facets} stones.", { facetsMax: max })).toContain(`facets=${String(max)}`);
    expect(variantsOf("{facets} stones.", { facetsMax: max })).toHaveLength(max + 1);
  });
});

describe("a hero's name is never recorded (#552)", () => {
  const NAME = "Zephyrine Quillfeather";

  it("refuses a line from a surface that composes names at run time", () => {
    const decision = { ...line("live/decision", `${NAME} chose: Open the gate.`), kind: "decision" } as unknown as VoiceLine;
    expect(() => classify([decision], OPTIONS)).toThrow(/not an authored line/);
  });

  it("refuses a token the engine would fill with a name", () => {
    expect(() => classify([line("a", "{hero} opens the gate.")], OPTIONS)).toThrow(/\{hero\} is filled at run time/);
    expect(() => refuseNameBearing(line("a", "{party} and {facets}"))).not.toThrow();
  });

  it("passes every shipped line, which is all authored", async () => {
    const { loadContent } = await import("./load");
    const { inventory } = await import("./inventory");
    const all = inventory(loadContent(), { facetsMax: 14 });
    expect(all.length).toBeGreaterThan(1000);
    expect(() => classify(all, { facetsMax: 14 })).not.toThrow();
  });

  it("never hands a provider an unfilled token", async () => {
    const { makeSynthesizer } = await import("./synth");
    const fetch = (): Promise<never> => { throw new Error("no provider may be called"); };
    const synth = makeSynthesizer({
      provider: { provider: "fake", model: "fake" },
      cast: { speakers: { narrator: { who: "the narrator" } } },
      tables: { delivery: {}, beats: {} } as never,
      keys: {},
      fetch: fetch as never,
    });
    await expect(synth({ key: "k", by: "narrator", text: "{hero} waves." })).rejects.toThrow(/unfilled token/);
  });
});
