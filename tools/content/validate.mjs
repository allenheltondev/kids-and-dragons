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

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { conditionRefs, lintChapterText, unbackedCosts, unbackedSceneCharges } from "../../packages/shared/src/condition-lint.ts";
import { slowBlockProblems } from "../../packages/shared/src/buffs.ts";
import { chapterStartDiscoveries, sceneDiscoveries } from "../../packages/shared/src/discoveries.ts";
import { goalStepFlags, stepsOffTheSpine } from "../../packages/shared/src/chapter-goal.ts";
import { checkEncounterEnvironment } from "../../packages/shared/src/environment.ts";
import { MUSIC_SPECS } from "../../packages/client/src/audio/paths.ts";
import { RIFT_ACTION_KINDS, campaignMode, journeyFlags, parseCampaignGraph, riftActionWays } from "../../packages/shared/src/campaign-graph.ts";
import { chapterFlagWrites, duplicateJsonKeys, lintCampaignGraph } from "../../packages/shared/src/campaign-graph-lint.ts";
import { graphFingerprint, graphProofPath, stableHash } from "../../packages/shared/src/graph-proof.ts";
import { prerequisiteProblems } from "../../packages/shared/src/campaign-prerequisites.ts";
import { plateProblems } from "../../packages/shared/src/story-plates.ts";
import { factTestProblems } from "../../packages/shared/src/world-state.ts";
import { helpProblems } from "../../packages/shared/src/help.ts";
import { DEED_OWNERS } from "../../packages/shared/src/types/domain.ts";
import { routeSetConflicts } from "./route-paths.mjs";
import { classPlaceReach, classPlaceVerdict, loadAllowList as loadClassPlaceAllow } from "./class-places.mjs";

/**
 * Which tree to validate. Defaults to this repo; `KAD_CONTENT_ROOT` points it
 * somewhere else.
 *
 * Same idea as `KAD_DDB_ENDPOINT` on the repository contract suite: a gate that
 * only ever runs against the one corpus it ships with can prove that corpus has
 * not *changed*, and cannot prove it would catch anything. The override is what
 * lets `validate.test.mjs` hand it a copy of the real content with exactly one
 * thing broken and require a specific complaint — the negative half of the gate,
 * which is the half that says whether the positive half means anything.
 */
const ROOT = process.env.KAD_CONTENT_ROOT
  ? resolve(process.env.KAD_CONTENT_ROOT)
  : fileURLToPath(new URL("../..", import.meta.url));
const CONTENT = join(ROOT, "content");
/** Graph campaigns allowed to lack class places until #315 (tools/content/class-places.mjs). */
const CLASS_PLACE_ALLOW = loadClassPlaceAllow();
/**
 * `KAD_CLASS_PLACES=off` skips the class-place check. For test harnesses whose
 * subject is something else and which drop a graph campaign into a content
 * copy; nothing in CI or the repo scripts sets it.
 */
const CLASS_PLACES_OFF = process.env.KAD_CLASS_PLACES === "off";
const SCHEMAS = join(ROOT, "schemas");
const MANIFEST = join(ROOT, "assets", "manifest.json");
/**
 * The art itself is always this checkout's, whichever tree is being judged: a
 * staged test tree may carry the manifest and not the megabytes of PNG a cast
 * figure points at.
 */
const REPO_ASSETS = fileURLToPath(new URL("../../assets", import.meta.url));
/**
 * `--write-proofs` (`npm run content:proofs`) records each clean graph walk in
 * `content/graph-proofs/` (shared `graph-proof.ts`). Without it a missing or
 * stale proof fails the check, so what ships always carries a current one.
 */
const WRITE_PROOFS = process.argv.includes("--write-proofs");
/**
 * The checker's own fingerprint: the route search and every shared file it
 * imports, followed from the source. A proof walked by any other checker is
 * walked again, so changing the checker re-proves every campaign.
 */
const CHECKER = checkerFingerprint();

function checkerFingerprint() {
  const src = fileURLToPath(new URL("../../packages/shared/src/", import.meta.url));
  const seen = new Set();
  const queue = ["campaign-graph-lint.ts", "graph-proof.ts"];
  const texts = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    // Proofs are shared across checkouts: Windows newlines and separators
    // must hash exactly like the Linux source that produced the proof.
    const text = readFileSync(join(src, file), "utf8").replace(/\r\n/g, "\n");
    texts.push(`${file}\n${text}`);
    for (const [, spec] of text.matchAll(/from\s+"\.\/([^"]+)"/g)) {
      const next = join(dirname(file), spec).replaceAll("\\", "/").replace(/\.js$/, ".ts");
      queue.push(next.endsWith(".ts") ? next : `${next}.ts`);
    }
  }
  return stableHash(texts.sort().join("\0"));
}

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

  // levelXp[n] is the total XP for level n+2 and maxLevel is length+1 - the
  // convention levelForXp()/maxLevel() in packages/shared/src/rules.ts implement.
  // A leading 0 would hand everyone level 2 for free.
  if (rules.levelXp[0] <= 0) {
    rep.fail(f, "/levelXp/0", `level 2 must cost more than 0 XP, got ${rules.levelXp[0]}`, "levelXp holds the thresholds *above* level 1; it does not start with a 0.");
    ok = false;
  }
  for (let i = 1; i < rules.levelXp.length; i += 1) {
    if (rules.levelXp[i] <= rules.levelXp[i - 1]) {
      rep.fail(
        f,
        `/levelXp/${i}`,
        `XP thresholds must increase: level ${i + 2} needs ${rules.levelXp[i]}, ` +
          `level ${i + 1} already needed ${rules.levelXp[i - 1]}`,
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
  const maxLevel = rules.levelXp.length + 1;
  if (rules.tierLevels.fledgling !== 1) {
    rep.fail(f, "/tierLevels/fledgling", `every character starts at fledgling, so it must be level 1, got ${rules.tierLevels.fledgling}`);
    ok = false;
  }
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

  // docs/class-mastery.md §6 - deeds. A deed that only another class's move can
  // do would leave the rank unreachable, and Master always includes a story
  // deed (rule 5), on every track, so fights are not the only way to grow.
  for (const [id, cls] of Object.entries(rules.classes)) {
    for (const [rank, req] of Object.entries(cls.deeds ?? {})) {
      for (const [trackName, track] of Object.entries(req)) {
        for (const deed of Object.keys(track)) {
          const owner = DEED_OWNERS[deed];
          if (owner && owner !== id) {
            rep.fail(f, `/classes/${id}/deeds/${rank}/${trackName}/${deed}`, `"${deed}" can only be done by a ${owner}`);
            ok = false;
          }
        }
        if (rank === "master" && !Object.hasOwn(track, "class_story")) {
          rep.fail(f, `/classes/${id}/deeds/master/${trackName}`, "Master includes a story deed (class_story) on every track");
          ok = false;
        }
      }
    }
  }

  if (ok) rep.ok(`${f}  rules invariants  (XP curve, tier order, one class per stat, icons, deeds)`);
  return ok;
}

/**
 * The abilities check, and the reason this file has one at all.
 *
 * `rules.json` names twenty-two combat abilities — four class signatures, twelve
 * level unlocks, six species actions — and the engine looks each one up in
 * `abilities.json` at the moment a phone asks what it may do. A name with no
 * definition is not a crash: `legalActions` skips what it cannot find, on
 * purpose, so a save written against newer content stays playable. Which means
 * the failure mode is silent, and it is the worst kind — a child reads "Bramble
 * Wall: grow a wall of thorns" on her level-6 card, taps it, and nothing
 * happens.
 *
 * So every ability `rules.json` names must be in exactly one of two places:
 * **authored**, or **listed in `$deferred`** with the verb it is waiting on.
 * Never both, never neither. Adding an ability to `rules.json` therefore cannot
 * ship a dead button — it fails the build until somebody has said, in writing,
 * which of the two this is.
 *
 * The check runs the other way too. An authored ability nobody references is
 * either a typo in the id or a leftover, and both are worth a failure while the
 * catalog is still small enough to fix in a minute.
 */
function checkAbilities(rep, file, doc, rules, rulesFile) {
  const f = rel(file);
  const rf = rel(rulesFile);
  let ok = true;

  const authored = doc.abilities ?? {};
  const deferred = doc.$deferred ?? {};

  // Every ability rules.json names, with the pointer that named it and the words
  // the card shows — so a mismatch can be reported against the right file.
  const referenced = new Map();
  const refer = (ability, at) => {
    const prior = referenced.get(ability.id);
    if (prior) {
      // The same ability granted by two classes would be a balance decision
      // nobody made, and the second grant's name and icon would silently lose.
      rep.fail(rf, at, `ability id "${ability.id}" is already granted at ${prior.at}`);
      ok = false;
      return;
    }
    referenced.set(ability.id, { at, ability });
  };
  for (const [id, cls] of Object.entries(rules.classes ?? {})) {
    refer(cls.signature, `/classes/${id}/signature`);
    for (const [level, ability] of Object.entries(cls.unlocks ?? {})) {
      refer(ability, `/classes/${id}/unlocks/${level}`);
    }
  }
  for (const [id, sp] of Object.entries(rules.species ?? {})) {
    refer(sp.combatAction, `/species/${id}/combatAction`);
  }

  for (const [id, { at, ability }] of referenced) {
    const isAuthored = Object.hasOwn(authored, id);
    const isDeferred = Object.hasOwn(deferred, id);

    if (isAuthored && isDeferred) {
      rep.fail(
        f,
        `/$deferred/${id}`,
        `"${id}" is both authored and deferred`,
        "The engine would use the definition and the deferral note would be a lie about the game. Delete one.",
      );
      ok = false;
      continue;
    }
    if (!isAuthored && !isDeferred) {
      rep.fail(
        f,
        `/abilities/${id}`,
        `rules.json grants "${ability.name}" (${id}) at ${at}, and nothing here defines it`,
        "legalActions skips an ability it cannot look up, so this ships as a card that does nothing when tapped. " +
          "Author it, or add it to $deferred naming the effect verb it needs.",
      );
      ok = false;
      continue;
    }
    if (isDeferred) continue;

    // Authored. The catalog wins at the table (encounter.ts abilityFor), so a
    // disagreement means the Rest screen and the battle screen call the same
    // thing by different names — which is how a child learns not to trust the
    // cards.
    const def = authored[id];
    if (def.name !== ability.name) {
      rep.fail(f, `/abilities/${id}/name`, `named "${def.name}" here and "${ability.name}" in rules.json at ${at}`);
      ok = false;
    }
    if (def.icon !== ability.icon) {
      rep.fail(f, `/abilities/${id}/icon`, `icon "${def.icon}" here and "${ability.icon}" in rules.json at ${at}`);
      ok = false;
    }
  }

  // An ability that is defined, and legal, and lands on nobody. These are the
  // failures the schema cannot see and no test will notice unless somebody
  // thought to write one, because the engine's answer to all of them is a
  // perfectly well-formed action that changes nothing.
  // Verbs that always land on the actor whatever the spec says (encounter.ts
  // SELF_DIRECTED_VERBS), so they are not evidence of anything about the
  // target rule and have to be taken out of the scope set before any of this
  // reasons about it. growWall acts on tiles; extraMove refunds the actor's
  // own steps.
  const selfDirected = new Set(["moveSelf", "extraMove", "growWall"]);
  for (const [id, def] of Object.entries(authored)) {
    const t = def.target ?? {};
    const effects = (def.effects ?? []).filter((e) => !selfDirected.has(e.effect?.type));
    const scopes = new Set(effects.map((e) => e.to ?? "target"));
    const movesSelf = (def.effects ?? []).some((e) => e.effect?.type === "moveSelf");

    if (scopes.has("area") && t.kind !== "tile") {
      rep.fail(f, `/abilities/${id}/target/kind`, `"${id}" scopes an effect to an area but does not target a tile`, "The area square is anchored on the target tile; without one there is nothing to anchor it to.");
      ok = false;
    }
    if (scopes.has("target") && (t.kind === "none" || (t.kind === "tile" && !t.followUp))) {
      rep.fail(f, `/abilities/${id}/effects`, `"${id}" scopes an effect to its target, and its target is a ${t.kind === "none" ? "nothing" : "tile"}`, "\"target\" means the one figure that was pointed at. On a tile or on nothing it lands on nobody.");
      ok = false;
    }
    // `openTileOnly` defaults to *open* (encounter.ts legalTilesFor), which is
    // right for a leap and wrong for an area attack: a 1x1 square anchored on a
    // tile that is required to be empty can never hold anybody.
    if (scopes.has("area") && (t.area ?? 1) <= 1 && t.openTileOnly !== false) {
      rep.fail(f, `/abilities/${id}/target/openTileOnly`, `"${id}" collects an area of 1 from a tile that must be empty`, "Give it an area, or set openTileOnly to false so it can be aimed at an occupied tile.");
      ok = false;
    }
    // A tile ability that moves the actor and permits an occupied tile is a
    // figure walking into another figure — grid.ts throws, mid-fight.
    if (t.kind === "tile" && t.openTileOnly === false && movesSelf) {
      rep.fail(f, `/abilities/${id}/target/openTileOnly`, `"${id}" moves the actor onto a tile it allows to be occupied`, "Two figures cannot share a tile (grid.ts placeActor throws). Drop openTileOnly: false.");
      ok = false;
    }
    // An effect gated on a state its target rule can never produce. Rally is the
    // legitimate use of `when` — one card, two readings — and it works because
    // its target rule says `state: "any"`.
    for (const [i, spec] of (def.effects ?? []).entries()) {
      if (!spec.when || selfDirected.has(spec.effect?.type)) continue;
      const scope = spec.to ?? "target";
      if (scope !== "target") continue;
      const allowed = t.state ?? "standing";
      if (allowed !== "any" && allowed !== spec.when) {
        rep.fail(f, `/abilities/${id}/effects/${i}/when`, `"${id}" only ever targets the ${allowed}, so a "${spec.when}" effect never fires`, "Widen the target rule to state \"any\", or drop the when.");
        ok = false;
      }
    }
  }

  // spec §7.2 — a species action is once per encounter, and a class ability is
  // not unless its own card says so ("Once per fight." — Starfall, Encore).
  // The card text is the license: the words she reads at a Rest scene and the
  // behaviour on the board must be the same fact, in either direction, and
  // getting it backwards is invisible in a diff and obvious at the table on
  // round two.
  const speciesActions = new Set(
    Object.values(rules.species ?? {}).map((sp) => sp.combatAction.id),
  );
  for (const [id, def] of Object.entries(authored)) {
    if (!referenced.has(id)) {
      rep.fail(
        f,
        `/abilities/${id}`,
        `nothing in rules.json grants "${id}"`,
        "An unreferenced ability is a typo in the id or a leftover; either way no phone can ever offer it.",
      );
      ok = false;
      continue;
    }
    const cardSaysOnce = /once per (fight|encounter)/i.test(referenced.get(id)?.ability?.text ?? "");
    const shouldBeOnce = speciesActions.has(id) || cardSaysOnce;
    if (shouldBeOnce && def.oncePerEncounter !== true) {
      const why = speciesActions.has(id)
        ? "a species action, which spec §7.2 limits to once per encounter"
        : 'a card whose text says "once per fight"';
      rep.fail(f, `/abilities/${id}/oncePerEncounter`, `"${id}" is ${why}, and the catalog does not limit it`);
      ok = false;
    }
    if (!shouldBeOnce && def.oncePerEncounter === true) {
      rep.fail(
        f,
        `/abilities/${id}/oncePerEncounter`,
        `"${id}" is limited to once per encounter, and neither spec §7.2 (species actions) nor its card text says so`,
      );
      ok = false;
    }
  }

  for (const id of Object.keys(deferred)) {
    if (!referenced.has(id)) {
      rep.fail(
        f,
        `/$deferred/${id}`,
        `nothing in rules.json grants "${id}"`,
        "Deferring an ability the game does not promise is a note about nothing. Delete it, or grant it in rules.json.",
      );
      ok = false;
    }
  }

  if (ok) {
    const counts = `${Object.keys(authored).length} authored, ${Object.keys(deferred).length} deferred, ${referenced.size} granted`;
    rep.ok(`${f}  ability catalog  (${counts}; every grant defined or deferred, names match rules.json)`);
  }
  return ok;
}

/**
 * The real entries of a catalog-shaped file, without its `$`-prefixed
 * annotations. Mirrors `itemCatalog()` in packages/shared — items.json is
 * generated (D7) and opens with a `$comment`, and `$` is not a legal item id.
 */
function entries(catalog) {
  return Object.entries(catalog ?? {}).filter(([id]) => !id.startsWith("$"));
}

function checkItems(rep, file, items) {
  const f = rel(file);
  let ok = true;
  const real = entries(items);
  for (const [id, item] of real) {
    if (!item.icon?.trim()) {
      rep.fail(f, `/${id}/icon`, "icon slug is empty");
      ok = false;
    }
  }
  const kinds = new Set(real.map(([, i]) => i.kind));
  for (const kind of ["consumable", "trinket", "quest"]) {
    if (!kinds.has(kind)) {
      rep.warn(`${f} has no ${kind} items`, "spec §9.2 defines three kinds; a catalog missing one is probably unfinished.");
    }
  }
  if (ok) rep.ok(`${f}  item catalog  (${real.length} items, icons present)`);
  return ok;
}

/** Every branch key a scene may carry — an environmental fight's two extra endings (#201) included. */
const BRANCH_KEYS = ["onSuccess", "onFailure", "onVictory", "onDefeat", "onEscape", "onTimeout"];

/** Every scene id this scene can transition to, with the JSON pointer that named it. */
function outgoing(scene, sceneId) {
  const edges = [];
  const base = `/scenes/${sceneId}`;
  if (Array.isArray(scene.choices)) {
    scene.choices.forEach((c, i) => edges.push([c.goto, `${base}/choices/${i}/goto`]));
  }
  for (const key of BRANCH_KEYS) {
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
  for (const key of BRANCH_KEYS) {
    if (scene[key]) push(scene[key].effects, `${base}/${key}/effects`);
  }
  // A freed captive's effects (#201) land when the fight ends.
  // One captive, or a list of them (#220), and objectives done, the same
  // way — in the place as authored and in every variant of it.
  const places = scene.environment
    ? [[scene.environment, `${base}/environment`], ...(scene.environment.variants ?? []).map((v, i) => [v, `${base}/environment/variants/${i}`])]
    : [];
  for (const [place, at] of places) {
    const rescue = place?.rescue;
    if (Array.isArray(rescue)) rescue.forEach((captive, i) => push(captive?.effects, `${at}/rescue/${i}/effects`));
    else push(rescue?.effects, `${at}/rescue/effects`);
    (place?.objectives ?? []).forEach((o, i) => push(o?.effects, `${at}/objectives/${i}/effects`));
  }
  return out;
}

/**
 * A map's playability, which the schema cannot see.
 *
 * The schema fixes the board at 10×8 and the alphabet at `.`/`#`. What it cannot
 * check is whether the figures can actually stand where the map says: a spawn on
 * a bramble tile throws out of `placeActor` at the instant the fight begins,
 * which is a crash at the table for a mistake plainly visible in the file.
 */
function checkMap(rep, file, map) {
  const at = rel(file);
  const seen = new Map();
  for (const kind of ["partySpawns", "enemySpawns"]) {
    (map[kind] ?? []).forEach((spawn, i) => {
      const where = `/${kind}/${i}`;
      if (map.rows?.[spawn.y]?.[spawn.x] !== ".") {
        rep.fail(at, where, `spawn at (${spawn.x}, ${spawn.y}) stands on a blocked tile`, "Spawns must be on \".\" — the figure is placed there before anyone moves.");
        return;
      }
      // Two figures cannot share a tile (grid.ts). A duplicate only fails once a
      // fight has that many bodies in it, so it would surface on the four-enemy
      // map and not the two-enemy one.
      const key = `${spawn.x},${spawn.y}`;
      if (seen.has(key)) {
        rep.fail(at, where, `spawn at (${spawn.x}, ${spawn.y}) repeats ${seen.get(key)}`, "Every spawn point needs its own tile.");
      }
      seen.set(key, where);
    });
  }

  // A board with no way from one side to the other is a fight nobody can reach.
  // Cheap flood fill from the first party spawn over the open tiles.
  const first = map.partySpawns?.[0];
  if (first && map.rows) {
    const open = (x, y) => map.rows[y]?.[x] === ".";
    const seenTiles = new Set([`${first.x},${first.y}`]);
    const queue = [first];
    while (queue.length) {
      const { x, y } = queue.pop();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          const key = `${nx},${ny}`;
          if ((dx || dy) && open(nx, ny) && !seenTiles.has(key)) {
            seenTiles.add(key);
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }
    (map.enemySpawns ?? []).forEach((spawn, i) => {
      if (!seenTiles.has(`${spawn.x},${spawn.y}`)) {
        rep.fail(at, `/enemySpawns/${i}`, `no route from the party to (${spawn.x}, ${spawn.y})`, "A walled-off enemy can never be reached, and the encounter can never be won.");
      }
    });
  }
}

function checkChapter(rep, file, chapter, items, rules, biomes, mapIds, bestiary, carried = new Set(), fieldGuide = null, world = null, mapsById = null, backgroundOnlyBiomes = []) {
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

  // --- D7: chapter-scoped props are projected into content/items.json, so the
  // two have to agree. The generator is what merges them; this is what notices
  // that nobody ran it. Everything below resolves item ids against items.json
  // alone, which would silently pass a prop the catalog has never heard of.
  for (const [id, prop] of entries(chapter.props)) {
    const shipped = items?.[id];
    if (!shipped) {
      fail(
        `/props/${id}`,
        `prop "${id}" is not in content/items.json`,
        "content/items.json is generated from canon and every chapter's props — run `npm run canon:items`.",
      );
    } else if (JSON.stringify(shipped) !== JSON.stringify(prop)) {
      fail(
        `/props/${id}`,
        `prop "${id}" does not match content/items.json`,
        "The catalog is stale, or somebody edited the generated file. Run `npm run canon:items`.",
      );
    }
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

  // spec §8.2 - the ending scene declares whether the chapter succeeded, and a
  // chapter may have several endings. `outcome` anywhere else is read by nothing:
  // play carries straight on past that scene, so an author who wrote it there
  // meant it to halve the award and would silently get the full one.
  const isEnding = new Set(endings);
  for (const [id, scene] of Object.entries(scenes)) {
    if (scene.outcome !== undefined && !isEnding.has(id)) {
      fail(
        `/scenes/${id}/outcome`,
        `outcome "${scene.outcome}" on a scene that is not an ending - the chapter does not stop here, so nothing reads it`,
        "Only a scene with an empty `choices` array ends the chapter (spec §8.2).",
      );
    }
    // Same reason: only an ending can finish the campaign early.
    if (scene.endsCampaign !== undefined && !isEnding.has(id)) {
      fail(
        `/scenes/${id}/endsCampaign`,
        "endsCampaign on a scene that is not an ending - the chapter does not stop here, so the campaign cannot either",
        "Only a scene with an empty `choices` array ends the chapter.",
      );
    }
  }

  // --- every itemId exists in the catalog, and is used as the right kind
  const speciesIds = new Set(Object.keys(rules?.species ?? {}));
  const classIds = new Set(Object.keys(rules?.classes ?? {}));

  // --- class places (#311, docs/class-mastery.md §2-§3). The schema already
  // keeps `classPlace` off every other scene type; these are the rules it
  // cannot say. A switch the table can never reach, or one Gemfall's pin
  // forbids, fails here and never at the table.
  for (const [id, scene] of Object.entries(scenes)) {
    if (scene.classPlace === undefined) continue;
    const at = `/scenes/${id}/classPlace`;
    if (scene.type !== "story" && scene.type !== "choice_point") {
      fail(at, `a ${scene.type} scene cannot be a class place`, "Put classPlace on the story or choice_point scene that is the room.");
    }
    if (!classIds.has(scene.classPlace)) {
      fail(at, `"${scene.classPlace}" is not a class in content/rules.json`, `known classes: ${[...classIds].join(", ")}`);
    }
    if (isEnding.has(id)) {
      fail(at, "a class place cannot end the chapter - nobody would get to answer before it closed", "Give the room a way on.");
    }
    if (chapter.campaignId === "gemfall") {
      fail(at, "Gemfall has no class places (docs/class-mastery.md §2) - it is pinned, and its only class change is the Exchange stall");
    }
  }
  const flagsSet = new Set();
  const flagsRequired = [];

  for (const [id, scene] of Object.entries(scenes)) {
    for (const [effect, at] of effectsOf(scene, id)) {
      // Only a flag some effect can set *true* counts as settable. `setFlag`
      // carries an optional `value`, and both the choice gate and
      // `awardObjectives` test for true — so a flag whose only effect sets it
      // false is, for every consumer, a flag nothing ever sets.
      if (effect.type === "setFlag" && (effect.value ?? true) === true) flagsSet.add(effect.flag);
      if (!effect.itemId) continue;
      if (effect.type === "takeItem") {
        for (const id of Array.isArray(effect.itemId) ? effect.itemId : [effect.itemId]) {
          if (!items?.[id]) fail(`${at}/itemId`, `item "${id}" is not in content/items.json`);
        }
        continue;
      }
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

    // Requirements *hide* a choice rather than greying it out (architecture §5),
    // so a scene where every choice is gated shows some parties nothing to tap.
    // Same rule as validateChapter()'s DEAD_END in packages/shared/src/chapter-graph.ts
    // (isGated); a `when` counts as a gate there too. Kept inline because
    // chapter-graph.ts cannot be loaded straight under Node.
    const gated = (c) => c.requiresSpecies !== undefined || c.requiresClass !== undefined || c.requiresFlag !== undefined || c.requiresItem !== undefined || c.when !== undefined;
    // No class is ever mandatory (#228): a scene whose every choice needs a
    // class is validateChapter()'s CLASS_GATED_ONLY_EXIT, the same failure
    // named for its fix; mixed with other gates it is the plain one below.
    if ((scene.choices ?? []).length > 0 && scene.choices.every((c) => c.requiresClass !== undefined)) {
      fail(
        `/scenes/${id}/choices`,
        "every choice is class-gated (CLASS_GATED_ONLY_EXIT) - a party with none of those classes sees nothing to tap",
        "No class is ever mandatory: add a choice no class is needed for.",
      );
    } else if ((scene.choices ?? []).length > 0 && scene.choices.every(gated)) {
      fail(`/scenes/${id}/choices`, "every choice is gated - a party matching none of the requirements sees nothing to tap");
    }

    const choiceIds = new Set();
    (scene.choices ?? []).forEach((choice, i) => {
      const at = `/scenes/${id}/choices/${i}`;

      // The client keys on choice ids and the server matches intents against
      // them, so a duplicate inside one scene is ambiguous.
      if (choiceIds.has(choice.id)) fail(`${at}/id`, `duplicate choice id "${choice.id}" in this scene`);
      choiceIds.add(choice.id);

      if (!choice.icon?.trim()) fail(`${at}/icon`, "icon slug is empty - no interactive element ships without an icon (spec §11)");

      // A choice that takes an item or spends coins is offered only to a party
      // that has them, or the story narrates a gift nobody gave.
      for (const problem of unbackedCosts(choice)) {
        fail(`${at}`, `choice "${choice.id}" ${problem}`, "hidden, never greyed: gate the choice so a party without it never sees it");
      }

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

      const reqClass = choice.requiresClass;
      if (reqClass) {
        for (const cl of Array.isArray(reqClass) ? reqClass : [reqClass]) {
          if (!classIds.has(cl)) {
            fail(`${at}/requiresClass`, `"${cl}" is not a class in content/rules.json`, `known classes: ${[...classIds].join(", ")}`);
          }
        }
      }
    });

    // spec §4.1 - three target numbers and no others, so a kid learns one scale.
    // A warning, not a failure: an author may deliberately want an in-between TN.
    if (scene.type === "check" && rules && !Object.values(rules.difficultyTn).includes(scene.tn)) {
      rep.warn(
        `${f} /scenes/${id}/tn is ${scene.tn}`,
        `spec §4.1 has three difficulties: ${Object.entries(rules.difficultyTn).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
      );
    }

    // spec §7.1 - 3 players vs 2-4 enemies, never more.
    if (scene.type === "encounter") {
      /*
       * Every monster is a canon creature, and its numbers come from there.
       *
       * `creature` is the join to canon/creatures.yaml (docs/canon-contract.md
       * D9); content/bestiary.json is the generated projection of it, and the
       * content loader fills each enemy from it at load time
       * (`resolveEnemy` in packages/shared/src/bestiary.ts).
       *
       * The chapter used to keep its own copy of the five stats with this
       * check policing the copy. Canon is the source of truth, and a second
       * copy a build has to police is not a source — so the copy is gone, and
       * what is checked now is the opposite thing: that nobody has *restated*
       * a number canon already supplies. An override is fine and deliberate; a
       * duplicate is the drift risk coming back.
       */
      const STATS = ["hp", "guard", "quick", "steps", "attack"];
      let total = 0;
      for (const enemy of scene.enemies) {
        const where = `/scenes/${id}/enemies/${enemy.id}`;
        // A numbing sting (#227) is checked with the same arithmetic the fight
        // uses, so a number the engine would clamp is a build failure instead.
        for (const key of ["onHit", "retaliation"]) {
          if (enemy[key] === undefined) continue;
          for (const problem of slowBlockProblems(enemy[key], key === "retaliation")) fail(`${where}/${key}${problem.path}`, problem.problem);
        }
        const entry = enemy.creature ? bestiary?.creatures?.[enemy.creature] : null;

        if (!enemy.creature) {
          rep.warn(
            `${f} ${where} has no \`creature\``,
            "Name the canon creature it is one of, so its stats come from canon instead of being written twice.",
          );
          total += enemy.count ?? 1;
          continue;
        }
        if (!entry) {
          fail(
            `${where}/creature`,
            `"${enemy.creature}" is not in content/bestiary.json`,
            bestiary
              ? "Give the creature an `encounter` block in canon/creatures.yaml, then `npm run canon:bestiary`."
              : "content/bestiary.json is missing — run `npm run canon:bestiary`.",
          );
          continue;
        }

        total += enemy.count ?? entry.usualCount ?? 1;

        for (const stat of [...STATS, "count", "art"]) {
          if (enemy[stat] === undefined) continue;
          const canonValue = stat === "count" ? entry.usualCount : entry[stat];
          if (enemy[stat] === canonValue) {
            fail(
              `${where}/${stat}`,
              `${stat} restates canon's own ${JSON.stringify(canonValue)}`,
              `Delete it — the loader fills it from content/bestiary.json. Keep it only to *override*, which this does not.`,
            );
          }
        }
      }
      if (total < 2 || total > 4) {
        fail(`/scenes/${id}/enemies`, `${total} enemies - encounters are 2 to 4, never more (spec §7.1)`);
      }

      // The board this fight happens on. Without it the encounter has nowhere to
      // put anybody, and the failure lands mid-chapter at the table rather than
      // here — so the map is a build-time reference like an itemId, not a path.
      if (mapIds && !mapIds.has(scene.map)) {
        fail(
          `/scenes/${id}/map`,
          `map "${scene.map}" is not in content/maps/`,
          mapIds.size ? `maps available: ${[...mapIds].sort().join(", ")}` : "content/maps/ is empty",
        );
      }

      // The place fighting back (#201): what the schema cannot say about an
      // `environment` — tiles on open ground of *this* map, off the spawns,
      // reachable; windows that can happen before the clock ends the fight;
      // exactly the extra branches it can end in (onEscape, onTimeout).
      for (const problem of checkEncounterEnvironment(scene, mapsById?.get(scene.map) ?? null)) {
        fail(
          `/scenes/${id}${problem.path}`,
          problem.problem,
          "See docs/campaigns/graph-campaigns.md, \"Environmental combat (#201)\".",
        );
      }
    }
  }

  // --- #160: conditions, variants and tokens. A malformed `when` fails here,
  // at the build, rather than at the table.
  for (const problem of lintChapterText(chapter)) fail(problem.path, problem.problem, problem.hint);
  // Coins a scene charges on arrival (onEnter, or any check/fight outcome) are
  // a cost of every way in, so they need the same purse gate as a choice's own.
  for (const problem of unbackedSceneCharges(chapter)) {
    fail(problem.path, problem.problem, "gate each choice into it on when.coins.min, and reach it only through choices");
  }
  for (const { path, when } of conditionRefs(chapter)) {
    for (const key of ["flag", "notFlag"]) {
      if (when[key]) flagsRequired.push([when[key], `${path}/${key}`]);
    }
    for (const key of ["item", "notItem"]) {
      if (when[key] && !items?.[when[key]]) fail(`${path}/${key}`, `item "${when[key]}" is not in content/items.json`);
    }
    const of = when.count?.of;
    if (of !== undefined) {
      const catalog = Object.keys(items ?? {});
      if (Array.isArray(of)) {
        for (const id of of) {
          if (!items?.[id]) fail(`${path}/count/of`, `item "${id}" is not in content/items.json`);
        }
      } else if (of.endsWith("*")) {
        if (!catalog.some((id) => id.startsWith(of.slice(0, -1)))) {
          fail(`${path}/count/of`, `prefix "${of}" matches no item in content/items.json`);
        }
      } else if (!items?.[of]) {
        fail(`${path}/count/of`, `item "${of}" is not in content/items.json`);
      }
    }
  }

  // A choice gated on a flag nothing ever sets is invisible forever. Almost always a typo.
  // The exception is a flag the chapter's campaign carries across the chapter
  // boundary (`routeSets`): those arrive seeded from the campaign attempt, so a
  // later chapter reading what an earlier one decided is the whole point.
  for (const [flag, at] of flagsRequired) {
    if (!flagsSet.has(flag) && !carried.has(flag)) {
      fail(at, `flag "${flag}" is never set to true by any effect in this chapter`, flagsSet.size ? `flags set here: ${[...flagsSet].join(", ")}` : "no setFlag effects in this chapter at all");
    }
  }

  // --- bonus objectives (spec §8.2)
  const objectives = chapter.objectives ?? [];
  const objectiveIds = new Set();
  let bonusTotal = 0;

  objectives.forEach((objective, i) => {
    const at = `/objectives/${i}`;

    // The completion screen keys on the id and RunState.bonuses records it, so
    // two objectives with one id are indistinguishable in the itemised list.
    if (objectiveIds.has(objective.id)) fail(`${at}/id`, `duplicate objective id "${objective.id}" in this chapter`);
    objectiveIds.add(objective.id);

    // An objective watches a flag; it never sets one. Pointed at a flag nothing
    // sets, it can never be earned - the party is offered a bonus the chapter
    // has no way to pay. Almost always a typo, exactly like a gated choice.
    if (!flagsSet.has(objective.flag)) {
      fail(
        `${at}/flag`,
        `flag "${objective.flag}" is never set to true by any effect in this chapter, so this objective can never be earned`,
        flagsSet.size ? `flags set here: ${[...flagsSet].join(", ")}` : "no setFlag effects in this chapter at all",
      );
    }

    bonusTotal += objective.xp;
  });

  // spec §8.2 - bonuses are capped at 25% of xpAward, and the cap is on the
  // total rather than on each one: four objectives paying a quarter each would
  // pay the whole award twice over. The cap is what keeps "Sworn ends campaign 1"
  // (§8.1) a promise rather than an average. The engine clamps to the same
  // ceiling at the table; this is the half that fails the build instead.
  const bonusCap = Math.floor(chapter.xpAward * 0.25);
  if (bonusTotal > bonusCap) {
    fail(
      "/objectives",
      `bonus objectives total ${bonusTotal} XP, over the 25% cap of ${bonusCap} for an xpAward of ${chapter.xpAward}`,
      "The engine clamps the overflow to nothing at the table, so the last objectives would pay 0 (spec §8.2).",
    );
  }

  // --- the chapter's goal (#356): on screen the whole chapter, ticking as flags set
  const goal = chapter.goal;
  const onlyAnEnding = (outgoing(scenes[chapter.entry] ?? {}, chapter.entry).length === 0);
  if (!goal) {
    // A chapter that is nothing but its ending (a preview's pause) has nothing to aim at.
    if (!onlyAnEnding) {
      fail("/goal", "chapter has no goal", "Every chapter states its goal, visible from scene 1: one sentence and two to four steps (content/README.md, \"The chapter's goal\").");
    }
  } else {
    const stepIds = new Set();
    const effectsOfChapter = Object.entries(scenes).flatMap(([id, scene]) => effectsOf(scene, id));
    goal.steps.forEach((step, i) => {
      const at = `/goal/steps/${i}`;
      if (stepIds.has(step.id)) fail(`${at}/id`, `duplicate goal step id "${step.id}" in this chapter`);
      stepIds.add(step.id);
      if ((step.flag === undefined) === (step.item === undefined)) {
        fail(at, `step "${step.id}" must watch a flag or an item, and not both`);
      }
      if (step.item !== undefined) {
        // One of this chapter's own props, so it cannot arrive already held from an earlier chapter.
        if (!Object.hasOwn(chapter.props ?? {}, step.item)) {
          fail(`${at}/item`, `item "${step.item}" is not one of this chapter's props`, "A step watches an item only this chapter hands over; anything else could arrive already held.");
        } else if (!effectsOfChapter.some(([e]) => e.type === "grantQuestItem" && e.itemId === step.item)) {
          fail(`${at}/item`, `item "${step.item}" is never handed over with grantQuestItem in this chapter, so this step can never tick`);
        }
      }
      for (const flag of goalStepFlags(step)) {
        // Watched, never set, exactly like an objective: a step nothing ticks sits empty all evening.
        if (!flagsSet.has(flag)) {
          fail(
            `${at}/flag`,
            `flag "${flag}" is never set to true by any effect in this chapter, so this step can never tick`,
            flagsSet.size ? `flags set here: ${[...flagsSet].join(", ")}` : "no setFlag effects in this chapter at all",
          );
        }
        // A route-set member can arrive already set, and the step would tick before anybody did anything.
        if (carried.has(flag)) {
          fail(`${at}/flag`, `flag "${flag}" is a route-set member, which can cross from an earlier chapter`, "Point the step at a flag only this chapter sets, on the scene where the thing happens.");
        }
      }
    });
    if (/—/.test(`${goal.text} ${goal.steps.map((s) => s.label).join(" ")}`)) {
      fail("/goal", "the goal has an em dash", "Read aloud to an eight-year-old: a full stop or a comma instead.");
    }
    if ((goal.text.match(/[.!?](\s|$)/g) ?? []).length > 1) {
      fail("/goal/text", "the goal is more than one sentence", "One sentence; the steps say the rest.");
    }
    // Every road to a success ending ticks every step that is not optional (the spine).
    for (const { stepId, ending } of stepsOffTheSpine(chapter)) {
      const i = goal.steps.findIndex((s) => s.id === stepId);
      fail(
        `/goal/steps/${i}`,
        `step "${stepId}" is not on the spine: some path reaches the success ending "${ending}" without setting its flag`,
        "Set the flag (or hand over the item) on a scene every path walks, or on each road's own scene, or mark the step `optional`.",
      );
    }
  }

  if (biomes && !biomes.includes(chapter.biome) && !(backgroundOnlyBiomes.includes(chapter.biome) && Object.values(scenes).every((scene) => scene.type !== "encounter" && typeof scene.art === "string"))) {
    fail("/biome", `biome "${chapter.biome}" is not in assets/manifest.json`, `known biomes: ${biomes.join(", ")}`);
  }

  // Music overrides (#226): a chapter or scene may name a MUSIC_SPECS track in place of its biome's.
  const checkMusic = (path, track) => {
    if (track !== undefined && !Object.hasOwn(MUSIC_SPECS, track)) {
      fail(path, `music "${track}" is not a MUSIC_SPECS track`, `known tracks: ${Object.keys(MUSIC_SPECS).join(", ")}`);
    }
  };
  checkMusic("/music", chapter.music);
  for (const [sceneId, scene] of Object.entries(scenes)) checkMusic(`/scenes/${sceneId}/music`, scene.music);

  // Field Guide tags (#103): `discovers` must name real entries, once each; and
  // so must everything the shared rules would reveal implicitly, so the
  // validator and the server cannot disagree about what a scene discovers.
  if (fieldGuide?.entries) {
    const known = fieldGuide.entries;
    for (const id of chapterStartDiscoveries(chapter, world)) {
      if (!known[id]) {
        fail("/biome", `chapter "${chapter.id}": biome "${chapter.biome}" resolves to "${id}", which is not in content/field-guide.json`, "Run `npm run canon:field-guide` after `npm run canon:world`.");
      }
    }
    for (const [sceneId, scene] of Object.entries(scenes)) {
      const seen = new Set();
      for (const [i, id] of (scene.discovers ?? []).entries()) {
        const at = `/scenes/${sceneId}/discovers/${i}`;
        if (!known[id]) {
          fail(at, `chapter "${chapter.id}", scene "${sceneId}": discovers "${id}", which is not an entry of content/field-guide.json`, "Use a canon id such as creature.embermoth; the valid ids are the keys of `entries`.");
        } else if (seen.has(id)) {
          fail(at, `chapter "${chapter.id}", scene "${sceneId}": discovers "${id}" more than once`, "Each id may appear once per scene.");
        }
        seen.add(id);
      }
      for (const id of sceneDiscoveries(scene, bestiary)) {
        if (!known[id]) {
          fail(`/scenes/${sceneId}`, `chapter "${chapter.id}", scene "${sceneId}": reveals "${id}", which is not in content/field-guide.json`, "Run `npm run canon:field-guide`.");
        }
      }
    }
  }

  // Cast (CastMember in chapter.ts): every figure is a file the shared screen
  // can draw. A typo here would leave an empty space opposite the party where
  // the selkie was meant to be, and nothing at runtime would say why.
  for (const [sceneId, scene] of Object.entries(scenes)) {
    const seen = new Set();
    for (const [i, member] of (scene.cast ?? []).entries()) {
      const at = `/scenes/${sceneId}/cast/${i}`;
      const file = castFigureFile(member.figure);
      if (!file || !existsSync(file)) {
        fail(
          `${at}/figure`,
          `chapter "${chapter.id}", scene "${sceneId}": cast figure "${member.figure}" has no art`,
          `Expected ${file ? rel(file).replace(/^.*?assets\//, "assets/") : "entities/<id>, characters/<species> or cast/<id>"}. Use an existing figure (ls assets/entities) or commission one (docs/briefs/story-cast-art.md).`,
        );
      }
      const key = `${member.figure}|${member.name ?? ""}`;
      if (seen.has(key)) fail(at, `chapter "${chapter.id}", scene "${sceneId}": the same cast member twice`, "Name each figure once; two of a kind need two names, or one entry with a count.");
      seen.add(key);
    }
  }

  if (ok) {
    const bonusNote = objectives.length ? `, ${objectives.length} objective(s) within the ${bonusCap} XP cap` : "";
    rep.ok(`${f}  graph  (${ids.size} scenes, ${endings.length} ending${endings.length === 1 ? "" : "s"}${bonusNote}, all reachable, all goto/itemId resolve)`);
  }
  return ok;
}

/** `entities/selkie` → its assembled.png under this checkout's assets/. */
function castFigureFile(figure) {
  const match = /^(entities|characters|cast)\/([a-z0-9]+(?:[_-][a-z0-9]+)*)$/.exec(figure ?? "");
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === "characters") return join(REPO_ASSETS, "characters", id, "fledgling", "assembled.png");
  return join(REPO_ASSETS, kind, id, "assembled.png");
}

/**
 * "Last time..." (#357, Campaign.lastTime): a campaign that carries flags between chapters has
 * a line for every one of them, so no road a party took reaches the next chapter unspoken, and
 * nothing else, so a renamed flag cannot leave a line nobody ever hears. A line that names a
 * great stone reads the inventory (the facet rule): a plain line may not name one, and a
 * `holding` line names a stone the catalog has. Returns [path, problem, hint] triples.
 */
function lastTimeProblems(campaign, items) {
  const out = [];
  const members = Object.values(campaign.routeSets ?? {}).flat();
  const lastTime = campaign.lastTime;
  if (!lastTime) {
    if (members.length > 0) {
      out.push(["/lastTime", "a campaign with routeSets needs lastTime, one line for each member", "See Campaign.lastTime in packages/shared/src/types/chapter.ts."]);
    }
    return out;
  }
  const lines = lastTime.lines ?? {};
  for (const flag of members) {
    if (!(flag in lines)) out.push(["/lastTime/lines", `no "Last time" line for "${flag}"`, "Every route-set member gets one authored line."]);
  }
  for (const flag of Object.keys(lines)) {
    if (!members.includes(flag)) out.push([`/lastTime/lines/${flag}`, `"${flag}" is not a member of any routeSets entry, so no party ever carries it`, "Remove the line or fix the flag's name."]);
  }
  const facets = Object.entries(items ?? {})
    .filter(([id]) => id.startsWith("facet_"))
    .map(([id, item]) => ({ id, name: String(item?.name ?? "").replace(/^the\s+/i, "").toLowerCase() }))
    .filter((facet) => facet.name !== "");
  const named = (text) => {
    const lower = text.toLowerCase();
    if (/\bgreat stones?\b/.test(lower)) return "a great stone";
    return facets.find((facet) => lower.includes(facet.name))?.name ?? null;
  };
  const check = (path, text) => {
    const stone = named(text);
    if (stone) out.push([path, `names ${stone} without reading the inventory`, "Use { holding, text, otherwise } so a party without the stone hears its own words."]);
  };
  check("/lastTime/opener", lastTime.opener ?? "");
  for (const [flag, line] of Object.entries(lines)) {
    const at = `/lastTime/lines/${flag}`;
    if (typeof line === "string") {
      check(at, line);
      continue;
    }
    if (items && !(line.holding in items)) out.push([`${at}/holding`, `"${line.holding}" is not in the item catalog`]);
    check(`${at}/otherwise`, line.otherwise);
  }
  return out;
}

const PROOF_COMMENT =
  "GENERATED by `npm run content:proofs` (tools/content/validate.mjs). Do not edit. The route search's clean walk of this campaign; the server trusts it while the fingerprint matches (packages/shared/src/graph-proof.ts).";

function checkCampaign(rep, file, campaign, chaptersById, brokenChapterIds, items = null, classIds = null) {
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

  /** Every listed chapter that exists, grouped by the beat it is. */
  const beats = new Map();
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
    const members = beats.get(chapter.index) ?? [];
    members.push(chapter);
    beats.set(chapter.index, members);

    // A path that sets two members of one fork is ignored by the engine — it
    // keeps the old value rather than guess — so the party plays on holding a
    // road or a memory they did not choose. Only a path walk can see it.
    if (campaign.routeSets) {
      const { conflicts, truncated } = routeSetConflicts(chapter, campaign.routeSets);
      for (const { ending, set, flags } of conflicts) {
        rep.fail(
          `content/chapters/${id}.json`,
          `/scenes/${ending}`,
          `a path to this ending sets ${flags.join(" and ")}, two members of route set "${set}"`,
          "The engine keeps neither. Set a route set once per path, on the edge that decides it.",
        );
        ok = false;
      }
      if (truncated) {
        rep.warn(`content/chapters/${id}.json has too many paths to check its route sets fully`, "Simplify the graph or raise the budget in route-paths.mjs.");
      }
    }
  });

  // A backfill flag is read off the attempt's saved flags, and only route-set
  // members are ever saved. Anything else would silently never pay.
  const carriedFlags = new Set(Object.values(campaign.routeSets ?? {}).flat());
  for (const flag of Object.keys(campaign.purseBackfill?.byFlag ?? {})) {
    if (!carriedFlags.has(flag)) {
      fail("/purseBackfill/byFlag", `"${flag}" is not in any routeSets entry, so no saved attempt ever holds it`);
    }
  }

  for (const [path, problem, hint] of lastTimeProblems(campaign, items)) fail(path, problem, hint);

  // The prologue and chapter plates (docs/story-plates.md): short static words, a painting each,
  // and never a prologue and a plate on the same start.
  const stoneNames = Object.entries(items ?? {})
    .filter(([id]) => id.startsWith("facet_"))
    .map(([, item]) => String(item?.name ?? "").replace(/^the\s+/i, "").toLowerCase())
    .filter((name) => name !== "");
  for (const { path, problem, hint } of plateProblems(campaign, chaptersById, stoneNames)) fail(path, problem, hint);

  if (campaignMode(campaign) === "graph") return checkGraphCampaign(rep, file, campaign, chaptersById, fail, ok, items, classIds);

  /*
   * Beats are the save unit and the player sees "Chapter 3 of 6" - a gap here is
   * a bug in the progress UI long before anyone notices the content. Indexes are
   * no longer *unique*, though: a routed beat is several chapter files sharing
   * one index, so what has to run 1..n is the set of distinct indexes.
   */
  const ordered = [...beats.keys()].sort((a, b) => a - b);
  ordered.forEach((index, i) => {
    if (index !== i + 1) {
      const names = beats.get(index).map((chapter) => chapter.id).join(", ");
      fail(
        "/chapters",
        `beat ${index} (${names}) is out of sequence; the listed chapters must cover beats 1..${ordered.length} with no gaps`,
      );
    }
  });

  /*
   * A routed beat has to be *complete*. This is the check the whole feature
   * exists for: author two of three roads, and a party that took the third
   * arrives at a beat with no chapter in it and the run stops dead — at a
   * table, mid-evening, with no way forward. A declared set is the only thing
   * that can notice an absence, which is why `routeSets` is authored rather
   * than inferred from the files that happen to exist.
   */
  const routeSets = campaign.routeSets ?? {};

  for (const index of ordered) {
    const members = beats.get(index);
    const routed = members.filter((chapter) => chapter.route);

    if (routed.length === 0) {
      // An unrouted beat is one chapter. Two files sharing an index with no
      // route between them is the old duplicate-index bug wearing a new hat:
      // nothing could ever choose one.
      if (members.length > 1) {
        const names = members.map((chapter) => chapter.id).join(", ");
        fail("/chapters", `beat ${index} has ${members.length} chapters (${names}) and no routes; only a routed beat may share an index`);
      }
      continue;
    }
    if (routed.length !== members.length) {
      const plain = members.filter((chapter) => !chapter.route).map((chapter) => chapter.id).join(", ");
      fail("/chapters", `beat ${index} mixes routed and unrouted chapters (${plain} declare no route); every member of a routed beat needs one`);
      continue;
    }

    const sets = new Set(routed.map((chapter) => chapter.route.set));
    if (sets.size > 1) {
      fail("/chapters", `beat ${index} draws from more than one route set (${[...sets].join(", ")}); a beat is chosen along one axis`);
      continue;
    }
    const setName = [...sets][0];
    const declared = routeSets[setName];
    if (!declared) {
      fail("/chapters", `beat ${index} uses route set "${setName}", which the campaign does not declare in routeSets`);
      continue;
    }

    const covered = routed.map((chapter) => chapter.route.flag);
    const duplicates = covered.filter((flag, at) => covered.indexOf(flag) !== at);
    if (duplicates.length > 0) {
      fail("/chapters", `beat ${index} has two chapters on route "${duplicates[0]}"; each member of a beat takes a different one`);
      continue;
    }
    const missing = declared.filter((flag) => !covered.includes(flag));
    const unknown = covered.filter((flag) => !declared.includes(flag));
    if (missing.length > 0) {
      fail(
        "/chapters",
        `beat ${index} is missing route(s) ${missing.join(", ")} of set "${setName}"`,
        "a party that took that road would reach this beat with no chapter to enter",
      );
    }
    if (unknown.length > 0) {
      fail("/chapters", `beat ${index} declares route(s) ${unknown.join(", ")}, which are not in set "${setName}"`);
    }
  }

  if (ok) {
    const routed = ordered.filter((index) => beats.get(index).length > 1).length;
    const shape = routed > 0 ? `, ${routed} routed` : "";
    rep.ok(`${f}  campaign  (${campaign.chapters.length} chapter(s), ${ordered.length} beat(s)${shape})`);
  }
  return ok;
}

/**
 * The graph half of `checkCampaign` (#192, docs/campaigns/graph-campaigns.md).
 *
 * A graph campaign chooses its next chapter by edge, so none of the beat
 * arithmetic above applies — no 1..n, no route set coverage — and running it
 * anyway would fail every graph whose chapters share an act number. What
 * applies instead is that every name in the declaration resolves
 * (`parseCampaignGraph`, the same check the server makes at startup), and
 * that no chapter still claims a routed beat nothing would ever read.
 *
 * Once every name resolves, the graph is *walked* (#193,
 * packages/shared/src/campaign-graph-lint.ts): reachability, dead ends,
 * unintentional cycles, `irreversible` claims, locked edges nothing opens, and
 * a search over journey states for a party that can be stranded. Errors fail
 * the build; warnings print. The file text is read once more for a repeated
 * node or edge id, which `JSON.parse` would silently merge.
 *
 * Ordered campaigns never get here (checkCampaign returns to its beat rules
 * first), so Gemfall's output is untouched.
 */
function checkGraphCampaign(rep, file, campaign, chaptersById, fail, okSoFar, items = null, classIds = null) {
  const f = rel(file);
  let ok = okSoFar;
  campaign.chapters.forEach((id, i) => {
    if (chaptersById.get(id)?.route) {
      fail(
        `/chapters/${i}`,
        `chapter "${id}" declares a route, but a graph campaign chooses its chapters by edge`,
        "Drop `route` from the chapter and express the choice as edges with `when`.",
      );
      ok = false;
    }
  });
  for (const { path, key } of duplicateJsonKeys(readFileSync(file, "utf8"))) {
    fail(path, `DUPLICATE_KEY: "${key}" appears twice in the same object, so JSON keeps only the last`, "Give each node and each edge its own id; the first one is silently dropped.");
    ok = false;
  }
  const { graph, problems } = parseCampaignGraph(campaign);
  for (const { path, problem } of problems) {
    fail(path, problem);
    ok = false;
  }
  if (graph) {
    // An environment keyed on the world (#220) names facts this graph
    // declares, with tests their values can pass — the same rule a graph
    // condition's `facts` is held to. Unknown, it could never hold.
    for (const id of campaign.chapters ?? []) {
      const chapter = chaptersById.get(id);
      for (const [sceneId, scene] of Object.entries(chapter?.scenes ?? {})) {
        (scene?.environment?.variants ?? []).forEach((variant, i) => {
          for (const [factId, test] of Object.entries(variant?.when?.facts ?? {})) {
            const at = `content/chapters/${id}.json /scenes/${sceneId}/environment/variants/${i}/when/facts/${factId}`;
            const fact = graph.facts?.[factId];
            if (!fact) {
              fail(at, `"${factId}" is not a world fact this campaign declares, so the variant can never hold`);
              ok = false;
              continue;
            }
            for (const { path, problem } of factTestProblems(fact, test)) {
              fail(`${at}${path}`, problem);
              ok = false;
            }
          }
        });
      }
    }
  }
  let walked = "";
  if (graph && items) {
    // A rift action way that needs a carried item (#199) names one the
    // catalog has — the same check a chapter choice's `requiresItem` gets.
    for (const id of graph.edgeOrder) {
      for (const kind of RIFT_ACTION_KINDS) {
        for (const { rule, at } of riftActionWays(graph.edges[id].rift, kind)) {
          (rule.requires?.anyItem ?? []).forEach((item, i) => {
            if (items[item]) return;
            fail(`/graph/edges/${id}/rift/${at}/requires/anyItem/${i}`, `item "${item}" is not in content/items.json`);
            ok = false;
          });
        }
      }
    }
  }
  if (graph) {
    // A chapter that did not load is unknown to the search (it may set any
    // flag), the conservative reading; a loaded one is read for its setFlags.
    const chapterFlags = (id) => (chaptersById.has(id) ? chapterFlagWrites(chaptersById.get(id)) : undefined);
    const fingerprint = graphFingerprint(campaign, chapterFlags);
    const proofFile = join(CONTENT, graphProofPath(campaign.id));
    const proof = existsSync(proofFile) ? JSON.parse(readFileSync(proofFile, "utf8")) : null;
    if (proof && proof.fingerprint === fingerprint && proof.checker === CHECKER) {
      // Walked already, by this checker, over exactly this graph.
      for (const w of proof.warnings) rep.warn(`${f} ${w.path}  ${w.code}: ${w.message}`, w.hint);
      walked = `, walked ${proof.states} state(s), proven`;
    } else {
      const { findings, search } = lintCampaignGraph(graph, { chapterFlags, routeSets: campaign.routeSets });
      const warnings = [];
      for (const finding of findings) {
        if (finding.severity === "error") {
          fail(finding.path, `${finding.code}: ${finding.message}`, finding.hint);
          ok = false;
        } else {
          rep.warn(`${f} ${finding.path}  ${finding.code}: ${finding.message}`, finding.hint);
          warnings.push({ path: finding.path, code: finding.code, message: finding.message, hint: finding.hint });
        }
      }
      walked = search.complete ? `, walked ${search.states} state(s)` : "";
      if (ok && search.complete && WRITE_PROOFS) {
        mkdirSync(dirname(proofFile), { recursive: true });
        const record = { campaign: campaign.id, fingerprint, checker: CHECKER, states: search.states, warnings };
        writeFileSync(proofFile, JSON.stringify({ $comment: PROOF_COMMENT, ...record }, null, 2) + "\n");
        walked += ", proof written";
      } else if (ok) {
        fail(
          "/graph",
          `${proof ? "the graph proof is stale" : "no graph proof"} (${rel(proofFile)}): the server would walk this graph at every start`,
          "Run `npm run content:proofs` and commit the proof it writes.",
        );
        ok = false;
      }
    }
  }
  if (graph && classIds && !CLASS_PLACES_OFF && campaign.id !== "gemfall" && campaign.chapters.every((id) => chaptersById.has(id))) {
    // Class places (#313, docs/class-mastery.md §2): all four, by a way every party has.
    const reach = classPlaceReach(campaign, campaign.chapters.map((id) => chaptersById.get(id)), classIds);
    const verdict = classPlaceVerdict(campaign.id, reach, CLASS_PLACE_ALLOW);
    for (const message of verdict.errors) {
      fail("/graph", `CLASS_PLACE: ${message}`, "Add the room to a chapter's rest scene (docs/class-mastery.md §2), or make its way in ungated.");
      ok = false;
    }
    for (const message of verdict.warnings) rep.warn(`${f}  CLASS_PLACE: ${message}`, "Remove the campaign from tools/content/class-place-allow.json once its rooms exist.");
  }
  if (ok && graph) {
    rep.ok(
      `${f}  campaign  (graph v${graph.version}: ${graph.nodeOrder.length} node(s), ${graph.edgeOrder.length} edge(s), ${graph.endings.length} ending(s)${walked})`,
    );
  }
  return ok;
}

// ----------------------------------------------------------------------------- driver

/**
 * The world map's places point at each other (a settlement names its biome)
 * and the painting it keys must exist, or the phone draws the party on a
 * missing image.
 */
function checkWorld(rep, file, world) {
  const f = rel(file);
  let ok = true;
  for (const [slug, place] of Object.entries(world.places)) {
    if (place.parent !== null && !world.places[place.parent]) {
      rep.fail(f, `/places/${slug}/parent`, `"${place.parent}" is not a place on the map`);
      ok = false;
    }
  }
  const image = join(ROOT, world.image.src.replace(/^\//, ""));
  if (!existsSync(image)) {
    rep.fail(f, "/image/src", `${world.image.src} is not in the repo`, "The map is the painting; ship it under assets/world/.");
    ok = false;
  }
  const sheets = [];
  for (const [slug, region] of Object.entries(world.regions ?? {})) {
    const at = `/regions/${slug}`;
    const fail = (message) => { rep.fail(f, at, message); ok = false; };
    if (world.places[slug]?.id !== region.placeId) fail("regional sheet must reference its canonical place");
    const b = region.bounds;
    if (b.x + b.width > 1000 || b.y + b.height > 1000) fail("regional bounds extend outside the realm");
    sheets.push([at, region]);
  }
  let previousWidth = 0;
  for (const [index, level] of (world.atlas?.levels ?? []).entries()) {
    if (level.image.width <= previousWidth) { rep.fail(f, "/atlas/levels", "atlas levels must increase in resolution"); ok = false; }
    previousWidth = level.image.width;
    if (Math.abs(level.image.height - level.image.width * world.atlas.image.height / world.atlas.image.width) > 1) {
      rep.fail(f, "/atlas/levels", "atlas levels must preserve the master aspect ratio"); ok = false;
    }
    sheets.push([`/atlas/levels/${index}`, level]);
  }
  if (world.atlas && previousWidth !== world.atlas.image.width) {
    rep.fail(f, "/atlas/levels", "atlas needs its native resolution level"); ok = false;
  }
  const patchIds = new Set();
  for (const [index, patch] of (world.atlas?.patches ?? []).entries()) {
    const at = `/atlas/patches/${index}`;
    if (patchIds.has(patch.id) || patch.bounds.x + patch.bounds.width > 1000 || patch.bounds.y + patch.bounds.height > 1000) {
      rep.fail(f, at, "detail sections need unique ids and bounds inside the realm"); ok = false;
    }
    patchIds.add(patch.id);
    sheets.push([at, patch]);
  }
  const knownPlaces = new Set(Object.values(world.places).map((place) => place.id));
  const routeIds = new Set();
  for (const route of world.routes ?? []) {
    if (routeIds.has(route.id) || [...route.connects, ...(route.via ? [route.via] : [])].some((id) => !knownPlaces.has(id))) {
      rep.fail(f, "/routes", "route ids must be unique and all endpoints must be mapped places"); ok = false;
    }
    routeIds.add(route.id);
  }
  for (const [at, region] of sheets) {
    const fail = (message) => { rep.fail(f, at, message); ok = false; };
    let area = 0;
    for (const [index, tile] of region.tiles.entries()) {
      if (!existsSync(join(ROOT, tile.src.replace(/^\//, "")))) fail(`missing tile ${tile.src}`);
      if (tile.x + tile.width > region.image.width || tile.y + tile.height > region.image.height) fail("tile extends outside its sheet");
      area += tile.width * tile.height;
      for (const earlier of region.tiles.slice(0, index)) {
        if (tile.x < earlier.x + earlier.width && earlier.x < tile.x + tile.width &&
            tile.y < earlier.y + earlier.height && earlier.y < tile.y + tile.height) fail("regional tiles overlap");
      }
    }
    if (area !== region.image.width * region.image.height) fail("regional tiles must cover the entire sheet without gaps");
  }
  if (ok) rep.ok(`${f}  world map  (${Object.keys(world.places).length} places, painting present)`);
}

function main() {
  const rep = new Report();

  console.log(`${BOLD}Kids & Dragons - content validate${RESET}`);
  console.log(`${DIM}schemas: ${rel(SCHEMAS)}   content: ${rel(CONTENT)}${RESET}`);

  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);

  for (const name of ["rules", "items", "chapter", "campaign", "map", "abilities", "world", "help"]) {
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

  // --- abilities, checked against rules.json: what every card actually does
  const abilitiesPath = join(CONTENT, "abilities.json");
  const abilities = existsSync(abilitiesPath) ? readJson(rep, abilitiesPath) : null;
  if (!abilities) {
    rep.fail(
      rel(abilitiesPath),
      "",
      "content/abilities.json is missing",
      "Without it every class signature and species action is a card that does nothing when tapped.",
    );
  } else if (validateAgainstSchema(rep, ajv, "abilities", abilitiesPath, abilities) && rules) {
    checkAbilities(rep, abilitiesPath, abilities, rules, rulesPath);
  }

  // --- the world map: generated from canon, read by the phone's map
  const worldPath = join(CONTENT, "world.json");
  const world = existsSync(worldPath) ? readJson(rep, worldPath) : null;
  if (!world) {
    rep.fail(rel(worldPath), "", "content/world.json is missing", "Run `npm run canon:world`.");
  } else if (validateAgainstSchema(rep, ajv, "world", worldPath, world)) {
    checkWorld(rep, worldPath, world);
  }

  // --- help: the words behind every "?", long-press and the join line (#256)
  const helpPath = join(CONTENT, "help.json");
  const help = existsSync(helpPath) ? readJson(rep, helpPath) : null;
  if (!help) {
    rep.fail(rel(helpPath), "", "content/help.json is missing", "Without it no screen can say what it is for, and the shared screen cannot say how to join.");
  } else if (validateAgainstSchema(rep, ajv, "help", helpPath, help)) {
    const problems = helpProblems(help);
    for (const problem of problems) rep.fail(rel(helpPath), problem.at, problem.message);
    if (!problems.length) rep.ok(`${rel(helpPath)}  help  (every player surface, the three long-press kinds and the join line, in the child's voice)`);
  }

  // --- the field guide: which canon ids a scene may say it discovers
  const fieldGuidePath = join(CONTENT, "field-guide.json");
  const fieldGuide = existsSync(fieldGuidePath) ? readJson(rep, fieldGuidePath) : null;
  if (!fieldGuide) {
    rep.warn("content/field-guide.json is missing", "Run `npm run canon:field-guide` — `discovers` tags cannot be checked without it.");
  }

  // Biome list lives in the art contract; content and art must not drift apart.
  let biomes = null;
  let backgroundOnlyBiomes = [];
  if (existsSync(MANIFEST)) {
    const manifest = readJson(rep, MANIFEST);
    biomes = manifest?.biomes ?? null;
    backgroundOnlyBiomes = manifest?.backgroundOnlyBiomes ?? [];
  }

  // --- maps, before chapters: an encounter is checked against them
  console.log(`\n${BOLD}maps${RESET}`);
  const mapFiles = listJson(join(CONTENT, "maps"));
  const mapIds = new Set();
  const mapsById = new Map();
  for (const file of mapFiles) {
    const map = readJson(rep, file);
    if (!map) continue;
    if (!validateAgainstSchema(rep, ajv, "map", file, map)) continue;
    checkMap(rep, file, map);
    if (mapIds.has(map.id)) rep.fail(rel(file), "/id", `duplicate map id "${map.id}"`);
    mapIds.add(map.id);
    mapsById.set(map.id, map);
  }
  if (mapFiles.length) rep.ok(`content/maps  ${mapFiles.length} map(s)  (10×8 board, spawns open and reachable)`);

  // --- the bestiary: canon's creatures, projected. Generated, never edited.
  const bestiaryPath = join(CONTENT, "bestiary.json");
  const bestiary = existsSync(bestiaryPath) ? readJson(rep, bestiaryPath) : null;
  if (!bestiary) {
    rep.warn("content/bestiary.json is missing", "Run `npm run canon:bestiary` — enemy stats cannot be checked against canon without it.");
  } else {
    rep.ok(`content/bestiary.json  ${Object.keys(bestiary.creatures ?? {}).length} creature(s) projected from canon`);
  }

  // --- chapters
  console.log(`\n${BOLD}chapters${RESET}`);
  const chapterFiles = listJson(join(CONTENT, "chapters"));
  if (!chapterFiles.length) rep.warn("no chapters found", "content/chapters/ is empty.");
  const chaptersById = new Map();
  const brokenChapterIds = new Set();

  // Flags each campaign carries between chapters — every member of every
  // declared route set, and a graph campaign's declared journey flags
  // (`journeyFlags`: the same carry rule, widened). Read before the chapters
  // so a chapter may gate on a flag an earlier chapter of its campaign set.
  // Malformed campaigns are reported below, in their own section; here they
  // simply carry nothing.
  const carriedByCampaign = new Map();
  for (const file of listJson(join(CONTENT, "campaigns"))) {
    let campaign;
    try {
      campaign = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const routeSets = campaign && typeof campaign.routeSets === "object" ? campaign.routeSets : undefined;
    const graph = campaign && typeof campaign.graph === "object" ? campaign.graph : undefined;
    carriedByCampaign.set(campaign?.id, new Set(journeyFlags({ routeSets: routeSets ?? undefined, graph: graph ?? undefined })));
  }

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
    checkChapter(rep, file, chapter, items, rules, biomes, mapIds, bestiary, carriedByCampaign.get(chapter.campaignId), fieldGuide, world, mapsById, backgroundOnlyBiomes);
    chaptersById.set(chapter.id, chapter);
  }

  checkFittingStall(rep, rules, chaptersById, brokenChapterIds);

  // --- campaigns
  console.log(`\n${BOLD}campaigns${RESET}`);
  const campaignFiles = listJson(join(CONTENT, "campaigns"));
  if (!campaignFiles.length) rep.warn("no campaigns found", "content/campaigns/ is empty.");
  const referenced = new Set();

  const loadedCampaigns = [];
  for (const file of campaignFiles) {
    const campaign = readJson(rep, file);
    if (!campaign) continue;
    if (!validateAgainstSchema(rep, ajv, "campaign", file, campaign)) continue;
    checkCampaign(rep, file, campaign, chaptersById, brokenChapterIds, items, rules ? Object.keys(rules.classes ?? {}) : null);
    for (const id of campaign.chapters) referenced.add(id);
    loadedCampaigns.push({ file, campaign });
  }

  // Prerequisites (#221) are a fact about the whole set - an unknown campaign
  // or a cycle cannot be seen from one file - so they are checked once every
  // campaign has been read. The same function the server's loader runs.
  const fileOf = new Map(loadedCampaigns.map(({ file, campaign }) => [campaign.id, file]));
  for (const { campaignId, path, problem } of prerequisiteProblems(loadedCampaigns.map((c) => c.campaign))) {
    rep.fail(
      rel(fileOf.get(campaignId)),
      path,
      problem,
      "Campaign.requires lists campaigns the household must finish first; see schemas/campaign.schema.json.",
    );
  }

  // The class-place allow-list (#313) names graph campaigns in content/campaigns;
  // an entry for anything else, or without a reason, is stale or hides a gap.
  const graphIds = new Set(loadedCampaigns.filter(({ campaign }) => campaignMode(campaign) === "graph").map(({ campaign }) => campaign.id));
  for (const [id, reason] of Object.entries(CLASS_PLACE_ALLOW)) {
    const at = "tools/content/class-place-allow.json";
    if (!graphIds.has(id)) rep.fail(at, `/${id}`, `"${id}" is not a graph campaign in content/campaigns, so there is nothing to allow`, "Remove the entry.");
    else if (typeof reason !== "string" || !reason.trim()) rep.fail(at, `/${id}`, "an allow-list entry needs a one-line reason", "Say why the campaign has no class places yet.");
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

/**
 * The Exchange's fitting stall (#312, docs/class-mastery.md §1): rules.json
 * names the scenes it stands in, and the schema cannot see whether they are
 * there. A stall that names a scene nobody can stand in, one a party could
 * never answer in, or a class's room would fail at the table instead of here.
 */
function checkFittingStall(rep, rules, chaptersById, brokenChapterIds) {
  const stall = rules?.fittingStall;
  if (!stall) return;
  const f = "content/rules.json";
  let ok = true;
  const bad = (path, problem, hint) => {
    ok = false;
    rep.fail(f, path, problem, hint);
  };
  stall.stands.forEach(({ chapterId, sceneId }, i) => {
    const at = `/fittingStall/stands/${i}`;
    if (brokenChapterIds.has(chapterId)) return;
    const chapter = chaptersById.get(chapterId);
    if (!chapter) return bad(`${at}/chapterId`, `no chapter "${chapterId}"`);
    if (chapter.index !== 1) {
      bad(`${at}/chapterId`, `"${chapterId}" is chapter ${chapter.index} of its campaign`, "The stall stands where a campaign opens, while its heroes are new: its first chapter.");
    }
    const scene = chapter.scenes?.[sceneId];
    if (!scene) return bad(`${at}/sceneId`, `"${chapterId}" has no scene "${sceneId}"`);
    if (scene.type !== "story" && scene.type !== "choice_point") {
      bad(`${at}/sceneId`, `"${sceneId}" is a ${scene.type} scene`, "The stall stands in a story or choice_point scene, as a class place does.");
    }
    if (Array.isArray(scene.choices) && scene.choices.length === 0) {
      bad(`${at}/sceneId`, `"${sceneId}" ends the chapter - nobody would get to answer before it closed`);
    }
    if (scene.classPlace !== undefined) {
      bad(`${at}/sceneId`, `"${sceneId}" is already the ${scene.classPlace} class place`, "One kind of class change per scene.");
    }
    // The way on waits for every new hero's answer, so it must be a plain
    // "go on": one choice, open to everybody. A vote or a gated choice held
    // behind the wait would be a decision the stall is sitting on.
    const choices = Array.isArray(scene.choices) ? scene.choices : [];
    if (choices.length > 1) {
      bad(`${at}/sceneId`, `"${sceneId}" has ${choices.length} choices - the stall's wait would hold a decision`, "Stand it in a scene whose only choice is the way on.");
    }
    for (const choice of choices) {
      const gates = ["requiresSpecies", "requiresClass", "requiresFlag", "requiresItem", "when"].filter((key) => choice[key] !== undefined);
      if (gates.length > 0) {
        bad(`${at}/sceneId`, `"${sceneId}"'s choice "${choice.id}" is gated (${gates.join(", ")})`, "The stall stands where everybody walks on the same way.");
      }
    }
  });
  // Shown on the shared screen in whichever campaign it stands in, Gemfall
  // included, so it keeps Gemfall's house rules (gemfall-authoring.md).
  if (/\u2014/.test(stall.narration)) bad("/fittingStall/narration", "has an em dash", "Gemfall text uses none.");
  if (ok) rep.ok(`${f}  fitting stall (${stall.stands.length} stand${stall.stands.length === 1 ? "" : "s"})`);
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
