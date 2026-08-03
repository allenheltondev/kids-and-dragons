#!/usr/bin/env node
/**
 * Kids & Dragons — image asset inventory.
 *
 * Answers one question: **what still has to be drawn?**
 *
 * `art:verify` answers a different one — is what exists correct — and it is
 * deliberately quiet about absence, because a set landing next week is not a
 * regression this week. That silence is why the docs kept claiming things were
 * outstanding months after they shipped, and claiming things had shipped that
 * had not. So the counts live here, in a command, and
 * `docs/asset-inventory.md` is prose *around* this output rather than a second
 * copy of it. A number nobody can regenerate is a number that drifts.
 *
 * Every expectation is derived from `assets/manifest.json`, never from a list
 * kept here — the manifest already declares the species and their part lists,
 * the four tiers, the gear matrix, the effect sheets, the biome destinations
 * and the canonical entities. Adding a species to the manifest adds it here on
 * the next run, which is the only way this stays true.
 *
 * The one thing it cannot derive is the six effect sheets specified in
 * asset-brief §9.4 but not yet in `effects[]`. A sheet that is specified and
 * undeclared is invisible to every other tool in this repo, which is exactly
 * why it is worth naming — see SPECIFIED_NOT_DECLARED.
 *
 * Exit code is always 0: this reports, it does not gate. `art:verify` and
 * `art:verify:rig` are the gates.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const tty = process.stdout.isTTY;
const GREEN = tty ? "\x1b[32m" : "";
const YELLOW = tty ? "\x1b[33m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const RESET = tty ? "\x1b[0m" : "";

interface Manifest {
  tiers: string[];
  species: { id: string; signature: string; parts: string[] }[];
  gear: { class: string; tiers: string[]; parts: string[]; deferred?: boolean }[];
  effects: { id: string; frames: number }[];
  biomes: string[];
  entities: { id: string; classification: string }[];
}

/**
 * asset-brief §9.5's body-plan table — the creatures meant to be rig-ready, as
 * opposed to the 27 that only ever need a cutout.
 *
 * Also listed by hand, and for a worse reason than the effects above: §9.7
 * items 4 and 5 specify `enemyPlans` and `enemies[]` for the manifest and both
 * are deliberately unadded ("no enemy part-sets exist yet... there is nothing
 * yet to describe"). So the roster lives in prose, invisible to every tool.
 * Adding `enemies[]` is what would let this be derived, and would let this
 * constant be deleted.
 *
 * Worth keeping in proportion: shipped content fights exactly one of these
 * (`will_o_wisp`, the bramblewisps). The other eight are the planned roster,
 * not a backlog anything is currently blocked on.
 */
const COMBAT_ROSTER = [
  "cinder_wolf",
  "echo_hunter",
  "glassback_crab",
  "mire_mimic",
  "bone_crawler",
  "frost_wyrm",
  "river_drake",
  "will_o_wisp",
  "legend_dragon",
];

/**
 * asset-brief §9.4's six missing combat sheets, which are specified in prose
 * and absent from `effects[]`. Listed by hand because there is nowhere else to
 * read them from — and the moment one is added to the manifest it drops out of
 * the report on its own, which is the cue to delete it from here.
 */
const SPECIFIED_NOT_DECLARED = [
  { id: "miss_veer", frames: 8, why: "a miss must be marked — absence is not a signal" },
  { id: "bonus_spark", frames: 8, why: "the `rollBonus` verb" },
  { id: "dust_scuff", frames: 8, why: "`moveSelf` and `shove` share it" },
  { id: "daze_swirl", frames: 12, why: "the `skipTurn` verb" },
  { id: "guard_ward", frames: 8, why: "the `protect` verb; `guard` must also declare its event" },
  { id: "down_settle", frames: 12, why: "the `down` event damage produces" },
];

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "assets/manifest.json"), "utf8"),
) as Manifest;

const has = (...p: string[]): boolean => existsSync(join(root, ...p));
const countPngs = (dir: string): number => {
  try {
    return readdirSync(join(root, dir)).filter((f) => f.endsWith(".png")).length;
  } catch {
    return 0;
  }
};

/**
 * One row of the report.
 *
 * `have` is *derived* from `need` and `missing` rather than passed in, and
 * that is a fix rather than a style choice: with all three independent, two
 * rows managed to make the summary and the work list disagree — biomes counted
 * `bg + tiles` but listed missing prop directories too, so an empty one was
 * shown and not counted; the combat roster subtracted unknown ids from `have`
 * without listing them, so a typo in a constant would inflate "N to draw" with
 * nothing on screen to explain it. Neither could bite yet. Both would have
 * bitten silently, in a tool whose only job is to be trusted later.
 */
interface Line {
  category: string;
  need: number;
  /** What is missing, named — a count alone is not a work list. */
  missing: string[];
  note?: string;
}

const lines: Line[] = [];
const delivered = (line: Line): number => line.need - line.missing.length;

// --- Character part-sets -----------------------------------------------------
{
  const missing: string[] = [];
  let need = 0;
  for (const sp of manifest.species) {
    for (const tier of manifest.tiers) {
      const dir = `assets/characters/${sp.id}/${tier}`;
      need += sp.parts.length + 1; // parts + assembled
      if (!has(dir, "assembled.png")) missing.push(`${sp.id}/${tier}/assembled.png`);
      for (const part of sp.parts) {
        if (!has(dir, "parts", `${part}.png`)) missing.push(`${sp.id}/${tier}/parts/${part}.png`);
      }
    }
  }
  lines.push({
    category: "Character part-sets",
    need,
    missing,
    note: `${manifest.species.length} species x ${manifest.tiers.length} tiers; part counts differ by species`,
  });
}

// --- Rigs (not an image asset — listed so the dependency is visible) ---------
{
  const missing: string[] = [];
  for (const sp of manifest.species) {
    for (const tier of manifest.tiers) {
      if (!has(`assets/characters/${sp.id}/${tier}`, "rig.riv")) missing.push(`${sp.id}/${tier}`);
    }
  }
  const need = manifest.species.length * manifest.tiers.length;
  lines.push({
    category: "Character rigs",
    need,
    missing,
    note: "generated by rive-mcp from rigContract — not commissioned",
  });
}

// --- Gear overlays -----------------------------------------------------------
{
  const missing: string[] = [];
  let need = 0;
  for (const g of manifest.gear) {
    for (const tier of g.tiers) {
      need += g.parts.length;
      for (const part of g.parts) {
        if (!has(`assets/gear/${g.class}/${tier}`, `${part}.png`)) {
          missing.push(`${g.class}/${tier}/${part}.png`);
        }
      }
    }
  }
  lines.push({
    category: "Gear overlays",
    need,
    missing,
    note: "species-agnostic torso registration — one set works on all six",
  });
}

// --- Effect sheets -----------------------------------------------------------
{
  const missing = manifest.effects
    .filter((e) => !has("assets/effects", `${e.id}.sheet.png`))
    .map((e) => `${e.id}.sheet.png`);
  lines.push({
    category: "Effect sheets (declared)",
    need: manifest.effects.length,
    missing,
  });

  const stillUndeclared = SPECIFIED_NOT_DECLARED.filter(
    (s) => !manifest.effects.some((e) => e.id === s.id),
  );
  lines.push({
    category: "Effect sheets (spec'd, undeclared)",
    need: stillUndeclared.length,
    missing: stillUndeclared.map((s) => `${s.id} (${s.frames}f) — ${s.why}`),
    note: "asset-brief §9.4 — add to effects[] when commissioned",
  });
}

// --- Biomes ------------------------------------------------------------------
{
  const missing: string[] = [];
  for (const b of manifest.biomes) {
    if (!has(`assets/biomes/${b}`, "bg.webp")) missing.push(`${b}/bg.webp`);
    if (!has(`assets/biomes/${b}`, "tiles.png")) missing.push(`${b}/tiles.png`);
    const props = countPngs(`assets/biomes/${b}/props`);
    if (props === 0) missing.push(`${b}/props/ (empty)`);
  }
  const propTotal = manifest.biomes.reduce((n, b) => n + countPngs(`assets/biomes/${b}/props`), 0);
  lines.push({
    category: "Biome backdrops + tiles",
    // Three things per destination, because three things are checked: a
    // backdrop, a tile sheet, and a props directory with something in it.
    need: manifest.biomes.length * 3,
    missing,
    note: `${manifest.biomes.length} destinations; ${propTotal} prop files across them`,
  });
}

// --- Canonical entities ------------------------------------------------------
{
  const missing = manifest.entities
    .filter((e) => !has(`assets/entities/${e.id}`, "assembled.png"))
    .map((e) => `${e.id}/assembled.png`);
  lines.push({
    category: "Entity cutouts",
    need: manifest.entities.length,
    missing,
    note: "single assembled.png each — enemies do not level, so no tier dimension",
  });

  // Part-sets are only wanted for creatures that will be rigged. The other 18
  // are ambient and supporting cast: a cutout is the whole delivery.
  const known = new Set(manifest.entities.map((e) => e.id));
  const stale = COMBAT_ROSTER.filter((id) => !known.has(id));
  const missingParts = COMBAT_ROSTER.filter(
    (id) => known.has(id) && countPngs(`assets/entities/${id}/parts`) === 0,
  );
  lines.push({
    category: "Entity part-sets (combat)",
    need: COMBAT_ROSTER.length,
    missing: [
      ...missingParts.map((id) =>
        id === "will_o_wisp" ? `${id}  <- the only one shipped content fights` : id,
      ),
      // Named rather than silently subtracted: this is a bug in the constant
      // above, not work for anybody to draw, and it must say so out loud.
      ...stale.map((id) => `${id}  <- BUG: in COMBAT_ROSTER, absent from manifest entities[]`),
    ],
    note: "asset-brief §9.5 — the prerequisite for enemy rigs; the other 18 entities need cutouts only",
  });
}

// --- Report ------------------------------------------------------------------

console.log(`${BOLD}Kids & Dragons - image asset inventory${RESET}`);
console.log(`${DIM}derived from assets/manifest.json + what is on disk${RESET}\n`);

const pad = Math.max(...lines.map((l) => l.category.length));
let outstanding = 0;
for (const line of lines) {
  const short = line.missing.length;
  outstanding += short;
  const mark = short === 0 ? `${GREEN}complete${RESET}` : `${YELLOW}${short} to draw${RESET}`;
  console.log(`  ${line.category.padEnd(pad)}  ${String(delivered(line)).padStart(4)}/${String(line.need).padEnd(4)}  ${mark}`);
  if (line.note) console.log(`  ${" ".repeat(pad)}  ${DIM}${line.note}${RESET}`);
}

console.log(`\n${BOLD}Outstanding${RESET}`);
let any = false;
for (const line of lines) {
  if (line.missing.length === 0) continue;
  any = true;
  console.log(`\n  ${BOLD}${line.category}${RESET} — ${line.missing.length}`);
  for (const m of line.missing.slice(0, 40)) console.log(`    ${m}`);
  if (line.missing.length > 40) {
    console.log(`    ${DIM}... and ${line.missing.length - 40} more${RESET}`);
  }
}
if (!any) console.log(`\n  ${GREEN}nothing outstanding${RESET}`);

console.log(
  `\n${DIM}${outstanding} file(s) outstanding. This reports; it does not gate — see art:verify.${RESET}`,
);
