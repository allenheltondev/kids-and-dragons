// @vitest-environment jsdom
/**
 * What the cast pages ask the server for as they open. A person who left a page in ElevenLabs mode comes back to it
 * in ElevenLabs mode, and both pages must then fetch the account's voices on their own: the profile page once forgot
 * to, and sat there with an empty picker until the mode was toggled.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pricing } from "../cost-model.ts";
import type { CastFile } from "../bakeoff/providers.ts";
import { renderCastPage } from "./page.ts";
import { renderProfilePage } from "./profile-page.ts";
import { castPageData } from "./routes.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the tools project has no DOM types: the page is reached through the global. */
const dom = globalThis as any;
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const cast = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "bakeoff", "cast.json"), "utf8")) as CastFile;
const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "pricing.json"), "utf8")) as Pricing;
const options = {
  ws: { outDir: fs.mkdtempSync(path.join(os.tmpdir(), "cast-start-")), cast, pricing, today: "2026-10-30" },
  sheetPath: path.join(ROOT, "content", "voice", "cast.json"),
  catalog: [],
  fetch: async () => {
    throw new Error("no call");
  },
  chapterCampaigns: {},
  root: ROOT,
};
const live = { token: "t", cap: 5, envKeys: { elevenlabs: false, gemini: false } };

/** Opens a page the way a browser does, in ElevenLabs mode with a key, and lists the routes it asked the server for. */
async function open(html: string, prefsKey: string): Promise<string[]> {
  const asked: string[] = [];
  dom.document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>[\s\S]*$/i, "");
  const script = [...dom.document.querySelectorAll("script")].filter((node: any) => node.type !== "application/json").map((node: any) => node.textContent)[0] as string;
  dom.localStorage.setItem(prefsKey, JSON.stringify({ provider: "elevenlabs" }));
  dom.sessionStorage.setItem("kad.voice-bakeoff.keys", JSON.stringify({ elevenlabs: "xi-test", gemini: "" }));
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  dom.Element.prototype.scrollIntoView = (): void => {};
  vi.stubGlobal("fetch", async (route: string) => {
    asked.push(route);
    return { ok: true, status: 200, json: async () => ({ voices: [], speakers: {}, order: [], clashes: {}, told: [], cells: {}, auditions: {} }) };
  });
  new Function(script)();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return asked;
}

afterEach(() => {
  dom.localStorage.clear();
  dom.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("the voices a cast page fetches as it opens, back in ElevenLabs mode", () => {
  it("the cards page lists the account's voices", async () => {
    const asked = await open(renderCastPage(castPageData(options), live), "kad.voice-cast");
    expect(asked).toContain("/api/voices");
  });

  it("the profile page lists the account's voices too", async () => {
    const html = renderProfilePage(castPageData(options, { profiles: true }), live);
    const prefsKey = /const STORE = "([^"]+)"/.exec(html)![1]!;
    const asked = await open(html, prefsKey);
    expect(asked).toContain("/api/voices");
  });
});
