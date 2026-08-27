#!/usr/bin/env node
/**
 * The manual road — `npm run audio:import -- ~/Downloads`.
 *
 * `audio:generate` calls a provider's API. Not every way of making audio has
 * one: a free tier, or a paid pack, or a friend with a microphone, all end the
 * same way — a folder of files somebody downloaded. This takes that folder and
 * finishes the job the generator would have: match each file to the cue it is
 * for, encode to Opus at the one loudness target, put it where the game looks.
 *
 * The encode is the part worth not skipping by hand. Files arrive as MP3 at
 * whatever level the tool that made them felt like, and a set of cues that are
 * individually fine but three decibels apart from each other is exactly the
 * kind of wrong nobody can point at — it just sounds cheap.
 *
 *   npm run audio:import -- ~/Downloads            # everything it recognises
 *   npm run audio:import -- take7.mp3 --as dice    # one file, named by hand
 *   npm run audio:import -- ~/Downloads --force    # replace what is there
 *
 * Nothing is deleted and nothing is moved: the downloads stay where they are.
 */

import fs from "node:fs";
import path from "node:path";
import { encodeToWebm } from "./generate";
import { planImport, type Plan } from "./match";
import { audioJobs, type AudioJob } from "./specs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const AUDIO = path.join(ROOT, "assets", "audio");

/** What a browser hands you, plus what a pack ships. */
const SOURCE_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm"]);

/** Every candidate file under the paths given, one level deep. */
export function collectSources(inputs: string[]): string[] {
  const files: string[] = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) continue;
    if (fs.statSync(input).isDirectory()) {
      for (const entry of fs.readdirSync(input)) {
        const full = path.join(input, entry);
        if (fs.statSync(full).isFile() && SOURCE_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
          files.push(full);
        }
      }
    } else if (SOURCE_EXTENSIONS.has(path.extname(input).toLowerCase())) {
      files.push(input);
    }
  }
  return files.sort();
}

function report(plan: Plan): void {
  for (const { file, candidates } of plan.ambiguous) {
    console.error(
      `? ${path.basename(file)} could be ${candidates.join(" or ")} — rename it, or use --as <selector>`,
    );
  }
  for (const { selector, files } of plan.contested) {
    console.error(
      `? ${selector} is claimed by ${String(files.length)} files (${files
        .map((f) => path.basename(f))
        .join(", ")}) — keep the take you want and re-run`,
    );
  }
  if (plan.unmatched.length > 0) {
    console.log(
      `· ignored ${String(plan.unmatched.length)} file(s) that name no cue: ${plan.unmatched
        .map((f) => path.basename(f))
        .slice(0, 4)
        .join(", ")}${plan.unmatched.length > 4 ? " …" : ""}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const asIndex = args.indexOf("--as");
  const forced = asIndex >= 0 ? args[asIndex + 1] : undefined;
  const inputs = args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    return !(asIndex >= 0 && index === asIndex + 1);
  });

  if (inputs.length === 0) {
    console.error("Give me a folder or some files: npm run audio:import -- ~/Downloads");
    process.exit(2);
  }

  const jobs = audioJobs();
  const sources = collectSources(inputs);
  if (sources.length === 0) {
    console.error("No audio files found there.");
    process.exit(2);
  }

  let plan: Plan;
  if (forced !== undefined) {
    const job = jobs.find((candidate) => candidate.selector === forced || candidate.id === forced);
    if (!job) {
      console.error(`"${forced}" is not a cue. \`npm run audio:briefs\` lists them.`);
      process.exit(2);
    }
    if (sources.length > 1) {
      console.error("--as names one cue, so give it one file.");
      process.exit(2);
    }
    plan = { imports: [{ file: sources[0]!, job }], unmatched: [], ambiguous: [], contested: [] };
  } else {
    plan = planImport(sources, jobs);
  }

  report(plan);

  let imported = 0;
  const failed: string[] = [];
  for (const { file, job } of plan.imports) {
    const destination = path.join(AUDIO, (job as AudioJob).file);
    if (fs.existsSync(destination) && !force) {
      console.log(`· ${job.selector} already exists (--force to replace)`);
      continue;
    }
    try {
      encodeToWebm(fs.readFileSync(file), destination);
      imported += 1;
      console.log(`✓ ${path.basename(file)} → assets/audio/${job.file}`);
    } catch (error) {
      failed.push(job.selector);
      console.error(`✗ ${job.selector}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n${String(imported)} imported. \`npm run audio:verify\` says what is left.`);
  // Same contract as the generator: what the person read, the shell hears.
  if (failed.length > 0 || plan.ambiguous.length > 0 || plan.contested.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await main();
}
