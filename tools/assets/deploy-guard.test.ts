/**
 * deploy.sh syncs assets/ to the site with --delete, so whatever is missing from
 * the working tree comes off the live site. Once the art lives in the asset
 * store (docs/asset-store.md), the tree only has it if a pull put it there.
 * These pin the facts that keep that safe.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchesRules } from "../../packages/shared/src/asset-store";
import { loadConfig } from "./lib";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const script = fs.readFileSync(path.join(ROOT, "scripts", "deploy.sh"), "utf8").replace(/\r\n/g, "\n");

describe("deploy.sh and the asset store", () => {
  const pullAt = script.indexOf("node tools/assets/cli.ts pull assets");
  const verifyAt = script.indexOf("node tools/assets/cli.ts verify --no-store --present assets");
  const checksAt = script.indexOf('if [ "${KAD_SKIP_CHECKS:-}" = "1" ]');
  const syncAt = script.indexOf('aws s3 sync assets "s3://$BUCKET/assets" --delete');

  it("pulls the art and proves the tree matches the lock before the --delete sync", () => {
    expect(pullAt).toBeGreaterThan(0);
    expect(verifyAt).toBeGreaterThan(pullAt);
    expect(syncAt).toBeGreaterThan(verifyAt);
  });

  it("does so before the checks that read the art, and outside what KAD_SKIP_CHECKS skips", () => {
    expect(verifyAt).toBeLessThan(checksAt);
  });

  it("uses plain node, because a ship-mode deploy has no node_modules", () => {
    for (const line of script.split("\n").filter((l) => l.includes("tools/assets/"))) {
      expect(line.trim(), line).toMatch(/^node tools\/assets\/cli\.ts /);
    }
  });
});

describe("assets.config.json", () => {
  const config = loadConfig(ROOT);

  it("manages the game's art and the source art, and never the client's bundled art", () => {
    expect(matchesRules("assets/cast/pib/assembled.png", config)).toBe(true);
    expect(matchesRules("assets/audio/rain.webm", config)).toBe(true);
    expect(matchesRules("art/source/painted-rifts/x.png", config)).toBe(true);
    // Vite imports these into the bundle at build time; they stay in git.
    expect(matchesRules("packages/client/src/assets/painted/leaf.webp", config)).toBe(false);
    expect(matchesRules("packages/client/public/icon.png", config)).toBe(false);
    // Text stays in git: manifests, briefs, the prompts.
    expect(matchesRules("assets/manifest.json", config)).toBe(false);
    expect(matchesRules("assets/brand/logo.svg", config)).toBe(false);
  });

  it("keeps the CloudFront prefixes the site serves out of the store's roots", () => {
    // content/ and the voice clips are served from the site bucket by their own rules.
    expect(config.roots).not.toContain("content");
    expect(config.roots).not.toContain("voice");
  });
});

describe("the store's budget (#733)", () => {
  const store = fs.readFileSync(path.join(ROOT, "infra", "asset-store.yaml"), "utf8");
  const resource = (name: string): string => {
    const start = store.indexOf(`\n  ${name}:\n`);
    expect(start, name).toBeGreaterThan(0);
    const rest = store.slice(start + 1);
    const next = rest.slice(1).search(/\n  [A-Za-z]+:\n/);
    return rest.slice(0, next < 0 ? undefined : next + 1);
  };

  it("filters on the tag the bucket and the CDN both carry, so it sees their cost", () => {
    const tag = /Key: kad:component\s+Value: asset-store/;
    expect(resource("StoreBucket")).toMatch(tag);
    expect(resource("Distribution")).toMatch(tag);
    expect(resource("StoreBudget")).toContain('"user:kad:component$asset-store"');
  });

  it("may publish to the production alarm topic", () => {
    const template = fs.readFileSync(path.join(ROOT, "infra", "template.yaml"), "utf8");
    const policy = template.slice(template.indexOf("  AlarmTopicPolicy:"), template.indexOf("  ApiErrorsAlarm:"));
    expect(policy).toContain("budgets.amazonaws.com");
    expect(policy).toContain(":budgets::${AWS::AccountId}:*");
  });
});
