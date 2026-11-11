/**
 * scripts/setup.mjs: the environment setup every agent session starts with.
 *
 * It was bash only (scripts/setup.sh), which an agent on Windows has no way to run: there a
 * session started with no art on disk and no merge driver for assets.lock.json. These check
 * the steps against a stand-in for the commands, and then run the real file in a scratch repo.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeDepsStale, pythonCandidates, setup } from "../../scripts/setup.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kad-setup-"));
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(root, "requirements-dev.txt"), "");
  fs.mkdirSync(path.join(root, "node_modules"));
  // Installed after the lockfile last changed.
  fs.utimesSync(path.join(root, "package-lock.json"), new Date(2026, 0, 1), new Date(2026, 0, 1));
  fs.utimesSync(path.join(root, "node_modules"), new Date(2026, 0, 2), new Date(2026, 0, 2));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A stand-in for the machine: `answers` says what a command line exits with (default 0). */
function machine(answers = () => 0) {
  const calls = [];
  const said = [];
  const warned = [];
  return {
    calls,
    said,
    warned,
    io: {
      say: (line) => said.push(line),
      warn: (line) => warned.push(line),
      run: (command, args, options = {}) => {
        const line = [command, ...args].join(" ");
        calls.push({ line, options });
        return answers(line, command, args) ?? 0;
      },
    },
  };
}
const lines = (m) => m.calls.map((c) => c.line);

describe("setup: node dependencies", () => {
  it("installs when the lockfile changed after node_modules, and not otherwise", () => {
    expect(nodeDepsStale(root)).toBe(false);
    const warm = machine();
    expect(setup(root, { io: warm.io, env: {} }).node).toBe("current");
    expect(lines(warm).some((l) => l.startsWith("npm "))).toBe(false);

    fs.utimesSync(path.join(root, "package-lock.json"), new Date(2026, 0, 3), new Date(2026, 0, 3));
    expect(nodeDepsStale(root)).toBe(true);
    const stale = machine();
    expect(setup(root, { io: stale.io, env: {} }).node).toBe("installed");
    expect(lines(stale)).toContain("npm install --no-audit --no-fund");
  });

  it("installs on a checkout with no node_modules at all", () => {
    fs.rmSync(path.join(root, "node_modules"), { recursive: true });
    const m = machine();
    expect(setup(root, { io: m.io, env: {} }).node).toBe("installed");
  });

  it("starts npm through a shell on Windows, where it is npm.cmd, and directly elsewhere", () => {
    fs.rmSync(path.join(root, "node_modules"), { recursive: true });
    for (const [platform, shell] of [["win32", true], ["linux", false], ["darwin", false]]) {
      const m = machine();
      setup(root, { io: m.io, env: {}, platform });
      expect(m.calls.find((c) => c.line.startsWith("npm "))?.options.shell).toBe(shell);
    }
  });

  it("stops when npm install fails, before anything else runs", () => {
    fs.rmSync(path.join(root, "node_modules"), { recursive: true });
    const m = machine((line) => (line.startsWith("npm ") ? 1 : 0));
    expect(() => setup(root, { io: m.io, env: {} })).toThrow(/npm install failed \(exit 1\)/);
    expect(lines(m)).toEqual(["npm install --no-audit --no-fund"]);
  });
});

describe("setup: python", () => {
  it("looks for python where each platform keeps it", () => {
    expect(pythonCandidates("win32").map(([c, pre]) => [c, ...pre].join(" "))).toEqual(["python", "py -3", "python3"]);
    expect(pythonCandidates("linux").map(([c]) => c)).toEqual(["python3", "python"]);
  });

  it("uses the py launcher on a Windows machine whose python is not Python 3", () => {
    const m = machine((line) => (line.startsWith("python ") ? 9009 : line.includes("import PIL") ? 1 : 0));
    expect(setup(root, { io: m.io, env: {}, platform: "win32" }).python).toBe("installed");
    expect(lines(m)).toContain("py -3 -m pip install --quiet --disable-pip-version-check -r requirements-dev.txt");
  });

  it("installs nothing when the packages already import", () => {
    const m = machine();
    expect(setup(root, { io: m.io, env: {} }).python).toBe("current");
    expect(lines(m).some((l) => l.includes("pip install"))).toBe(false);
  });

  it("falls back to --user and then --break-system-packages, and only warns when all fail", () => {
    const m = machine((line) => (line.includes("import PIL") || line.includes("pip install") ? 1 : 0));
    expect(setup(root, { io: m.io, env: {}, platform: "linux" }).python).toBe("failed");
    const pips = lines(m).filter((l) => l.includes("pip install"));
    expect(pips).toHaveLength(3);
    expect(pips[1]).toContain("--user");
    expect(pips[2]).toContain("--break-system-packages");
    expect(m.warned.join("\n")).toMatch(/could not install requirements-dev.txt/);
    expect(m.said.at(-1)).toBe("ready");
  });

  it("warns and carries on when there is no python", () => {
    const m = machine((line) => (/^(python3?|py) /.test(line) ? 127 : 0));
    expect(setup(root, { io: m.io, env: {} }).python).toBe("missing");
    expect(m.warned.join("\n")).toMatch(/python 3 not found/);
    expect(m.said.at(-1)).toBe("ready");
  });
});

describe("setup: the asset store", () => {
  it("registers the lock's merge driver in the clone's own git config", () => {
    const m = machine();
    expect(setup(root, { io: m.io, env: {} }).driver).toBe(true);
    expect(lines(m)).toContain("git config merge.kad-assets-lock.driver node tools/assets/merge-lock.ts %O %A %B");
    expect(lines(m).some((l) => l.startsWith("git config merge.kad-assets-lock.name "))).toBe(true);
  });

  it("leaves git alone outside a repository", () => {
    const m = machine((line) => (line === "git rev-parse --git-dir" ? 128 : 0));
    expect(setup(root, { io: m.io, env: {} }).driver).toBe(false);
    expect(lines(m).some((l) => l.startsWith("git config"))).toBe(false);
  });

  it("pulls the game's art once there is a lock, through the sandbox's proxy", () => {
    const before = machine();
    expect(setup(root, { io: before.io, env: {} }).art).toBe("no lock");
    expect(lines(before).some((l) => l.includes("pull"))).toBe(false);

    fs.writeFileSync(path.join(root, "assets.lock.json"), "{}");
    const m = machine();
    expect(setup(root, { io: m.io, env: { HTTPS_PROXY: "http://proxy.example:8080" } }).art).toBe("pulled");
    const pull = m.calls.find((c) => c.line.endsWith("tools/assets/cli.ts pull assets"));
    expect(pull.line.startsWith(process.execPath)).toBe(true);
    expect(pull.options.env).toMatchObject({ NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://proxy.example:8080" });
  });

  it("skips the pull when asked, and a failed pull only warns", () => {
    fs.writeFileSync(path.join(root, "assets.lock.json"), "{}");
    const skipped = machine();
    expect(setup(root, { io: skipped.io, env: { KAD_SKIP_ASSET_PULL: "1" } }).art).toBe("skipped");
    expect(lines(skipped).some((l) => l.includes("pull"))).toBe(false);

    const m = machine((line) => (line.includes("pull assets") ? 1 : 0));
    expect(setup(root, { io: m.io, env: {} }).art).toBe("failed");
    expect(m.warned.join("\n")).toMatch(/could not pull the art/);
    expect(m.said.at(-1)).toBe("ready");
  });
});

describe("setup, run as a command", () => {
  it("runs with node alone in a scratch clone and registers the merge driver", () => {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.copyFileSync(path.join(REPO, "scripts/setup.mjs"), path.join(root, "scripts/setup.mjs"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    // No bash and no npm: node alone, started from another folder, as an agent's setup step may.
    const direct = spawnSync(process.execPath, [path.join(root, "scripts/setup.mjs")], { cwd: os.tmpdir(), encoding: "utf8", env: { ...process.env, KAD_SKIP_ASSET_PULL: "1" } });
    expect(direct.status, direct.stderr).toBe(0);
    expect(direct.stdout).toMatch(/node dependencies already installed/);
    expect(direct.stdout).toMatch(/ready/);
    expect(direct.stdout).toMatch(/npm run assets:push/);
    const driver = execFileSync("git", ["config", "--local", "merge.kad-assets-lock.driver"], { cwd: root, encoding: "utf8" }).trim();
    expect(driver).toBe("node tools/assets/merge-lock.ts %O %A %B");
  }, 120_000);

  it("is what npm run setup and scripts/setup.sh both call", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts.setup).toBe("node scripts/setup.mjs");
    const sh = fs.readFileSync(path.join(REPO, "scripts/setup.sh"), "utf8");
    expect(sh).toMatch(/^exec node "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/setup\.mjs" "\$@"$/m);
    // Nothing left in the bash file to drift from the node one.
    expect(sh).not.toMatch(/npm install|pip install|git config/);
    const hook = fs.readFileSync(path.join(REPO, ".claude/settings.json"), "utf8");
    expect(hook).toContain("scripts/setup.sh");
    // A Windows checkout must not give the bash file CRLF: bash reads the \r as part of the command.
    expect(fs.readFileSync(path.join(REPO, ".gitattributes"), "utf8")).toMatch(/^\*\.sh text eol=lf\r?$/m);
  });
});
