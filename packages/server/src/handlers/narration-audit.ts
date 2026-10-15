/**
 * Narration audit (#166) — what a steered party was actually shown, and the
 * checks that say whether it was fit to read.
 *
 * The playthrough driver records every composed narration and every visible
 * choice label (`AuditLine`). `findOffenders` runs the rules over that record
 * and names the chapter, the scene and the line for each offence. It is pure
 * and has no test framework in it, so a content agent can run it on anything:
 *
 *   const run = await playCampaign(content, 3, EMPTY_HANDED);
 *   console.log(formatOffenders(findOffenders(run.lines, { facetNames })));
 *
 * Rules (each one is an `AuditRule`):
 *  - `stones_not_held`  — a great stone is named, or counted, that the party
 *    does not hold at that moment (#162/#163/#165).
 *  - `counted_party`    — wording that counts a party that is not that size:
 *    "two of you", "both of you" … (#165).
 *  - `unfilled_token`   — a `{token}` reached a player (never acceptable).
 *  - `band_text_missing` — the full collection should see its band text
 *    (variants of gemfall-08 gated on `count.min >= 5`) in the climb, at the
 *    Seal-Keeper and in the ending (#163). Needs the chapter; opt in with
 *    `options.band`.
 */

import {
  evaluateCondition,
  fillTokens,
  numberWord,
  type Chapter,
  type ChoiceParty,
  type Condition,
  type NarrationVariant,
} from "@kad/shared";

export type AuditRule = "stones_not_held" | "counted_party" | "unfilled_token" | "band_text_missing";

export interface AuditLine {
  chapterId: string;
  sceneId: string;
  /** A scene's composed narration, or one visible choice label. */
  kind: "narration" | "choice";
  text: string;
  /** The party as it was when this was shown — what conditions are tested against. */
  party: ChoiceParty;
}

export interface Offender {
  rule: AuditRule;
  chapterId: string;
  sceneId: string;
  kind: AuditLine["kind"] | "region";
  /** The offending line (or a description of what is missing). */
  line: string;
  why: string;
}

export interface AuditOptions {
  /** facet item id → display name, e.g. `facet_ford` → "The Ford Stone". */
  facetNames: Readonly<Record<string, string>>;
  /** Rules to run; default: the three that need no chapter. */
  rules?: readonly AuditRule[];
  /** Required by `band_text_missing`: the finale, as loaded. */
  band?: { chapter: Chapter };
}

/** The `facet_*` item ids and display names in an item catalog's raw JSON. */
export function facetNamesOf(
  items: Readonly<Record<string, { name?: string } | undefined>>,
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [id, def] of Object.entries(items)) {
    if (id.startsWith("facet_") && def?.name) names[id] = def.name;
  }
  return names;
}

export function heldFacets(party: ChoiceParty): Set<string> {
  const held = new Set<string>();
  for (const m of party.members) {
    for (const id of m.questItems) if (id.startsWith("facet_")) held.add(id);
    for (const e of m.inventory) if (e.itemId.startsWith("facet_")) held.add(e.itemId);
  }
  return held;
}

const norm = (text: string) => text.replace(/[‘’]/g, "'");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NUMBER_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen",
];
/** "five great stones", "nine of the stones", "three facets", "one great stone". */
const COUNTED_STONES = new RegExp(
  `\\b(${NUMBER_WORDS.join("|")}|\\d+)\\s+(?:of\\s+(?:the\\s+|your\\s+)?)?(?:great\\s+(stones?|facets?)|(stones|facets))\\b`,
  "gi",
);
const GREAT_STONE = /\bgreat[\s-]+(?:stones?|facets?)\b/i;
const COUNTED_PARTY = /\b(?:both|two|three|four)\s+of\s+you\b/i;
const TOKEN = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;

function stoneOffences(line: AuditLine, facetNames: Readonly<Record<string, string>>): string[] {
  const text = norm(line.text);
  const held = heldFacets(line.party);
  const why: string[] = [];
  for (const [id, name] of Object.entries(facetNames)) {
    if (held.has(id)) continue;
    // "The Ford Stone" is named in running text as "the Ford Stone".
    const bare = norm(name).replace(/^the\s+/i, "");
    if (new RegExp(`\\b${escape(bare)}\\b`, "i").test(text)) why.push(`names ${name}, which the party does not hold`);
  }
  if (held.size === 0 && GREAT_STONE.test(text)) why.push(`says "great stone(s)" to a party holding none`);
  for (const m of text.matchAll(COUNTED_STONES)) {
    const said = m[1]!.toLowerCase();
    if (said !== numberWord(held.size)) {
      why.push(`counts "${m[0]}" to a party holding ${numberWord(held.size)} (${[...held].join(", ") || "none"})`);
    }
  }
  return why;
}

/** Offences by one line, per rule (the cheap per-line rules). */
function lineOffences(line: AuditLine, options: AuditOptions, rules: ReadonlySet<AuditRule>): Offender[] {
  const out: Offender[] = [];
  const add = (rule: AuditRule, why: string) =>
    out.push({ rule, chapterId: line.chapterId, sceneId: line.sceneId, kind: line.kind, line: line.text, why });
  if (rules.has("stones_not_held")) for (const why of stoneOffences(line, options.facetNames)) add("stones_not_held", why);
  if (rules.has("counted_party") && line.party.members.length === 1) {
    const hit = COUNTED_PARTY.exec(line.text);
    if (hit) add("counted_party", `"${hit[0]}" to a party of one`);
  }
  if (rules.has("unfilled_token")) {
    const hit = TOKEN.exec(line.text);
    if (hit) add("unfilled_token", `${hit[0]} reached the player`);
  }
  return out;
}

// --- band text ---------------------------------------------------------------

/** Variants of a chapter gated on collecting five or more facets (the band). */
export function isBandCondition(when: Condition): boolean {
  return (when.count?.min ?? 0) >= 5;
}

export type BandRegion = "climb" | "keeper" | "ending";
export const BAND_REGIONS: readonly BandRegion[] = ["climb", "keeper", "ending"];

/**
 * Which part of the finale a scene belongs to, given whether the Seal-Keeper
 * has been met yet. The climb is everything from the tree line to the mouth
 * and the gallery; the Seal-Keeper's scenes are `scene_keeper*`; the endings
 * are `ending_*`. Scenes between (the verdict, the seal chamber) are none.
 */
export function bandRegionOf(sceneId: string, keeperSeen: boolean): BandRegion | null {
  if (sceneId.startsWith("ending_")) return "ending";
  if (sceneId.startsWith("scene_keeper")) return "keeper";
  return keeperSeen ? null : "climb";
}

/** Every variant that can colour a scene: its own, plus any branch leading to it. */
export function variantsReaching(chapter: Chapter): Map<string, NarrationVariant[]> {
  const byScene = new Map<string, NarrationVariant[]>();
  const push = (sceneId: string, variants: readonly NarrationVariant[] | undefined) => {
    if (variants?.length) byScene.set(sceneId, [...(byScene.get(sceneId) ?? []), ...variants]);
  };
  for (const [id, scene] of Object.entries(chapter.scenes)) {
    if ("variants" in scene) push(id, scene.variants);
    const branches =
      scene.type === "check"
        ? [scene.onSuccess, scene.onFailure]
        : scene.type === "encounter"
          ? [scene.onVictory, scene.onDefeat]
          : [];
    for (const branch of branches) if (branch) push(branch.goto, branch.variants);
  }
  return byScene;
}

function bandOffences(lines: readonly AuditLine[], chapter: Chapter): Offender[] {
  const out: Offender[] = [];
  const reaching = variantsReaching(chapter);
  const shown = new Set<BandRegion>();
  const available = new Set<BandRegion>();
  let keeperSeen = false;
  for (const line of lines) {
    if (line.chapterId !== chapter.id || line.kind !== "narration") continue;
    if (line.sceneId.startsWith("scene_keeper")) keeperSeen = true;
    const region = bandRegionOf(line.sceneId, keeperSeen);
    const band = (reaching.get(line.sceneId) ?? []).filter((v) => isBandCondition(v.when));
    if (region && band.length) available.add(region);
    for (const variant of band) {
      if (!evaluateCondition(variant.when, line.party)) continue;
      const text = fillTokens(variant.text, line.party);
      if (line.text.includes(text)) {
        if (region) shown.add(region);
      } else {
        out.push({
          rule: "band_text_missing",
          chapterId: line.chapterId,
          sceneId: line.sceneId,
          kind: "narration",
          line: line.text,
          why: `band text holds for this party but was not composed in: "${text.slice(0, 80)}"`,
        });
      }
    }
  }
  for (const region of BAND_REGIONS) {
    if (shown.has(region)) continue;
    out.push({
      rule: "band_text_missing",
      chapterId: chapter.id,
      sceneId: `(${region})`,
      kind: "region",
      line: "(nothing)",
      why: available.has(region)
        ? `no band text was shown in the ${region}`
        : `no scene in the ${region} has a band variant (count.min >= 5) the full collection could see`,
    });
  }
  return out;
}

// --- entry points ------------------------------------------------------------

const DEFAULT_RULES: readonly AuditRule[] = ["stones_not_held", "counted_party", "unfilled_token"];

/** Runs the rules over a recording; returns every offence, in play order. */
export function findOffenders(lines: readonly AuditLine[], options: AuditOptions): Offender[] {
  const rules = new Set<AuditRule>(options.rules ?? DEFAULT_RULES);
  const found = lines.flatMap((line) => lineOffences(line, options, rules));
  if (rules.has("band_text_missing")) {
    if (!options.band) throw new Error("band_text_missing needs options.band.chapter (gemfall-08)");
    found.push(...bandOffences(lines, options.band.chapter));
  }
  return found;
}

/** Offenders grouped by rule, as a failure message: chapter/scene: "line" — why. */
export function formatOffenders(offenders: readonly Offender[]): string {
  if (offenders.length === 0) return "no offenders";
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const o of offenders) {
    const key = `${o.rule}|${o.chapterId}|${o.sceneId}|${o.line}|${o.why}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = o.line.length > 160 ? `${o.line.slice(0, 157)}...` : o.line;
    rows.push(`  [${o.rule}] ${o.chapterId} / ${o.sceneId} (${o.kind}): "${line.replace(/\s+/g, " ")}" -- ${o.why}`);
  }
  return `${rows.length} offending line(s):\n${rows.join("\n")}`;
}
