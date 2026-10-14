/**
 * `verify.py` — where the cross-tier check takes a joint to be.
 *
 * The cross-tier check holds a species' structural joints in one place across
 * its four tiers. It used to take each joint as the centroid of the two parts'
 * overlap, which was the joint while parts overlapped only in a disc stamped
 * on it. A recut that paints the overlap along the whole seam moves that
 * centroid mid-limb without moving the joint the rig is built on, and failed
 * the check (bigfoot fledgling->sworn, 72-91px) with every pinned pivot where it
 * was. So a set's joints.json wins; the centroid is the fallback for a set
 * without one.
 *
 * Python and Pillow are required, the same dependency `art:verify` has.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ART = fileURLToPath(new URL(".", import.meta.url));

function joints(withPins: boolean): Record<string, [number, number]> {
  const py = `
import json, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(ART)})
import verify as v

W = 200
yy, xx = np.mgrid[0:W, 0:W]
def part(mask):
    a = np.zeros((W, W, 4), np.uint8); a[..., 3] = np.where(mask, 255, 0); return a
body = (xx >= 50) & (xx < 150) & (yy >= 50) & (yy < 150)
# A recut arm: its overlap with the body runs the whole seam, so the overlap's
# centroid is mid-limb (y ~100), while the shoulder is at the top (y 60).
arm = (xx >= 140) & (xx < 170) & (yy >= 55) & (yy < 150)
parts = {"body": part(body), "arm_l": part(arm)}
assembled = part(body | arm)
pins = {"arm_l": {"parent": "body", "x": 145, "y": 60}} if ${withPins ? "True" : "False"} else None
print(json.dumps(v.joint_centroids(parts, assembled, [["body", "arm_l"]], 8, pins)))
`;
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
}

describe("verify.py joint_centroids", () => {
  it("takes a pinned pivot from joints.json over the overlap centroid", () => {
    const [, y] = joints(true)["body/arm_l"]!;
    // Bounding box y 50..149 (height 99): the pin at y 60 normalises to ~0.10.
    expect(y).toBeCloseTo((60 - 50) / 99, 5);
  });

  it("falls back to the overlap centroid for a set with no pinned joints", () => {
    const [, y] = joints(false)["body/arm_l"]!;
    expect(y).toBeGreaterThan(0.4); // mid-seam, which is why pins win
  });
});
