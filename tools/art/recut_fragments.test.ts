/**
 * `recut_fragments.py` — removing duplicated fragments without breaking a rig.
 *
 * The re-cut looks like a deletion and is not one. Of the 179 fragments the
 * gate flags in the corpus, 151 are doing a job: `check_seams` requires
 * adjacent parts to share 2,000px, and at most joints the duplicated disc *is*
 * that overlap, sitting on the pivot the rig derives from it. Delete it and the
 * joint has nothing shared, so it opens when the limb turns — a worse defect
 * than the one being fixed, and one nothing else would catch, since the art
 * still recomposites perfectly.
 *
 * So three of the four cases here are fragments the duplicate check flags and
 * the re-cut must refuse anyway. The removable one is last, and without it the
 * others would pass against a tool that simply does nothing.
 *
 * Python and Pillow are required, the same dependency `art:verify` has.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "kad-recut-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/**
 * Three parts on a 256px canvas, and one disc duplicated into `arm`.
 *
 * `body` is the torso block, `arm` reaches in from the right, `mane` sits above
 * and touches neither. The disc is always detached from the arm's own blob —
 * that is what makes it a fragment — and `dup` decides which other part draws
 * the same pixels, which is what makes it a duplicate rather than the only copy
 * of some artwork.
 */
type Layout = {
  /** Centre of the duplicated disc. */
  disc: [number, number];
  /** Wide body/arm overlap of the arm's own, so the disc is not the seam. */
  seam: boolean;
  /** The part carrying the detached copy — the one a deletion would come out of. */
  carrier: "arm" | "mane";
  /** Which part also draws the disc: the adjacent body, the distant mane, or neither. */
  dup: "body" | "mane" | "none";
};

function partSet(name: string, l: Layout): string {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const py = `
import numpy as np
from PIL import Image, ImageDraw

W = 256
def blank(): return np.zeros((W, W, 4), np.uint8)

body = blank()
body[60:200, 40:150] = (180, 120, 90, 255)

# seam=True: the arm reaches well into the body and the pair shares a band of
# its own. seam=False: they barely touch, and the disc is all the overlap there is.
arm = blank()
arm[80:180, ${l.seam ? 100 : 148}:210] = (200, 150, 110, 255)

mane = blank()
mane[20:55, 40:150] = (150, 100, 70, 255)

cx, cy = (${l.disc[0]}, ${l.disc[1]})
d = Image.new("L", (W, W), 0)
ImageDraw.Draw(d).ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=255)
disc = np.array(d) > 0

${l.carrier}[disc] = (180, 120, 90, 255)
${l.dup === "none" ? "" : `${l.dup}[disc] = (180, 120, 90, 255)`}

Image.fromarray(body).save("${join(dir, "body.png")}")
Image.fromarray(arm).save("${join(dir, "arm.png")}")
Image.fromarray(mane).save("${join(dir, "mane.png")}")
`;
  execFileSync("python3", ["-c", py], { stdio: "pipe" });
  return dir;
}

/** Drive `recut_set` directly — the CLI walks the real asset tree, which this is not. */
function recut(dir: string): {
  removed: number; flagged: number; seam: string | null; joint: string | null;
} {
  const py = `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(HERE)})
import numpy as np
from PIL import Image
import recut_fragments as rf

parts = {n: np.array(Image.open(os.path.join(${JSON.stringify(dir)}, n + ".png")).convert("RGBA"))
         for n in ("body", "arm", "mane")}
adj = [["body", "arm"], ["body", "mane"]]
structural = [["body", "arm"]]          # growth parts are excluded, as in the manifest
recs = rf.recut_set(parts, 8, adj, 2000, structural)
dup = [r for r in recs if r["coverage"] >= rf.FRAGMENT_DUPLICATE_COVERAGE]
print(json.dumps({
    "removed": sum(r["removed"] for r in recs),
    "flagged": len(dup),
    "seam": dup[0]["seam"][0] if dup and dup[0]["seam"] else None,
    "joint": dup[0]["joint"][0] if dup and dup[0]["joint"] else None,
}))
`;
  return JSON.parse(
    execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").pop() as string,
  );
}

describe("recut_fragments.py", () => {
  // The 141-fragment case: the disc is the entire body/mane overlap. Removing
  // it satisfies the duplicate check and leaves that joint sharing nothing, so
  // it opens when the mane swings. A growth joint on purpose — those are absent
  // from structuralAdjacency, so this is the seam guard alone, with the joint
  // guard never consulted. 38 of the corpus's fragments are held by this only.
  it("keeps a fragment that is the only overlap at a joint", () => {
    const r = recut(partSet("loadbearing", { disc: [95, 120], seam: true, carrier: "mane", dup: "body" }));
    expect(r.flagged).toBe(1);
    expect(r.seam).toBe("body/mane");
    expect(r.removed).toBe(0);
  });

  // The 10-fragment case: the joint survives the deletion, but the rig derives
  // its pivot from the band's centroid and this fragment is part of that band.
  it("keeps a fragment whose removal would move the joint", () => {
    const r = recut(partSet("pivot", { disc: [72, 120], seam: true, carrier: "arm", dup: "body" }));
    expect(r.flagged).toBe(1);
    expect(r.joint).toBe("body/arm");
    expect(r.removed).toBe(0);
  });

  // The manticore-barb case one level on: nothing else draws these pixels, so
  // the fragment is the only copy of that artwork and is not a duplicate at all.
  it("never removes the last copy of a fragment", () => {
    const r = recut(partSet("lastcopy", { disc: [200, 40], seam: true, carrier: "arm", dup: "none" }));
    expect(r.flagged).toBe(0);
    expect(r.removed).toBe(0);
  });

  // Duplicated by a part that shares no joint with the arm, and clear of every
  // seam band. This is the one the re-cut is for, and without it the three
  // above would pass against a tool that does nothing at all.
  it("removes a duplicate no joint depends on", () => {
    const r = recut(partSet("removable", { disc: [200, 40], seam: true, carrier: "arm", dup: "mane" }));
    expect(r.flagged).toBe(1);
    expect(r.seam).toBe(null);
    expect(r.joint).toBe(null);
    expect(r.removed).toBeGreaterThan(2000);
  });
});
