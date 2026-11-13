import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extensionOfKey, extensionSamples } from "./cache-migration.ts";

const TOOL = fileURLToPath(new URL("./cache-migration.ts", import.meta.url));

describe("the extensions a prefix holds", () => {
  it("reads an extension off the file's name, never off a folder's", () => {
    expect(extensionOfKey("assets/scenes/gemfall/hollow-gate.webp")).toBe("webp");
    expect(extensionOfKey("assets/scenes/gemfall/hollow-gate@0.5x.webp")).toBe("webp");
    expect(extensionOfKey("assets/v1.2/readme")).toBe("");
    expect(extensionOfKey("assets/.hidden")).toBe("");
  });

  it("gives one sample key per extension, and leaves out what has none", () => {
    const listing = {
      Contents: [
        { Key: "assets/" },
        { Key: "assets/manifest.json" },
        { Key: "assets/cast/keeper/assembled.png" },
        { Key: "assets/entities/drake/assembled.png" },
        { Key: "assets/brand/mark.svg" },
        { Key: "assets/LICENSE" },
      ],
    };
    expect(extensionSamples(listing)).toEqual([
      { extension: "json", key: "assets/manifest.json", count: 1 },
      { extension: "png", key: "assets/cast/keeper/assembled.png", count: 2 },
      { extension: "svg", key: "assets/brand/mark.svg", count: 1 },
    ]);
    expect(extensionSamples({})).toEqual([]);
    expect(extensionSamples({ Contents: null })).toEqual([]);
  });

  it("prints them as the deploy reads them, and nothing for an empty prefix", () => {
    const run = (input: string): string => execFileSync(process.execPath, [TOOL], { input, encoding: "utf8" });
    expect(run(JSON.stringify({ Contents: [{ Key: "content/rules.json" }, { Key: "content/README.md" }] }))).toBe("json\tcontent/rules.json\nmd\tcontent/README.md\n");
    expect(run("")).toBe("");
  });
});
