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

  /*
   * The stage is paired with a canvas, and every canvas needs its own.
   *
   * `rigStage` reads like a global, and for the six species it is one — they all
   * draw on the manifest's 1024 canvas. Entities do not: `verify.py` already
   * honours a per-entity `canvas` override, and `legend_dragon` is 2048 art. A
   * rig generated for it against the 1024-derived 1400 stage would be staged for
   * a drawing half its size, which is the clipping bug this whole stage exists to
   * prevent, arriving through the one door nobody was watching.
   *
   * No entity is rigged yet (`rigContract.sets.enemy` exists, no `.riv` does), so
   * this holds the contract rather than any delivered file — which is the point of
   * writing it now, while the cost is one assertion instead of twenty rebuilt rigs.
   */
  it("pairs a rigStage with every canvas, on one ratio, centred", () => {
    const base = manifest.canvas;
    const baseStage = manifest.rigStage;
    const ratio = baseStage.width / base.width;

    const pairs: { what: string; canvas: typeof base; stage: typeof baseStage }[] = [
      { what: "manifest default", canvas: base, stage: baseStage },
    ];
    for (const e of manifest.entities as { id: string; canvas?: typeof base; rigStage?: typeof baseStage }[]) {
      if (!e.canvas) continue; // inherits the default canvas, so it inherits the default stage
      expect(e.rigStage, `${e.id} declares its own canvas but no rigStage to go with it`).toBeDefined();
      pairs.push({ what: e.id, canvas: e.canvas, stage: e.rigStage! });
    }

    for (const { what, canvas, stage } of pairs) {
      expect(stage.width / canvas.width, `${what}: stage/canvas ratio`).toBeCloseTo(ratio, 9);
      expect(stage.height / canvas.height, `${what}: stage/canvas ratio`).toBeCloseTo(ratio, 9);
      // Centred, and on whole pixels — a half-pixel offset puts every rig built
      // from it a half-pixel off its own origin.
      expect(stage.offsetX, `${what}: offsetX`).toBe((stage.width - canvas.width) / 2);
      expect(stage.offsetY, `${what}: offsetY`).toBe((stage.height - canvas.height) / 2);
      expect(Number.isInteger(stage.offsetX), `${what}: offsetX is whole`).toBe(true);
      expect(Number.isInteger(stage.offsetY), `${what}: offsetY is whole`).toBe(true);
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
