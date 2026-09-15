/**
 * The 30 class-variant rig configs' *structure*, held to the manifest.
 *
 * `packages/client/src/world/rig-configs.test.ts` holds the six species
 * configs to their part lists, their draw order, a connected skeleton and the
 * manifest's stage — and says why: a rig config names parts as bare strings,
 * `rive-mcp` builds from whatever it is given, and a typo lands as a limb that
 * does not bend, visible only to somebody watching the figure move. When the
 * class rigs arrived (`assets/character-rigs/<class>/<tier>/<species>`, one
 * config each in `art/rig/<class>-<tier>-<species>.rig.json`) they arrived
 * with none of that: thirty configs, five times the six that were guarded,
 * with a part (`armor_visible`, `gear_visible`) the species configs never
 * name — which is exactly the part most likely to be misspelled, because it
 * is the one nobody has typed thirty times before.
 *
 * Same assertions, applied to `manifest.rigVariants`. Here rather than beside
 * the species test because these rigs are a tooling concern — the client draws
 * them through the same `rive-actor.ts` and has no idea a class rig is any
 * different — and because this file can look at the disk: a variant's parts
 * directory is checked to hold exactly the PNGs its config draws, which is the
 * check `art:rig:build` would otherwise be the first to make, ten seconds
 * into a browser start.
 *
 * Nothing here needs a renderer or a `.riv`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../assets/manifest.json";

interface RigConfig {
  $comment?: string;
  root?: string;
  adjacency?: [string, string][];
  zOrder?: string[];
  meshParts?: Record<string, unknown>;
  tintSlots?: unknown[];
  origin?: { x: number; y: number };
  ground?: { x: number; y: number };
  artboardWidth?: number;
  artboardHeight?: number;
  scale?: number;
}

interface RigVariant {
  class: string;
  tier: string;
  species: string;
  parts: string[];
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const variants = manifest.rigVariants as RigVariant[];

const label = (v: RigVariant) => `${v.class}/${v.tier}/${v.species}`;
const configPath = (v: RigVariant) => `${ROOT}art/rig/${v.class}-${v.tier}-${v.species}.rig.json`;
const partsDir = (v: RigVariant) => `${ROOT}assets/character-rigs/${v.class}/${v.tier}/${v.species}/parts`;

function configFor(v: RigVariant): RigConfig {
  return JSON.parse(readFileSync(configPath(v), "utf8")) as RigConfig;
}

describe("class-variant rig configs", () => {
  it("declares thirty-six variants, each with a config", () => {
    // The number is pinned on purpose: a variant dropped from the manifest
    // takes its rig out of every gate at once, and thirty-six is the count the
    // rest of the tooling (art:rig:build's "60/60") is written against.
    expect(variants).toHaveLength(36);
    for (const v of variants) {
      expect(existsSync(configPath(v)), `${label(v)} has no config at ${configPath(v)}`).toBe(true);
    }
  });

  it("has no config that builds a rig the manifest does not declare", () => {
    // The reverse: a `<class>-<tier>-<species>.rig.json` nothing builds is
    // either a variant somebody forgot to declare or a rename that left its
    // old name behind. Both look like a delivered rig to a reader of art/rig/.
    const declared = new Set(variants.map((v) => `${v.class}-${v.tier}-${v.species}`));
    const speciesIds = new Set((manifest.species as { id: string }[]).map((s) => s.id));
    const stray = readdirSync(`${ROOT}art/rig`)
      .filter((f) => f.endsWith(".rig.json"))
      .map((f) => f.slice(0, -".rig.json".length))
      .filter((name) => !speciesIds.has(name) && !declared.has(name));
    expect(stray, "rig configs that no species or rigVariant claims").toEqual([]);
  });

  it("names only parts the variant actually has", () => {
    for (const v of variants) {
      const config = configFor(v);
      const named = new Set<string>([
        ...(config.root ? [config.root] : []),
        ...(config.adjacency ?? []).flat(),
        ...(config.zOrder ?? []),
        ...Object.keys(config.meshParts ?? {}),
      ]);
      for (const part of named) {
        expect(v.parts, `${label(v)} names "${part}", which is not one of its parts`).toContain(part);
      }
    }
  });

  it("draws every part, exactly once", () => {
    for (const v of variants) {
      const zOrder = configFor(v).zOrder ?? [];
      expect([...zOrder].sort(), label(v)).toEqual([...v.parts].sort());
    }
  });

  it("has a PNG on disk for every part it draws, and draws every PNG on disk", () => {
    // The builder takes `--parts <dir>` and draws what it finds there. A part
    // in the config with no PNG is a missing limb; a PNG with no entry in the
    // config is drawn at whatever depth the builder defaults to. verify.py
    // checks the manifest against the disk for these directories; this is the
    // config against the disk, the leg of the triangle nothing else walks.
    for (const v of variants) {
      const dir = partsDir(v);
      expect(existsSync(dir), `${label(v)} has no parts directory at ${dir}`).toBe(true);
      const onDisk = readdirSync(dir)
        .filter((f) => f.endsWith(".png"))
        .map((f) => f.slice(0, -".png".length))
        .sort();
      expect(onDisk, `${label(v)} parts on disk vs zOrder`).toEqual([...(configFor(v).zOrder ?? [])].sort());
    }
  });

  it("roots the skeleton at a real part, and hangs every other part off it", () => {
    for (const v of variants) {
      const config = configFor(v);
      const adjacency = config.adjacency ?? [];
      expect(config.root, `${label(v)} has no root`).toBeDefined();

      const linked = new Map<string, string[]>();
      for (const [a, b] of adjacency) {
        linked.set(a, [...(linked.get(a) ?? []), b]);
        linked.set(b, [...(linked.get(b) ?? []), a]);
      }
      const seen = new Set<string>([config.root!]);
      const queue = [config.root!];
      while (queue.length > 0) {
        for (const next of linked.get(queue.shift()!) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect([...seen].sort(), `${label(v)} has parts not joined to the skeleton`).toEqual(
        [...v.parts].sort(),
      );
    }
  });

  it("stages every variant on the manifest's rigStage, at scale 1", () => {
    // A class rig is drawn by the same client code as its species rig, at the
    // same anchor and the same stage/canvas scale — so a variant staged on a
    // different artboard, or one that picked up the builder's fit-to-height
    // default, stands in the wrong place beside a figure that does not.
    const stage = manifest.rigStage;
    for (const v of variants) {
      const config = configFor(v);
      expect(config.artboardWidth, `${label(v)} artboard width`).toBe(stage.width);
      expect(config.artboardHeight, `${label(v)} artboard height`).toBe(stage.height);
      expect(config.scale, `${label(v)} scale`).toBe(1);
    }
  });

  it("puts the standing point at the canvas origin, offset into the stage", () => {
    const { canvas, rigStage } = manifest;
    for (const v of variants) {
      const config = configFor(v);
      expect(config.origin, `${label(v)} origin`).toEqual({ x: canvas.originX, y: canvas.originY });
      expect(config.ground, `${label(v)} ground`).toEqual({
        x: canvas.originX + rigStage.offsetX,
        y: canvas.originY + rigStage.offsetY,
      });
      expect(config.ground!.x / rigStage.width, `${label(v)} horizontal anchor`).toBeCloseTo(0.5, 6);
    }
  });

  it("carries no tint slots — the runtime recolour is gone", () => {
    for (const v of variants) {
      expect(configFor(v).tintSlots, `${label(v)} has tintSlots again`).toBeUndefined();
    }
  });
});
