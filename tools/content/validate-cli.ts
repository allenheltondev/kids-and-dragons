/**
 * The content gate's command line, as a function: load the tree from disk,
 * print the report as it is made, and return the exit code.
 *
 * The checking is `validateContent` (validate-content.ts). This is everything
 * about running it as a process, kept apart from tools/content/validate.mjs
 * (which only calls it) so it is typechecked like the rest.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ContentSet } from "./content-set.ts";
import { formatEvent, validateContent } from "./validate-content.ts";

export interface CliInput {
  /**
   * The arguments after the script name. Clean graph walks are recorded in
   * `content/graph-proofs/` unless `--no-write-proofs` is given: the folder is
   * an ignored cache, so refreshing it is what a run is for. `--write-proofs`
   * is still accepted and changes nothing; it was how the proofs were re-taken
   * when they were committed.
   */
  argv: readonly string[];
  /**
   * - `KAD_CONTENT_ROOT`: which tree to validate. Defaults to this repo. It
   *   is what lets a test hand the command line a staged tree and read what
   *   it says and how it exits.
   * - `KAD_CLASS_PLACES=off`: skip the class-place check, for a staged tree
   *   whose subject is something else.
   * - `KAD_SCHEMA_CACHE`: a directory to keep compiled schemas in. The test
   *   runner sets it so its spawns share one compile; CI's own run does not.
   */
  env: Readonly<Record<string, string | undefined>>;
  /** Color the report, as a terminal gets and a pipe does not. */
  color: boolean;
  /** Where each line of the report goes. */
  print: (line: string) => void;
}

/** Runs the gate over the tree on disk. Returns 0, or 1 when anything failed. */
export function runCli({ argv, env, color, print }: CliInput): number {
  const root = env.KAD_CONTENT_ROOT ? resolve(env.KAD_CONTENT_ROOT) : fileURLToPath(new URL("../..", import.meta.url));
  const result = validateContent(ContentSet.load(root), {
    writeProofs: !argv.includes("--no-write-proofs"),
    classPlaces: env.KAD_CLASS_PLACES !== "off",
    schemaCacheDir: env.KAD_SCHEMA_CACHE || null,
    onEvent: (event) => {
      for (const line of formatEvent(event, color)) print(line);
    },
    write: (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    },
  });
  return result.code;
}
