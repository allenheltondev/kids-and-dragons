/**
 * Runs the real content validator over a content tree, and reads its report.
 *
 * `tools/content/validate.mjs` takes `KAD_CONTENT_ROOT` to say which tree to
 * judge, so a test can copy the content, change something, and ask the gate
 * itself rather than an approximation of it.
 */

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
export function runValidator(contentRoot: string, args: readonly string[] = []): GateRun {
  const result = spawnSync(process.execPath, [VALIDATOR, ...args], {
    env: { ...process.env, KAD_CONTENT_ROOT: contentRoot },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { ok: result.status === 0, problems: readFailures(output), output };
}
