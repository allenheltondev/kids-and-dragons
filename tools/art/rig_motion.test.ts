/**
 * `rig_motion.py` — the pixel half of the motion gate.
 *
 * Two groups of tests. The first exists because the hole detector this file was
 * written for had
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
 * The second group is about a subtler failure than a dead metric: a live metric
 * that measures two different things and cannot say which. See its own comment.
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

type Metrics = { interior_worst: { px: number; new: number; wall: number }[] };

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
    const m = measure(apng, art) as unknown as Metrics & { interior_holes: number };
    expect(m.interior_holes).toBe(0);
    /*
     * And the description has to agree with the number. Reporting the peak
     * frame's absolute gaps while `interior_holes` is rest-subtracted describes
     * a different thing: the first calibration run in CI listed a bigfoot
     * `revive` that opened 3px as a 76px region walled in by 47px, at
     * coordinates that hardly moved between clips, because it was measuring
     * anatomy every clip shares rather than anything that opened.
     */
    expect(m.interior_worst).toEqual([]);
  });
});

/*
 * `interior_holes` is one number covering two different events, and the gate
 * above it says so: a joint coming apart and a limb lifting both enclose area,
 * so the threshold sits high enough to catch neither cheaply. Measured on the
 * approved art standing still, a griffin already encloses 896px walled in by
 * 30px of figure — anatomy, not breakage. The area cannot separate them.
 *
 * What can be told apart is how deeply the gap is sealed off. These two frames
 * are the same figure enclosing almost the same area: one has a hole punched
 * through the middle of the body, the other a notch pinched shut by a limb
 * crossing back over the silhouette. A human sees the difference instantly;
 * this asserts the measurement does too.
 */
describe("interior_worst", () => {
  function shaped(name: string, kind: "hole" | "pinch"): { apng: string; art: string } {
    const apng = join(work, `${name}.png`);
    const art = join(work, `${name}_art.png`);
    const py = `
import numpy as np
from PIL import Image
def base():
    a = np.zeros((160, 160, 4), np.uint8)
    a[30:130, 40:120] = (200, 120, 90, 255)
    return a

rest = base()

moved = base()
${
  kind === "hole"
    ? `# A hole in the middle of the body: sealed off by the full half-width of the
# torso on every side.
moved[70:90, 70:90, 3] = 0`
    : `# A notch cut in from the edge, then pinched shut by a thin limb laid across
# its mouth — the shape "the gap between two legs" makes.
moved[70:90, 40:90, 3] = 0
moved[70:90, 40:46] = (200, 120, 90, 255)`
}
Image.fromarray(rest, "RGBA").save(${JSON.stringify(apng)}, save_all=True,
    append_images=[Image.fromarray(moved, "RGBA")], duration=16, loop=0)
Image.fromarray(rest, "RGBA").save(${JSON.stringify(art)})
`;
    execFileSync("python3", ["-c", py], { stdio: "pipe" });
    return { apng, art };
  }

  it("reports a deep wall for a hole punched through the body", () => {
    const { apng, art } = shaped("deep", "hole");
    const worst = (measure(apng, art) as unknown as Metrics).interior_worst[0];
    expect(worst).toBeDefined();
    expect(worst!.px).toBeGreaterThan(300);
    expect(worst!.new).toBe(worst!.px); // all of it opened; none was there at rest
    expect(worst!.wall).toBeGreaterThan(20);
  });

  it("reports a shallow wall for a gap pinched shut at the silhouette", () => {
    const { apng, art } = shaped("shallow", "pinch");
    const worst = (measure(apng, art) as unknown as Metrics).interior_worst[0];
    expect(worst).toBeDefined();
    // Comparable area to the punched hole — in fact larger, 880px against 400px,
    // and that is the point. The areas rank these backwards; the walls do not.
    expect(worst!.px).toBeGreaterThan(300);
    expect(worst!.wall).toBeLessThan(10);
  });

  /*
   * The tick these regions are read off used to be `argmax` of the frame's TOTAL
   * enclosed area, and a total cancels. This clip is that cancellation taken to
   * its limit: as the joint tears open, a limb swings shut over a gap the art
   * encloses at rest, and the two areas very nearly annihilate.
   *
   * Every summary number stays quiet. `interior_holes` is a net, so it is 0. The
   * total peaks on the REST frame, so the old selection compared frame 0 with
   * itself, scored every region `new = 0`, and returned nothing — the torn joint
   * was invisible to the description and to the calibration sample both, which is
   * why no amount of sampling those runs would ever have turned one up.
   *
   * Choosing the tick by what opened cannot cancel: closing figure back over
   * anatomy adds nothing to an opening. So the tear is described even though the
   * clip's headline number never moves.
   */
  it("describes a tear the clip's own total cancels out", () => {
    const apng = join(work, "cancelled.png");
    const art = join(work, "cancelled_art.png");
    const py = `
import numpy as np
from PIL import Image
def body():
    a = np.zeros((160, 160, 4), np.uint8)
    a[30:130, 40:120] = (200, 120, 90, 255)
    return a

# At rest the figure encloses 144px of its own negative space — the loop between
# an arm and the torso.
rest = body()
rest[40:52, 50:62, 3] = 0

# Mid-clip the limb closes that loop (-144px) and a joint tears open (+143px).
# The frame's total enclosed area therefore goes DOWN by one pixel.
moved = body()
moved[90:101, 90:103, 3] = 0

Image.fromarray(rest, "RGBA").save(${JSON.stringify(apng)}, save_all=True,
    append_images=[Image.fromarray(moved, "RGBA")], duration=16, loop=0)
Image.fromarray(rest, "RGBA").save(${JSON.stringify(art)})
`;
    execFileSync("python3", ["-c", py], { stdio: "pipe" });
    const m = measure(apng, art) as unknown as Metrics & {
      interior_holes: number;
      interior_worst_tick: number;
    };

    // The number the gate reads never moves — that is the premise, not a bug
    // this test is asking to be fixed. `interior_holes` is a net and the net is
    // negative here, so it floors at 0.
    expect(m.interior_holes).toBe(0);

    // ...and the description still finds the tear, on the later tick, because it
    // is chosen by what opened rather than by the total.
    expect(m.interior_worst_tick).toBe(1);
    const worst = m.interior_worst[0];
    expect(worst).toBeDefined();
    expect(worst!.new).toBe(143);
    // Deep in the torso, not pinched at the silhouette: this is the shape the
    // whole metric exists to point at.
    expect(worst!.wall).toBeGreaterThan(10);
  });

  /*
   * `new` asks whether a region was solid figure at rest. Asked at a fixed
   * CANVAS coordinate, a gap that merely MOVED answers yes: translate a figure
   * whose arm encloses a loop against its torso, and the loop lands where torso
   * used to be. Code review caught this; before the fix these fixtures reported
   * 80px "opened" at a 4px shift, 240px at 12px and the whole 500px gap at 30px,
   * each walled in by 21px — deep enough to sit in the bucket the threshold
   * candidate was being read out of, on a figure with no tear anywhere.
   *
   * Both halves matter and a fix can fail either way: suppress the artefact by
   * going blind to real tears, or keep the sensitivity and keep the artefact.
   * So this drives the same translations twice, once with a tear and once
   * without, and pins both answers.
   */
  describe("a figure that moves is not a figure that tore", () => {
    function translated(name: string, dx: number, tear: boolean) {
      const apng = join(work, `${name}.png`);
      const art = join(work, `${name}_art.png`);
      const py = `
import numpy as np
from PIL import Image
def body(dx=0, tear=False):
    a = np.zeros((200, 200, 4), np.uint8)
    a[40:160, 60:140] = (200, 120, 90, 255)
    # Anatomy: the loop an arm encloses against the torso. 500px, and it is
    # present at rest, so nothing about it is news.
    a[70:90, 80:105, 3] = 0
    if tear:
        # A genuine 288px tear, elsewhere in the torso so it cannot be confused
        # with the loop above.
        a[120:136, 95:113, 3] = 0
    if dx:
        a = np.roll(a, dx, axis=1)
    return a

Image.fromarray(body(0), "RGBA").save(${JSON.stringify(apng)}, save_all=True,
    append_images=[Image.fromarray(body(${dx}, ${tear ? "True" : "False"}), "RGBA")],
    duration=16, loop=0)
Image.fromarray(body(0), "RGBA").save(${JSON.stringify(art)})
`;
      execFileSync("python3", ["-c", py], { stdio: "pipe" });
      return measure(apng, art) as unknown as Metrics & { interior_holes: number };
    }

    for (const dx of [4, 12, 30]) {
      it(`reports nothing when the figure only shifts ${dx}px`, () => {
        const m = translated(`shift${dx}`, dx, false);
        // Translation preserves enclosed area, so the net was always right here.
        // It is the description that used to invent a tear.
        expect(m.interior_holes).toBe(0);
        expect(m.interior_worst).toEqual([]);
      });

      it(`still finds a real tear through a ${dx}px shift`, () => {
        const m = translated(`shifttear${dx}`, dx, true);
        const worst = m.interior_worst[0];
        expect(worst).toBeDefined();
        // Exactly the tear, none of the loop that travelled with the body.
        expect(worst!.new).toBe(288);
        expect(worst!.wall).toBeGreaterThan(20);
      });
    }
  });
});
