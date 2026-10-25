#!/usr/bin/env node
/**
 * Read-only helpers for the chapter-cohesion review
 * (.claude/skills/chapter-cohesion/SKILL.md). Nothing here gates the build;
 * every mode prints a reading list.
 *
 *   node tools/content/cohesion.mjs concept <regex> [--introduced-by a,b] [--chapter <prefix>]
 *   node tools/content/cohesion.mjs setbacks [--chapter <prefix>]
 *   node tools/content/cohesion.mjs opening [--chapter <prefix>]
 *   node tools/content/cohesion.mjs idioms [--chapter <prefix>]
 *   node tools/content/cohesion.mjs merges [--chapter <prefix>]
 *
 * `--chapter` is a file-name prefix, `gemfall-` by default; `--chapter ""`
 * reads every chapter.
 *
 * **concept** is the lowercase-concept sweep `content:continuity` cannot do
 * ("the masks", "the cult", "the seal"). It lists every scene whose text
 * matches the regex (case-insensitive) and the *first mentions*: the matching
 * scenes a party can reach from the entry without hearing the concept on the
 * way. Each first mention must introduce the concept in its own words. With
 * `--introduced-by` (scene ids, or `chapter/scene`), it removes those
 * introductions from the graph and lists every matching scene still reachable
 * from the entry: a *leak*, a way in that never passed an introduction. This
 * is the #364 mask/cult sweep. It is path-sensitive: a scene's narration,
 * prompt and cast introduce on every way out, a choice label or a check or
 * fight result only on its own way out, and a variant never (see
 * `conceptSweep`).
 *
 * **setbacks** lists, for each `"outcome": "setback"` ending, the route there
 * with the fewest failures (a check's `onFailure` or a fight's `onDefeat`),
 * then the fewest scenes, and under it every failure after which the ending
 * can follow with nothing else going wrong. A failed check there that can be
 * the party's first failure is the CLAUDE.md "never from one ordinary failed
 * roll" case (08's tether and Keystone checks); a short route through a
 * single lost fight is the 05c case. These are structural lower bounds: a
 * route through a gated choice is marked, with the count when every gated
 * choice is left out, and needs a human read to confirm a party can take it.
 *
 * **idioms** lists the UK idioms `spelling.test.mjs` does not catch (the #368
 * audit's list: "round" for around, biscuit, jumper, sweets, crisps, "you
 * lot", nan, teatime, full stop), in player text only, never ids. A hit is a
 * word to read, not a verdict: "a round table" is fine.
 *
 * **merges** lists every reachable scene two or more scenes lead into, with
 * the scenes that lead there: the merge points that need a human read for
 * "the jar", "your goat" and other references no tool sees.
 *
 * **opening** prints the chapter's `goal.text` (when it has one) beside the
 * entry scene's narration, for the "goal in scene 1" read.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAPTERS = join(HERE, "..", "..", "content", "chapters");

/** The result keys a check or fight leaves by, in `exits` order. */
function branchKeys(scene) {
  if (scene.type === "check") return ["onSuccess", "onFailure"];
  if (scene.type === "interaction") return ["onSuccess", "onFailure", ...(scene.onAssisted ? ["onAssisted"] : [])];
  if (scene.type === "encounter") return ["onVictory", "onDefeat", ...["onEscape", "onTimeout"].filter((k) => scene[k])];
  return [];
}

/** A choice some parties never see: a species, class, flag or item gate, or a `when`. */
function isGated(choice) {
  return Boolean(choice.when || choice.requiresFlag || choice.requiresItem || choice.requiresSpecies || choice.requiresClass);
}

/**
 * Every way out of a scene: `{ to, failure, gated }`. `failure` is a check's
 * `onFailure` or a fight's `onDefeat`; `gated` a choice some parties never see.
 */
export function exits(scene) {
  const keys = branchKeys(scene);
  if (keys.length) return keys.map((k) => ({ to: scene[k].goto, failure: k === "onFailure" || k === "onDefeat", gated: false }));
  return (scene.choices ?? []).map((c) => ({ to: c.goto, failure: false, gated: isGated(c) }));
}

/**
 * Every string a party can read in or on the way out of a scene: `{ field,
 * text, at }`. `at` says who is sure to see it: `"scene"` (narration, prompt,
 * cast: everyone who enters), an exit index (a choice label or a result's
 * narration: only a party leaving that way), or `"variant"` (shown only to
 * some parties, so it never proves an introduction).
 */
export function sceneTexts(scene) {
  const out = [];
  const add = (field, text, at) => text && out.push({ field, text, at });
  add("narration", scene.narration, "scene");
  add("prompt", scene.prompt, "scene");
  for (const c of scene.cast ?? []) add("cast", c.name, "scene");
  (scene.variants ?? []).forEach((v, i) => add(`variants[${String(i)}]`, v.text, "variant"));
  (scene.choices ?? []).forEach((c, i) => add(`choice ${c.id}`, c.label, i));
  branchKeys(scene).forEach((key, i) => {
    add(key, scene[key].narration, i);
    (scene[key].variants ?? []).forEach((v, j) => add(`${key}.variants[${String(j)}]`, v.text, "variant"));
  });
  return out;
}

/**
 * Scenes whose text matches `re`: `{ id, hits: [{ field, quote }], scene,
 * exits, variant }`. `scene` when everyone entering sees it; `exits` the exit
 * indexes whose own text carries it; `variant` when some of it is variant-only.
 */
export function mentions(chapter, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  const found = [];
  for (const [id, scene] of Object.entries(chapter.scenes ?? {})) {
    const hit = { id, hits: [], scene: false, exits: new Set(), variant: false };
    for (const { field, text, at } of sceneTexts(scene)) {
      for (const m of text.matchAll(g)) {
        const from = Math.max(0, m.index - 40);
        const to = Math.min(text.length, m.index + m[0].length + 40);
        hit.hits.push({ field, quote: `${from > 0 ? "..." : ""}${text.slice(from, to)}${to < text.length ? "..." : ""}` });
        if (at === "scene") hit.scene = true;
        else if (at === "variant") hit.variant = true;
        else hit.exits.add(at);
      }
    }
    if (hit.hits.length) found.push(hit);
  }
  return found;
}

/**
 * The scenes reachable from the entry. A `blocked` scene is never entered;
 * `cut(id)` returns the exit indexes of a scene not to walk out by (all of
 * them to stop there). Exits that `skip` returns true for are not walked.
 */
export function reachable(chapter, blocked = new Set(), cut = () => [], skip = () => false) {
  const scenes = chapter.scenes ?? {};
  const seen = new Set();
  const queue = blocked.has(chapter.entry) ? [] : [chapter.entry];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !scenes[id]) continue;
    seen.add(id);
    const stop = new Set(cut(id));
    exits(scenes[id]).forEach((e, i) => {
      if (!stop.has(i) && !skip(e) && !blocked.has(e.to) && !seen.has(e.to)) queue.push(e.to);
    });
  }
  return seen;
}

/**
 * The lowercase-concept sweep, path by path. Text everyone entering a scene
 * sees introduces the concept on every way out; a choice label or a result's
 * narration introduces it only on that way out (a failed roll's words are not
 * heard by the party that passed); a variant never proves it.
 *
 * `introducers` are the scenes meant to introduce the concept (ids in this
 * chapter; unknown ids are ignored). Each is removed as far as its own words
 * reach: the whole scene, or only the exits that carry the concept. An
 * introducer whose mention is variant-only, or absent, removes nothing and is
 * listed in `unproven`. A `leak` is a mentioning scene, not itself an
 * introducer, still reachable after that. `variantOnly` lists mentions a
 * party may or may not see, to read by hand.
 */
export function conceptSweep(chapter, re, introducers = []) {
  const scenes = chapter.scenes ?? {};
  const all = mentions(chapter, re);
  const byId = new Map(all.map((m) => [m.id, m]));
  const live = reachable(chapter);
  const allExits = (id) => exits(scenes[id]).map((_, i) => i);
  const intro = (m) => (m.scene ? allExits(m.id) : [...m.exits]);
  const first = reachable(chapter, new Set(), (id) => (byId.has(id) ? intro(byId.get(id)) : []));
  const firstMentions = all.filter((m) => first.has(m.id)).map((m) => m.id);
  const own = introducers.filter((id) => scenes[id]);
  const unproven = own.filter((id) => !byId.has(id) || (!byId.get(id).scene && !byId.get(id).exits.size));
  let leaks = null;
  if (own.length) {
    const whole = new Set(own.filter((id) => byId.get(id)?.scene));
    const partial = new Map(own.filter((id) => !whole.has(id) && byId.has(id)).map((id) => [id, [...byId.get(id).exits]]));
    const without = reachable(chapter, whole, (id) => partial.get(id) ?? []);
    leaks = all.filter((m) => without.has(m.id) && !own.includes(m.id)).map((m) => m.id);
  }
  return {
    mentions: all.filter((m) => live.has(m.id)),
    unreachable: all.filter((m) => !live.has(m.id)).map((m) => m.id),
    firstMentions,
    variantOnly: all.filter((m) => live.has(m.id) && !m.scene && !m.exits.size).map((m) => m.id),
    introducers: own,
    unproven,
    leaks,
  };
}

/**
 * For each setback ending, the route from the entry with the fewest failures,
 * then the fewest scenes: `{ ending, failures: [{ scene, type, tn }], scenes,
 * path, gated, lastFailures }`, or `failures: null` when no route reaches it.
 *
 * A structural lower bound: the route may take a gated choice no party at the
 * table can see, and `gated` says when it does. `ungatedFailures` is the same
 * count with every gated choice left out (null when the ending then needs one).
 */
export function setbackRoutes(chapter) {
  const scenes = chapter.scenes ?? {};
  const cheapest = (ungated) => {
    const best = new Map([[chapter.entry, { f: 0, n: 1, prev: null, via: null, gated: false }]]);
    const better = (a, b) => !b || a.f < b.f || (a.f === b.f && a.n < b.n);
    const queue = [chapter.entry];
    while (queue.length) {
      queue.sort((a, b) => best.get(a).f - best.get(b).f || best.get(a).n - best.get(b).n);
      const id = queue.shift();
      const here = best.get(id);
      if (!scenes[id]) continue;
      for (const e of exits(scenes[id])) {
        if (!scenes[e.to] || (ungated && e.gated)) continue;
        const next = { f: here.f + (e.failure ? 1 : 0), n: here.n + 1, prev: id, via: e.failure ? id : null, gated: here.gated || e.gated };
        if (better(next, best.get(e.to))) {
          best.set(e.to, next);
          if (!queue.includes(e.to)) queue.push(e.to);
        }
      }
    }
    return best;
  };
  const best = cheapest(false);
  const open = cheapest(true);

  return Object.entries(scenes)
    .filter(([, s]) => s.outcome === "setback")
    .map(([ending]) => {
      if (!best.has(ending)) return { ending, failures: null, scenes: 0, path: [], gated: false, ungatedFailures: null, lastFailures: [] };
      const path = [];
      const failures = [];
      for (let id = ending; id; id = best.get(id).prev) {
        path.unshift(id);
        const via = best.get(id).via;
        if (via) failures.unshift({ scene: via, type: scenes[via].type, tn: scenes[via].tn ?? null });
      }
      return {
        ending,
        failures,
        scenes: path.length,
        path,
        gated: best.get(ending).gated,
        ungatedFailures: open.has(ending) ? open.get(ending).f : null,
        lastFailures: lastFailures(ending),
      };
    });

  /**
   * Every failure after which the ending can follow with nothing else going
   * wrong: `{ scene, type, tn, firstFailure }`. `firstFailure` is `"any"` when
   * the scene is reachable with no failure before it through ungated choices,
   * `"gated"` when only a gated choice gets there failure-free, else false.
   */
  function lastFailures(ending) {
    const clean = new Set([ending]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [id, s] of Object.entries(scenes)) {
        if (clean.has(id)) continue;
        if (exits(s).some((e) => !e.failure && clean.has(e.to))) {
          clean.add(id);
          grew = true;
        }
      }
    }
    const first = (id) => (open.get(id)?.f === 0 ? "any" : best.get(id).f === 0 ? "gated" : false);
    return Object.entries(scenes)
      .filter(([id, s]) => best.has(id) && exits(s).some((e) => e.failure && clean.has(e.to)))
      .map(([id, s]) => ({ scene: id, type: s.type, tn: s.tn ?? null, firstFailure: first(id) }));
  }
}

/** Reachable scenes with two or more distinct scenes leading in: `{ scene, from: [ids] }`. */
export function mergePoints(chapter) {
  const live = reachable(chapter);
  const into = new Map();
  for (const id of live) {
    for (const e of exits(chapter.scenes[id])) {
      if (!live.has(e.to)) continue;
      if (!into.has(e.to)) into.set(e.to, new Set());
      into.get(e.to).add(id);
    }
  }
  return [...into].filter(([, from]) => from.size > 1).map(([scene, from]) => ({ scene, from: [...from] }));
}

/** UK idioms the spelling lint misses, each with the US word to reach for. */
export const IDIOMS = [
  { re: /\b(?:turn|turns|turned|turning|look|looks|looked|looking|come|comes|came|go|goes|went|spin|spins|spun|walk|walks|walked|gather|gathered|passed|all|ran|run|runs) round\b/gi, fix: "around" },
  { re: /\bround (?:the|a|an|your|their|his|her|its|and|here|there)\b/gi, fix: "around" },
  { re: /\bbiscuits?\b/gi, fix: "cookie or cracker" },
  { re: /\bjumpers?\b/gi, fix: "sweater" },
  { re: /\bsweets\b/gi, fix: "candy" },
  { re: /\bcrisps\b/gi, fix: "chips" },
  { re: /\byou lot\b/gi, fix: "you all, you folks" },
  { re: /\bnan\b/gi, fix: "grandma" },
  { re: /\bteatime\b/gi, fix: "suppertime" },
  { re: /\bfull stop\b/gi, fix: "period, or rephrase" },
];

/** UK-idiom hits in a chapter's player text: `{ scene, field, word, fix }`. */
export function idioms(chapter) {
  const out = [];
  for (const [id, scene] of Object.entries(chapter.scenes ?? {})) {
    for (const { field, text } of sceneTexts(scene)) {
      for (const { re, fix } of IDIOMS) for (const m of text.matchAll(re)) out.push({ scene: id, field, word: m[0], fix });
    }
  }
  return out;
}

/** The chapter's goal sentence (if it has one) and its entry scene's words. */
export function opening(chapter) {
  const entry = chapter.scenes?.[chapter.entry] ?? {};
  return { goal: chapter.goal?.text ?? null, entry: chapter.entry, narration: entry.narration ?? "" };
}

// ---------------------------------------------------------------------------

export function loadChapters(prefix = "gemfall-", dir = CHAPTERS) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json") && n.startsWith(prefix))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
}

function option(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at >= 0 ? (argv[at + 1] ?? "") : fallback;
}

export function main(argv, print = console.log) {
  const [mode, pattern] = argv;
  const chapters = loadChapters(option(argv, "--chapter", "gemfall-"));
  if (mode === "concept" && pattern) {
    const re = new RegExp(pattern, "i");
    const named = option(argv, "--introduced-by", "").split(",").filter(Boolean);
    for (const c of chapters) {
      const intro = named.flatMap((n) => (n.includes("/") ? (n.startsWith(`${c.id}/`) ? [n.slice(c.id.length + 1)] : []) : [n]));
      const r = conceptSweep(c, re, intro);
      if (!r.mentions.length) continue;
      print(`${c.id}: ${String(r.mentions.length)} scene(s) mention /${pattern}/i`);
      for (const m of r.mentions) for (const h of m.hits) print(`  ${m.id} [${h.field}] ${h.quote}`);
      if (r.unreachable.length) print(`  unreachable from the entry: ${r.unreachable.join(", ")}`);
      print(`  first mentions (each must introduce it): ${r.firstMentions.join(", ") || "-"}`);
      if (r.variantOnly.length) print(`  variant-only (some parties see it, none is introduced by it; read these): ${r.variantOnly.join(", ")}`);
      if (r.unproven.length) print(`  introduces nothing on any path (variant-only or no mention): ${r.unproven.join(", ")}`);
      if (r.leaks) print(`  leaks without ${r.introducers.join(", ")}: ${r.leaks.join(", ") || "none"}`);
      else if (named.length) print("  no --introduced-by scene is in this chapter");
    }
    return 0;
  }
  if (mode === "setbacks") {
    print("Structural lower bounds: gated choices are walked unless marked. Confirm a flagged route by hand.");
    for (const c of chapters) {
      for (const r of setbackRoutes(c)) {
        if (!r.failures) {
          print(`${c.id} ${r.ending}: unreachable`);
          continue;
        }
        const one = r.failures.length === 1 && r.failures[0].type === "check" ? "  ! one failed roll" : "";
        const what = r.failures.map((f) => `${f.scene} (${f.type === "check" ? `failed roll${f.tn ? `, TN ${String(f.tn)}` : ""}` : "lost fight"})`);
        const gate = !r.gated ? "" : r.ungatedFailures === null ? " [through a gated choice; no ungated route]" : ` [through a gated choice; ${String(r.ungatedFailures)} failure(s) with no gated choice]`;
        print(`${c.id} ${r.ending}: ${String(r.failures.length)} failure(s), ${String(r.scenes)} scenes: ${what.join(" then ") || "no failure needed"}${gate}${one}`);
        for (const f of r.lastFailures) {
          const kind = f.type === "check" ? `failed roll${f.tn ? `, TN ${String(f.tn)}` : ""}` : "lost fight";
          const first = f.firstFailure === "gated" ? "can be the first failure, through a gated choice" : "can be the first failure";
          const alone = f.firstFailure ? (f.type === "check" ? `  ! ${first}` : `  (${first})`) : "";
          print(`  after ${f.scene} (${kind})${alone}`);
        }
      }
    }
    return 0;
  }
  if (mode === "merges") {
    for (const c of chapters) for (const m of mergePoints(c)) print(`${c.id} ${m.scene} <- ${m.from.join(", ")}`);
    return 0;
  }
  if (mode === "idioms") {
    for (const c of chapters) for (const h of idioms(c)) print(`${c.id} ${h.scene} [${h.field}] "${h.word}" -> ${h.fix}`);
    return 0;
  }
  if (mode === "opening") {
    for (const c of chapters) {
      const o = opening(c);
      print(`${c.id} (${o.entry})`);
      print(`  goal: ${o.goal ?? "(no goal field)"}`);
      print(`  scene 1: ${o.narration}`);
    }
    return 0;
  }
  print("usage: cohesion.mjs concept <regex> [--introduced-by a,b] | setbacks | merges | idioms | opening   [--chapter <prefix>]");
  return 1;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
