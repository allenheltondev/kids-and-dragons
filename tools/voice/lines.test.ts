import { describe, expect, it } from "vitest";
import type { VoiceLine } from "./inventory";
import { classify, duplicateAddresses, variantsOf } from "./lines";

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
