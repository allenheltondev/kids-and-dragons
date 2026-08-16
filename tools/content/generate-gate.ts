/**
 * The gate the generator checks against — the real one.
 *
 * `tools/content/validate.mjs` already knows every rule a chapter has to satisfy:
 * the JSON Schema, every `goto` resolving, every scene reachable *and* able to
 * reach an ending, every `itemId` in the catalog, every objective flag actually
 * set by some effect, the bonus XP under §8.2's 25% cap, the biome in the art
 * manifest, the map ids on encounters, the creature ids in the bestiary. It is
 * what CI runs, and it is what "a chapter that builds" means.
 *
 * So the generator runs *that*, rather than an approximation of it. A second
 * implementation of those rules living inside the generator would drift, and it
 * would drift in the direction that makes the tool worthless: producing chapters
 * that satisfy the generator's idea of the rules and fail the build.
 *
 * ---------------------------------------------------------------------------
 * HOW A CANDIDATE GETS CHECKED
 *
 * `validate.mjs` reads a whole content tree, and it takes `KAD_CONTENT_ROOT` to
 * say which one — a seam its own header explains ("a gate that only ever runs
 * against the one corpus it ships with can prove that corpus has not *changed*,
 * and cannot prove it would catch anything"). This uses that seam: link the real
 * tree into a scratch directory, drop the candidate in beside the real chapters,
 * and run the gate over the result.
 *
 * Which gives the property that makes the report readable. The real tree is
 * green — this refuses to start otherwise — so **every failure the staging run
 * reports is the candidate's**. There is no filtering to get wrong.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const VALIDATOR = path.join(ROOT, "tools", "content", "validate.mjs");

export interface GateRun {
  ok: boolean;
  /** One line per failure, in the validator's own words. */
  problems: string[];
  /** Everything it printed, for a `--verbose` flag or a bug report. */
  output: string;
}

/**
 * The validator's failures, lifted out of its report.
 *
 * It prints a four-line block per failure — `FAIL <file>` then `at:`, `problem:`
 * and an optional hint — and all four lines are worth keeping. The `at:` pointer
 * tells the model *where*, and the hint is frequently the most actionable part
 * ("did you mean: scene_shrine?", "flags set here: found_shrine").
 *
 * Exported so the parse is testable against a captured report without spawning
 * anything.
 */
export function readFailures(output: string): string[] {
  const problems: string[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    // The colour codes are stripped rather than matched around: the validator
    // only emits them on a TTY, and a check that worked in a terminal and not in
    // a pipe would be the worst possible bug in a gate.
    const line = (lines[i] ?? "").replace(/\[[0-9;]*m/g, "");
    /*
     * Anchored on the indent because that is the shape of a failure *block*:
     * `rep.fail` prints "  FAIL  <file>" under its section heading, and the
     * run's own summary sits at column zero. Today the summary reads "FAILED"
     * and would not match either way — this keeps the parse tied to the block
     * rather than to the word appearing anywhere in the output.
     */
    const failure = /^\s+FAIL\s+(.+)$/.exec(line);
    if (!failure) continue;

    const parts: string[] = [failure[1]?.trim() ?? ""];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = (lines[j] ?? "").replace(/\[[0-9;]*m/g, "");
      // The block is the indented lines that follow, up to the next report line.
      if (!/^\s{6,}\S/.test(next)) break;
      parts.push(next.trim());
    }
    problems.push(parts.join(" — "));
  }

  return problems;
}

/** Runs `validate.mjs` over a tree and reports what it said. */
export function runValidator(contentRoot: string): GateRun {
  const result = spawnSync(process.execPath, [VALIDATOR], {
    env: { ...process.env, KAD_CONTENT_ROOT: contentRoot },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { ok: result.status === 0, problems: readFailures(output), output };
}

/**
 * A scratch tree that is the real one plus a candidate chapter.
 *
 * Symlinked rather than copied: `content/` and `assets/` are read-only to the
 * validator, and copying them per repair round would be a few megabytes of
 * pointless I/O per attempt. Only `content/chapters/` is a real directory,
 * because that is the one the candidate has to be written into.
 */
function stage(candidate: unknown, chapterId: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-generate-"));
  fs.mkdirSync(path.join(dir, "content", "chapters"), { recursive: true });

  fs.symlinkSync(path.join(ROOT, "schemas"), path.join(dir, "schemas"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.symlinkSync(path.join(ROOT, "assets", "manifest.json"), path.join(dir, "assets", "manifest.json"));

  for (const entry of fs.readdirSync(path.join(ROOT, "content"))) {
    if (entry === "chapters" || entry === "campaigns") continue;
    fs.symlinkSync(path.join(ROOT, "content", entry), path.join(dir, "content", entry));
  }
  enrol(dir, candidate, chapterId);
  for (const entry of fs.readdirSync(path.join(ROOT, "content", "chapters"))) {
    fs.symlinkSync(
      path.join(ROOT, "content", "chapters", entry),
      path.join(dir, "content", "chapters", entry),
    );
  }

  /*
   * Written last, and with `rmSync` first, so a candidate that reuses an
   * existing chapter's id replaces the symlink rather than failing on it — an
   * author regenerating `bramblewood-01` should get their draft checked, not an
   * EEXIST.
   */
  const file = path.join(dir, "content", "chapters", `${chapterId}.json`);
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  return dir;
}

/**
 * Lists the candidate in the campaign it claims, in the staging tree only.
 *
 * The gate refuses a chapter no campaign lists — "an unlisted chapter can never
 * be reached from the campaign screen" — and it is right to. But a chapter that
 * has just been written is by definition unlisted, so a loop that waited for the
 * gate to go green on the real campaigns would never terminate, on any chapter,
 * ever. The staging tree enrols it: the campaign it names gets a copy with its
 * id appended.
 *
 * Which is more than a workaround. It is what turns on the *rest* of the
 * campaign checks — that `campaignId` names a campaign that exists, and that the
 * chapter's `index` is the next one in the sequence rather than a collision or a
 * gap. Both are real constraints on a new chapter, and neither can be checked on
 * a chapter nobody has listed.
 *
 * The enrolment is the one edit the author still owes afterwards, and
 * `generate.ts` says so on the way out.
 */
function enrol(dir: string, candidate: unknown, chapterId: string): void {
  const source = path.join(ROOT, "content", "campaigns");
  const staged = path.join(dir, "content", "campaigns");
  fs.mkdirSync(staged, { recursive: true });

  const claimed =
    typeof candidate === "object" && candidate !== null
      ? (candidate as { campaignId?: unknown }).campaignId
      : undefined;

  for (const entry of fs.readdirSync(source)) {
    const from = path.join(source, entry);
    const to = path.join(staged, entry);
    let campaign: { id?: unknown; chapters?: unknown } | null = null;
    try {
      campaign = JSON.parse(fs.readFileSync(from, "utf8")) as { id?: unknown; chapters?: unknown };
    } catch {
      campaign = null;
    }

    // Anything unreadable, or not the campaign being claimed, passes through
    // untouched — the gate should see the real file and say so.
    if (campaign === null || campaign.id !== claimed || !Array.isArray(campaign.chapters)) {
      fs.symlinkSync(from, to);
      continue;
    }

    const chapters = campaign.chapters.includes(chapterId)
      ? campaign.chapters
      : [...campaign.chapters, chapterId];
    fs.writeFileSync(to, `${JSON.stringify({ ...campaign, chapters }, null, 2)}\n`, "utf8");
  }
}

/**
 * The id a candidate claims, or null if it does not claim one.
 *
 * `validate.mjs` requires `id` to match the filename, so the candidate names its
 * own file. A candidate with no usable `id` cannot be staged at all, and that is
 * itself the first thing to tell the model.
 */
export function chapterIdOf(candidate: unknown): string | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const id = (candidate as { id?: unknown }).id;
  // Same shape `schemas/chapter.schema.json` requires of `$defs.kebabId`, and
  // narrower than the filesystem needs — a candidate that got the id wrong
  // should hear it from the schema, not from a path traversal.
  return typeof id === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) ? id : null;
}

/** Checks one candidate. The gate's answer, in the gate's words. */
export function checkCandidate(candidate: unknown): string[] {
  const id = chapterIdOf(candidate);
  if (id === null) {
    return [
      'The chapter has no usable "id". It must be a kebab-case string ' +
        '(lowercase letters, digits and single hyphens), and the file is named after it.',
    ];
  }

  const dir = stage(candidate, id);
  try {
    const run = runValidator(dir);
    if (run.ok) return [];
    // A non-zero exit the parser found nothing in means the validator itself
    // failed rather than the chapter. Saying so beats reporting "clean".
    return run.problems.length > 0
      ? run.problems
      : [`The content validator failed without naming a problem:\n${run.output.trim()}`];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Refuses to start against a tree that is already failing.
 *
 * The whole "every failure is the candidate's" property rests on this. Without
 * it, a broken `content/items.json` would be reported to the model as a problem
 * with its chapter, and it would spend every repair round trying to fix
 * something it did not write.
 */
export function baselineIsClean(): GateRun {
  return runValidator(ROOT);
}
