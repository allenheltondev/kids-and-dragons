/**
 * One hero-art resolver (docs/hero-looks.md §5.1, §9; #672).
 *
 * Two promises are pinned here. The resolver picks exactly the painting every
 * surface picked before it existed, so moving onto it changes no picture. And
 * nothing in the client picks a hero's painting around it: the inventory
 * lists every use of the four painting helpers and fails on one outside the
 * resolver, character creation and the service worker, unless `ALLOWED` below
 * names it with a reason. A new screen that draws a hero cannot skip her look
 * (#666) by reaching for a helper.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Texture } from "pixi.js";
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import {
  STARTING_TIER,
  characterArtUrl,
  characterPortraitArtUrl,
  characterWorldArtUrl,
} from "./art-paths";
import { HERO_ART_PLACES, heroArtUrl, heroBase, heroPaintingUrl } from "./hero-art";
import { HeroImage, useHeroArt } from "./hero-art-dom";
import { loadHeroTexture } from "./hero-art-pixi";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

const HELPERS = ["characterArtUrl", "characterWorldArtUrl", "characterPortraitArtUrl", "gearPortraitUrl"] as const;

/** Where the helpers may be used without a reason: where they live, the resolver, creation, the service worker. */
function exempt(path: string): boolean {
  return (
    path === "world/art-paths.ts" ||
    path === "world/hero-art.ts" ||
    /^screens\/[Cc]reation[^/]*\.tsx?$/.test(path) ||
    path.startsWith("sw/")
  );
}

/**
 * Files that may use a helper anyway, each with its reason. Empty: every
 * surface that draws a player's hero goes through the resolver. An entry here
 * is for art that only looks like a hero's (a species picture with no hero
 * behind it), never for a screen that draws a player's hero.
 */
const ALLOWED: Readonly<Record<string, string>> = {};

/**
 * The §9 inventory: where a player's hero is drawn, each of which must reach
 * the resolver. A still reaches it through CharacterPortrait, so its callers
 * need not name it.
 */
const SURFACES = [
  "world/scene.ts",
  "world/board.ts",
  "world/camp.ts",
  "world/lobby-camp.ts",
  "world/StaticStage.tsx",
  // Not in the §9 table: the lobby's still camp, for a screen with no WebGL.
  "world/StillCamp.tsx",
  "screens/InteractionArt.tsx",
  "screens/InteractionExtras.tsx",
  "screens/SkillGame.tsx",
  "screens/RelayGame.tsx",
  "screens/RelayFlightGame.tsx",
  "screens/CharacterPortrait.tsx",
] as const;

const RESOLVER = /\b(heroArtUrl|heroPaintingUrl|useHeroArt|HeroImage|loadHeroTexture)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/**
 * The code of a source file with its comments and string contents blanked
 * (newlines kept, so line numbers hold). A helper named in a comment or a
 * string is not a use of it; one called inside a template's `${}` is.
 */
function codeOnly(text: string): string {
  let out = "";
  // Each open template literal remembers the brace depth its `${` opened at.
  const templates: number[] = [];
  let depth = 0;
  let i = 0;
  const blank = (c: string): string => (c === "\n" ? "\n" : " ");
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i += 1;
      }
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i += 1) out += blank(text[i]!);
    } else if (c === '"' || c === "'") {
      out += c;
      i += 1;
      while (i < text.length && text[i] !== c && text[i] !== "\n") {
        if (text[i] === "\\") {
          out += " ";
          i += 1;
        }
        out += blank(text[i] ?? "");
        i += 1;
      }
      out += text[i] ?? "";
      i += 1;
    } else if (c === "`" || (c === "}" && templates.length > 0 && templates[templates.length - 1] === depth)) {
      // Opening a template, or returning to one from its `${…}`.
      if (c === "}") templates.pop();
      out += c;
      i += 1;
      while (i < text.length && text[i] !== "`" && !(text[i] === "$" && text[i + 1] === "{")) {
        if (text[i] === "\\") {
          out += " ";
          i += 1;
        }
        out += blank(text[i] ?? "");
        i += 1;
      }
      if (text[i] === "$") {
        templates.push(depth);
        out += "${";
        i += 2;
      } else {
        out += text[i] ?? "";
        i += 1;
      }
    } else {
      if (c === "{") depth += 1;
      if (c === "}") depth -= 1;
      out += c;
      i += 1;
    }
  }
  return out;
}

interface Use {
  file: string;
  line: number;
  helper: string;
}

function helperUses(): Use[] {
  const pattern = new RegExp(`\\b(${HELPERS.join("|")})\\b`, "g");
  return sources(SRC).flatMap((path) => {
    const file = relative(SRC, path).split("\\").join("/");
    return codeOnly(readFileSync(path, "utf8"))
      .split("\n")
      .flatMap((line, index) => [...line.matchAll(pattern)].map((match) => ({ file, line: index + 1, helper: match[1]! })));
  });
}

const SPECIES: SpeciesId[] = ["bigfoot", "dragonling", "griffin", "kitsune", "manticore", "unicorn"];
const TIERS: TierId[] = ["fledgling", "sworn", "radiant", "mythic", "ascendant", "starborn", "legendary"];
const CLASSES: (ClassId | undefined)[] = [undefined, "thornguard", "duskrunner", "songkeeper", "starweaver"];

function* heroes(): Generator<{ species: SpeciesId; tier: TierId; class: ClassId | undefined }> {
  for (const species of SPECIES) {
    for (const tier of TIERS) {
      for (const characterClass of CLASSES) yield { species, tier, class: characterClass };
    }
  }
}

describe("the hero-art resolver", () => {
  it("picks the painting every surface picked before it: the stage's and the still's", () => {
    for (const hero of heroes()) {
      expect(heroArtUrl(hero, "world")).toBe(characterWorldArtUrl(hero.species, hero.tier, hero.class));
      expect(heroArtUrl(hero, "portrait")).toBe(characterPortraitArtUrl(hero.species, hero.tier, hero.class));
      // As painted, until #666 tints it.
      for (const place of HERO_ART_PLACES) expect(heroArtUrl(hero, place)).toBe(heroPaintingUrl(hero, place));
    }
  });

  it("draws a hero with no tier as the tier every character starts at", () => {
    expect(heroArtUrl({ species: "griffin" }, "portrait")).toBe(characterArtUrl("griffin", STARTING_TIER));
    expect(heroArtUrl({ species: "griffin", class: "songkeeper" }, "world")).toBe(
      characterWorldArtUrl("griffin", STARTING_TIER, "songkeeper"),
    );
  });

  it("falls back to the base painting, keeping everything else about her", () => {
    const hero = { species: "kitsune" as const, tier: "radiant" as const, class: "starweaver" as const, name: "Ember" };
    const base = heroBase(hero);
    expect(base).toEqual({ species: "kitsune", tier: "radiant", class: undefined, name: "Ember" });
    for (const place of HERO_ART_PLACES) expect(heroArtUrl(base, place)).toBe(characterArtUrl("kitsune", "radiant"));
  });

  it("gives the DOM the same URL, and an <img> exactly like the one it replaces", () => {
    const hero = { species: "unicorn" as const, tier: "mythic" as const, class: "duskrunner" as const };
    const Probe = () => <>{useHeroArt(hero, "portrait")}</>;
    expect(renderToStaticMarkup(<Probe />)).toBe(characterPortraitArtUrl("unicorn", "mythic", "duskrunner").replace(/&/g, "&amp;"));
    const url = characterWorldArtUrl("unicorn", "mythic", "duskrunner");
    expect(renderToStaticMarkup(<HeroImage hero={hero} place="world" className="a" alt="" decoding="async" />)).toBe(
      renderToStaticMarkup(<img src={url} className="a" alt="" decoding="async" />),
    );
  });

  it("hands a Pixi stage the texture of her painting, and nothing once stopped or missing", async () => {
    const hero = { species: "bigfoot" as const, tier: "sworn" as const, class: "thornguard" as const };
    const asked: string[] = [];
    const texture = {} as Texture;
    const load = (url: string): Promise<Texture> => {
      asked.push(url);
      return Promise.resolve(texture);
    };
    const got: Texture[] = [];
    loadHeroTexture(hero, "world", (t) => got.push(t), { load });
    const stop = loadHeroTexture(hero, "portrait", (t) => got.push(t), { load });
    stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual([
      characterWorldArtUrl("bigfoot", "sworn", "thornguard"),
      characterPortraitArtUrl("bigfoot", "sworn", "thornguard"),
    ]);
    expect(got).toEqual([texture]);
    let missing = 0;
    loadHeroTexture({ species: "unicorn" }, "world", (t) => got.push(t), {
      load: () => Promise.reject(new Error("404")),
      missing: () => (missing += 1),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(got).toEqual([texture]);
    expect(missing).toBe(1);
  });
});

describe("the hero-art inventory (docs/hero-looks.md §9)", () => {
  it("strips comments and strings but keeps template expressions", () => {
    const code = codeOnly('// gearPortraitUrl\nconst a = "characterArtUrl"; /* characterWorldArtUrl */ const b = `x ${characterPortraitArtUrl(s)} y`;');
    expect(code).not.toMatch(/gearPortraitUrl|characterArtUrl|characterWorldArtUrl/);
    expect(code).toMatch(/characterPortraitArtUrl\(s\)/);
    expect(code.split("\n")).toHaveLength(2);
  });

  it("finds no painting helper outside the resolver, creation and the service worker", () => {
    const uses = helperUses();
    // The scan sees the helpers where they are known to be.
    expect(uses.some((use) => use.file === "world/hero-art.ts")).toBe(true);
    expect(uses.some((use) => use.file.startsWith("sw/"))).toBe(true);
    const stray = uses
      .filter((use) => !exempt(use.file) && ALLOWED[use.file] === undefined)
      .map((use) => `${use.file}:${use.line} ${use.helper} (use world/hero-art.ts, or allow-list it with a reason)`);
    expect(stray).toEqual([]);
  });

  it("keeps the allow-list honest: every entry has a reason and a use", () => {
    const used = new Set(helperUses().map((use) => use.file));
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim(), file).not.toBe("");
      expect(used.has(file), `${file} no longer uses a helper; drop its entry`).toBe(true);
    }
  });

  it("puts every surface in the inventory on the resolver", () => {
    for (const file of SURFACES) {
      expect(codeOnly(readFileSync(join(SRC, file), "utf8")), file).toMatch(RESOLVER);
    }
  });
});
