/**
 * `scripts/deploy.sh` is the one path to every stack, and three of its
 * properties are easy to lose in an edit and expensive to lose in production:
 * it never picks an environment for you, nothing that can fail offline runs
 * after the stack has changed, and it never deletes a bundle file a page may
 * still be asking for. Read as text where order is the point; run for real
 * where the script refuses before it touches anything.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "deploy.sh");
const script = fs.readFileSync(SCRIPT, "utf8").replace(/\r\n/g, "\n");
// Commands only: the header explains the old behaviour in words that would
// otherwise match.
const code = script
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const at = (needle: string): number => {
  const index = code.indexOf(needle);
  expect(index, `deploy.sh no longer contains: ${needle}`).toBeGreaterThan(-1);
  return index;
};

describe("deploy.sh and the stack it changes", () => {
  const stack = at("sam deploy \\");

  it("builds the client before the stack changes, so a failed build leaves the old API with the old client", () => {
    expect(at("npm run build")).toBeLessThan(stack);
  });

  it("bundles the Lambdas and verifies a prebuilt artifact before the stack changes", () => {
    expect(at("node infra/build.mjs")).toBeLessThan(stack);
    expect(at("KAD_PREBUILT=1 but $dir is missing or empty")).toBeLessThan(stack);
  });

  it("asks the site for its voice clips before the stack changes, and after only on a first deploy", () => {
    const calls = [...code.matchAll(/^\s*voice_clips_on_site$/gm)].map((m) => m.index);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBeLessThan(stack);
    expect(calls[1]).toBeGreaterThan(stack);
    // The second is the first-deploy fallback and nothing else.
    expect(code.slice(stack, calls[1])).toContain('if [ "$VOICE_CHECKED" = "0" ]');
  });

  it("uploads nothing until the stack has deployed", () => {
    expect(at("aws s3 sync")).toBeGreaterThan(stack);
  });
});

describe("deploy.sh and the Cache-Control of what is already in the bucket", () => {
  it("syncs art and content with one header each, and migrates what sync left behind to the same one", () => {
    expect(at('aws s3 sync assets "s3://$BUCKET/assets" --delete --cache-control "$ASSETS_CACHE"')).toBeGreaterThan(at("ASSETS_CACHE="));
    expect(at('migrate_cache_control assets "$ASSETS_CACHE"')).toBeGreaterThan(at("aws s3 sync content"));
    expect(at('migrate_cache_control content "$CONTENT_CACHE"')).toBeGreaterThan(at("aws s3 sync content"));
  });

  it("migrates before the invalidation, so the edge refills with the new header", () => {
    expect(at('migrate_cache_control content "$CONTENT_CACHE"')).toBeLessThan(at("aws cloudfront create-invalidation"));
  });

  it("replaces metadata with the Content-Type the bucket already has, and only when the marker says it has not", () => {
    expect(at("--metadata-directive REPLACE --content-type \"$type\" --cache-control \"$wanted\"")).toBeGreaterThan(at("head-object"));
    expect(at('if [ "$have" = "$wanted" ]; then')).toBeLessThan(at("--metadata-directive REPLACE"));
  });
});

describe("deploy.sh and the bundle a phone may still be using", () => {
  const commands = code.replace(/\\\n\s*/g, " ").split("\n");

  it("adds to bundle/ and never syncs it with --delete", () => {
    const bundle = commands.filter((line) => /aws s3 sync/.test(line) && line.includes("/bundle"));
    expect(bundle).toHaveLength(1);
    expect(bundle[0]).not.toContain("--delete");
  });

  it("prunes only after the new page is up and the old one invalidated, through the stale-bundle rule", () => {
    const prune = at("node tools/deploy/stale-bundles.ts packages/client/dist/bundle");
    expect(prune).toBeGreaterThan(at('aws s3 sync packages/client/dist "s3://$BUCKET"'));
    expect(prune).toBeGreaterThan(at("aws cloudfront create-invalidation"));
  });

  it("deletes one named key at a time, and only under bundle/", () => {
    expect(code).not.toMatch(/aws s3 rm/);
    const deletes = commands.filter((line) => line.includes("delete-object"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('--key "$key"');
    const guard = code.slice(at('case "$key" in'), at("delete-object"));
    expect(guard).toContain("bundle/*) ;;");
    expect(guard).toContain("continue ;;");
  });
});

describe("deploy.sh and the environment", () => {
  it("has no default environment", () => {
    expect(code).not.toMatch(/\$\{1:-/);
    expect(code).not.toMatch(/^\s*default\b.*\)/m);
  });

  it("checks a laptop's prod deploy against main before it looks for any tool", () => {
    const guard = at("refusing to deploy this checkout to prod");
    expect(guard).toBeLessThan(at("for tool in sam aws node npm"));
    expect(code.slice(0, guard)).toContain("git status --porcelain");
    expect(code.slice(0, guard)).toContain("git ls-remote origin refs/heads/main");
  });

  it("shows a person the changeset on prod, and never stops for one in CI", () => {
    const confirm = code.slice(at("CONFIRM=()"), at("sam deploy \\"));
    expect(confirm).toMatch(/if \[ -n "\$\{CI:-\}" \]; then\s+CONFIRM=\(--no-confirm-changeset\)/);
    expect(confirm).toMatch(/elif \[ "\$STAGE" = "prod" \]; then\s+CONFIRM=\(--confirm-changeset\)/);
  });

  // Run for real, where the script stops before it needs sam, aws or a
  // network. Not on Windows: `bash` there may be the WSL launcher.
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync("bash", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });

  it.skipIf(process.platform === "win32")("refuses to run with no environment, and says which exist", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no environment given");
    expect(result.stderr).toContain("usage: ./scripts/deploy.sh <prod|staging|dev>");
    expect(result.stdout).toBe("");
  });

  it.skipIf(process.platform === "win32")("refuses an environment it does not know, `default` included", () => {
    for (const name of ["default", "production", ""]) {
      const result = run([name]);
      expect(result.status, name).toBe(2);
      expect(result.stderr, name).toContain(`unknown environment '${name}'`);
    }
  });
});
