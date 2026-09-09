#!/usr/bin/env node
/**
 * Kids & Dragons — build the Rive CLI, at the pinned commit, into `.rive-mcp/`.
 *
 * `rive-mcp-build` is not an npm dependency of this repo and cannot become
 * one (rive-cli.mjs has the reasons), so the three rig gates and the rig
 * builder all start from the same question: is there a CLI, and is it the
 * *right* one? Until this file existed the answer was a five-line shell
 * recipe in art-pipeline §6.3 that a developer typed once, in a directory of
 * their choosing, at whatever commit the recipe was copied on — and then set
 * two environment variables by hand and kept them set. CI had its own copy of
 * the same recipe in two workflows. This is that recipe, once, reading the pin.
 *
 * What it does, and skips when already done:
 *
 *   1. Fetch the commit named in `art/rig/rive-mcp.pin.json` into `.rive-mcp/`
 *      (gitignored) from the pin's `repo`. The repo is private: `RIVE_MCP_TOKEN`
 *      — the same fine-grained PAT CI uses — is sent as a header on the fetch
 *      and is never written to disk or printed, which is why this is an
 *      `init` + `fetch` and not a `clone` with the token in the URL.
 *      `KAD_RIVE_SRC=/path/to/rive-mcp` fetches from a local checkout instead,
 *      for a machine that already has one or cannot reach GitHub.
 *   2. `npm ci && npm run build` there.
 *   3. Install Chromium through the checkout's *own* `playwright-core`, unless
 *      the browser it asks for is already on disk, or `RIVE_MCP_CHROME` names
 *      one that is — ci.yml's `rigs` job has the story of two Playwright
 *      versions wanting two revisions.
 *   4. Print the two exports. `rive-cli.mjs` finds `.rive-mcp/dist/cli.js` and
 *      the checkout's Chromium on its own, so from this repo's npm scripts they
 *      are not needed; they are for running `rive-mcp-build` by hand.
 *
 * Idempotent: with the checkout at the pin, clean, its node_modules present and
 * `dist/cli.js` built, steps 1
 * and 2 are skipped, and step 3 is a stat. Moving the pin and running this
 * again is the whole upgrade procedure — the CLI is rebuilt, and the browser is
 * re-installed only if the new commit's `playwright-core` asks for a different
 * revision.
 *
 * Usage:
 *     npm run art:rig:setup
 *     RIVE_MCP_TOKEN=github_pat_... npm run art:rig:setup     private repo over https
 *     KAD_RIVE_SRC=~/src/rive-mcp npm run art:rig:setup       from a local checkout
 *
 * Exit 0 when the CLI is built and the browser is present; 1 when a step
 * failed (the repo unreachable, the build broken, the download refused); 2 when
 * the pin itself is malformed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { CHECKOUT_DIR, chromiumFromCheckout, ROOT } from "./rive-cli.mjs";

const tty = process.stdout.isTTY;
const RED = tty ? "\x1b[31m" : "";
const GREEN = tty ? "\x1b[32m" : "";
const YELLOW = tty ? "\x1b[33m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const RESET = tty ? "\x1b[0m" : "";

const PIN_PATH = join(ROOT, "art", "rig", "rive-mcp.pin.json");

// ---- the pin ----------------------------------------------------------------------

const pin = JSON.parse(readFileSync(PIN_PATH, "utf8"));
// Same rule as CI: a short sha or a branch name would still check out, and
// would make "which generator built this" unanswerable six months from now.
if (typeof pin.ref !== "string" || !/^[0-9a-f]{40}$/.test(pin.ref)) {
  console.error(`error: ${relative(ROOT, PIN_PATH)} ref is not a full 40-char sha: ${pin.ref}`);
  process.exit(2);
}
if (typeof pin.repo !== "string" || !/^https:\/\//.test(pin.repo)) {
  console.error(`error: ${relative(ROOT, PIN_PATH)} repo is not an https URL: ${pin.repo}`);
  process.exit(2);
}

const localSrc = process.env.KAD_RIVE_SRC ? resolve(process.env.KAD_RIVE_SRC) : undefined;
const token = process.env.RIVE_MCP_TOKEN;
const source = localSrc ?? pin.repo;

if (localSrc && !existsSync(join(localSrc, ".git"))) {
  console.error(`error: KAD_RIVE_SRC=${localSrc} is not a git checkout (no .git in it)`);
  process.exit(2);
}

console.log(`${BOLD}Kids & Dragons - the Rive CLI at the pinned commit${RESET}`);
console.log(`${DIM}${pin.ref}  from ${source}${localSrc ? " (KAD_RIVE_SRC)" : token ? " (RIVE_MCP_TOKEN)" : ""}  into ${relative(ROOT, CHECKOUT_DIR)}/${RESET}\n`);

// ---- helpers -----------------------------------------------------------------------

/**
 * The token travels as an `Authorization` header set through git's
 * environment-config mechanism — not in the remote URL (which git would save
 * in `.rive-mcp/.git/config`), and not on the command line (which `ps` would
 * show). The environment of a child is the one place a secret can be handed
 * to git without leaving a copy somewhere.
 */
function gitEnv() {
  // Never fall through to a terminal prompt, token or no token: a CI runner
  // would hang there, and so would the SessionStart hook that runs setup.sh.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (!token || localSrc) return env;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    ...env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

/** Run a command in the checkout; returns the result, exits on a failure to start. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? CHECKOUT_DIR,
    env: opts.env ?? process.env,
    encoding: "utf8",
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
  if (r.error) {
    console.error(`${RED}error${RESET}: could not run ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  return r;
}

function git(args, opts = {}) {
  return run("git", args, { ...opts, env: gitEnv() });
}

function step(what) {
  console.log(`${BOLD}==>${RESET} ${what}`);
}

/** The commit the checkout is at, or undefined when it is not a checkout. */
function headOf(dir) {
  if (!existsSync(join(dir, ".git"))) return undefined;
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

// ---- 1. the checkout, at the pin -----------------------------------------------------

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const cliPath = join(CHECKOUT_DIR, "dist", "cli.js");

// "Built" is more than dist/cli.js existing. The CLI needs the checkout's own
// node_modules at run time (playwright-core drives the browser, the Rive
// runtime is vendored from @rive-app at build time), and a dist left over from
// a deleted or half-installed node_modules would report ready and then fail on
// the first render — or worse, run a stale build. And the whole point of the
// pin is that what runs is the pinned commit, so a checkout with local edits
// is not "at the pin" whatever HEAD says: refuse it rather than build it.
const depsPresent = ["playwright-core", "@rive-app/canvas-advanced", "zod"].every((d) =>
  existsSync(join(CHECKOUT_DIR, "node_modules", d, "package.json")),
);
let built = existsSync(cliPath) && depsPresent;
let fetchedNow = false;
if (headOf(CHECKOUT_DIR) === pin.ref) {
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: CHECKOUT_DIR, encoding: "utf8" });
  if (dirty.status === 0 && dirty.stdout.trim() !== "") {
    console.error(
      `${RED}error${RESET}: ${relative(ROOT, CHECKOUT_DIR)}/ is at the pin but has local changes:\n` +
        dirty.stdout.trimEnd().split("\n").map((l) => `    ${l}`).join("\n") +
        `\n  A pinned checkout with edits is not the pin. Discard them (git -C ${relative(ROOT, CHECKOUT_DIR)} checkout -- .) ` +
        `or point KAD_RIVE_SRC at the checkout you are actually developing in.`,
    );
    process.exit(1);
  }
  step(
    `${relative(ROOT, CHECKOUT_DIR)}/ is at the pin` +
      (built ? ", and built" : existsSync(cliPath) ? ", but its node_modules are incomplete — rebuilding" : ""),
  );
} else {
  built = false;
  if (existsSync(CHECKOUT_DIR) && !existsSync(join(CHECKOUT_DIR, ".git"))) {
    console.error(
      `${RED}error${RESET}: ${relative(ROOT, CHECKOUT_DIR)}/ exists and is not a git checkout. ` +
        `Remove it and run again; nothing in it is source.`,
    );
    process.exit(1);
  }
  if (!existsSync(join(CHECKOUT_DIR, ".git"))) {
    step(`creating ${relative(ROOT, CHECKOUT_DIR)}/`);
    mkdirSync(CHECKOUT_DIR, { recursive: true });
    if (git(["init", "-q"]).status !== 0) process.exit(1);
  }
  // The remote is (re)pointed every time so a checkout made from a local
  // source can later be updated from GitHub, and vice versa — and because the
  // URL never carries a credential, re-pointing it costs nothing.
  git(["remote", "remove", "origin"], { quiet: true });
  if (git(["remote", "add", "origin", source]).status !== 0) process.exit(1);

  step(`fetching ${pin.ref.slice(0, 12)} from ${source}`);
  // GitHub serves a fetch by full sha (`uploadpack.allowReachableSHA1InWant`),
  // so a shallow fetch of the one commit is enough over https. A plain git
  // repo on disk does not, so a local source gets its branches fetched
  // instead — local, so cheap, and the sha is found among them or is missing
  // from that checkout altogether.
  let fetched = false;
  if (!localSrc) fetched = git(["fetch", "-q", "--depth", "1", "origin", pin.ref]).status === 0;
  if (!fetched) {
    fetched = git(["fetch", "-q", "origin", "+refs/heads/*:refs/remotes/origin/*"]).status === 0;
  }
  if (!fetched) {
    console.error(
      `\n${RED}error${RESET}: could not fetch ${pin.ref.slice(0, 12)} from ${source}.\n` +
        (localSrc
          ? `KAD_RIVE_SRC points at a checkout; is it a git repository that has this commit?`
          : `The repo is private. Set RIVE_MCP_TOKEN to a fine-grained PAT with read access to it ` +
            `(the same secret CI's rigs job uses), or KAD_RIVE_SRC=/path/to/rive-mcp to fetch from a ` +
            `checkout you already have. An expired token fails exactly like a missing repo.`),
    );
    process.exit(1);
  }
  fetchedNow = true;
  if (git(["checkout", "-q", "--detach", pin.ref]).status !== 0) {
    console.error(`\n${RED}error${RESET}: fetched from ${source}, but ${pin.ref.slice(0, 12)} is not among what it has.`);
    process.exit(1);
  }
}

// ---- 2. build ---------------------------------------------------------------------------

if (!built) {
  step("npm ci");
  if (run(npmCmd, ["ci", "--no-audit", "--no-fund"]).status !== 0) {
    console.error(`${RED}error${RESET}: npm ci failed in ${relative(ROOT, CHECKOUT_DIR)}/`);
    process.exit(1);
  }
  step("npm run build");
  if (run(npmCmd, ["run", "build"]).status !== 0 || !existsSync(cliPath)) {
    console.error(`${RED}error${RESET}: the build did not produce ${relative(ROOT, cliPath)}`);
    process.exit(1);
  }
}

// ---- 3. the browser ------------------------------------------------------------------------

// An explicit RIVE_MCP_CHROME that exists wins, as it does in rive-cli.mjs:
// a machine that cannot reach Playwright's CDN but has a browser is served
// by saying where it is, not by a download it cannot make.
const explicit = process.env.RIVE_MCP_CHROME;
let chrome = explicit && existsSync(explicit) ? explicit : chromiumFromCheckout(CHECKOUT_DIR);
if (chrome) {
  step(`chromium present: ${chrome}${chrome === explicit ? " (RIVE_MCP_CHROME)" : ""}`);
} else {
  // Asked of the checkout's own playwright-core, which is what decides the
  // revision. `install` is a no-op when the browser is already there, so it is
  // never gated on anything cleverer than "is the executable a file".
  let wanted = "(unknown)";
  try {
    wanted = createRequire(join(CHECKOUT_DIR, "package.json"))("playwright-core").chromium.executablePath();
  } catch {
    // no playwright-core in the checkout; the install below will say so
  }
  step(`installing chromium for the CLI (playwright-core wants ${wanted})`);
  if (run(npxCmd, ["playwright-core", "install", "chromium"]).status !== 0) {
    console.error(
      `${RED}error${RESET}: chromium did not install. On a bare Linux box the browser's own ` +
        `libraries may be missing too: \`npx playwright-core install --with-deps chromium\` in ` +
        `${relative(ROOT, CHECKOUT_DIR)}/ adds them (needs sudo).`,
    );
    process.exit(1);
  }
  chrome = chromiumFromCheckout(CHECKOUT_DIR);
  if (!chrome) {
    console.error(`${RED}error${RESET}: playwright-core installed a browser and then could not find it at ${wanted}`);
    process.exit(1);
  }
}

// ---- 4. say where things are -------------------------------------------------------------------

console.log(`\n${GREEN}ready${RESET} - the Rive CLI is ${relative(ROOT, cliPath)} at ${pin.ref.slice(0, 12)}`);
console.log(
  `${DIM}npm run art:rig:build and the rig gates find it there on their own. To run rive-mcp-build by hand:${RESET}\n`,
);
console.log(`  export KAD_RIVE_CLI=${cliPath}`);
console.log(`  export RIVE_MCP_CHROME=${chrome}`);
if (fetchedNow && !localSrc && !token) {
  console.log(`\n${YELLOW}note${RESET}: fetched without RIVE_MCP_TOKEN - fine while the repo is reachable, set it if it stops being.`);
}
