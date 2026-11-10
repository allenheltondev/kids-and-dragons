#!/usr/bin/env node
/**
 * Kids & Dragons - content validator, the command line.
 *
 * The checking is `validateContent` in validate-content.ts, and running it as
 * a process is `runCli` in validate-cli.ts. This file only starts it, so the
 * path every script, doc and CI step names stays where it was.
 *
 * Usage:
 *     npm run content:validate            # everything
 *     node tools/content/validate.mjs     # same thing
 *     npm run content:proofs              # --write-proofs: record clean graph walks
 */

import { runCli } from "./validate-cli.ts";

process.exit(
  runCli({
    argv: process.argv.slice(2),
    env: process.env,
    color: Boolean(process.stdout.isTTY),
    print: (line) => console.log(line),
  }),
);
