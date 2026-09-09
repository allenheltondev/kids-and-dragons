/**
 * Kids & Dragons — finding and driving the Rive CLI.
 *
 * `rive-mcp-build` is not an npm dependency of this repo and cannot become
 * one: the published `rive-mcp-server` package ships only the MCP server, not
 * the CLI the rig tooling drives. So every tool that needs it has to answer
 * two questions first — *where is the CLI* and *where is the browser it renders
 * with* — and until this module existed each of them answered the first one
 * with its own copy of the same eight lines (`verify-rig-rest.mjs`,
 * `verify-rig-motion.mjs`, `rig-sheet.mjs`) and left the second entirely to
 * whoever set `RIVE_MCP_CHROME`. Three copies agree today. The fourth tool is
 * where they would have stopped agreeing, so the fourth tool is where this
 * module was written; the other three can adopt it in their own change.
 *
 * Resolution order for the CLI, and why it is that order:
 *
 *   1. `KAD_RIVE_CLI` — explicit wins. CI sets it; a developer with a checkout
 *      somewhere unusual sets it. A `.js`/`.mjs` path is run under this same
 *      node; anything else is taken to be an executable.
 *   2. `.rive-mcp/dist/cli.js` under the repo root — what `art:rig:setup`
 *      leaves behind, and what CI's `rigs` job checks out. Gitignored.
 *   3. `rive-mcp-build` on PATH — a globally installed build, the original
 *      convention the three gates were written against.
 *
 * The browser is a separate question because rive-mcp's own search does not
 * honour `PLAYWRIGHT_BROWSERS_PATH` (art-pipeline §6.3, "Running the Rive
 * CLI"), and its list of Playwright cache layouts has gone stale before. The
 * one thing that always knows where the browser is is the `playwright-core`
 * inside the rive-mcp checkout itself — the very package that installed it —
 * so that is what `resolveChrome()` asks, and only if the answer is a file
 * that exists does it become `RIVE_MCP_CHROME` for the child. Otherwise it is
 * left unset and the CLI is allowed its own search, which is the right
 * fallback for a machine with a branded Chrome and no Playwright at all.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where `art:rig:setup` puts the checkout, and where CI's `rigs` job checks it out. */
export const CHECKOUT_DIR = join(ROOT, ".rive-mcp");

/**
 * Batch results carry every pivot of every rig, so 54 of them is a few
 * megabytes of JSON — well past node's 1 MiB `spawnSync` default, which would
 * truncate the stream and present as "unexpected end of JSON input" rather
 * than as the size problem it is.
 */
const MAX_OUTPUT = 256 * 1024 * 1024;

/**
 * How to invoke the CLI: `{ cmd, pre, source }`, where `cmd` is what to spawn,
 * `pre` is the argv prefix before the command name (the script path when the
 * CLI is a `.js` run under node), and `source` says which rule matched so an
 * error message can name it.
 */
export function resolveCli() {
  const env = process.env.KAD_RIVE_CLI;
  if (env) {
    if (env.endsWith(".js") || env.endsWith(".mjs")) {
      return { cmd: process.execPath, pre: [resolve(env)], source: "KAD_RIVE_CLI" };
    }
    return { cmd: env, pre: [], source: "KAD_RIVE_CLI" };
  }
  const local = join(CHECKOUT_DIR, "dist", "cli.js");
  if (existsSync(local)) return { cmd: process.execPath, pre: [local], source: ".rive-mcp" };
  return {
    cmd: process.platform === "win32" ? "rive-mcp-build.cmd" : "rive-mcp-build",
    pre: [],
    source: "PATH",
  };
}

/**
 * The rive-mcp checkout the resolved CLI lives in, if it lives in one — the
 * directory two above `dist/cli.js`. A CLI found on PATH has no checkout we
 * can see, and that is fine: it is only used to find `playwright-core`.
 */
export function resolveCheckout(cli = resolveCli()) {
  const script = cli.pre[0];
  if (script && /[\\/]dist[\\/]cli\.m?js$/.test(script)) return dirname(dirname(script));
  if (existsSync(join(CHECKOUT_DIR, "package.json"))) return CHECKOUT_DIR;
  return undefined;
}

/**
 * Ask the checkout's own `playwright-core` where its Chromium is. Undefined
 * when there is no checkout, no `playwright-core` in it, or no browser at the
 * path it names — `executablePath()` is a computed path, not a promise that
 * anything is there, and a CI cache that restored *something* is exactly the
 * case where it points at nothing.
 */
export function chromiumFromCheckout(checkout = resolveCheckout()) {
  if (!checkout) return undefined;
  try {
    const req = createRequire(join(checkout, "package.json"));
    const exe = req("playwright-core").chromium.executablePath();
    return exe && existsSync(exe) ? exe : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The browser the CLI should render with, or undefined to let it search.
 * When found through the checkout, it is exported into `process.env` so every
 * child spawned from here on inherits it without each call site remembering.
 */
export function resolveChrome() {
  if (process.env.RIVE_MCP_CHROME) return process.env.RIVE_MCP_CHROME;
  const exe = chromiumFromCheckout();
  if (exe) process.env.RIVE_MCP_CHROME = exe;
  return exe;
}

/**
 * A one-paragraph explanation for the moment the CLI cannot be run at all —
 * the same words from every tool, so the fix is the same wherever it is read.
 */
export function cannotRunMessage(cli = resolveCli()) {
  return (
    `could not run the Rive CLI (looked via ${cli.source}: ${[cli.cmd, ...cli.pre].join(" ")}).\n` +
    `Run \`npm run art:rig:setup\` to build it into .rive-mcp/ at the pinned commit, ` +
    `or set KAD_RIVE_CLI to its cli.js, or put rive-mcp-build on your PATH:\n\n` +
    `    KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js npm run art:rig:build\n`
  );
}

/**
 * Run one CLI command synchronously. `args` starts with the command name
 * (`["render", rig, "--animation", "idle"]`). With `json: true`, `--json` is
 * appended and `result.json` carries the parsed payload when stdout parsed;
 * the raw streams are always there for the caller that wants to show them.
 *
 * `result.error` is set only when the process could not be started at all,
 * which is the "CLI is not installed" case and is worth telling apart from
 * "the CLI ran and found something".
 */
export function runCli(args, opts = {}) {
  const cli = opts.cli ?? resolveCli();
  resolveChrome();
  const argv = [...cli.pre, ...args, ...(opts.json ? ["--json"] : [])];
  const r = spawnSync(cli.cmd, argv, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.input,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
  });
  const result = { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error, cli };
  if (opts.json && !r.error) {
    try {
      result.json = JSON.parse(result.stdout);
    } catch {
      result.json = undefined;
    }
  }
  return result;
}

/**
 * Run many jobs through one `batch` invocation — one process, one browser —
 * and return the CLI's parsed report: `{ ok, results: [{ id, ok, ...payload,
 * error? }] }`, plus `status` (the highest exit code any job ended with).
 *
 * Each job is the command's options in camelCase with the command under `cmd`
 * (rive-mcp README, "The CLI"). Paths inside jobs resolve against the CLI's
 * working directory, so callers should pass absolute ones.
 *
 * Throws when the batch could not run as a whole — the CLI is missing, or
 * predates `batch`. The second is `error.unsupported`, and it is a real case:
 * the commit pinned in `art/rig/rive-mcp.pin.json` may be older than the
 * command, and a caller that can fall back to one `rig` per job (slower, same
 * bytes) should rather than fail a rebuild over a convenience.
 */
export function runBatch(jobs, opts = {}) {
  const work = mkdtempSync(join(tmpdir(), "kad-rive-batch-"));
  try {
    const jobsFile = join(work, "jobs.json");
    const spec = { jobs };
    if (opts.concurrency && opts.concurrency > 1) spec.concurrency = opts.concurrency;
    writeFileSync(jobsFile, JSON.stringify(spec));

    const r = runCli(["batch", jobsFile], { ...opts, json: true });
    if (r.error) {
      const err = new Error(cannotRunMessage(r.cli));
      err.cause = r.error;
      throw err;
    }
    if (r.json && Array.isArray(r.json.results)) {
      return { ok: r.json.ok === true, results: r.json.results, status: r.status, stderr: r.stderr };
    }
    const combined = `${r.stderr}\n${r.stdout}`;
    const err = new Error(
      /unknown command 'batch'/.test(combined)
        ? "this Rive CLI predates the `batch` command"
        : `the Rive CLI's batch run produced no report (exit ${r.status}): ${combined.trim().split("\n").pop()}`,
    );
    err.unsupported = /unknown command 'batch'/.test(combined);
    err.status = r.status;
    throw err;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
