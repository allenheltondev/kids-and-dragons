/**
 * `verify-rig-motion.mjs` — argument parsing.
 *
 * The gate itself cannot be tested without the Rive CLI, which is built from a
 * private repo in CI and is not an npm dependency here. Its argument parsing
 * can, and that is where a genuinely nasty failure lives.
 *
 * A bare word on the command line is a species name unless the token before it
 * was an option expecting a value, and the list of such options used to be
 * written out inline. Adding `--gap-report <path>` without updating it did not
 * error: the path was read as a species, matched none of the six, and the run
 * measured **zero rigs while still exiting 0**. In CI that is a green tick over
 * a job that did nothing — the same shape as the metric that could not fire,
 * which is the failure this whole file is downstream of.
 *
 * So: assert the species count the banner reports, for the option forms CI
 * actually uses.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./verify-rig-motion.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The banner prints before anything needs the renderer, so this works CLI-less. */
function banner(...args: string[]): string {
  const r = spawnSync("node", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
  return (r.stdout ?? "").split("\n").find((l) => l.includes("species")) ?? "";
}

describe("verify-rig-motion argument parsing", () => {
  it("measures every species when only options are given", () => {
    // The exact form the rig-motion workflow runs.
    expect(banner("--gap-report", "gap-report.json")).toContain("6 species");
  });

  it("still honours a positional species filter", () => {
    expect(banner("unicorn", "--gap-report", "gap-report.json")).toContain("1 species");
  });

  it("does not mistake any value-taking option's argument for a species", () => {
    for (const opt of ["--tier", "--clip", "--jobs", "--gap-report"]) {
      // A value that is not a species id, and must not be read as one.
      expect(banner(opt, "griffin-not-a-real-arg")).toContain("6 species");
    }
  });
});
