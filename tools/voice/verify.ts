#!/usr/bin/env node
/**
 * The voice gate — `npm run voice:verify` (docs/voice-narration-plan.md §4).
 *
 * Fails on broken, never on missing (check.ts says what each means). From git
 * alone it checks every manifest against the words the game says today, the
 * script sidecars and the cast, the clip lengths and the approvals lock. Given a
 * destination it also asks whether every clip a manifest plays is there:
 *
 *   npm run voice:verify                                  # git only (CI's checks job)
 *   npm run voice:verify -- --site https://…cloudfront.net  # and the deployed site (deploy.sh)
 *   npm run voice:verify -- --stage prod                  # the stage's site, found from its stack
 *   npm run voice:verify -- --bucket NAME | --dir FOLDER  # a bucket (your AWS credentials) or a trial folder
 *   npm run voice:verify -- --fix                         # drop entries that would play the old words, then check
 *
 * `--fix` changes no clip and calls nothing: it only takes out manifest entries
 * whose clips say words, a voice or a delivery that have since changed, so those
 * lines fall back to the device voice until `voice:generate` renders them again.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { S3Client } from "@aws-sdk/client-s3";
import { checkManifests, checkSources, fixManifest, type Finding } from "./check";
import { SiteClipSource, type ClipSource } from "./sources";
import { DirClipStore, S3ClipStore } from "./store";
import { desire, loadWorld, MANIFEST_DIR } from "./world";
import type { Desired } from "./desired";

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    stage: { type: "string" },
    bucket: { type: "string" },
    dir: { type: "string" },
    region: { type: "string" },
    fix: { type: "boolean", default: false },
  },
});

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const region = values.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const list = (value: string | undefined): string[] => (value?.split(",") ?? []).map((v) => v.trim()).filter(Boolean);

async function sources(): Promise<ClipSource[]> {
  const out: ClipSource[] = list(values.site).map((site) => new SiteClipSource(site));
  const stages = list(values.stage);
  if (stages.length > 0) {
    const cloudformation = new CloudFormationClient({ region });
    for (const stage of stages) {
      const stack = await cloudformation.send(new DescribeStacksCommand({ StackName: `kad-${stage}` }));
      const site = stack.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === "SiteUrl")?.OutputValue;
      if (site === undefined) {
        console.error(`Stack kad-${stage} has no SiteUrl output.`);
        process.exit(2);
      }
      out.push(new SiteClipSource(site));
    }
  }
  const buckets = list(values.bucket);
  if (buckets.length > 0) {
    const s3 = new S3Client({ region });
    out.push(...buckets.map((bucket) => new S3ClipStore(s3, bucket)));
  }
  if (values.dir !== undefined) out.push(new DirClipStore(path.resolve(values.dir)));
  return out;
}

const world = loadWorld();
const desired = new Map<string, Desired>([...world.groups.keys()].map((name) => [name, desire(world, name)]));

if (values.fix) {
  let dropped = 0;
  for (const [name, manifest] of world.manifests) {
    const want = desired.get(name);
    if (want === undefined) continue;
    const fixed = fixManifest(manifest, want);
    const before = Object.values(manifest).reduce((n, v) => n + Object.keys(v).length, 0);
    const after = Object.values(fixed).reduce((n, v) => n + Object.keys(v).length, 0);
    if (before === after) continue;
    dropped += before - after;
    fs.writeFileSync(path.join(MANIFEST_DIR, `${name}.json`), `${JSON.stringify(fixed, null, 2)}\n`);
    world.manifests.set(name, fixed);
    console.log(`fixed  content/voice/manifest/${name}.json: dropped ${String(before - after)} entr${before - after === 1 ? "y" : "ies"} that would play the old words`);
  }
  if (dropped === 0) console.log("fixed  nothing to drop");
}

const verdict = checkManifests({ manifests: world.manifests, desired, lock: world.lock });
const failures: Finding[] = [...verdict.failures];
const notes: Finding[] = [...verdict.notes];

const lines = [...desired.values()].reduce((n, d) => n + d.lines.length, 0);
const recorded = [...world.manifests.values()].reduce((n, m) => n + Object.values(m).reduce((k, v) => k + Object.keys(v).length, 0), 0);
console.log(`voice: ${String(world.manifests.size)} manifest(s), ${String(recorded)} recorded line variant(s) of ${String(lines)}, ${String(verdict.clips.size)} distinct clip(s)`);

const destinations = await sources();
if (destinations.length === 0) {
  console.log(`clips  not looked up: name --site, --stage, --bucket or --dir to check every clip a manifest plays is there`);
} else if (verdict.clips.size === 0) {
  console.log(`clips  no manifest plays any yet: nothing to look up at ${destinations.map((d) => d.name).join(", ")}`);
} else {
  const found = await checkSources(verdict.clips, destinations);
  failures.push(...found.failures);
  notes.push(...found.notes);
  console.log(`clips  looked up ${String(found.checked)} at ${destinations.map((d) => d.name).join(", ")}`);
}

// Missing clips are the ordinary state of a line, so they are a count, not a list.
const missingLines = lines - recorded;
if (missingLines > 0) console.log(`${YELLOW}note${RESET}  ${String(missingLines)} line variant(s) have no clips yet and are read by the device voice (npm run voice:status)`);
const shown = new Map<string, number>();
for (const note of notes) {
  const kind = note.message.replace(/[0-9a-f]{12,64}/g, "…");
  const seen = shown.get(kind) ?? 0;
  shown.set(kind, seen + 1);
  if (seen < 5) console.log(`${YELLOW}note${RESET}  ${note.at}: ${note.message}`);
}
for (const [kind, count] of shown) if (count > 5) console.log(`${YELLOW}note${RESET}  …and ${String(count - 5)} more like "${kind.slice(0, 80)}"`);
for (const failure of failures) console.log(`${RED}FAIL${RESET}  ${failure.at}: ${failure.message}`);

if (failures.length > 0) {
  console.log(`\n${RED}voice:verify: ${String(failures.length)} broken${RESET}`);
  process.exit(1);
}
console.log(`\n${GREEN}voice:verify: nothing broken${RESET}`);
