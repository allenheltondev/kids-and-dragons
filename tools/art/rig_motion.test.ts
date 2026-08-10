/**
 * `rig_motion.py` — the pixel half of the motion gate.
 *
 * One test, for one reason: the hole detector this file was written for had
 * never once returned a non-zero number, and nothing noticed. It asked whether
 * a not-solid pixel sat inside an *eroded solid* mask, and the erosion includes
 * the centre pixel — so a pixel that is not solid is never inside it. The
 * expression could not be satisfied by any image. `interior_holes` was 0 for
 * every rig ever measured, and the joint-opening gate reading it was decoration.
 *
 * A metric that cannot fire is worse than no metric, because the summary line
 * says it passed. So this drives the real script over a synthetic clip whose
 * second frame has a hole punched through it, and asserts the number moves.
 *
 * Python and Pillow are required — the same dependency `art:verify` has, and
 * what `requirements-dev.txt` installs. CI sets both up before it runs tests.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./rig_motion.py", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "kad-rig-motion-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/**
 * Build a two-frame APNG and a matching "approved art" PNG.
 *
 * Frame 0 is a solid square. Frame 1 is the same square with `hole` punched
 * clean through it, which is the shape of the defect: a joint coming apart
 * mid-clip rather than art that was always see-through.
 */
function clip(name: string, hole: boolean): { apng: string; art: string } {
  const apng = join(work, `${name}.png`);
  const art = join(work, `${name}_art.png`);
  const py = `
import numpy as np
from PIL import Image
def frame(punch):
    a = np.zeros((128, 128, 4), np.uint8)
    a[30:100, 30:100] = (200, 120, 90, 255)
    if punch:
        a[55:75, 55:75, 3] = 0
    return Image.fromarray(a, "RGBA")
solid = frame(False)
second = frame(${hole ? "True" : "False"})
# Two frames, sampled with a stride of 1 below. Padding this out to ten to
# mimic the real 1/60s stride does not work: APNG collapses runs of identical
# frames, so the file comes back with two anyway and the stride then samples
# only the first one.
solid.save(${JSON.stringify(apng)}, save_all=True,
           append_images=[second], duration=16, loop=0)
solid.save(${JSON.stringify(art)})
`;
  execFileSync("python3", ["-c", py], { stdio: "pipe" });
  return { apng, art };
}

function measure(apng: string, art: string): Record<string, number> {
  const out = execFileSync("python3", [SCRIPT, apng, "1", "99", art], { encoding: "utf8" });
  return JSON.parse(out) as Record<string, number>;
}

describe("interior_holes", () => {
  it("reports a hole that opens mid-clip", () => {
    const { apng, art } = clip("holed", true);
    const m = measure(apng, art);
    // 20x20 punched through. Exactness is not the point — non-zero is, because
    // the implementation this replaces returned 0 here.
    expect(m.interior_holes).toBeGreaterThan(300);
  });

  it("stays at zero for a clip that never opens one", () => {
    const { apng, art } = clip("solid", false);
    expect(measure(apng, art).interior_holes).toBe(0);
  });

  it("ignores a hole the art already had, and measures only what opens", () => {
    /*
     * A figure encloses gaps by design — the space under a wing, the loop of a
     * curled tail — and a clean rig measures a few hundred pixels of them
     * standing still. Reporting the absolute count would make every rig red on
     * its own artwork, so the baseline is the clip's own first tick.
     */
    const apng = join(work, "prehole.png");
    const art = join(work, "prehole_art.png");
    const py = `
import numpy as np
from PIL import Image
a = np.zeros((128, 128, 4), np.uint8)
a[30:100, 30:100] = (200, 120, 90, 255)
a[55:75, 55:75, 3] = 0
img = Image.fromarray(a, "RGBA")
img.save(${JSON.stringify(apng)}, save_all=True, append_images=[img], duration=16, loop=0)
img.save(${JSON.stringify(art)})
`;
    execFileSync("python3", ["-c", py], { stdio: "pipe" });
    expect(measure(apng, art).interior_holes).toBe(0);
  });
});
