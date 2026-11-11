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
 *     node tools/content/validate.mjs --no-write-proofs   # check only: leave content/graph-proofs alone
 *
 * A clean graph walk is recorded in content/graph-proofs/ as it is made. That folder is a
 * cache git ignores (tools/content/graph-proofs.ts), so there is nothing to commit.
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
