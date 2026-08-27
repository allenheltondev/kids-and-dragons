#!/usr/bin/env node
/**
 * The worksheet — `npm run audio:briefs`.
 *
 * What to paste into somebody else's UI, and what to call the file that comes
 * back. The generator sends these prompts over an API; this prints them for
 * the evening when the API is not the road — a free tier, a pack search, a
 * brief for a person.
 *
 * By default it lists only what the game is still synthesizing, because that
 * is the actual worklist. `--all` prints the set.
 */

import fs from "node:fs";
import path from "node:path";
import { audioJobs } from "./specs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const AUDIO = path.join(ROOT, "assets", "audio");

const all = process.argv.includes("--all");
const jobs = audioJobs().filter((job) => all || !fs.existsSync(path.join(AUDIO, job.file)));

if (jobs.length === 0) {
  console.log("Every cue has a file. `npm run audio:verify` checks them.");
} else {
  console.log(
    `${String(jobs.length)} to make. Generate each one, download it, and keep the cue name\n` +
      "somewhere in the filename — `dice.mp3`, `ElevenLabs_dice_v2.mp3`, anything\n" +
      "containing it. Then: npm run audio:import -- ~/Downloads\n",
  );
  for (const job of jobs) {
    // The length is a target rather than a rule; a UI that only offers
    // presets is fine to round with.
    console.log(`── ${job.selector}  (${String(job.seconds)}s, ${job.kind})`);
    console.log(`   file: something containing "${job.id}"`);
    console.log(`   ${job.brief}\n`);
  }
}
