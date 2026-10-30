/**
 * Recorded clips live in the site bucket beside the site, so the deploy must
 * never be able to remove them (docs/voice-narration-plan.md §5): `aws s3 sync
 * --delete` deletes everything under its destination that is not in the
 * source. These tests pin the two facts that keep `voice/` safe.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("deploy.sh and the voice/ prefix", () => {
  const script = fs.readFileSync(path.join(ROOT, "scripts", "deploy.sh"), "utf8");
  // A shell command with its continuation lines joined.
  const commands = script.replace(/\\\n\s*/g, " ").split("\n");
  const syncs = commands.filter((line) => /aws s3 sync/.test(line));

  it("only ever syncs with --delete into a named prefix of its own", () => {
    const deleting = syncs.filter((line) => line.includes("--delete"));
    expect(deleting.length).toBeGreaterThan(0);
    for (const line of deleting) {
      expect(line, line).toMatch(/s3:\/\/\$BUCKET\/(bundle|assets|content)\b/);
    }
  });

  it("syncs the bucket root only without --delete", () => {
    const root = syncs.filter((line) => /s3:\/\/\$BUCKET"/.test(line));
    expect(root.length).toBeGreaterThan(0);
    for (const line of root) expect(line, line).not.toContain("--delete");
  });

  it("never names the voice prefix", () => {
    expect(script).not.toMatch(/s3:\/\/\$BUCKET\/voice/);
  });
});

describe("the CloudFront distribution", () => {
  const template = fs.readFileSync(path.join(ROOT, "infra", "template.yaml"), "utf8");

  it("serves /voice/* from the site bucket without the SPA router", () => {
    const at = template.indexOf("PathPattern: /voice/*");
    expect(at).toBeGreaterThan(0);
    const behavior = template.slice(at, at + 400);
    expect(behavior).toContain("TargetOriginId: site");
    expect(behavior).not.toContain("FunctionAssociations");
  });
});

describe("deploy.sh and the voice manifests (#545)", () => {
  const script = fs.readFileSync(path.join(ROOT, "scripts", "deploy.sh"), "utf8");

  it("checks every clip is on the site before content/ goes up, with plain node and whatever the checks setting", () => {
    const verify = script.indexOf('node tools/voice/verify-site.ts "$SITE_URL"');
    const content = script.indexOf('aws s3 sync content "s3://$BUCKET/content"');
    expect(verify).toBeGreaterThan(0);
    expect(verify).toBeLessThan(content);
    // After the checks block, so KAD_SKIP_CHECKS=1 (a prod ship) still runs it.
    expect(verify).toBeGreaterThan(script.indexOf("KAD_SKIP_CHECKS"));
    expect(script.slice(script.indexOf("KAD_SKIP_CHECKS"), verify)).toMatch(/\nfi\n/);
  });
});
