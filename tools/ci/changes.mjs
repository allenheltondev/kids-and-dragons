#!/usr/bin/env node
/**
 * Kids & Dragons — which CI jobs does this change need?
 *
 * Every pull request used to run everything: ~4 minutes of build, ~6½ of
 * end-to-end, ~3 of rig rest gate, a staging deploy, and — whenever
 * `assets/manifest.json` was touched at all — a rig rebuild and the 25–45
 * minute motion gate. A PR that added one entity to the manifest paid for all
 * of it; a PR that fixed a typo in a doc paid for everything but the motion.
 *
 * This decides, from the files a pull request changes, which of those jobs
 * can say anything about it. Each workflow runs it as a fast first job and
 * gates its expensive jobs on the outputs with `if:`. That is deliberate: a
 * job skipped by `if:` reports as passed, so a required check is satisfied; a
 * workflow skipped by `on.paths` reports nothing, and a required check waits
 * for it forever.
 *
 * Pushes and manual runs are not classified: every output is true, so main is
 * always fully verified (and prod-deploy, which follows CI on main, never
 * ships something a skipped job would have caught).
 *
 * The rules are lists of what a job can safely IGNORE, never of what it
 * needs: a file nobody thought about runs everything. Adding a new kind of
 * file to the repo therefore costs CI time, not coverage.
 *
 * Usage (in a workflow; BASE and HEAD are commit shas):
 *     node tools/ci/changes.mjs "$BASE" HEAD      # writes to $GITHUB_OUTPUT
 *     node tools/ci/changes.mjs --all             # push/dispatch: everything true
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The outputs, in the order they are reported. */
export const JOBS = ["build", "e2e", "rigs", "motion", "deploy"];

/** Prose only: changes nothing any job builds, tests or ships. */
const DOCS = [/\.md$/, /^docs\//, /^LICENSE/];

/**
 * Not part of the running game: source and review art, art and CI tooling,
 * the wiki (its own workflow), dev-only Python deps, and the workflows that
 * are not the one being run. The end-to-end suite plays the game, so none of
 * these can change what it sees. Rig PNG parts and joints are inputs to a
 * rig.riv, not to the game; the rig.riv itself is not on this list.
 */
const NOT_GAME = [
  ...DOCS,
  /^art\//,
  /^tools\/art\//,
  /^tools\/ci\//,
  /^tools\/wiki\//,
  /^wiki\//,
  /^requirements-dev\.txt$/,
  /^\.github\/actions\/rive-cli\//,
  /^\.github\/workflows\/(rig-motion|deploy|prod-deploy|wiki-deploy)\.yml$/,
  /^assets\/(characters|character-rigs)\/.*\/parts\//,
  /^assets\/(characters|character-rigs)\/.*\/joints\.json$/,
];

/** On top of NOT_GAME, what staging also does not need: tests change nothing that ships. */
const NOT_SHIPPED = [
  ...NOT_GAME,
  /^e2e\//,
  /^playwright(\.wiki)?\.config\.ts$/,
  /^vitest\.config\.ts$/,
  /\.test\.(ts|tsx|mjs|js)$/,
  /(^|\/)__tests__\//,
  /^\.github\/workflows\/ci\.yml$/,
];

/**
 * What a rig is built from or measured with. Unlike the lists above this one
 * says what a job NEEDS: the rig gates measure only rigs, so any other change
 * cannot move them. The classifier itself is here so a change to it runs the
 * gates it might be wrongly skipping.
 */
const RIG_INPUTS = [
  /^art\/rig\//,
  /^assets\/(characters|character-rigs)\/.*\/parts\//,
  /^assets\/(characters|character-rigs)\/.*\/joints\.json$/,
  /^assets\/(characters|character-rigs)\/.*\/rig\.riv$/,
  /^assets\/(characters|character-rigs)\/.*\/assembled\.png$/,
  /^tools\/art\/(build-rigs|rive-cli|setup-rive|verify-rig-rest)\.mjs$/,
  /^\.github\/actions\/rive-cli\//,
  /^\.github\/workflows\/ci\.yml$/,
  /^tools\/ci\//,
];

/** The motion gate's own machinery, on top of RIG_INPUTS. */
const MOTION_INPUTS = [
  /^art\/rig\//,
  /^assets\/(characters|character-rigs)\/.*\/parts\//,
  /^assets\/(characters|character-rigs)\/.*\/joints\.json$/,
  /^assets\/(characters|character-rigs)\/.*\/rig\.riv$/,
  /^tools\/art\/(build-rigs|rive-cli|setup-rive|verify-rig-motion|gap-calibration)\.mjs$/,
  /^tools\/art\/rig_motion\.py$/,
  /^\.github\/actions\/rive-cli\//,
  /^\.github\/workflows\/rig-motion\.yml$/,
  /^tools\/ci\//,
];

/**
 * The manifest sections the rig tooling reads (build-rigs, verify-rig-rest,
 * verify-rig-motion, rig-sheet, and the builder's --contract). An edit
 * anywhere else in the manifest — a new entity, an effect, a biome — cannot
 * change a rig or how one is measured.
 */
export const RIG_MANIFEST_KEYS = ["canvas", "rigStage", "rigVariants", "species", "tiers", "tolerance", "rigContract"];

const any = (file, rules) => rules.some((r) => r.test(file));

/**
 * Decide the jobs for a list of changed paths. `rigManifestChanged` says
 * whether a RIG_MANIFEST_KEYS section of assets/manifest.json differs; the
 * manifest's other sections count as an ordinary game file.
 */
export function classify(files, { rigManifestChanged = false } = {}) {
  const game = files.filter((f) => !any(f, NOT_GAME));
  return {
    build: files.some((f) => !any(f, DOCS)),
    e2e: game.length > 0,
    rigs: rigManifestChanged || files.some((f) => any(f, RIG_INPUTS)),
    motion: rigManifestChanged || files.some((f) => any(f, MOTION_INPUTS)),
    deploy: files.some((f) => !any(f, NOT_SHIPPED)),
  };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function rigSections(rev) {
  let text;
  try {
    text = git("show", `${rev}:assets/manifest.json`);
  } catch {
    return null; // no manifest at that revision
  }
  const m = JSON.parse(text);
  return JSON.stringify(RIG_MANIFEST_KEYS.map((k) => m[k] ?? null));
}

function main() {
  const args = process.argv.slice(2);
  let result;
  let why;
  if (args[0] === "--all") {
    result = Object.fromEntries(JOBS.map((j) => [j, true]));
    why = "not a pull request: every job runs";
  } else {
    const [base, head = "HEAD"] = args;
    if (!base) {
      console.error("usage: changes.mjs <base> [head]  |  changes.mjs --all");
      process.exit(2);
    }
    const files = git("diff", "--name-only", base, head).split("\n").filter(Boolean);
    const rigManifestChanged = files.includes("assets/manifest.json") && rigSections(base) !== rigSections(head);
    result = classify(files, { rigManifestChanged });
    why = `${files.length} file(s) changed${files.includes("assets/manifest.json") ? `; manifest rig sections ${rigManifestChanged ? "changed" : "unchanged"}` : ""}`;
  }
  const lines = JOBS.map((j) => `${j}=${result[j]}`);
  console.log(`${why}\n${lines.join("\n")}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Jobs this change needs\n\n${why}\n\n| job | runs |\n|---|---|\n${JOBS.map((j) => `| ${j} | ${result[j] ? "yes" : "skipped"} |`).join("\n")}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
