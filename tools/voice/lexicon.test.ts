import { describe, expect, it } from "vitest";
import { namesIn } from "./lexicon";

describe("names heard aloud", () => {
  it("are capitalized words the content never writes in lowercase", () => {
    const names = namesIn([
      { address: "a", text: "The path ends. Pib waves at Pib's friend, the Gemfall courier." },
      { address: "b", text: "Beyond the gate, Pib hums, and you go beyond it too." },
    ]);
    expect(names.map((n) => n.word)).toEqual(["Pib", "Gemfall"]);
    expect(names[0]).toEqual({ word: "Pib", count: 3, example: "a" });
  });
});
