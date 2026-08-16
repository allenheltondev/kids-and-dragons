#!/usr/bin/env node
/**
 * The chapter generator — `npm run content:generate -- "<brief>"`.
 *
 * Roadmap chapter 6's last piece, and its done condition: "you can go from an
 * idea to a validated, playable chapter in under an hour." An idea goes in as a
 * sentence; a chapter that passes `npm run content:validate` comes out.
 *
 * Three files, and the split is the design:
 *
 *   - `generate-core.ts` — the generate → check → repair loop, with `ask` and
 *     `check` injected. No SDK, no network, fully tested in CI without a key.
 *   - `generate-gate.ts` — `check`, which runs the **real** content validator
 *     over a staging tree rather than re-implementing its rules.
 *   - this file — `ask`, the argument parsing, and the prompt.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DOES NOT USE STRUCTURED OUTPUTS
 *
 * The obvious move is `output_config.format` with `schemas/chapter.schema.json`,
 * so the reply is valid by construction. It does not work here, and the reason
 * is worth writing down rather than rediscovering: structured outputs support a
 * subset of JSON Schema, and the chapter schema is built out of exactly the
 * parts outside it — `if`/`then` (which effect fields go with which `type`),
 * `oneOf` (a species gate is a string or a list), `propertyNames` and `pattern`
 * (scene ids are kebab-case keys), and the numeric bounds on `index`,
 * `estimatedMinutes` and `xp`.
 *
 * A simplified schema written to fit would be a second copy of the contract with
 * the interesting half deleted — the duplication `bestiary.ts` argues against at
 * length, and worse here, because the deleted half is where the mistakes are.
 * The loop already handles a reply that does not conform; that is what it is
 * for.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_ATTEMPTS, generateChapter } from "./generate-core.ts";
import type { Turn } from "./generate-core.ts";
import { baselineIsClean, chapterIdOf, checkCandidate } from "./generate-gate.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const tty = process.stdout.isTTY;
const RED = tty ? "\x1b[31m" : "";
const GREEN = tty ? "\x1b[32m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const OFF = tty ? "\x1b[0m" : "";

/**
 * `claude-opus-5`, as the roadmap names it.
 *
 * A chapter is a long, highly-constrained structured document with a graph
 * inside it — the shape of work where the loop below converges in one or two
 * rounds rather than four, which is the difference between the tool being worth
 * running and not.
 */
const MODEL = "claude-opus-5";

/** A 25-scene chapter is comfortably 20k tokens of JSON; the ceiling is 128k. */
const MAX_TOKENS = 64000;

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(ROOT, ...segments), "utf8");
}

/**
 * Everything the model needs to write a chapter that is *this* game's chapter.
 *
 * The schema is the contract, the reference chapter is the only example of the
 * house style that exists, and the four content files are the vocabulary — the
 * item, creature, map and biome ids a chapter is allowed to name. All four are
 * checked by the gate, so leaving any of them out would just mean spending a
 * repair round on ids that could have been supplied up front.
 */
/** Each campaign, its chapters, and the index a new one would take. */
function campaigns(): string[] {
  const dir = path.join(ROOT, "content", "campaigns");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const campaign = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as {
        id?: string;
        title?: string;
        chapters?: string[];
      };
      const listed = campaign.chapters ?? [];
      return (
        `- \`${campaign.id ?? name}\` (${campaign.title ?? "untitled"}) — ` +
        `${listed.length === 0 ? "no chapters yet" : `chapters so far: ${listed.join(", ")}`}. ` +
        `A new chapter here takes \`"index": ${String(listed.length + 1)}\`.`
      );
    });
}

function corpus(): string {
  const reference = fs
    .readdirSync(path.join(ROOT, "content", "chapters"))
    .filter((name) => name.endsWith(".json"))
    .sort()[0];

  const maps = fs
    .readdirSync(path.join(ROOT, "content", "maps"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""));

  const manifest = JSON.parse(read("assets", "manifest.json")) as { biomes?: unknown };

  return [
    "## The schema a chapter must satisfy",
    "",
    "```json",
    read("schemas", "chapter.schema.json"),
    "```",
    "",
    "## The rules of the game",
    "",
    "```json",
    read("content", "rules.json"),
    "```",
    "",
    "## The item catalog — a chapter may only name these `itemId`s",
    "",
    "```json",
    read("content", "items.json"),
    "```",
    "",
    "## The bestiary — an encounter's `creature` must be one of these keys",
    "",
    "```json",
    read("content", "bestiary.json"),
    "```",
    "",
    "## Encounter maps — an encounter scene's `map` must be one of these",
    "",
    "```",
    maps.join("\n"),
    "```",
    "",
    "## Biomes — `biome` must be one of these",
    "",
    "```json",
    JSON.stringify(manifest.biomes ?? null, null, 2),
    "```",
    "",
    /*
     * The campaigns, with the next free index spelled out. A chapter belongs to
     * a campaign whose chapters are indexed 1..n with no gaps, and the gate
     * checks it — so getting this wrong is a whole repair round spent on one
     * integer that could simply have been stated.
     */
    "## Campaigns — `campaignId` must be one of these, and `index` the next free one",
    "",
    ...campaigns(),
    "",
    reference === undefined
      ? ""
      : [
          `## The reference chapter (\`content/chapters/${reference}\`)`,
          "",
          "This is the house style. Match its voice, its scene sizes, and the way it",
          "uses species-gated choices, checks, and flags.",
          "",
          "```json",
          read("content", "chapters", reference),
          "```",
        ].join("\n"),
  ].join("\n");
}

/**
 * The system prompt.
 *
 * Written as constraints and context rather than as a procedure. The model is
 * good at writing a scene graph; what it cannot know is who is at the table, and
 * that is what most of this says.
 */
function systemPrompt(): string {
  return [
    "You are writing a chapter for Kids & Dragons: a tabletop-style adventure played by",
    "three people — two adults and an eight-year-old — on a TV with phones as controllers.",
    "A chapter is one JSON file, played in about half an hour.",
    "",
    "What the audience means for what you write:",
    "",
    "- **Nobody dies.** A lost fight branches the story (`onDefeat`), it does not end it.",
    "  A failed check is a different scene, not a retry. There is no game over anywhere.",
    "- She taps, she does not type. Every choice is a labelled button with an icon.",
    "- Vocabulary for an eight-year-old. Warm and playful; never grim, never cute-to-the-point",
    "  of-condescending. Read every line as though it will be spoken aloud by a text-to-speech",
    "  voice on a television, because it will be.",
    "- Give each of the six species something only they can do. A species-gated choice is",
    "  *hidden* from a party that does not match it, never greyed out — so a scene whose every",
    "  choice is gated is a dead end for somebody, and the build will refuse it.",
    "- Three players. An encounter is 2–4 enemies and should resolve in about four rounds.",
    "",
    "Structure:",
    "",
    "- Around 20–25 scenes. Branch early, converge before the end; a chapter that is one",
    "  straight line is not worth the format, and one that never converges is unwritable.",
    "- Every scene must be reachable from `entry`, and every scene must be able to reach an",
    "  ending. An ending is a scene with an empty `choices` array.",
    "- Bonus objectives ride on flags: author a `setFlag` effect wherever the thing happens,",
    "  and point the objective's `flag` at it. Their XP totals no more than 25% of `xpAward`.",
    "",
    "Reply with the complete chapter JSON and nothing else — no commentary, no explanation.",
    "",
    corpus(),
  ].join("\n");
}

interface Options {
  brief: string;
  attempts: number;
  out: string | null;
  write: boolean;
}

function parseArgs(argv: string[]): Options | string {
  const rest: string[] = [];
  let attempts = DEFAULT_ATTEMPTS;
  let out: string | null = null;
  let write = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--attempts") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) return "--attempts takes a positive integer";
      attempts = value;
    } else if (arg === "--out") {
      out = argv[++i] ?? null;
      if (out === null) return "--out takes a path";
    } else if (arg === "--dry-run") {
      write = false;
    } else if (arg !== undefined) {
      rest.push(arg);
    }
  }

  const brief = rest.join(" ").trim();
  if (brief.length === 0) {
    return [
      "Usage: npm run content:generate -- \"<what the chapter is about>\"",
      "",
      "  --attempts N   how many times to ask (default " + String(DEFAULT_ATTEMPTS) + "; after the first, each",
      "                 attempt carries the build gate's complaints about the last one)",
      "  --out PATH     where to write it (default content/chapters/<id>.json)",
      "  --dry-run      generate and check, but write nothing",
      "",
      "Needs ANTHROPIC_API_KEY, or an `ant auth login` profile.",
    ].join("\n");
  }

  return { brief, attempts, out, write };
}

// --- Run ---------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));
if (typeof options === "string") {
  console.log(options);
  process.exit(1);
}

console.log(`${BOLD}Kids & Dragons — chapter generator${OFF}`);
console.log(`${DIM}${MODEL} · up to ${String(options.attempts)} attempt(s) against the real build gate${OFF}\n`);

/*
 * The baseline check, before spending a single token. Every failure the staging
 * run reports has to be the candidate's, and that is only true if the tree it is
 * staged into is green — otherwise the model spends its repair rounds trying to
 * fix content it did not write.
 */
const baseline = baselineIsClean();
if (!baseline.ok) {
  console.log(`${RED}The content tree is already failing \`npm run content:validate\`.${OFF}`);
  console.log(`${DIM}Fix that first — otherwise its failures get reported as problems with the new chapter.${OFF}\n`);
  for (const problem of baseline.problems) console.log(`  ${RED}${problem}${OFF}`);
  process.exit(1);
}

const client = new Anthropic();
const system = systemPrompt();

/**
 * One turn of the model.
 *
 * Streaming because a chapter is tens of thousands of tokens and a non-streaming
 * request that large risks an HTTP timeout. Effort is high because the work is a
 * constraint-satisfaction problem over a whole graph, and a cheaper answer costs
 * more in repair rounds than it saves.
 *
 * The system prompt carries a cache breakpoint and nothing volatile: the schema,
 * the rules, the catalogs and the reference chapter are byte-identical on every
 * attempt, so each repair round reads the prefix instead of paying for it again.
 */
async function ask(turns: Turn[]): Promise<string> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "high" },
    messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("The model declined the request. Try rewording the brief.");
  }
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

const result = await generateChapter({
  brief: options.brief,
  ask,
  check: (candidate) => Promise.resolve(checkCandidate(candidate)),
  maxAttempts: options.attempts,
  log: (line) => {
    console.log(`  ${DIM}${line}${OFF}`);
  },
});

console.log("");

if (result.problems.length > 0 || result.chapter === null) {
  console.log(`${RED}Gave up after ${String(result.attempts)} attempt(s).${OFF} Still wrong:\n`);
  for (const problem of result.problems) console.log(`  ${RED}${problem}${OFF}`);
  if (result.chapter !== null && options.write) {
    /*
     * The last candidate is kept even though it failed. Four rounds of a large
     * model is not a thing to throw away because it was one `goto` short, and
     * the fastest path from here is usually an author reading it.
     *
     * Written to `.generated/`, never to `content/chapters/`. The validator
     * reads every `*.json` under that directory, so a rejected draft parked
     * there would fail the build — the generator would leave the repo red as
     * the price of not losing your work.
     */
    const id = chapterIdOf(result.chapter) ?? "chapter";
    const dir = path.join(ROOT, ".generated");
    fs.mkdirSync(dir, { recursive: true });
    const rejected = path.join(dir, `${id}.rejected.json`);
    fs.writeFileSync(rejected, `${JSON.stringify(result.chapter, null, 2)}\n`, "utf8");
    console.log(`\n${DIM}Last candidate: ${path.relative(ROOT, rejected)}${OFF}`);
  }
  process.exit(1);
}

const id = chapterIdOf(result.chapter) ?? "chapter";
const destination = options.out ?? path.join(ROOT, "content", "chapters", `${id}.json`);

console.log(
  `${GREEN}Clean on attempt ${String(result.attempts)}${OFF} — it passes the same gate CI runs.`,
);

if (!options.write) {
  console.log(`${DIM}--dry-run: nothing written.${OFF}`);
  process.exit(0);
}

fs.writeFileSync(destination, `${JSON.stringify(result.chapter, null, 2)}\n`, "utf8");
console.log(`${DIM}Wrote ${path.relative(ROOT, destination)}${OFF}`);
console.log(
  [
    "",
    "It validates. It is not finished:",
    `  ${DIM}npm run content:graph${OFF}    look at the shape of it`,
    `  ${DIM}npm run content:balance${OFF}  see what its fights cost`,
    `  ${DIM}npm run dev${OFF}              play it — the Playtest drawer jumps to any scene`,
    "",
    `${DIM}A chapter no campaign lists is unreachable in play — add "${id}" to a campaign's`,
    `chapters array when you are happy with it.${OFF}`,
  ].join("\n"),
);
