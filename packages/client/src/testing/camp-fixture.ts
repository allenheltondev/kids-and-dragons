/**
 * A camp layout for the camp tests, in exactly the shape assets/manifest.json
 * → `camp` takes (docs/camp.md §9, camp-layout.ts). The contract's own
 * example, filled out to a stage-1 camp: four bedrolls, a campfire with a
 * place each side of it, and a few spots on the near lane.
 *
 * Named so vitest's `*.test.ts` glob does not collect it, like fixtures.ts.
 */

import { campLayout, parseCampManifest, type CampLayout } from "../world/camp-layout";

export function campManifestFixture(): Record<string, unknown> {
  return {
    backdropCanvas: { width: 1920, height: 1080 },
    backdrops: [
      {
        family: "open_plains",
        path: "camp/backdrops/open_plains.webp",
        lanes: [
          { id: "back", y: 0.7, x0: 0.1, x1: 0.9, scale: 0.86 },
          { id: "middle", y: 0.78, x0: 0.08, x1: 0.92, scale: 0.93 },
          { id: "near", y: 0.87, x0: 0.05, x1: 0.97, scale: 1.0 },
        ],
        // The contract's two end crossings, and one between each pair of
        // bedrolls, so a hero in the middle of the row is never shut in.
        crossings: [
          { x: 0.18, lanes: ["back", "middle", "near"] },
          { x: 0.31, lanes: ["back", "middle", "near"] },
          { x: 0.69, lanes: ["back", "middle", "near"] },
          { x: 0.82, lanes: ["back", "middle", "near"] },
        ],
      },
    ],
    frames: [
      {
        stage: 1,
        pieces: [
          { id: "campfire", path: "camp/frames/stage1/campfire.png", lane: "middle", x: 0.5 },
          { id: "pack", path: "camp/frames/stage1/pack.png", lane: "near", x: 0.7 },
        ],
        movingParts: [
          { piece: "campfire", path: "camp/frames/stage1/campfire-flame.png", motion: "flicker" },
          { piece: "pack", path: "camp/frames/stage1/pack-flap.png", motion: "lift" },
        ],
        standPoints: [
          { id: "campfire-w", lane: "middle", x: 0.42, face: "right", action: "warmUp", hotspot: "campfire" },
          { id: "campfire-e", lane: "middle", x: 0.58, face: "left", action: "warmUp", hotspot: "campfire" },
          { id: "bedroll-0", lane: "back", x: 0.24, face: "right", action: "rest", seat: 0 },
          { id: "bedroll-1", lane: "back", x: 0.38, face: "right", action: "rest", seat: 1 },
          { id: "bedroll-2", lane: "back", x: 0.62, face: "left", action: "rest", seat: 2 },
          { id: "bedroll-3", lane: "back", x: 0.76, face: "left", action: "rest", seat: 3 },
          { id: "stars", lane: "near", x: 0.38, face: "left", action: "lookUp" },
          { id: "pack-peek", lane: "near", x: 0.62, face: "right", action: "peek", hotspot: "pack" },
          { id: "meadow", lane: "near", x: 0.5, face: "right", action: "pet" },
        ],
        trailhead: { lane: "near", x: 0.96 },
      },
    ],
  };
}

export function campLayoutFixture(): CampLayout {
  return campLayout(parseCampManifest(campManifestFixture()), "open_plains", 1);
}
