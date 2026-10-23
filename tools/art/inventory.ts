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
 * The explicit audit hook for prose-specified effects remains below. All six
 * sheets from asset-brief §9.4 are now declared, so the list is empty; keeping
 * the typed hook makes a future prose-only commission visible to this report.
 *
 * Exit code is always 0: this reports, it does not gate. `art:verify` is the gate.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { environmentCoverage } from "./environment-coverage.ts";

const tty = process.stdout.isTTY;
const GREEN = tty ? "\x1b[32m" : "";
const YELLOW = tty ? "\x1b[33m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const RESET = tty ? "\x1b[0m" : "";

interface Manifest {
  tiers: string[];
  species: { id: string }[];
  gearPortraits: {
    class: string;
    tiers: string[];
    species: string[];
    canvas: { width: number; height: number };
  }[];
  figureVariants: {
    class: string;
    tier: string;
    species: string;
  }[];
  effects: { id: string; frames: number }[];
  biomes: string[];
  backgroundOnlyBiomes?: string[];
  sceneIllustrations?: string[];
  campaignArt?: { campaigns: string[] };
  storyPlates?: { ids: string[] };
  paintedIcons?: { ids: string[] };
  entities: { id: string; classification: string }[];
}

/**
 * Effects specified in prose but not yet declared in `effects[]`. All six from
 * asset-brief §9.4 are delivered; retain this typed list as an audit hook.
 */
const SPECIFIED_NOT_DECLARED: { id: string; frames: number; why: string }[] = [];

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
  missingLabel?: string;
}

const lines: Line[] = [];
const delivered = (line: Line): number => line.need - line.missing.length;

// --- Character illustrations -----------------------------------------------------
{
  const missing: string[] = [];
  let need = 0;
  for (const sp of manifest.species) {
    for (const tier of manifest.tiers) {
      const dir = `assets/characters/${sp.id}/${tier}`;
      need += 1;
      if (!has(dir, "assembled.png")) missing.push(`${sp.id}/${tier}/assembled.png`);
    }
  }
  lines.push({
    category: "Character illustrations",
    need,
    missing,
    note: `${manifest.species.length} species x ${manifest.tiers.length} tiers; one transparent illustration per appearance`,
  });
}

// --- Approved purpose-drawn gear portraits ----------------------------------
{
  const missing: string[] = [];
  let need = 0;
  for (const group of manifest.gearPortraits) {
    for (const tier of group.tiers) {
      for (const species of group.species) {
        need += 1;
        if (!has(`assets/gear-portraits/${group.class}/${tier}`, `${species}.png`)) {
          missing.push(`${group.class}/${tier}/${species}.png`);
        }
      }
    }
  }
  lines.push({
    category: "Gear portraits",
    need,
    missing,
    note: "approved opaque source art — one exact fit per class, tier, and species",
  });
}

// --- Species-specific class rig variants ------------------------------------
{
  const missing: string[] = [];
  let need = 0;
  const declared = new Map(
    manifest.figureVariants.map((variant) => [
      `${variant.class}/${variant.tier}/${variant.species}`,
      variant,
    ]),
  );

  for (const group of manifest.gearPortraits) {
    for (const tier of group.tiers) {
      for (const species of group.species) {
        need += 1;
        const key = `${group.class}/${tier}/${species}`;
        const variant = declared.get(key);
        if (!variant) {
          missing.push(key);
          continue;
        }

        const dir = `assets/character-rigs/${key}`;
        const absent = [
          ...(has(dir, "assembled.png") ? [] : ["assembled.png"]),
        ];
        if (absent.length > 0) missing.push(`${key} (missing ${absent.join(", ")})`);
      }
    }
  }

  lines.push({
    category: "Class figure variants",
    need,
    missing,
    missingLabel: "to illustrate",
    note: "finished transparent illustrations; assembled.png only",
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
    note: "asset-brief §9.4 audit hook — all six commissioned sheets are declared",
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

// --- Scene illustrations -----------------------------------------------------
{
  const backgrounds = manifest.backgroundOnlyBiomes ?? [];
  lines.push({
    category: "Story-only environments",
    need: backgrounds.length,
    missing: backgrounds.filter(id => !has(`assets/biomes/${id}`, "bg.webp")),
    note: `${backgrounds.join(", ")}; backdrops only — no tactical tiles or props required`,
  });
  const coverage = environmentCoverage(root, manifest);
  lines.push({
    category: "Canon place coverage",
    ...coverage,
    note: "biomes + named locations; every backdrop must be declared and present (shared art allowed)",
    missingLabel: "coverage gaps",
  });
}

{
  const illustrations = manifest.sceneIllustrations ?? [];
  lines.push({
    category: "Scene illustrations",
    need: illustrations.length,
    missing: illustrations.filter((id) => !has("assets", `${id}.webp`)),
    note: "optional story backdrops; biome art remains the fallback",
  });
}

{
  const campaigns = manifest.campaignArt?.campaigns ?? [];
  lines.push({
    category: "Campaign key art",
    need: campaigns.length,
    missing: campaigns.filter((id) => !has("assets/campaigns", `${id}.webp`)).map((id) => `${id}.webp`),
    note: "lobby adventure cards; a story scene stands in until delivered",
  });
}

{
  const plates = manifest.storyPlates?.ids ?? [];
  lines.push({
    category: "Story plates",
    need: plates.length,
    missing: plates.filter((id) => !has("assets", `${id}.webp`)).map((id) => `${id}.webp`),
    note: "prologue and chapter plates, 1600x900 (docs/story-plates.md); the story plays without a plate until it lands",
  });
}

// --- Canonical entities ------------------------------------------------------
{
  const icons = manifest.paintedIcons?.ids ?? [];
  lines.push({
    category: "Additional painted icons",
    need: icons.length,
    missing: icons.filter(id => !has("packages/client/src/assets/painted", `${id}.webp`)),
    note: "#421 ability icons and distinct facets, key and potion; bundled with the client",
  });
}

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

}

// --- Report ------------------------------------------------------------------

console.log(`${BOLD}Kids & Dragons - image asset inventory${RESET}`);
console.log(`${DIM}derived from assets/manifest.json + what is on disk${RESET}\n`);

const pad = Math.max(...lines.map((l) => l.category.length));
let outstanding = 0;
for (const line of lines) {
  const short = line.missing.length;
  outstanding += short;
  const mark = short === 0
    ? `${GREEN}complete${RESET}`
    : `${YELLOW}${short} ${line.missingLabel ?? "to draw"}${RESET}`;
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
  `\n${DIM}${outstanding} deliverable(s) outstanding. This reports; it does not gate — see art:verify.${RESET}`,
);
