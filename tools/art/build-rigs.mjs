#!/usr/bin/env node
/**
 * Kids & Dragons — build every rig from its config, or prove the committed
 * ones still are.
 *
 * Rigging is generated, not authored (art-pipeline §3): a `.riv` is the output
 * of `rive-mcp-build rig` given a config in `art/rig/`, a parts directory and
 * the contract in `assets/manifest.json`. Until this file existed that command
 * was run by hand, one rig at a time, from a shell loop somebody typed — which
 * meant "which config, which parts, which flags" for 54 rigs was carried in
 * commit messages, and the question *does the committed rig still match its
 * config* had no way to be asked. Both of those are this file's job.
 *
 * Every job is derived from the manifest, not listed here: `species` × `tiers`
 * gives the 24 base rigs, `rigVariants` the 30 class rigs. A rig whose config
 * or parts are missing is a failure, not a skip — with one exception, taken
 * from `verify.py`: a tier whose directory does not exist at all is *not yet
 * delivered*, and is reported rather than failed, because a check that reds
 * the build on art nobody has drawn yet is a check people learn to skip. A
 * directory that exists with no `parts/` in it is something else: art that
 * was delivered and then lost, and that is exactly a failure.
 *
 * All the jobs go through ONE `batch` invocation, so Chromium starts once
 * rather than 54 times; the browser start is most of a single `rig` call.
 * The generator is deterministic — a full rebuild of all 54 was byte-identical
 * to the committed set — and `--check` is built on that: it builds every rig
 * into a temp directory and compares bytes with the committed one, which is
 * how CI tells a PR that edited a config without rebuilding, or a rebuild
 * under a moved pin, from one that did the whole job.
 *
 * Usage:
 *     npm run art:rig:build                          rebuild all 54 in place
 *     npm run art:rig:build -- unicorn kitsune       one or more species
 *     npm run art:rig:build -- unicorn/mythic        one base rig
 *     npm run art:rig:build -- thornguard/mythic/unicorn   one class rig
 *     npm run art:rig:build -- --check               rebuild to a temp dir, compare bytes
 *     npm run art:rig:build -- --jobs 4              batch concurrency (default 2)
 *
 * Exit 0 when every rig built (and, with --check, matched); 1 when a rig
 * failed to build, failed the contract, or differs; 2 when the CLI could not
 * run at all. Needs the Rive CLI — `npm run art:rig:setup`, or KAD_RIVE_CLI.
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { cannotRunMessage, ROOT, resolveChrome, resolveCli, runBatch, runCli } from "./rive-cli.mjs";

const MANIFEST_PATH = join(ROOT, "assets", "manifest.json");
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

const tty = process.stdout.isTTY;
const RED = tty ? "\x1b[31m" : "";
const GREEN = tty ? "\x1b[32m" : "";
const YELLOW = tty ? "\x1b[33m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const RESET = tty ? "\x1b[0m" : "";

// ---- arguments ----------------------------------------------------------------

const args = process.argv.slice(2);
const VALUE_OPTIONS = new Set(["--jobs"]);
const check = args.includes("--check");
const jobsIdx = args.indexOf("--jobs");
const concurrency = jobsIdx >= 0 ? Number(args[jobsIdx + 1]) : 2;
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error("error: --jobs expects a whole number of workers, at least 1");
  process.exit(2);
}
// A bare word is a filter unless it is the value of an option that takes one.
// Spelled as a set rather than an inline check so the next option added here
// cannot silently turn its value into a filter that matches nothing.
const wanted = args.filter((a, i) => !a.startsWith("--") && !VALUE_OPTIONS.has(args[i - 1]));
for (const a of args) {
  if (a.startsWith("--") && a !== "--check" && !VALUE_OPTIONS.has(a)) {
    console.error(`error: unknown option ${a}`);
    process.exit(2);
  }
}

// ---- the job list, from the manifest --------------------------------------------

/**
 * One entry per rig the manifest declares. `label` is how a person names it
 * (`unicorn/mythic`, `thornguard/mythic/unicorn`) and also the batch job id.
 */
export function rigTargets(manifest = MANIFEST) {
  const targets = [];
  for (const sp of manifest.species) {
    for (const tier of manifest.tiers) {
      const dir = join(ROOT, "assets", "characters", sp.id, tier);
      targets.push({
        label: `${sp.id}/${tier}`,
        species: sp.id,
        tier,
        dir,
        config: join(ROOT, "art", "rig", `${sp.id}.rig.json`),
        parts: join(dir, "parts"),
        out: join(dir, "rig.riv"),
      });
    }
  }
  for (const v of manifest.rigVariants ?? []) {
    const dir = join(ROOT, "assets", "character-rigs", v.class, v.tier, v.species);
    targets.push({
      label: `${v.class}/${v.tier}/${v.species}`,
      species: v.species,
      tier: v.tier,
      class: v.class,
      dir,
      config: join(ROOT, "art", "rig", `${v.class}-${v.tier}-${v.species}.rig.json`),
      parts: join(dir, "parts"),
      out: join(dir, "rig.riv"),
    });
  }
  return targets;
}

/**
 * A filter word matches a species (every rig of it, class variants included),
 * a `species/tier` (that one base rig — a class rig of the same species and
 * tier is `class/tier/species`, and is not swept in), or a full class label.
 */
function matches(target, word) {
  if (word === target.label) return true;
  if (word === target.species) return true;
  return !target.class && word === `${target.species}/${target.tier}`;
}

const all = rigTargets();
const selected = wanted.length === 0 ? all : all.filter((t) => wanted.some((w) => matches(t, w)));
for (const w of wanted) {
  if (!all.some((t) => matches(t, w))) {
    console.error(`error: '${w}' names no rig the manifest declares (species, species/tier, or class/tier/species)`);
    process.exit(2);
  }
}

// ---- preflight: every input present, or say which is not ------------------------

const undelivered = [];
const missing = [];
const targets = [];
for (const t of selected) {
  if (!existsSync(t.dir)) {
    undelivered.push(t.label);
    continue;
  }
  const gone = [];
  if (!existsSync(t.config)) gone.push(`config ${relative(ROOT, t.config)}`);
  if (!existsSync(t.parts)) gone.push(`parts ${relative(ROOT, t.parts)}/`);
  if (gone.length > 0) {
    missing.push(`${t.label}: ${gone.join(", ")}`);
    continue;
  }
  targets.push(t);
}

console.log(`${BOLD}Kids & Dragons - rig ${check ? "reproducibility" : "build"}${RESET}`);
console.log(
  `${DIM}${targets.length} rig(s) from ${relative(ROOT, MANIFEST_PATH)} · contract set hero · ` +
    `${check ? "building to a temp dir and comparing bytes with the committed rig.riv" : "writing rig.riv in place"}${RESET}`,
);
if (undelivered.length > 0) {
  console.log(`${DIM}not yet delivered: ${undelivered.length} - ${undelivered.slice(0, 6).join(", ")}${undelivered.length > 6 ? "..." : ""}${RESET}`);
}
if (missing.length > 0) {
  console.log(`\n${RED}error${RESET}: a delivered rig is missing an input it is built from:`);
  for (const m of missing) console.log(`  ${m}`);
  console.log(`\n${RED}FAILED${RESET} - a rig cannot be built. A tier directory with no parts/ is art that was lost, not art not yet drawn.`);
  process.exit(1);
}
if (targets.length === 0) {
  console.error("error: nothing to build");
  process.exit(2);
}

// ---- build ------------------------------------------------------------------------

const cli = resolveCli();
const chrome = resolveChrome();
console.log(`${DIM}cli ${[cli.cmd, ...cli.pre].join(" ")} (${cli.source})   chromium ${chrome ?? "(the CLI's own search)"}${RESET}\n`);

const work = check ? mkdtempSync(join(tmpdir(), "kad-rig-check-")) : null;
const outFor = (t) => (check ? join(work, `${t.label.replace(/\//g, "_")}.riv`) : t.out);

const jobs = targets.map((t) => ({
  id: t.label,
  cmd: "rig",
  parts: t.parts,
  config: t.config,
  out: outFor(t),
  contract: MANIFEST_PATH,
  set: "hero",
}));

const started = performance.now();
let results;
let batched = true;
try {
  ({ results } = runBatch(jobs, { concurrency, cli }));
} catch (err) {
  if (!err.unsupported) {
    console.error(`${RED}error${RESET}: ${err.message}`);
    if (work) rmSync(work, { recursive: true, force: true });
    process.exit(2);
  }
  // The pinned CLI is older than `batch`. Same command, same bytes, one
  // browser per rig — slower, and said so, rather than a red build over a
  // convenience the pin has not caught up with yet.
  console.log(`${YELLOW}note${RESET}: ${err.message}; running one \`rig\` per rig instead (a browser start each)\n`);
  batched = false;
  results = jobs.map((job) => {
    const r = runCli(
      ["rig", "--parts", job.parts, "--config", job.config, "-o", job.out, "--contract", job.contract, "--set", job.set],
      { json: true, cli },
    );
    if (r.error) {
      console.error(`${RED}error${RESET}: ${cannotRunMessage(cli)}`);
      if (work) rmSync(work, { recursive: true, force: true });
      process.exit(2);
    }
    if (r.json) return { id: job.id, ...r.json };
    return { id: job.id, ok: false, error: (r.stderr || r.stdout).trim().split("\n").pop() };
  });
}
const elapsed = (performance.now() - started) / 1000;
const how = batched ? `concurrency ${concurrency}` : "one browser per rig";

// ---- report -------------------------------------------------------------------------

const byId = new Map(results.map((r) => [r.id, r]));
const failed = [];
const differs = [];
let built = 0;

for (const t of targets) {
  const r = byId.get(t.label);
  if (!r) {
    failed.push(t.label);
    console.log(`  ${RED}FAIL${RESET}  ${t.label}  the batch returned no result for this job`);
    continue;
  }
  if (r.error || !existsSync(outFor(t))) {
    failed.push(t.label);
    console.log(`  ${RED}FAIL${RESET}  ${t.label}  ${r.error ?? "no rig.riv was written"}`);
    continue;
  }

  const pivots = r.pivots ?? [];
  const guessed = pivots.filter((p) => p.source === "guess");
  const measured = pivots.length - guessed.length;
  const contract = r.contract;
  const warnings = r.warnings ?? [];
  const contractOk = contract ? contract.ok : true;

  let verdict = GREEN + "ok  " + RESET;
  let note = "";
  if (check) {
    const committed = t.out;
    const same = existsSync(committed) && readFileSync(committed).equals(readFileSync(outFor(t)));
    if (!same) {
      verdict = RED + "DIFF" + RESET;
      note = existsSync(committed) ? "  differs from the committed rig.riv" : "  no committed rig.riv to compare with";
      differs.push(t.label);
    }
  }
  if (!contractOk) {
    verdict = RED + "FAIL" + RESET;
    failed.push(t.label);
  }
  built += 1;

  const pivotText = `${measured} measured${guessed.length ? `, ${YELLOW}${guessed.length} guessed${RESET} (${guessed.map((p) => `${p.parent}-${p.part}`).join(", ")})` : ""}`;
  const contractText = contract ? (contract.ok ? "contract ok" : `contract ${RED}${contract.findings.length} finding(s)${RESET}`) : "no contract";
  console.log(`  ${verdict}  ${t.label.padEnd(30)} ${String(r.parts ?? "?").padStart(2)} parts  pivots ${pivotText}  ${contractText}${note}`);
  for (const f of contract && !contract.ok ? contract.findings : []) {
    console.log(`        ${RED}${f.severity}${RESET} ${f.rule}: ${f.message}`);
  }
  // The `roles` report (rive-mcp e1a7ac5 and later; older CLIs return none)
  // says which parts the acting recipes matched by name and which they did
  // not. An unmatched part is not an error: it rides its parent without
  // acting of its own, which is right for a horn and wrong for a wing. It is
  // printed so that the difference is read here rather than noticed on a
  // contact sheet. The root has no parent to ride and is left out.
  const parentOf = new Map(pivots.map((p) => [p.part, p.parent]));
  const unmatched = (r.roles ?? []).filter((x) => x.source === "unmatched" && parentOf.has(x.part));
  if (unmatched.length > 0) {
    console.log(`        ${DIM}no role${RESET}  ${unmatched.map((x) => `${x.part}: ${x.role} - rides ${parentOf.get(x.part)}`).join(", ")}`);
  }
  for (const w of warnings) console.log(`        ${YELLOW}warning${RESET} ${w}`);
}

if (work) rmSync(work, { recursive: true, force: true });

console.log(`\n${"-".repeat(60)}`);
console.log(`${DIM}${targets.length} rig(s) in ${elapsed.toFixed(1)}s (${(elapsed / targets.length).toFixed(1)}s each, ${how})${RESET}`);

if (failed.length > 0) {
  console.log(`${built - failed.length} built   ${RED}${failed.length} FAILED${RESET}: ${failed.join(", ")}\n`);
  console.log(`${RED}FAILED${RESET} - a rig did not build, or built and failed its contract.`);
  process.exit(1);
}
if (check) {
  if (differs.length > 0) {
    console.log(`${built - differs.length}/${built} reproducible   ${RED}${differs.length} differ${RESET}:`);
    for (const d of differs) console.log(`  ${d}`);
    console.log(
      `\n${RED}FAILED${RESET} - a rig differs from its config. Rebuild with \`npm run art:rig:build\` and commit the result, ` +
        `or the pin moved (art/rig/rive-mcp.pin.json) and the committed rigs were built by a different generator.`,
    );
    process.exit(1);
  }
  console.log(`${built}/${built} reproducible\n`);
  console.log(`${GREEN}PASS${RESET} - every committed rig is what its config builds.`);
} else {
  console.log(`${built} built\n`);
  console.log(`${GREEN}DONE${RESET} - now run art:verify:rig:strict, art:verify:rig:rest and art:verify:rig:motion (art-pipeline §6.3).`);
}
