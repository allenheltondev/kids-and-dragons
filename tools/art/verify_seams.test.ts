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

function run(
  kind: "flat" | "gap" | "copied" | "rider" | "taper",
  exceptions?: Record<string, unknown>,
): { problems: string[]; warnings: string[]; notes: string[] } {
  const py = `
import json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, ${JSON.stringify(ART)})
import verify_seams as vs

base = os.path.join(${JSON.stringify(work)}, ${JSON.stringify(kind)} + "-" + str(abs(hash(${JSON.stringify(JSON.stringify(exceptions ?? null))}))))
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
if ${JSON.stringify(kind)} == "taper":
    # The torso's own contour narrows behind the lower arm: under the arm the
    # body paints the shoulder (and its 64px joint zone) fully, then only the
    # first 10px lower down, where the waist turns in. The band near the seam's
    # lower end reaches past that, and the check cannot know it should not.
    body_mask = torso | (arm & (yy < 420)) | (arm & (xx < 570) & (yy < 630))
body = paint(body_mask, textured)
armp = paint(arm, textured)
assembled = body.copy(); assembled[arm] = armp[arm]
Image.fromarray(body).save(os.path.join(base, "parts", "body.png"))
Image.fromarray(armp).save(os.path.join(base, "parts", "arm_l.png"))
Image.fromarray(assembled).save(os.path.join(base, "assembled.png"))
json.dump({"arm_l": {"parent": "body", "x": 580, "y": 340}}, open(os.path.join(base, "joints.json"), "w"))
cfg = os.path.join(base, "rig.json")
adjacency, z = [["body", "arm_l"]], ["body", "arm_l"]
if ${JSON.stringify(kind)} == "rider":
    # A leg behind the body, its band painted up under the body, except where
    # the arm (riding the body) hangs over the hip seam: the leg leaves that
    # alone, as the brief requires, and the check must not ask for it.
    leg = (xx >= 520) & (xx < 600) & (yy >= 600) & (yy < 820)
    under = leg | ((xx >= 480) & (xx < 640) & (yy >= 560) & (yy < 600) & ~arm)
    legp = paint(under, False)
    Image.fromarray(legp).save(os.path.join(base, "parts", "leg_l.png"))
    asm = np.asarray(Image.open(os.path.join(base, "assembled.png"))).copy()
    fill = leg & (asm[..., 3] == 0)
    asm[fill] = legp[fill]
    Image.fromarray(asm).save(os.path.join(base, "assembled.png"))
    j = json.load(open(os.path.join(base, "joints.json")))
    j["leg_l"] = {"parent": "body", "x": 540, "y": 590}
    json.dump(j, open(os.path.join(base, "joints.json"), "w"))
    adjacency, z = [["body", "arm_l"], ["body", "leg_l"]], ["leg_l", "body", "arm_l"]
json.dump({"root": "body", "adjacency": adjacency, "zOrder": z}, open(cfg, "w"))
exc = json.loads(${JSON.stringify(JSON.stringify(exceptions ?? null))})
if exc is not None:
    json.dump(exc, open(os.path.join(base, "seam-exceptions.json"), "w"))
problems, warnings, notes = vs.check_set(${JSON.stringify(kind)}, base, cfg)
print(json.dumps({"problems": problems, "warnings": warnings, "notes": notes}))
`;
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
}

describe("verify_seams", () => {
  it("passes an honest recut in one flat colour: equality with assembled.png is not copying", () => {
    const { problems, warnings } = run("flat");
    expect({ problems, warnings }).toEqual({ problems: [], warnings: [] });
  });

  it("fails parts cut edge to edge, with nothing under the seam", () => {
    const { problems } = run("gap");
    expect(problems.some((p) => /^body\/arm_l: band/.test(p))).toBe(true);
    expect(problems.some((p) => /^body\/arm_l: joint/.test(p))).toBe(true);
  });

  it("does not ask a leg to paint under an arm that rides the body over the hip seam", () => {
    const { problems } = run("rider");
    expect(problems).toEqual([]);
  });

  it("warns, but does not fail, when textured hidden paint equals assembled.png", () => {
    const { problems, warnings } = run("copied");
    expect(problems).toEqual([]);
    expect(warnings.some((w) => /^body\/arm_l: copy\?/.test(w))).toBe(true);
  });

  describe("reviewed seam exceptions", () => {
    it("a torso that tapers behind the arm fails the band without one", () => {
      const { problems } = run("taper");
      expect(problems.some((p) => /^body\/arm_l: band .* \(need 98%\)/.test(p))).toBe(true);
      expect(problems.some((p) => /joint/.test(p))).toBe(false);
    });

    it("passes at its reviewed floor, and prints the reason", () => {
      const { problems, notes } = run("taper", { "body/arm_l": { band: 0.5, reason: "waist turns in behind the arm" } });
      expect(problems).toEqual([]);
      expect(notes.some((n) => /reviewed floor 50\.0%: waist turns in behind the arm/.test(n))).toBe(true);
    });

    it("still fails below the reviewed floor", () => {
      const { problems } = run("taper", { "body/arm_l": { band: 0.97, reason: "too generous" } });
      expect(problems.some((p) => /below its reviewed floor 97\.0%/.test(p))).toBe(true);
    });

    it("refuses a floor too low, a missing reason, an unknown pair, and the joint zone", () => {
      const r = run("taper", {
        "body/arm_l": { band: 0.3, reason: "x" },
        "body/arm_r": { band: 0.8, reason: "no such seam" },
      });
      expect(r.problems.some((p) => /'body\/arm_l' band must be a number from 0\.5/.test(p))).toBe(true);
      expect(r.problems.some((p) => /'body\/arm_r' is not a seam this set has/.test(p))).toBe(true);
      expect(run("taper", { "body/arm_l": { band: 0.8 } }).problems.some((p) => /needs a reason/.test(p))).toBe(true);
      expect(run("taper", { "body/arm_l": { band: 0.8, joint: 0.5, reason: "x" } }).problems
        .some((p) => /joint zone is never excepted/.test(p))).toBe(true);
    });

    it("reports an exception the art no longer needs", () => {
      const { problems, notes } = run("flat", { "body/arm_l": { band: 0.8, reason: "stale" } });
      expect(problems).toEqual([]);
      expect(notes.some((n) => /no longer needed, delete it/.test(n))).toBe(true);
    });
  });
});
