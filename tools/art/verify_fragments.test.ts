/**
 * `verify.py` — the duplicated-fragment check.
 *
 * The defect this guards against passed every gate in the pipeline and was
 * found by a person looking at a contact sheet: parts carrying a detached copy
 * of artwork another part already draws. At rest the copy sits exactly on its
 * original, so `check_recomposite` is satisfied — any partition of the image
 * is, including one that hands the same pixels to two parts — and the rig
 * gates, which render the rest pose, cannot see it either. It only appears when
 * the part rotates and takes the copy with it.
 *
 * The hard part is not spotting detached fragments. It is spotting the *wrong*
 * ones: detached artwork is legitimate and common — the manticore's barbed tail
 * is six components and the barbs never touch the shaft. So the two cases below
 * are the whole point of the test, and a check that fires on both is as useless
 * as one that fires on neither.
 *
 * Python and Pillow are required, the same dependency `art:verify` has.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const VERIFY = fileURLToPath(new URL("./verify.py", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "kad-fragment-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/**
 * Two parts on a shared canvas, plus the fragment under test.
 *
 * `body` is a big rectangle; `arm` is a smaller one beside it, overlapping
 * enough to satisfy the seam rule. The fragment is a disc, and `over` decides
 * whether it lands on top of the body — a duplicate — or out in open space
 * where nothing else draws, which is the legitimate barb case.
 */
function partSet(name: string, over: boolean): string {
  const dir = join(work, name);
  mkdirSync(join(dir, "parts"), { recursive: true });
  const py = `
import numpy as np
from PIL import Image, ImageDraw

W = 256
def blank(): return np.zeros((W, W, 4), np.uint8)

body = blank()
body[60:200, 40:150] = (180, 120, 90, 255)

arm = blank()
arm[80:180, 140:200] = (200, 150, 110, 255)   # overlaps body by 10px

# The fragment: a disc, drawn into the arm. ${over ? "On the body" : "In open space"}.
cx, cy = (${over ? "95, 120" : "225, 40"})
d = Image.new("L", (W, W), 0)
ImageDraw.Draw(d).ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=255)
disc = np.array(d) > 0
arm[disc] = (180, 120, 90, 255)
${over ? "body[disc] = (180, 120, 90, 255)   # the body already draws it" : ""}

# assembled.png is the parts stacked in z-order, so recomposite passes either way.
asm = blank()
for layer in (body, arm):
    a = layer[..., 3:4] / 255.0
    asm[..., :3] = (layer[..., :3] * a + asm[..., :3] * (1 - a)).astype(np.uint8)
    asm[..., 3:4] = (a * 255 + asm[..., 3:4] * (1 - a)).astype(np.uint8)

Image.fromarray(body).save("${join(dir, "parts", "body.png")}")
Image.fromarray(arm).save("${join(dir, "parts", "arm.png")}")
Image.fromarray(asm).save("${join(dir, "assembled.png")}")
`;
  execFileSync("python3", ["-c", py], { stdio: "pipe" });
  return dir;
}

/** Drive the check directly — the CLI walks the real asset tree, which this is not. */
function runCheck(dir: string): string {
  const py = `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(fileURLToPath(new URL(".", import.meta.url)))})
import verify
import numpy as np
from PIL import Image

parts = {}
for n in ("body", "arm"):
    parts[n] = np.array(Image.open(os.path.join(${JSON.stringify(dir)}, "parts", n + ".png")).convert("RGBA"))

rep = verify.Report()
verify.check_part_fragments(rep, "test", parts, {"alphaThreshold": 8})
print(json.dumps({"warnings": rep.warnings, "passed": rep.passed}))
`;
  const out = execFileSync("python3", ["-c", py], { encoding: "utf8" });
  return out.trim().split("\n").pop() as string;
}

describe("verify.py duplicated part fragments", () => {
  it("flags a detached fragment another part already draws", () => {
    const r = JSON.parse(runCheck(partSet("dup", true)));
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("duplicated part fragments");
  });

  // The manticore tail case. Nothing else in the set draws these pixels, so the
  // fragment is the only source of that artwork and removing it would lose art.
  it("leaves detached artwork alone when it is the only copy", () => {
    const r = JSON.parse(runCheck(partSet("unique", false)));
    expect(r.warnings).toEqual([]);
    expect(r.passed).toBe(1);
  });
});
