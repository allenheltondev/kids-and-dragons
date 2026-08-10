/**
 * The rig configs' *structure*, held to the manifest's part lists.
 *
 * An earlier version of this file guarded the palette bindings — a `tintSlots`
 * entry per bound colour, the accent on the signature part, never on a meshed
 * one. The runtime recolour is gone (world/nameplate.ts) and those slots went
 * with it, so all five of those assertions were deleted along with their
 * subject. Deleting the file too was a mistake: the *reason* it existed
 * outlived the tinting.
 *
 * That reason is that a rig config names parts as bare strings — in `root`,
 * `adjacency`, `zOrder` and `meshParts` — and a name that matches nothing is
 * silent. `rive-mcp` builds the rig from these, `art:verify` checks the
 * *manifest* against the PNGs and never opens a rig config, and a typo lands
 * as a joint that does not bend or a limb drawn in the wrong order: visible
 * only to somebody watching the figure move, and easy to read as an art
 * problem rather than a one-character bug in a JSON file.
 *
 * These are the checks that need no renderer and no `.riv`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";

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

const species = manifest.species as { id: string; signature: string; parts: string[] }[];

function configFor(id: string): RigConfig {
  const path = fileURLToPath(new URL(`../../../../art/rig/${id}.rig.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as RigConfig;
}

describe("rig configs", () => {
  it("names only parts the species actually has", () => {
    for (const sp of species) {
      const config = configFor(sp.id);
      const named = new Set<string>([
        ...(config.root ? [config.root] : []),
        ...(config.adjacency ?? []).flat(),
        ...(config.zOrder ?? []),
        ...Object.keys(config.meshParts ?? {}),
      ]);
      for (const part of named) {
        expect(sp.parts, `${sp.id} names "${part}", which is not one of its parts`).toContain(part);
      }
    }
  });

  it("draws every part, exactly once", () => {
    // A part missing from zOrder has no defined depth; a part listed twice is
    // a merge artefact. Both draw *something*, which is why neither shows up
    // as an error anywhere else.
    for (const sp of species) {
      const zOrder = configFor(sp.id).zOrder ?? [];
      expect([...zOrder].sort(), sp.id).toEqual([...sp.parts].sort());
    }
  });

  it("roots the skeleton at a real part, and hangs every other part off it", () => {
    for (const sp of species) {
      const config = configFor(sp.id);
      const adjacency = config.adjacency ?? [];
      expect(config.root, `${sp.id} has no root`).toBeDefined();

      // Walk the joint graph from the root. Anything unreached is a part the
      // rig cannot move — it would sit still while the body walked away.
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
      expect([...seen].sort(), `${sp.id} has parts not joined to the skeleton`).toEqual(
        [...sp.parts].sort(),
      );
    }
  });

  /*
   * The stage each config hands to rive-mcp, held to the manifest.
   *
   * A rig is staged on an artboard larger than the art canvas so a knocked-down
   * figure has room to sweep its own diagonal (manifest `$rigStageComment`,
   * art-pipeline §6.3). These are not the client's anchors — `art-paths.test.ts`
   * owns those, and the client already draws rigs from `RIG_ANCHOR_X/Y` with the
   * stage/canvas sprite scaling to match. What these hold is the *input* side:
   * that every config still stages where the manifest says, grounds where the
   * manifest says, and does not quietly pick up a builder default.
   *
   * Worth holding because every one of these numbers is silent when wrong. A
   * config that drifts from the manifest produces a rig that is subtly the wrong
   * size or in the wrong place, which is exactly what shipped once already.
   */
  it("stages every species on the manifest's rigStage", () => {
    const stage = manifest.rigStage;
    for (const sp of species) {
      const config = configFor(sp.id);
      expect(config.artboardWidth, `${sp.id} artboard width`).toBe(stage.width);
      expect(config.artboardHeight, `${sp.id} artboard height`).toBe(stage.height);
      // A builder default that fits the figure to a fraction of the artboard
      // height looks fine in isolation and stands in the wrong place in the game.
      expect(config.scale, `${sp.id} scale`).toBe(1);
    }
  });

  it("puts the standing point at the canvas origin, offset into the stage", () => {
    // `ground` is the manifest origin expressed in artboard coordinates. Get
    // this wrong and the figure is rigged around a point that is not where its
    // feet are, which no clip-table check can see.
    const { canvas, rigStage } = manifest;
    for (const sp of species) {
      const config = configFor(sp.id);
      expect(config.origin, `${sp.id} origin`).toEqual({ x: canvas.originX, y: canvas.originY });
      expect(config.ground, `${sp.id} ground`).toEqual({
        x: canvas.originX + rigStage.offsetX,
        y: canvas.originY + rigStage.offsetY,
      });
    }
  });

  it("leaves the figure centred horizontally on the stage", () => {
    // The horizontal anchor stays 0.5 across the restage — worth pinning,
    // because it is the half of the anchor pair that does NOT change, and a
    // reader repointing the client needs to know which number is moving.
    const { rigStage } = manifest;
    for (const sp of species) {
      expect(configFor(sp.id).ground!.x / rigStage.width, `${sp.id} horizontal anchor`).toBeCloseTo(
        0.5,
        6,
      );
    }
  });

  it("carries no tint slots — the runtime recolour is gone", () => {
    // Guarding the *absence*, so a regenerated config cannot quietly bring
    // back a binding nothing reads (asset-brief §4.4).
    for (const sp of species) {
      expect(configFor(sp.id).tintSlots, `${sp.id} has tintSlots again`).toBeUndefined();
    }
  });
});
