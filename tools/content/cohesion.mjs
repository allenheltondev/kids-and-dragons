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
 * scenes a party can reach from the entry without passing another matching
 * scene. Each first mention must introduce the concept in its own words. With
 * `--introduced-by` (scene ids, or `chapter/scene`), it removes those scenes
 * from the graph and lists every matching scene still reachable from the
 * entry: a *leak*, a way in that never passed an introduction. This is the
 * #364 mask/cult sweep.
 *
 * **setbacks** lists, for each `"outcome": "setback"` ending, the route there
 * with the fewest failures (a check's `onFailure` or a fight's `onDefeat`),
 * then the fewest scenes, and under it every failure after which the ending
 * can follow with nothing else going wrong. A failed check there that can be
 * the party's first failure is the CLAUDE.md "never from one ordinary failed
 * roll" case (08's tether and Keystone checks); a short route through a
 * single lost fight is the 05c case.
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

/** A check or fight result as `{ to, text, failure }`. */
function branch(b, failure) {
  return { to: b.goto, text: [b.narration, ...(b.variants ?? []).map((v) => v.text)].filter(Boolean), failure };
}

/** Every way out of a scene: `{ to, text: [words shown on the way out], failure }`. */
export function exits(scene) {
  switch (scene.type) {
    case "check":
      return [branch(scene.onSuccess, false), branch(scene.onFailure, true)];
    case "encounter":
      return [
        branch(scene.onVictory, false),
        branch(scene.onDefeat, true),
        ...[scene.onEscape, scene.onTimeout].filter(Boolean).map((b) => branch(b, false)),
      ];
    default:
      return (scene.choices ?? []).map((c) => ({ to: c.goto, text: [c.label].filter(Boolean), failure: false }));
  }
}

/** Every string a party can read in or on the way out of a scene, with where it lives. */
export function sceneTexts(scene) {
  const out = [];
  const add = (field, text) => text && out.push({ field, text });
  add("narration", scene.narration);
  add("prompt", scene.prompt);
  (scene.variants ?? []).forEach((v, i) => add(`variants[${String(i)}]`, v.text));
  for (const c of scene.cast ?? []) add("cast", c.name);
  (scene.choices ?? []).forEach((c) => add(`choice ${c.id}`, c.label));
  const named = { check: ["onSuccess", "onFailure"], encounter: ["onVictory", "onDefeat", "onEscape", "onTimeout"] }[scene.type] ?? [];
  for (const key of named) {
    const b = scene[key];
    if (!b) continue;
    add(key, b.narration);
    (b.variants ?? []).forEach((v, i) => add(`${key}.variants[${String(i)}]`, v.text));
  }
  return out;
}

/** Scenes whose text matches `re`, as `{ id, hits: [{ field, quote }] }`. */
export function mentions(chapter, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  const found = [];
  for (const [id, scene] of Object.entries(chapter.scenes ?? {})) {
    const hits = [];
    for (const { field, text } of sceneTexts(scene)) {
      for (const m of text.matchAll(g)) {
        const from = Math.max(0, m.index - 40);
        const to = Math.min(text.length, m.index + m[0].length + 40);
        hits.push({ field, quote: `${from > 0 ? "..." : ""}${text.slice(from, to)}${to < text.length ? "..." : ""}` });
      }
    }
    if (hits.length) found.push({ id, hits });
  }
  return found;
}

/**
 * The scenes reachable from the entry when `blocked` scenes are removed. A
 * blocked scene is never entered, so nothing past it is reached through it.
 * `stopAt` scenes are entered (and returned) but not walked past.
 */
export function reachable(chapter, blocked = new Set(), stopAt = new Set()) {
  const scenes = chapter.scenes ?? {};
  const seen = new Set();
  const queue = blocked.has(chapter.entry) ? [] : [chapter.entry];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !scenes[id]) continue;
    seen.add(id);
    if (stopAt.has(id)) continue;
    for (const e of exits(scenes[id])) if (!blocked.has(e.to) && !seen.has(e.to)) queue.push(e.to);
  }
  return seen;
}

/**
 * The lowercase-concept sweep. `introducers` are the scenes meant to
 * introduce the concept (ids in this chapter; unknown ids are ignored).
 * Returns `{ mentions, firstMentions, introducers, leaks }`; `leaks` is null
 * when no introducer was given.
 */
export function conceptSweep(chapter, re, introducers = []) {
  const all = mentions(chapter, re);
  const ids = new Set(all.map((m) => m.id));
  const live = reachable(chapter);
  const first = reachable(chapter, new Set(), ids);
  const firstMentions = all.filter((m) => first.has(m.id)).map((m) => m.id);
  const own = introducers.filter((id) => chapter.scenes?.[id]);
  let leaks = null;
  if (own.length) {
    const without = reachable(chapter, new Set(own));
    leaks = all.filter((m) => without.has(m.id)).map((m) => m.id);
  }
  return { mentions: all.filter((m) => live.has(m.id)), unreachable: all.filter((m) => !live.has(m.id)).map((m) => m.id), firstMentions, introducers: own, leaks };
}

/**
 * For each setback ending, the route from the entry with the fewest failures,
 * then the fewest scenes: `{ ending, failures: [{ scene, type, tn }], scenes, path }`,
 * or `failures: null` when the ending is unreachable.
 */
export function setbackRoutes(chapter) {
  const scenes = chapter.scenes ?? {};
  const best = new Map([[chapter.entry, { f: 0, n: 1, prev: null, via: null }]]);
  const better = (a, b) => !b || a.f < b.f || (a.f === b.f && a.n < b.n);
  const queue = [chapter.entry];
  while (queue.length) {
    queue.sort((a, b) => best.get(a).f - best.get(b).f || best.get(a).n - best.get(b).n);
    const id = queue.shift();
    const here = best.get(id);
    if (!scenes[id]) continue;
    for (const e of exits(scenes[id])) {
      if (!scenes[e.to]) continue;
      const next = { f: here.f + (e.failure ? 1 : 0), n: here.n + 1, prev: id, via: e.failure ? id : null };
      if (better(next, best.get(e.to))) {
        best.set(e.to, next);
        if (!queue.includes(e.to)) queue.push(e.to);
      }
    }
  }
  return Object.entries(scenes)
    .filter(([, s]) => s.outcome === "setback")
    .map(([ending]) => {
      if (!best.has(ending)) return { ending, failures: null, scenes: 0, path: [] };
      const path = [];
      const failures = [];
      for (let id = ending; id; id = best.get(id).prev) {
        path.unshift(id);
        const via = best.get(id).via;
        if (via) failures.unshift({ scene: via, type: scenes[via].type, tn: scenes[via].tn ?? null });
      }
      return { ending, failures, scenes: path.length, path, lastFailures: lastFailures(ending) };
    });

  /**
   * Every failure after which the ending can follow with nothing else going
   * wrong: `{ scene, type, tn, firstFailure }`. `firstFailure` when the scene
   * is reachable with no failure before it, so this one failure alone is enough.
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
    return Object.entries(scenes)
      .filter(([id, s]) => best.has(id) && exits(s).some((e) => e.failure && clean.has(e.to)))
      .map(([id, s]) => ({ scene: id, type: s.type, tn: s.tn ?? null, firstFailure: best.get(id).f === 0 }));
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
      if (r.leaks) print(`  leaks without ${r.introducers.join(", ")}: ${r.leaks.join(", ") || "none"}`);
      else if (named.length) print("  no --introduced-by scene is in this chapter");
    }
    return 0;
  }
  if (mode === "setbacks") {
    for (const c of chapters) {
      for (const r of setbackRoutes(c)) {
        if (!r.failures) {
          print(`${c.id} ${r.ending}: unreachable`);
          continue;
        }
        const one = r.failures.length === 1 && r.failures[0].type === "check" ? "  ! one failed roll" : "";
        const what = r.failures.map((f) => `${f.scene} (${f.type === "check" ? `failed roll${f.tn ? `, TN ${String(f.tn)}` : ""}` : "lost fight"})`);
        print(`${c.id} ${r.ending}: ${String(r.failures.length)} failure(s), ${String(r.scenes)} scenes: ${what.join(" then ") || "no failure needed"}${one}`);
        for (const f of r.lastFailures) {
          const kind = f.type === "check" ? `failed roll${f.tn ? `, TN ${String(f.tn)}` : ""}` : "lost fight";
          const alone = f.firstFailure ? (f.type === "check" ? "  ! can be the first failure" : "  (can be the first failure)") : "";
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
