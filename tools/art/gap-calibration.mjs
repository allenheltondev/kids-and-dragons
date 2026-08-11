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
 */
const opened = clips.filter((c) => c.interior_holes > 0 && c.worst.length > 0);
const walls = opened.map((c) => Math.max(...c.worst.map((w) => w.wall)));

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
p();

if (opened.length === 0) {
  p("No clip opened an enclosed gap. Nothing to calibrate from this run.");
} else {
  p(md ? "| wall thickness | clips | |" : "wall thickness   clips");
  if (md) p("|---|---:|---|");
  for (const [lo, hi] of BUCKETS) {
    const n = walls.filter((w) => w >= lo && w < hi).length;
    const label = hi > 1e8 ? `${lo}+ px` : `${lo}-${hi - 1} px`;
    const bar = "#".repeat(Math.min(40, n));
    p(md ? `| ${label} | ${n} | \`${bar}\` |` : `  ${label.padEnd(14)} ${String(n).padStart(5)}  ${bar}`);
  }
  p();

  const sorted = [...opened].sort(
    (a, b) => Math.max(...b.worst.map((w) => w.wall)) - Math.max(...a.worst.map((w) => w.wall)),
  );
  p(md ? "### Deepest-walled gaps — look at these clips" : "deepest-walled gaps — look at these clips");
  p();
  p(md ? "| clip | area opened | worst region |" : "clip                                area    worst region");
  if (md) p("|---|---:|---|");
  for (const c of sorted.slice(0, 15)) {
    const w = c.worst.reduce((a, b) => (b.wall > a.wall ? b : a));
    const name = `${c.species}/${c.tier} ${c.clip}`;
    const region = `${w.px}px walled in by ${w.wall}px at (${w.at[0]},${w.at[1]})`;
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
