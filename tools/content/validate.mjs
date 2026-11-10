#!/usr/bin/env node
/**
 * Kids & Dragons - content validator, the command line.
 *
 * The checking is `validateContent` in validate-content.mjs; this loads the
 * tree from disk, prints the report as it is made, and exits 1 on any failure.
 *
 * Usage:
 *     npm run content:validate            # everything
 *     node tools/content/validate.mjs     # same thing
 *     npm run content:proofs              # --write-proofs: record clean graph walks
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ContentSet } from "./content-set.ts";
import { formatEvent, validateContent } from "./validate-content.mjs";

/**
 * Which tree to validate. Defaults to this repo; `KAD_CONTENT_ROOT` points it
 * somewhere else, so a test can hand the command line a staged tree and read
 * what it says and how it exits.
 */
const root = process.env.KAD_CONTENT_ROOT
  ? resolve(process.env.KAD_CONTENT_ROOT)
  : fileURLToPath(new URL("../..", import.meta.url));
const color = Boolean(process.stdout.isTTY);

const result = validateContent(ContentSet.load(root), {
  writeProofs: process.argv.includes("--write-proofs"),
  // `KAD_CLASS_PLACES=off` skips the class-place check, for a staged tree whose subject is something else.
  classPlaces: process.env.KAD_CLASS_PLACES !== "off",
  // The test runner sets this so its spawns share one compile of the schemas; CI's own run does not.
  schemaCacheDir: process.env.KAD_SCHEMA_CACHE || null,
  onEvent: (event) => {
    for (const line of formatEvent(event, color)) console.log(line);
  },
  write: (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  },
});

process.exit(result.code);
