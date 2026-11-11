#!/usr/bin/env node
/**
 * Kids & Dragons: one-command environment setup, on any machine that has Node.
 *
 *   npm run setup            (PowerShell, cmd, bash: anywhere)
 *   ./scripts/setup.sh       (the same thing; Claude Code's SessionStart hook runs this)
 *
 * Installs everything the checks in .github/workflows/ci.yml need, registers the asset
 * lock's merge driver, and pulls the game's art from the asset store, so a fresh machine
 * or a fresh agent session can run the tests, the content validator and the art gate.
 *
 * It is Node rather than bash because an agent on Windows has no bash to run a setup
 * script with: there the bash version could not run at all, and a session started with
 * no art on disk and no merge driver.
 *
 * Idempotent: safe to run on every session start. Node deps are skipped when
 * node_modules is newer than package-lock.json; Python deps when they already import.
 *
 * Built-ins only: it runs before node_modules exists.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {object} SetupIo
 * @property {(line: string) => void} say
 * @property {(line: string) => void} warn
 * @property {(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv, quiet?: boolean, shell?: boolean }) => number} run
 *   Runs a command in the repo and returns its exit code (127 when it is not there to run).
 */

/** @returns {SetupIo} */
function realIo(root) {
  return {
    say: (line) => console.log(`\x1b[1m==>\x1b[0m ${line}`),
    warn: (line) => console.error(`\x1b[33mwarn\x1b[0m ${line}`),
    run: (command, args, options = {}) => {
      const result = spawnSync(command, args, {
        cwd: root,
        env: options.env ?? process.env,
        stdio: options.quiet ? "ignore" : "inherit",
        // npm is npm.cmd on Windows, which only a shell can start. The arguments are fixed
        // strings from this file, never anything read from the environment or the repo.
        shell: options.shell ?? false,
      });
      if (result.error) return 127;
      return result.status ?? 1;
    },
  };
}

/** True when the lockfile has changed since node_modules was last written, or there is none. */
export function nodeDepsStale(root) {
  const modules = path.join(root, "node_modules");
  if (!fs.existsSync(modules)) return true;
  return fs.statSync(path.join(root, "package-lock.json")).mtimeMs >= fs.statSync(modules).mtimeMs;
}

/**
 * The commands that might be Python 3 here, most likely first. Windows installs it as
 * `python` or behind the `py` launcher; `python3` there is often a stub that opens the Store.
 * @returns {Array<[string, string[]]>}
 */
export function pythonCandidates(platform = process.platform) {
  return platform === "win32"
    ? [["python", []], ["py", ["-3"]], ["python3", []]]
    : [["python3", []], ["python", []]];
}

/**
 * @param {string} root
 * @param {{ env?: NodeJS.ProcessEnv, io?: SetupIo, platform?: NodeJS.Platform }} [options]
 * @returns {{ node: "installed" | "current", python: "installed" | "current" | "missing" | "failed", driver: boolean, art: "pulled" | "failed" | "skipped" | "no lock" }}
 */
export function setup(root, options = {}) {
  const env = options.env ?? process.env;
  const io = options.io ?? realIo(root);
  const platform = options.platform ?? process.platform;
  /** @type {ReturnType<typeof setup>} */
  const done = { node: "current", python: "missing", driver: false, art: "no lock" };

  // --- Node -------------------------------------------------------------------
  // The workspaces (packages/shared, server, client) install from the root.
  if (nodeDepsStale(root)) {
    io.say("installing node dependencies");
    const code = io.run("npm", ["install", "--no-audit", "--no-fund"], { shell: platform === "win32" });
    if (code !== 0) throw new Error(`npm install failed (exit ${code}).`);
    done.node = "installed";
  } else {
    io.say("node dependencies already installed");
  }

  // --- Python -----------------------------------------------------------------
  // requirements-dev.txt is the one list: pillow and numpy for tools/art/, and cfn-lint for
  // `npm run infra:lint`. The same file feeds every pip install in .github/workflows/, so a
  // laptop and CI cannot drift apart.
  const python = pythonCandidates(platform).find(([command, pre]) => io.run(command, [...pre, "-c", "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)"], { quiet: true }) === 0);
  if (!python) {
    io.warn("python 3 not found: 'npm run art:verify', 'npm run art:sheet' and 'npm run infra:lint' will not run");
  } else {
    const [command, pre] = python;
    if (io.run(command, [...pre, "-c", "import PIL, numpy, cfnlint"], { quiet: true }) === 0) {
      io.say("python dev dependencies already installed (pillow, numpy, cfn-lint)");
      done.python = "current";
    } else {
      io.say("installing python dev dependencies (requirements-dev.txt)");
      const pip = [...pre, "-m", "pip", "install", "--quiet", "--disable-pip-version-check"];
      // Debian-style images mark the system interpreter externally-managed; fall back
      // rather than failing the whole session over dev tooling.
      const ways = [[], ["--user"], ["--break-system-packages"]];
      const ok = ways.some((extra) => io.run(command, [...pip, ...extra, "-r", "requirements-dev.txt"]) === 0);
      if (!ok) io.warn("could not install requirements-dev.txt: the art commands will explain what is missing");
      done.python = ok ? "installed" : "failed";
    }
  }

  // --- The asset store ----------------------------------------------------------
  // docs/asset-store.md. The lock merges by path rather than by line, so two agents adding
  // art to one folder never conflict. git reads merge drivers only from local config, never
  // from the repo, so each clone registers it here.
  if (io.run("git", ["rev-parse", "--git-dir"], { quiet: true }) === 0) {
    const name = io.run("git", ["config", "merge.kad-assets-lock.name", "asset lock, merged by path (tools/assets/merge-lock.ts)"]);
    const driver = io.run("git", ["config", "merge.kad-assets-lock.driver", "node tools/assets/merge-lock.ts %O %A %B"]);
    done.driver = name === 0 && driver === 0;
    if (!done.driver) io.warn("could not register the asset lock's merge driver: a merge of assets.lock.json may conflict line by line");
  }
  // Once the art lives in the store, a fresh checkout has none of it. Pull the game's art
  // (what the tests, the art gate and the dev server read); `npm run assets:pull` with no
  // arguments also brings art/ and the docs' screenshots. Never fatal: the dev server fetches
  // what is missing on demand. NODE_USE_ENV_PROXY lets node's fetch use HTTPS_PROXY where a
  // sandbox requires one. KAD_SKIP_ASSET_PULL=1 skips it.
  if (fs.existsSync(path.join(root, "assets.lock.json"))) {
    if (env.KAD_SKIP_ASSET_PULL === "1") {
      done.art = "skipped";
    } else {
      io.say("pulling the game's art from the asset store");
      const code = io.run(process.execPath, ["tools/assets/cli.ts", "pull", "assets"], { env: { ...env, NODE_USE_ENV_PROXY: "1" } });
      done.art = code === 0 ? "pulled" : "failed";
      if (code !== 0) io.warn("could not pull the art (npm run assets:pull); the tests and art:verify need it on disk");
    }
  }

  io.say("ready");
  return done;
}

const COMMANDS = `  npm run typecheck          tsc across shared, server, client
  npm test                   vitest
  npm run content:validate   schemas + scene graphs  (tools/content/validate.mjs)
  npm run art:verify         the art gate            (tools/art/verify.py)
  npm run art:sheet          contact sheets for review -> art/review/
  npm run assets:push        new or changed art/audio -> the S3 asset store (docs/asset-store.md)
  npm run dev                server + client`;

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    setup(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
    console.log(COMMANDS);
  } catch (error) {
    console.error(`setup: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
