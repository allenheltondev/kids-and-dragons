#!/usr/bin/env node
/**
 * The encounter balance report — `npm run content:balance`.
 *
 * Roadmap chapter 6 asks for "estimated rounds, expected damage". The model is
 * `packages/shared/src/balance.ts`; this walks the content tree, resolves each
 * fight the way the server loader does, and prints what it finds.
 *
 * **It reports and never gates**, and the exit code says so: zero unless the
 * content is unreadable. That is `art:inventory`'s precedent rather than
 * `content:validate`'s, and the line between them is worth naming. A dangling
 * `goto` is wrong in a way a build can prove. Whether a fight is the right size
 * is a judgement about an evening at a table with an eight-year-old at it — the
 * checker's job is to put the number in front of the person who gets to decide,
 * not to decide.
 *
 * The one thing it does gate on is its own ability to answer: an unresolvable
 * creature means the report would be silently missing a fight, and a silent gap
 * in a report is worse than a red build.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defaultParty, estimateEncounter, resolveEnemy, TARGET_ROUNDS } from "@kad/shared";
import type {
  Bestiary,
  Chapter,
  EncounterEstimate,
  EnemySpec,
  PartyProfile,
  RulesContent,
} from "@kad/shared";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const tty = process.stdout.isTTY;
const RED = tty ? "[31m" : "";
const GREEN = tty ? "[32m" : "";
const YELLOW = tty ? "[33m" : "";
const DIM = tty ? "[2m" : "";
const BOLD = tty ? "[1m" : "";
const OFF = tty ? "[0m" : "";

function readJson<T>(...segments: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...segments), "utf8")) as T;
}

const rules = readJson<RulesContent>("content", "rules.json");
const bestiary = readJson<Bestiary>("content", "bestiary.json");
const party: PartyProfile = defaultParty(rules);

const chapterDir = path.join(ROOT, "content", "chapters");
const chapterFiles = fs
  .readdirSync(chapterDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

/** How a verdict reads, and in what colour. Icon *and* word, never colour alone. */
const VERDICT: Record<EncounterEstimate["verdict"], { word: string; colour: string }> = {
  short: { word: "short", colour: YELLOW },
  on_target: { word: "on target", colour: GREEN },
  long: { word: "long", colour: RED },
};

/**
 * The round count, as a range when the two readings of §7.3 disagree.
 *
 * Nobody moves in this model, and whether a revived hero gets walked out of
 * reach is exactly the difference between a §7.3 beat and a grind. Printing one
 * number would be quoting the pessimistic end of a bracket as a measurement.
 */
function roundRange(estimate: EncounterEstimate): string {
  const { rounds, roundsIfRetreating } = estimate;
  return roundsIfRetreating === rounds
    ? String(rounds)
    : `${String(Math.min(rounds, roundsIfRetreating))}\u2013${String(Math.max(rounds, roundsIfRetreating))}`;
}

interface Finding {
  chapter: string;
  scene: string;
  estimate: EncounterEstimate;
}

const findings: Finding[] = [];
const problems: string[] = [];

for (const file of chapterFiles) {
  const chapter = readJson<Chapter>("content", "chapters", file);
  for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
    if (scene.type !== "encounter") continue;

    /*
     * Resolved exactly as the server loader resolves it. A chapter authors
     * `{ "creature": "will_o_wisp" }` and the stats come from canon, so a
     * report that read the authored form would be estimating a fight with no
     * hit points in it (bestiary.ts).
     */
    const enemies: EnemySpec[] = [];
    for (const authored of scene.enemies) {
      const { spec, problems: theirs } = resolveEnemy(authored, bestiary);
      for (const problem of theirs) problems.push(`${chapter.id}/${sceneId}: ${problem}`);
      if (spec) enemies.push(spec);
    }
    if (enemies.length !== scene.enemies.length) continue;

    findings.push({ chapter: chapter.id, scene: sceneId, estimate: estimateEncounter(enemies, party) });
  }
}

console.log(`${BOLD}Kids & Dragons — encounter balance${OFF}`);
console.log(
  `${DIM}${String(chapterFiles.length)} chapters · ${String(findings.length)} fights · ` +
    `party of ${String(party.size)} at ${String(party.hp)} HP, Guard ${String(party.guard)}, +${String(party.attackMod)} to hit${OFF}`,
);
console.log(
  `${DIM}Target: ${String(TARGET_ROUNDS.min)}–${String(TARGET_ROUNDS.max)} rounds (spec §7.1 asks for 4).${OFF}\n`,
);

if (findings.length === 0) {
  console.log(`${DIM}No encounter scenes to estimate.${OFF}`);
}

for (const { chapter, scene, estimate } of findings) {
  const { word, colour } = VERDICT[estimate.verdict];
  console.log(`${BOLD}${chapter}${OFF} ${DIM}·${OFF} ${scene}`);
  console.log(
    `  ${String(estimate.enemyCount)} enem${estimate.enemyCount === 1 ? "y" : "ies"}, ` +
      `${String(estimate.enemyHp)} HP ${DIM}vs${OFF} ${String(estimate.partyHp)} party HP`,
  );
  console.log(
    `  ${colour}${roundRange(estimate)} rounds — ${word}${OFF}` +
      `${DIM}, ${String(estimate.damageTaken)} damage taken${OFF}`,
  );

  /*
   * The knockdown lines, which are the ones worth reading twice. §7.3 wants
   * "someone goes down, someone else picks them up" to be a beat; the same rule
   * plus a nearest-target AI plus a revive that gives back 1 HP is also how a
   * fight turns into a grind, and the two are told apart by whether the same
   * hero keeps hitting the floor.
   */
  if (estimate.partyWiped) {
    console.log(`  ${RED}The party goes over — nobody is left standing to help anybody up.${OFF}`);
  } else if (estimate.heroesDown === 0) {
    console.log(`  ${DIM}Nobody goes down. Safe, and maybe too safe (§7.3).${OFF}`);
  } else if (estimate.knockdowns > estimate.heroesDown + 1) {
    console.log(
      `  ${YELLOW}${String(estimate.knockdowns)} knockdowns across ${String(estimate.heroesDown)} ` +
        `hero${estimate.heroesDown === 1 ? "" : "es"} — a revive spiral, not a §7.3 beat.${OFF}`,
    );
  } else {
    console.log(
      `  ${DIM}${String(estimate.heroesDown)} hero${estimate.heroesDown === 1 ? "" : "es"} ` +
        `on the floor at some point — the §7.3 beat.${OFF}`,
    );
  }

  for (const note of estimate.notes) console.log(`  ${DIM}${note}${OFF}`);
  console.log("");
}

if (problems.length > 0) {
  console.log(`${RED}${BOLD}Could not estimate:${OFF}`);
  for (const problem of problems) console.log(`  ${RED}${problem}${OFF}`);
  console.log(
    `\n${DIM}A fight missing from a report looks the same as a fight that is fine, so this is` +
      ` the one thing here that fails.${OFF}`,
  );
  process.exit(1);
}

/*
 * ---------------------------------------------------------------------------
 * The bands, before anybody writes a fight out of them.
 *
 * The authored encounters are the point, but there is one of them, and every
 * fight anybody writes next is a band at its usual count. `encounterBands`
 * carries the only balance arithmetic this project had — a `$comment` deriving
 * the stat blocks from §7.1's four rounds — so running the model over the table
 * itself is the shortest path from "I want a hard fight" to "here is what a
 * hard fight costs".
 */
interface Band {
  description?: string;
  stats: { hp: number; guard: number; quick: number; steps: number; attack: number } | null;
  usualCount: number;
}

const bands = Object.entries(
  (rules as RulesContent & { encounterBands?: Record<string, Band | string> }).encounterBands ?? {},
).filter((entry): entry is [string, Band] => typeof entry[1] === "object" && entry[1] !== null);

if (bands.length > 0) {
  console.log(`${BOLD}The bands${OFF} ${DIM}· content/rules.json, at each one's usual count${OFF}`);
  for (const [name, band] of bands) {
    if (band.stats === null) {
      // "legend" has no stat block on purpose: a designed encounter authors its
      // own numbers and can never be generated.
      console.log(`  ${name.padEnd(11)} ${DIM}authors its own — a designed encounter, not a rolled one${OFF}`);
      continue;
    }
    const estimate = estimateEncounter(
      [{ id: name, count: band.usualCount, ...band.stats }],
      party,
    );
    const { word, colour } = VERDICT[estimate.verdict];
    // Padded before the escapes go on: a colour code is zero columns wide and
    // `padEnd` counts it anyway, so colouring first shreds the alignment on
    // exactly the terminals that can see the colour.
    const block = `${String(band.usualCount)}×${String(band.stats.hp)} HP, Guard ${String(band.stats.guard)}, +${String(band.stats.attack)}`;
    console.log(
      `  ${name.padEnd(11)} ${DIM}${block.padEnd(26)}${OFF}` +
        `${colour}${`${roundRange(estimate)} rounds, ${word}`.padEnd(20)}${OFF}` +
        `${DIM}${String(estimate.damageTaken)} damage, ${String(estimate.knockdowns)} knockdown` +
        `${estimate.knockdowns === 1 ? "" : "s"}${OFF}`,
    );
  }
  console.log("");
}

const off = findings.filter((f) => f.estimate.verdict !== "on_target").length;
console.log(
  off === 0
    ? `${GREEN}Every fight lands inside the target.${OFF}`
    : `${DIM}${String(off)} of ${String(findings.length)} outside the target. Nothing here fails a build —` +
        ` how long a fight should run is your call.${OFF}`,
);
