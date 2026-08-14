/**
 * `rig_holes.py` — the two judgements that decide whether an opening is damage.
 *
 * The renderer is not exercised here; the Rive CLI is not a repo dependency and
 * CI has it in only two jobs. What is exercised is everything downstream of it,
 * which is where this tool can be wrong in ways that matter:
 *
 *   1. A wing sweeping away leaves the space it occupied empty. That is
 *      animation. Counting it would report every rig in the corpus as broken —
 *      the first version of this measurement did exactly that, naming wings 26
 *      times, before openings that reach the outside were excluded.
 *   2. An opening several parts drew is not one part carrying artwork off, and
 *      naming a culprit there would be a guess.
 *
 * Python and Pillow are required, the same dependency `art:verify` has.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * A figure on a 1024px render: a torso block with a limb block beside it.
 *
 * `hole` puts a gap in the middle of the torso — enclosed on every side, which
 * is the contact-sheet defect. `bite` takes the same area out of the torso's
 * right edge instead, so the opening reaches the outside: the silhouette
 * changed, nothing broke.
 */
function run(kind: "hole" | "bite" | "shared"): { count: number; part: string | null } {
  const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(HERE)})
import numpy as np
import rig_holes as rh

W = 1024
rest = np.zeros((W, W), bool)
rest[300:700, 300:700] = True                    # the figure at rest, solid
# Placed where a rendered figure actually sits: attribute() maps render pixels
# back through the 1400 artboard offset, and a figure near the origin maps off
# the top-left of the art canvas entirely.

moving = rest.copy()
kind = ${JSON.stringify(kind)}
if kind == "bite":
    moving[400:460, 640:700] = False             # opening reaches the right edge of the figure
else:
    moving[400:460, 400:460] = False             # enclosed on all sides

rh.MIN_HOLE_PX = 100
gaps = rh.enclosed_openings(rest, moving)

# Source art at 1024, in the coordinates attribute() maps render pixels back to.
def block(y0, y1, x0, x1):
    m = np.zeros((1024, 1024), bool); m[y0:y1, x0:x1] = True; return m
scale = rh.ARTBOARD / rh.CANVAS
off = (rh.ARTBOARD - rh.CANVAS) // 2
lo_y, hi_y = int(400*scale-off), int(460*scale-off)
lo_x, hi_x = int(400*scale-off), int(460*scale-off)
if kind == "shared":
    masks = {"arm": block(lo_y, (lo_y+hi_y)//2, lo_x, hi_x),
             "body": block((lo_y+hi_y)//2, hi_y+2, lo_x, hi_x)}
else:
    masks = {"arm": block(lo_y-2, hi_y+2, lo_x-2, hi_x+2), "body": np.zeros((1024,1024), bool)}

who = rh.attribute(gaps[0], masks) if gaps else None
print(json.dumps({"count": len(gaps),
                  "part": who[0] if who and who[1] >= rh.SOLE_OWNER_SHARE else None}))
`;
  return JSON.parse(
    execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").pop() as string,
  );
}

describe("rig_holes.py", () => {
  it("counts an opening the figure encloses", () => {
    const r = run("hole");
    expect(r.count).toBe(1);
    expect(r.part).toBe("arm");
  });

  // The wings case. Without this exclusion the measurement named wings 26 times
  // across the corpus, all of them a part that had simply moved.
  it("ignores an opening that reaches the outside", () => {
    expect(run("bite").count).toBe(0);
  });

  // Half the hole each: no one part carried it off, so no one is named.
  it("names nobody when several parts drew the opening", () => {
    const r = run("shared");
    expect(r.count).toBe(1);
    expect(r.part).toBe(null);
  });
});
