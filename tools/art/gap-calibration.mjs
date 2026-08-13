#!/usr/bin/env node
/**
 * Kids & Dragons — what the enclosed-gap measurements say.
 *
 * Reads the `--gap-report` JSON that `verify-rig-motion.mjs` writes and prints a
 * distribution. It exists because the motion gate has one open number and this
 * is the only way to close it honestly.
 *
 * The open number: `INTERIOR_GAP_WARN` is a warning rather than a failure
 * because enclosed *area* cannot separate "a joint came apart" from "a limb
 * lifted". That is measured, not assumed — a real defect (parts carrying a
 * detached copy of another part's artwork) opened 2,716px of gap on a bigfoot
 * `attack`, and clean clips of good rigs reach 6,198px. The defect is *below*
 * the clean population. No setting of an area threshold separates them.
 *
 * What does separate them is how thickly a gap is walled in by figure: on
 * constructed shapes, a hole punched through a torso reads 400px of area behind
 * a 31px wall, and a gap pinched shut between two limbs 880px behind a 7px wall
 * — the areas rank those backwards, the walls do not. Setting a threshold on the
 * wall needs its distribution over MOVING rigs, which needs the renderer, which
 * is why this runs in CI and not on a laptop.
 *
 * Read the output as: if the walls are bimodal, the trough is the threshold. If
 * they are not, say so and leave the gate soft — a number invented to look
 * decisive is how this file's neighbour ended up with a metric that could not
 * fire.
 *
 * Usage:
 *     node tools/art/gap-calibration.mjs gap-report.json
 *     node tools/art/gap-calibration.mjs gap-report.json --markdown   # for a CI summary
 */

import { readFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: gap-calibration.mjs <gap-report.json> [--markdown]");
  process.exit(2);
}
const md = rest.includes("--markdown");
const { clips } = JSON.parse(readFileSync(file, "utf8"));

/*
 * Only clips that actually opened a gap carry information about the threshold.
 * A clip whose figure never encloses anything new says nothing about where to
 * draw the line, and letting hundreds of zeroes into the histogram would make
 * any distribution look bimodal at zero.
 *
 * Keyed on the regions, NOT on `interior_holes`, and the difference is not
 * academic. `interior_holes` is a *net*: the peak frame's enclosed area minus
 * the rest frame's. A clip can open a real hole at a joint while a limb closes
 * an equal amount of the figure's own negative space, and the net reads zero.
 * The first good calibration run caught one — `griffin/radiant revive` reported
 * 3px of net change over a region with 141px that had been solid figure at rest.
 * Filtering on the net would have dropped exactly the clips most worth looking
 * at, which is also a fact about the gate above: its headline number can cancel.
 */
const opened = clips.filter((c) => c.worst.length > 0);
/*
 * The wall of the region that OPENED most, not of the biggest region on the
 * frame. `worst` is already ranked by `new` (the part of each region that was
 * solid figure at rest), which is what makes it comparable to interior_holes.
 * Ranking by absolute area instead describes the figure's anatomy — permanent
 * enclosed space that no clip opened — and that is what the first calibration
 * run reported before this was fixed.
 */
const walls = opened.map((c) => c.worst[0].wall);

const BUCKETS = [
  [0, 5],
  [5, 10],
  [10, 20],
  [20, 40],
  [40, 1e9],
];

const out = [];
const p = (s = "") => out.push(s);

p(md ? "## Enclosed-gap calibration" : "enclosed-gap calibration");
p();
p(`${clips.length} clips measured, ${opened.length} opened a gap during the clip.`);
p("(\"opened\" counts regions that were solid figure at rest, not the net area change.)");
p();

if (opened.length === 0) {
  p("No clip opened an enclosed gap. Nothing to calibrate from this run.");
} else {
  p(md ? "| wall thickness | clips | |" : "wall thickness   clips");
  if (md) p("|---|---:|---|");
  // Scaled to the tallest bucket. Clamping instead of scaling drew 42, 69, 80
  // and 91 as four identical 40-wide bars, which is a histogram that hides its
  // own shape — the one thing it exists to show.
  const tallest = Math.max(1, ...BUCKETS.map(([lo, hi]) => walls.filter((w) => w >= lo && w < hi).length));
  for (const [lo, hi] of BUCKETS) {
    const n = walls.filter((w) => w >= lo && w < hi).length;
    const label = hi > 1e8 ? `${lo}+ px` : `${lo}-${hi - 1} px`;
    const bar = "#".repeat(Math.round((n / tallest) * 40));
    p(md ? `| ${label} | ${n} | \`${bar}\` |` : `  ${label.padEnd(14)} ${String(n).padStart(5)}  ${bar}`);
  }
  p();

  const sorted = [...opened].sort((a, b) => b.worst[0].wall - a.worst[0].wall);
  p(md ? "### Deepest-walled gaps — look at these clips" : "deepest-walled gaps — look at these clips");
  p();
  p(md ? "| clip | net change | worst region |" : "clip                                 net    worst region");
  if (md) p("|---|---:|---|");
  for (const c of sorted.slice(0, 15)) {
    const w = c.worst[0];
    const name = `${c.rig} ${c.clip}`;
    // The tick is part of "look at these clips": it is chosen by what opened, so
    // it is not the tick the net change points at.
    const at = c.worst_tick == null ? "" : ` on tick ${c.worst_tick}`;
    const region = `${w.new}px opened (of ${w.px}px) walled in by ${w.wall}px at (${w.at[0]},${w.at[1]})${at}`;
    p(md ? `| \`${name}\` | ${c.interior_holes}px | ${region} |` : `  ${name.padEnd(34)} ${String(c.interior_holes).padStart(6)}px  ${region}`);
  }
  p();

  /*
   * The caveat that decides how much this run is worth. The delivered art
   * carries a known defect — 179 duplicated fragments across 115 parts
   * (docs/briefs/part-fragments.md) — so some of what is measured here IS the
   * defect rather than the clean population it is meant to describe. Re-run
   * after the re-cut before setting anything from it.
   */
  p(
    md
      ? "> **Before setting a threshold from this:** the delivered art still carries 179 duplicated " +
        "fragments across 115 parts (`docs/briefs/part-fragments.md`), so part of this sample is the " +
        "defect rather than the clean population. Re-run after the re-cut."
      : "NOTE: the art still carries 179 duplicated fragments (docs/briefs/part-fragments.md),\n" +
        "so part of this sample is the defect. Re-run after the re-cut before setting a number.",
  );
}

console.log(out.join("\n"));
