/**
 * `verify_seams.py` — the recut's acceptance check (docs/briefs/part-recut.md).
 *
 * Three synthetic part sets, each a body with an arm drawn over it:
 *   - flat: one flat coat colour, the body painted honestly under the arm. A
 *     correct recut. Pixel equality with assembled.png is total here, and
 *     that must not count as copying (review on #100: it did, and failed it).
 *   - gap: the body cut edge to edge with the arm, nothing under the seam.
 *     The defect the check exists for.
 *   - copied: textured art, the body's hidden band sampled from
 *     assembled.png. Reported for a person to look at, not failed: equality
 *     suggests copying but does not prove it.
 *
 * Python and Pillow are required, the same dependency `art:verify` has.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ART = fileURLToPath(new URL(".", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "kad-seams-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function run(kind: "flat" | "gap" | "copied"): { problems: string[]; warnings: string[] } {
  const py = `
import json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, ${JSON.stringify(ART)})
import verify_seams as vs

base = os.path.join(${JSON.stringify(work)}, ${JSON.stringify(kind)})
os.makedirs(os.path.join(base, "parts"), exist_ok=True)
W = 1024
yy, xx = np.mgrid[0:W, 0:W]
def paint(mask, textured):
    a = np.zeros((W, W, 4), np.uint8)
    if textured:
        a[..., 0] = 120 + (xx * 7 + yy * 13) % 90
        a[..., 1] = 90 + (xx * 3) % 60
        a[..., 2] = 60
    else:
        a[..., :3] = (200, 170, 140)
    a[..., 3] = np.where(mask, 255, 0)
    return a

textured = ${JSON.stringify(kind)} == "copied"
torso = (xx >= 300) & (xx < 600) & (yy >= 300) & (yy < 600)
arm = (xx >= 560) & (xx < 640) & (yy >= 320) & (yy < 700)
# The honest cut paints the body on under the whole arm down to just past the
# torso; the defective one stops the body exactly where the arm begins.
body_mask = (torso & ~arm) if ${JSON.stringify(kind)} == "gap" else (torso | (arm & (yy < 630)))
body = paint(body_mask, textured)
armp = paint(arm, textured)
assembled = body.copy(); assembled[arm] = armp[arm]
Image.fromarray(body).save(os.path.join(base, "parts", "body.png"))
Image.fromarray(armp).save(os.path.join(base, "parts", "arm_l.png"))
Image.fromarray(assembled).save(os.path.join(base, "assembled.png"))
json.dump({"arm_l": {"parent": "body", "x": 580, "y": 340}}, open(os.path.join(base, "joints.json"), "w"))
cfg = os.path.join(base, "rig.json")
json.dump({"root": "body", "adjacency": [["body", "arm_l"]], "zOrder": ["body", "arm_l"]}, open(cfg, "w"))
problems, warnings, notes = vs.check_set(${JSON.stringify(kind)}, base, cfg)
print(json.dumps({"problems": problems, "warnings": warnings}))
`;
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
}

describe("verify_seams", () => {
  it("passes an honest recut in one flat colour: equality with assembled.png is not copying", () => {
    expect(run("flat")).toEqual({ problems: [], warnings: [] });
  });

  it("fails parts cut edge to edge, with nothing under the seam", () => {
    const { problems } = run("gap");
    expect(problems.some((p) => /^body\/arm_l: band/.test(p))).toBe(true);
    expect(problems.some((p) => /^body\/arm_l: joint/.test(p))).toBe(true);
  });

  it("warns, but does not fail, when textured hidden paint equals assembled.png", () => {
    const { problems, warnings } = run("copied");
    expect(problems).toEqual([]);
    expect(warnings.some((w) => /^body\/arm_l: copy\?/.test(w))).toBe(true);
  });
});
