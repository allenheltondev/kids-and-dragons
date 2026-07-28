#!/usr/bin/env node
/**
 * Kids & Dragons - content validator.
 *
 * The machine gate for authored content, and the sibling of tools/art/verify.py.
 * Every file under content/ is checked against its JSON Schema in schemas/, and
 * then against the cross-file rules a schema cannot express: that the scene graph
 * actually connects, that every itemId is in the catalog, that every campaign
 * lists chapters that exist.
 *
 * The rule this exists to enforce (architecture §5, roadmap "Schema validation in CI"):
 *
 *     A malformed chapter fails the build, never the play session.
 *
 * Usage:
 *     npm run content:validate            # everything
 *     node tools/content/validate.mjs     # same thing
 *
 * Requires: ajv, ajv-formats (root devDependencies).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTENT = join(ROOT, "content");
const SCHEMAS = join(ROOT, "schemas");
const MANIFEST = join(ROOT, "assets", "manifest.json");

const tty = process.stdout.isTTY;
const RED = tty ? "\u001b[31m" : "";
const GREEN = tty ? "\u001b[32m" : "";
const YELLOW = tty ? "\u001b[33m" : "";
const DIM = tty ? "\u001b[2m" : "";
const BOLD = tty ? "\u001b[1m" : "";
const RESET = tty ? "\u001b[0m" : "";

// ----------------------------------------------------------------------------- report

class Report {
  constructor() {
    this.failures = [];
    this.warnings = [];
    this.passed = 0;
  }

  ok(label) {
    this.passed += 1;
    console.log(`  ${GREEN}pass${RESET}  ${label}`);
  }

  /** @param file repo-relative path @param path JSON pointer @param problem what is wrong */
  fail(file, path, problem, hint) {
    this.failures.push(`${file}${path}`);
    console.log(`  ${RED}FAIL${RESET}  ${file}`);
    console.log(`        at:      ${path || "/"}`);
    console.log(`        problem: ${problem}`);
    if (hint) console.log(`        ${DIM}${hint}${RESET}`);
  }

  warn(label, detail) {
    this.warnings.push(label);
    console.log(`  ${YELLOW}warn${RESET}  ${label}`);
    if (detail) console.log(`        ${detail}`);
  }
}

// ----------------------------------------------------------------------------- loading

const rel = (p) => relative(ROOT, p).split("\\").join("/");

function readJson(rep, path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    rep.fail(rel(path), "", `not valid JSON - ${err.message}`);
    return null;
  }
}

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

/** ajv error -> one human line. Its own message is usually good; params add the detail. */
function describe(err) {
  const p = err.params ?? {};
  const extra = [
    p.additionalProperty && `unknown property "${p.additionalProperty}"`,
    p.missingProperty && `missing "${p.missingProperty}"`,
    p.allowedValues && `allowed: ${p.allowedValues.join(", ")}`,
    p.limit !== undefined && `limit ${p.limit}`,
    p.pattern && `pattern ${p.pattern}`,
  ]
    .filter(Boolean)
    .join("; ");
  return extra ? `${err.message} (${extra})` : err.message;
}

// ----------------------------------------------------------------------------- schema pass

function validateAgainstSchema(rep, ajv, schemaName, path, data) {
  const validate = ajv.getSchema(schemaName);
  if (validate(data)) {
    rep.ok(`${rel(path)}  schema ${schemaName}`);
    return true;
  }
  // Errors from failed if/then branches are noisy; keep the specific ones and drop
  // the "must match a schema in anyOf/if" summaries that repeat what follows.
  const errors = validate.errors.filter((e) => e.keyword !== "if");
  for (const err of errors) {
    rep.fail(rel(path), err.instancePath, describe(err));
  }
  return false;
}

// ----------------------------------------------------------------------------- cross-file checks

/** Rules invariants a schema cannot state: ordering and one-class-per-stat. */
function checkRules(rep, file, rules) {
  const f = rel(file);
  let ok = true;

  if (rules.levelXp[0] !== 0) {
    rep.fail(f, "/levelXp/0", `level 1 must cost 0 XP, got ${rules.levelXp[0]}`);
    ok = false;
  }
  for (let i = 1; i < rules.levelXp.length; i += 1) {
    if (rules.levelXp[i] <= rules.levelXp[i - 1]) {
      rep.fail(
        f,
        `/levelXp/${i}`,
        `XP thresholds must increase: level ${i + 1} needs ${rules.levelXp[i]}, ` +
          `level ${i} already needed ${rules.levelXp[i - 1]}`,
      );
      ok = false;
    }
  }

  // spec §8.1 - the four appearance tiers, in level order.
  const tiers = ["fledgling", "sworn", "radiant", "mythic"];
  for (let i = 1; i < tiers.length; i += 1) {
    if (rules.tierLevels[tiers[i]] <= rules.tierLevels[tiers[i - 1]]) {
      rep.fail(
        f,
        `/tierLevels/${tiers[i]}`,
        `tiers must be reached in order: ${tiers[i]} at level ${rules.tierLevels[tiers[i]]} ` +
          `is not after ${tiers[i - 1]} at level ${rules.tierLevels[tiers[i - 1]]}`,
      );
      ok = false;
    }
  }
  const maxLevel = rules.levelXp.length;
  if (rules.tierLevels.mythic > maxLevel) {
    rep.fail(f, "/tierLevels/mythic", `mythic is at level ${rules.tierLevels.mythic}, but levelXp only reaches level ${maxLevel}`);
    ok = false;
  }

  // spec §4.3 - four classes, one per stat. Two classes on one stat leaves a stat
  // with no class and breaks the "one roll type" symmetry the whole design rests on.
  const byStat = new Map();
  for (const [id, cls] of Object.entries(rules.classes)) {
    if (byStat.has(cls.stat)) {
      rep.fail(f, `/classes/${id}/stat`, `stat "${cls.stat}" is already used by class "${byStat.get(cls.stat)}"`);
      ok = false;
    }
    byStat.set(cls.stat, id);
  }

  // Icons carry the text (spec §11) - so an empty slug anywhere is a real defect.
  for (const [id, sp] of Object.entries(rules.species)) {
    for (const key of ["worldAbility", "combatAction"]) {
      if (!sp[key].icon?.trim()) {
        rep.fail(f, `/species/${id}/${key}/icon`, "icon slug is empty");
        ok = false;
      }
    }
  }
  for (const [id, cls] of Object.entries(rules.classes)) {
    const abilities = [["signature", cls.signature], ...Object.entries(cls.unlocks)];
    for (const [key, ability] of abilities) {
      if (!ability.icon?.trim()) {
        rep.fail(f, `/classes/${id}/${key}/icon`, "icon slug is empty");
        ok = false;
      }
    }
  }

  if (ok) rep.ok(`${f}  rules invariants  (XP curve, tier order, one class per stat, icons)`);
  return ok;
}

function checkItems(rep, file, items) {
  const f = rel(file);
  let ok = true;
  for (const [id, item] of Object.entries(items)) {
    if (!item.icon?.trim()) {
      rep.fail(f, `/${id}/icon`, "icon slug is empty");
      ok = false;
    }
  }
  const kinds = new Set(Object.values(items).map((i) => i.kind));
  for (const kind of ["consumable", "trinket", "quest"]) {
    if (!kinds.has(kind)) {
      rep.warn(`${f} has no ${kind} items`, "spec §9.2 defines three kinds; a catalog missing one is probably unfinished.");
    }
  }
  if (ok) rep.ok(`${f}  item catalog  (${Object.keys(items).length} items, icons present)`);
  return ok;
}

/** Every scene id this scene can transition to, with the JSON pointer that named it. */
function outgoing(scene, sceneId) {
  const edges = [];
  const base = `/scenes/${sceneId}`;
  if (Array.isArray(scene.choices)) {
    scene.choices.forEach((c, i) => edges.push([c.goto, `${base}/choices/${i}/goto`]));
  }
  for (const key of ["onSuccess", "onFailure", "onVictory", "onDefeat"]) {
    if (scene[key]?.goto) edges.push([scene[key].goto, `${base}/${key}/goto`]);
  }
  return edges;
}

/** Every effect in a scene, with its pointer. */
function effectsOf(scene, sceneId) {
  const out = [];
  const base = `/scenes/${sceneId}`;
  const push = (list, at) => (list ?? []).forEach((e, i) => out.push([e, `${at}/${i}`]));
  push(scene.onEnter, `${base}/onEnter`);
  (scene.choices ?? []).forEach((c, i) => push(c.effects, `${base}/choices/${i}/effects`));
  for (const key of ["onSuccess", "onFailure", "onVictory", "onDefeat"]) {
    if (scene[key]) push(scene[key].effects, `${base}/${key}/effects`);
  }
  return out;
}

function checkChapter(rep, file, chapter, items, rules, biomes) {
  const f = rel(file);
  let ok = true;
  const fail = (path, problem, hint) => {
    rep.fail(f, path, problem, hint);
    ok = false;
  };

  const expectedId = basename(file, ".json");
  if (chapter.id !== expectedId) {
    fail("/id", `id "${chapter.id}" does not match filename "${expectedId}.json"`, "The loader resolves chapters by filename.");
  }

  const scenes = chapter.scenes;
  const ids = new Set(Object.keys(scenes));

  if (!ids.has(chapter.entry)) {
    fail("/entry", `entry scene "${chapter.entry}" does not exist`);
  }

  // --- every goto names a scene that exists
  const edges = new Map();
  for (const [id, scene] of Object.entries(scenes)) {
    const outs = outgoing(scene, id);
    for (const [target, at] of outs) {
      if (!ids.has(target)) {
        const near = [...ids].filter((id) => id.startsWith(target.slice(0, 4)));
        fail(at, `goto "${target}" is not a scene in this chapter`, near.length ? `did you mean: ${near.join(", ")}?` : null);
      }
    }
    edges.set(id, outs.filter(([t]) => ids.has(t)).map(([t]) => t));
  }

  // --- every scene is reachable from entry
  const seen = new Set();
  const queue = ids.has(chapter.entry) ? [chapter.entry] : [];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of edges.get(id) ?? []) queue.push(next);
  }
  for (const id of ids) {
    if (!seen.has(id)) {
      fail(`/scenes/${id}`, "scene is unreachable from entry", "An orphan scene is either a typo in a goto or content nobody will ever see.");
    }
  }

  // --- no dead ends: an ending must be reachable from every scene.
  // A scene with no outgoing edges IS the ending (the Chapter type has no terminal
  // marker, so an empty `choices` array is the only way to say "the chapter stops
  // here" - see content/README.md). Getting stuck in a loop with no way out is the
  // failure this catches.
  const endings = [...ids].filter((id) => (edges.get(id) ?? []).length === 0);
  if (endings.length === 0) {
    fail("/scenes", "chapter has no ending - every scene leads to another scene", "End on a rest scene with an empty `choices` array (spec §6.1).");
  } else {
    const canFinish = new Set(endings);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, outs] of edges) {
        if (canFinish.has(id)) continue;
        if (outs.some((t) => canFinish.has(t))) {
          canFinish.add(id);
          changed = true;
        }
      }
    }
    for (const id of ids) {
      if (!canFinish.has(id)) {
        fail(`/scenes/${id}`, "dead end - no path from this scene reaches the end of the chapter");
      }
    }
    for (const id of endings) {
      if (scenes[id].type === "check" || scenes[id].type === "encounter") {
        fail(`/scenes/${id}`, `a ${scenes[id].type} scene cannot be an ending - both of its branches must go somewhere`);
      }
    }
  }

  // --- every itemId exists in the catalog, and is used as the right kind
  const speciesIds = new Set(Object.keys(rules?.species ?? {}));
  const flagsSet = new Set();
  const flagsRequired = [];

  for (const [id, scene] of Object.entries(scenes)) {
    for (const [effect, at] of effectsOf(scene, id)) {
      if (effect.type === "setFlag") flagsSet.add(effect.flag);
      if (!effect.itemId) continue;
      const item = items?.[effect.itemId];
      if (!item) {
        fail(`${at}/itemId`, `item "${effect.itemId}" is not in content/items.json`);
        continue;
      }
      if (effect.type === "grantQuestItem" && item.kind !== "quest") {
        fail(`${at}/itemId`, `"${effect.itemId}" is a ${item.kind}, so it must be granted with grantItem, not grantQuestItem`);
      }
      if (effect.type === "grantItem" && item.kind === "quest") {
        fail(`${at}/itemId`, `"${effect.itemId}" is a quest item - use grantQuestItem so it stays outside the six slots (spec §9.2)`);
      }
    }

    (scene.choices ?? []).forEach((choice, i) => {
      const at = `/scenes/${id}/choices/${i}`;

      if (!choice.icon?.trim()) fail(`${at}/icon`, "icon slug is empty - no interactive element ships without an icon (spec §11)");

      if (choice.requiresItem && !items?.[choice.requiresItem]) {
        fail(`${at}/requiresItem`, `item "${choice.requiresItem}" is not in content/items.json`);
      }
      if (choice.requiresFlag) flagsRequired.push([choice.requiresFlag, `${at}/requiresFlag`]);

      const req = choice.requiresSpecies;
      if (req) {
        for (const sp of Array.isArray(req) ? req : [req]) {
          if (!speciesIds.has(sp)) {
            fail(`${at}/requiresSpecies`, `"${sp}" is not a species in content/rules.json`, `known species: ${[...speciesIds].join(", ")}`);
          }
        }
      }
    });

    // spec §7.1 - 3 players vs 2-4 enemies, never more.
    if (scene.type === "encounter") {
      const total = scene.enemies.reduce((n, e) => n + e.count, 0);
      if (total < 2 || total > 4) {
        fail(`/scenes/${id}/enemies`, `${total} enemies - encounters are 2 to 4, never more (spec §7.1)`);
      }
    }
  }

  // A choice gated on a flag nothing ever sets is invisible forever. Almost always a typo.
  for (const [flag, at] of flagsRequired) {
    if (!flagsSet.has(flag)) {
      fail(at, `flag "${flag}" is never set by any effect in this chapter`, flagsSet.size ? `flags set here: ${[...flagsSet].join(", ")}` : "no setFlag effects in this chapter at all");
    }
  }

  if (biomes && !biomes.includes(chapter.biome)) {
    fail("/biome", `biome "${chapter.biome}" is not in assets/manifest.json`, `known biomes: ${biomes.join(", ")}`);
  }

  if (ok) {
    rep.ok(`${f}  graph  (${ids.size} scenes, ${endings.length} ending${endings.length === 1 ? "" : "s"}, all reachable, all goto/itemId resolve)`);
  }
  return ok;
}

function checkCampaign(rep, file, campaign, chaptersById, brokenChapterIds) {
  const f = rel(file);
  let ok = true;
  const fail = (path, problem, hint) => {
    rep.fail(f, path, problem, hint);
    ok = false;
  };

  const expectedId = basename(file, ".json");
  if (campaign.id !== expectedId) {
    fail("/id", `id "${campaign.id}" does not match filename "${expectedId}.json"`);
  }

  const indexes = [];
  campaign.chapters.forEach((id, i) => {
    const chapter = chaptersById.get(id);
    if (!chapter) {
      // Distinguish "you typed the id wrong" from "that chapter is already failing above".
      const problem = brokenChapterIds.has(id)
        ? `chapter "${id}" did not validate - fix the errors reported against it above`
        : `chapter "${id}" has no file at content/chapters/${id}.json`;
      fail(`/chapters/${i}`, problem);
      return;
    }
    if (chapter.campaignId !== campaign.id) {
      fail(`/chapters/${i}`, `chapter "${id}" belongs to campaign "${chapter.campaignId}"`);
    }
    indexes.push([id, chapter.index]);
  });

  // Chapters are the save unit and the player sees "Chapter 3 of 6" - a gap or a
  // duplicate here is a bug in the progress UI long before anyone notices the content.
  indexes
    .slice()
    .sort((a, b) => a[1] - b[1])
    .forEach(([id, index], i) => {
      if (index !== i + 1) {
        fail("/chapters", `chapter "${id}" has index ${index}; the listed chapters must be indexed 1..${indexes.length} with no gaps`);
      }
    });

  if (ok) rep.ok(`${f}  campaign  (${campaign.chapters.length} chapter(s), contiguous indexes)`);
  return ok;
}

// ----------------------------------------------------------------------------- driver

function main() {
  const rep = new Report();

  console.log(`${BOLD}Kids & Dragons - content validate${RESET}`);
  console.log(`${DIM}schemas: ${rel(SCHEMAS)}   content: ${rel(CONTENT)}${RESET}`);

  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);

  for (const name of ["rules", "items", "chapter", "campaign"]) {
    const path = join(SCHEMAS, `${name}.schema.json`);
    if (!existsSync(path)) {
      rep.fail(rel(path), "", "schema is missing");
      continue;
    }
    const schema = readJson(rep, path);
    if (schema) ajv.addSchema(schema, name);
  }
  if (rep.failures.length) return finish(rep);

  // --- rules + items first: chapters are checked against them
  console.log(`\n${BOLD}rules & items${RESET}`);
  const rulesPath = join(CONTENT, "rules.json");
  const itemsPath = join(CONTENT, "items.json");

  const rules = existsSync(rulesPath) ? readJson(rep, rulesPath) : null;
  if (!rules) rep.fail(rel(rulesPath), "", "content/rules.json is missing");
  else if (validateAgainstSchema(rep, ajv, "rules", rulesPath, rules)) checkRules(rep, rulesPath, rules);

  const items = existsSync(itemsPath) ? readJson(rep, itemsPath) : null;
  if (!items) rep.fail(rel(itemsPath), "", "content/items.json is missing");
  else if (validateAgainstSchema(rep, ajv, "items", itemsPath, items)) checkItems(rep, itemsPath, items);

  // Biome list lives in the art contract; content and art must not drift apart.
  let biomes = null;
  if (existsSync(MANIFEST)) {
    const manifest = readJson(rep, MANIFEST);
    biomes = manifest?.biomes ?? null;
  }

  // --- chapters
  console.log(`\n${BOLD}chapters${RESET}`);
  const chapterFiles = listJson(join(CONTENT, "chapters"));
  if (!chapterFiles.length) rep.warn("no chapters found", "content/chapters/ is empty.");
  const chaptersById = new Map();
  const brokenChapterIds = new Set();

  for (const file of chapterFiles) {
    const chapter = readJson(rep, file);
    if (!chapter) {
      brokenChapterIds.add(basename(file, ".json"));
      continue;
    }
    if (!validateAgainstSchema(rep, ajv, "chapter", file, chapter)) {
      brokenChapterIds.add(basename(file, ".json"));
      continue;
    }
    checkChapter(rep, file, chapter, items, rules, biomes);
    chaptersById.set(chapter.id, chapter);
  }

  // --- campaigns
  console.log(`\n${BOLD}campaigns${RESET}`);
  const campaignFiles = listJson(join(CONTENT, "campaigns"));
  if (!campaignFiles.length) rep.warn("no campaigns found", "content/campaigns/ is empty.");
  const referenced = new Set();

  for (const file of campaignFiles) {
    const campaign = readJson(rep, file);
    if (!campaign) continue;
    if (!validateAgainstSchema(rep, ajv, "campaign", file, campaign)) continue;
    checkCampaign(rep, file, campaign, chaptersById, brokenChapterIds);
    for (const id of campaign.chapters) referenced.add(id);
  }

  for (const [id, chapter] of chaptersById) {
    if (!referenced.has(id)) {
      rep.fail(
        `content/chapters/${id}.json`,
        "/campaignId",
        `no campaign lists this chapter (it claims campaign "${chapter.campaignId}")`,
        "An unlisted chapter can never be reached from the campaign screen.",
      );
    }
  }

  return finish(rep);
}

function finish(rep) {
  console.log(`\n${BOLD}${"-".repeat(60)}${RESET}`);
  const warn = rep.warnings.length ? `   ${YELLOW}${rep.warnings.length} warnings${RESET}` : "";
  const bad = rep.failures.length ? `   ${RED}${rep.failures.length} FAILED${RESET}` : "";
  console.log(`${GREEN}${rep.passed} passed${RESET}${warn}${bad}`);

  if (rep.failures.length) {
    console.log(`\n${RED}${BOLD}FAILED${RESET} - content is broken. A malformed chapter fails the build, never the play session.`);
    return 1;
  }
  console.log(`\n${GREEN}${BOLD}PASS${RESET} - schemas and scene graphs are clean.`);
  return 0;
}

process.exit(main());
