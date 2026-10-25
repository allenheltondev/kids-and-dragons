#!/usr/bin/env node
/**
 * Kids & Dragons — which CI jobs does this change need?
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
export const JOBS = ["build", "e2e", "deploy"];

/** Prose only: changes nothing any job builds, tests or ships. */
const DOCS = [/\.md$/, /^docs\//, /^LICENSE/];

/**
 * Not part of the running game: source and review art, art and CI tooling,
 * the wiki (its own workflow), dev-only Python deps, and the workflows that
 * are not the one being run. The end-to-end suite plays the game, so none of
 * these can change what it sees.
 */
const NOT_GAME = [
  ...DOCS,
  /^art\//,
  /^tools\/art\//,
  // Except e2e-shard, which decides what the end-to-end shards run.
  /^tools\/ci\/(?!e2e-shard\.)/,
  /^tools\/wiki\//,
  /^wiki\//,
  /^requirements-dev\.txt$/,
  /^\.github\/workflows\/(deploy|prod-deploy|wiki-deploy)\.yml$/,
];

/** On top of NOT_GAME, what staging also does not need: tests change nothing that ships. */
const NOT_SHIPPED = [
  ...NOT_GAME,
  /^e2e\//,
  /^tools\/ci\/e2e-shard\./,
  /^playwright(\.wiki|\.prod)?\.config\.ts$/,
  /^vitest\.config\.ts$/,
  /\.test\.(ts|tsx|mjs|js)$/,
  /(^|\/)__tests__\//,
  /^\.github\/workflows\/ci\.yml$/,
];

const any = (file, rules) => rules.some((r) => r.test(file));

/** Decide which checks and deployments can be affected by changed files. */
export function classify(files) {
  const game = files.filter((f) => !any(f, NOT_GAME));
  return {
    build: files.some((f) => !any(f, DOCS)),
    e2e: game.length > 0,
    deploy: files.some((f) => !any(f, NOT_SHIPPED)),
  };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
    result = classify(files);
    why = `${files.length} file(s) changed`;
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
