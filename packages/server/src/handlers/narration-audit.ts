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
 *  - `counted_party`    — wording that counts a party that is not that size, at
 *    any party size: "both of you" to three, "all four of you" to two, "each of
 *    you" to one … (#165). Player-and-NPC wording is excused by
 *    `PLAYER_AND_NPC_EXCEPTIONS`.
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
/**
 * Wording that counts the party: "both of you", "the two of you", "all three of
 * you", "four of you" … (a number word, or "both"). Each states a size, which
 * must be the size of the party being shown (#165).
 */
const COUNTED_PARTY = new RegExp(
  `\\b(?:(?:all|the)\\s+)?(both|${NUMBER_WORDS.slice(1).join("|")})\\s+of\\s+you\\b`,
  "gi",
);
/** "one of you", "each of you", "neither of you" … — wording that assumes more than one player. */
const SINGULAR_ASSUMING_PARTY = /\b(?:one|each|every|all|any|either|neither|none)\s+of\s+you\b/gi;
/**
 * Expressions that read "of you" but count a player and an NPC, not the party
 * ("the goat lies down too. Neither of you says anything"). Each is matched
 * against the sentence of the hit and the one before it; a hit inside a match
 * is not counted. Add a pattern here, with the scene it comes from, rather
 * than rewording a line that is right.
 */
export const PLAYER_AND_NPC_EXCEPTIONS: readonly RegExp[] = [
  /\bthe goat lies down too\.\s+neither of you\b/i, // gemfall-05c, the failed run
  /\byou and the masks\b[^.]*\bneither of you\b/i, // gemfall-07r, scene_masks_let_be
  /\byou look at the mule\.\s+neither of you\b/i, // gemfall-07r, the failed creep
];

/** The sentence a hit is in, and the one before it. */
function sentenceWindow(text: string, at: number): string {
  const before = text.slice(0, at);
  const start = Math.max(
    0,
    before.lastIndexOf(". ", Math.max(0, before.lastIndexOf(". ") - 1)) + 1,
  );
  return text.slice(start, at + 120);
}

function partyCountOffences(line: AuditLine): string[] {
  const text = norm(line.text);
  const size = line.party.members.length;
  const why: string[] = [];
  const excused = (at: number) => {
    const window = sentenceWindow(text, at);
    return PLAYER_AND_NPC_EXCEPTIONS.some((re) => re.test(window));
  };
  for (const m of text.matchAll(COUNTED_PARTY)) {
    const said = m[1]!.toLowerCase();
    const count = said === "both" ? 2 : NUMBER_WORDS.indexOf(said) + 1;
    if (count !== size && !excused(m.index!)) {
      why.push(`"${m[0]}" (${count}) to a party of ${numberWord(size)}`);
    }
  }
  if (size === 1) {
    for (const m of text.matchAll(SINGULAR_ASSUMING_PARTY)) {
      if (!excused(m.index!)) why.push(`"${m[0]}" to a party of one`);
    }
  }
  return why;
}
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
  if (rules.has("counted_party")) for (const why of partyCountOffences(line)) add("counted_party", why);
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
          ? [scene.onVictory, scene.onDefeat, scene.onEscape, scene.onTimeout]
          : [];
    for (const branch of branches) if (branch) push(branch.goto, branch.variants);
  }
  return byScene;
}

/**
 * Scenes of `chapter` where a count-gated variant (any `when.count`, not just
 * the finale's band) held for the party and its text was composed in. This is
 * how a chapter's "the haul shows" wording is told to have reached the table.
 */
export function countVariantScenesShown(lines: readonly AuditLine[], chapter: Chapter): Set<string> {
  const reaching = variantsReaching(chapter);
  const shown = new Set<string>();
  for (const line of lines) {
    if (line.chapterId !== chapter.id || line.kind !== "narration") continue;
    for (const variant of reaching.get(line.sceneId) ?? []) {
      if (!variant.when.count || !evaluateCondition(variant.when, line.party)) continue;
      if (line.text.includes(fillTokens(variant.text, line.party))) shown.add(line.sceneId);
    }
  }
  return shown;
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
    // The Seal-Keeper is met only on some roads (a failed race check goes
    // straight to `ending_last_ring`), so the keeper is owed band text only to
    // a party that actually visited a keeper scene. The climb and the ending
    // are on every road and stay required.
    if (region === "keeper" && !keeperSeen) continue;
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
