/**
 * The cast pages are each one HTML string with their script inline, so a slip in a string that is itself inside a
 * template literal (a "\n" that should have been "\\n", an unclosed quote) typechecks fine and breaks the whole page
 * in the browser. This builds each page from the real cast sheet and compiles its script, which is all it takes to
 * catch that.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pricing } from "../cost-model.ts";
import type { CastFile } from "../bakeoff/providers.ts";
import { renderCastPage } from "./page.ts";
import { renderProfilePage } from "./profile-page.ts";
import { castPageData } from "./routes.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const cast = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;
const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "pricing.json"), "utf8")) as Pricing;
const options = {
  ws: { outDir: fs.mkdtempSync(path.join(os.tmpdir(), "cast-pages-")), cast, pricing, today: "2026-10-30" },
  sheetPath: path.join(ROOT, "content", "voice", "cast.json"),
  catalog: [],
  fetch: async () => {
    throw new Error("no call");
  },
  chapterCampaigns: {},
  root: ROOT,
};
const live = { token: "t", cap: 5, envKeys: { elevenlabs: false, gemini: false } };

/** The page's own script: the one that is not the JSON the server boots it with. */
const scriptOf = (html: string): string => {
  const scripts = [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
  expect(scripts).toHaveLength(1);
  return scripts[0]!;
};

describe("the cast pages' scripts", () => {
  it("compile: the cards page", () => {
    const script = scriptOf(renderCastPage(castPageData(options), live));
    expect(script.length).toBeGreaterThan(5000);
    expect(() => new Function(script)).not.toThrow();
  });

  it("compile: the profile page", () => {
    const script = scriptOf(renderProfilePage(castPageData(options, { profiles: true }), live));
    expect(script.length).toBeGreaterThan(10000);
    expect(() => new Function(script)).not.toThrow();
  });

  it("carry every profile's people and homeland to the page", () => {
    const html = renderProfilePage(castPageData(options, { profiles: true }), live);
    const boot = JSON.parse(/<script type="application\/json" id="boot">([\s\S]*?)<\/script>/.exec(html)![1]!.replace(/\\u003c/g, "<")) as { data: { profiles: Record<string, { people: string | null }> } };
    expect(boot.data.profiles.yeti_herder!.people).toBe("yeti");
    expect(boot.data.profiles.narrator!.people).toBeNull();
  });
});
