/**
 * Static checks for `when` conditions, narration variants and text tokens
 * (#160). A malformed condition must fail the build, never the play session.
 *
 * Pure and dependency-free (type imports only), because
 * tools/content/validate.mjs loads this file directly under Node. The checks
 * that need the item catalog or the chapter's flags live in validate.mjs and
 * `validateChapter`; they walk conditions with `conditionRefs` from here.
 */

import type { Branch, Chapter, Choice, Condition, NarrationVariant, Scene } from "./types/chapter.js";

/**
 * Every token the engine fills, by name (`{facets}` -> `"facets"`); narration.ts
 * fills them. Lives here, import-free, because the validator loads this file
 * directly under Node. Any other `{name}` in authored text is an error.
 */
export const NARRATION_TOKENS = ["facets", "party"] as const;
export type NarrationToken = (typeof NARRATION_TOKENS)[number];

export interface LintProblem {
  /** JSON pointer inside the chapter, e.g. `/scenes/a/variants/0/when/count`. */
  path: string;
  problem: string;
  hint?: string;
}

export interface ConditionRef {
  path: string;
  when: Condition;
}

type Bounds = { min?: number; max?: number };

// ---------------------------------------------------------------------------
// Walking a chapter's authored text and conditions
// ---------------------------------------------------------------------------

/** Every named branch a scene has, with its JSON key. */
function branchesOf(scene: Scene): [string, Branch][] {
  const out: [string, Branch][] = [];
  const s = scene as unknown as Record<string, Branch | undefined>;
  for (const key of ["onSuccess", "onFailure", "onVictory", "onDefeat"]) {
    const branch = s[key];
    if (branch && typeof branch === "object") out.push([key, branch]);
  }
  return out;
}

/** Every variant list in the chapter, with where it hangs. */
function variantLists(chapter: Chapter): { path: string; variants: NarrationVariant[] }[] {
  const out: { path: string; variants: NarrationVariant[] }[] = [];
  for (const [id, scene] of Object.entries(chapter.scenes ?? {})) {
    const base = `/scenes/${id}`;
    const own = (scene as { variants?: NarrationVariant[] }).variants;
    if (Array.isArray(own)) out.push({ path: `${base}/variants`, variants: own });
    for (const [key, branch] of branchesOf(scene)) {
      if (Array.isArray(branch.variants)) {
        out.push({ path: `${base}/${key}/variants`, variants: branch.variants });
      }
    }
  }
  return out;
}

/** Every `Condition` in a chapter: choice gates and variant conditions. */
export function conditionRefs(chapter: Chapter): ConditionRef[] {
  const out: ConditionRef[] = [];
  for (const [id, scene] of Object.entries(chapter.scenes ?? {})) {
    const choices = (scene as { choices?: { when?: Condition }[] }).choices;
    (choices ?? []).forEach((choice, i) => {
      if (choice.when) out.push({ path: `/scenes/${id}/choices/${i}/when`, when: choice.when });
    });
  }
  for (const { path, variants } of variantLists(chapter)) {
    variants.forEach((v, i) => {
      if (v.when) out.push({ path: `${path}/${i}/when`, when: v.when });
    });
  }
  return out;
}

/** Every string a player reads that may carry `{tokens}`. */
function authoredTexts(chapter: Chapter): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const push = (path: string, text: unknown) => {
    if (typeof text === "string") out.push({ path, text });
  };
  for (const [id, scene] of Object.entries(chapter.scenes ?? {})) {
    const base = `/scenes/${id}`;
    const s = scene as unknown as { narration?: string; prompt?: string; choices?: { label?: string }[] };
    push(`${base}/narration`, s.narration);
    push(`${base}/prompt`, s.prompt);
    (s.choices ?? []).forEach((c, i) => push(`${base}/choices/${i}/label`, c.label));
    for (const [key, branch] of branchesOf(scene)) push(`${base}/${key}/narration`, branch.narration);
  }
  for (const { path, variants } of variantLists(chapter)) {
    variants.forEach((v, i) => push(`${path}/${i}/text`, v.text));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Names in `{name}` position that the engine does not fill. */
export function unknownTokens(text: string): string[] {
  const known = new Set<string>(NARRATION_TOKENS);
  const bad: string[] = [];
  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    const name = match[1] ?? "";
    if (!known.has(name) && !bad.includes(name)) bad.push(name);
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Ranges and exclusivity
// ---------------------------------------------------------------------------

function lo(b: Bounds): number {
  return b.min ?? 0;
}
function hi(b: Bounds): number {
  return b.max ?? Number.POSITIVE_INFINITY;
}
function disjoint(a: Bounds, b: Bounds): boolean {
  return hi(a) < lo(b) || hi(b) < lo(a);
}
/** A range that no number satisfies. */
function empty(b: Bounds): boolean {
  return lo(b) > hi(b);
}

const sameOf = (a: string | string[], b: string | string[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Conservative: true only when the two conditions can **never** hold at the
 * same time. False means "cannot show it", not "overlap exists". Recognised:
 * a flag against its own `notFlag`, an item against its own `notItem`,
 * disjoint `partySize` or `coins` ranges, and disjoint `count` ranges over the same `of`.
 */
export function mutuallyExclusive(a: Condition, b: Condition): boolean {
  if (a.flag !== undefined && a.flag === b.notFlag) return true;
  if (b.flag !== undefined && b.flag === a.notFlag) return true;
  if (a.item !== undefined && a.item === b.notItem) return true;
  if (b.item !== undefined && b.item === a.notItem) return true;
  if (a.partySize && b.partySize && disjoint(a.partySize, b.partySize)) return true;
  if (a.coins && b.coins && disjoint(a.coins, b.coins)) return true;
  if (a.count && b.count && sameOf(a.count.of, b.count.of) && disjoint(a.count, b.count)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The chapter-level lint
// ---------------------------------------------------------------------------

/**
 * Everything checkable without the item catalog or the chapter's flags:
 * `min` above `max`, unknown `{tokens}`, and several `replace` variants that
 * cannot be shown mutually exclusive.
 */
export function lintChapterText(chapter: Chapter): LintProblem[] {
  const problems: LintProblem[] = [];

  for (const { path, when } of conditionRefs(chapter)) {
    if (when.count && empty(when.count)) {
      problems.push({
        path: `${path}/count`,
        problem: `count min ${String(when.count.min)} is above max ${String(when.count.max)}, so it can never hold`,
      });
    }
    if (when.coins && empty(when.coins)) {
      problems.push({
        path: `${path}/coins`,
        problem: `coins min ${String(when.coins.min)} is above max ${String(when.coins.max)}, so it can never hold`,
      });
    }
    if (when.partySize && empty(when.partySize)) {
      problems.push({
        path: `${path}/partySize`,
        problem: `partySize min ${String(when.partySize.min)} is above max ${String(when.partySize.max)}, so it can never hold`,
      });
    }
  }

  for (const { path, text } of authoredTexts(chapter)) {
    for (const name of unknownTokens(text)) {
      problems.push({
        path,
        problem: `unknown token "{${name}}"`,
        hint: `the engine fills only ${NARRATION_TOKENS.map((t) => `{${t}}`).join(" and ")}; any other braces show up on the table as written`,
      });
    }
  }

  for (const { path, variants } of variantLists(chapter)) {
    const replacing = variants
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v.replace === true);
    for (let x = 0; x < replacing.length; x += 1) {
      for (let y = x + 1; y < replacing.length; y += 1) {
        const a = replacing[x];
        const b = replacing[y];
        if (!a || !b) continue;
        if (!mutuallyExclusive(a.v.when ?? {}, b.v.when ?? {})) {
          problems.push({
            path: `${path}/${b.i}`,
            problem: `replace variants ${a.i} and ${b.i} can both match, and only one can replace the base text`,
            hint: "make their conditions mutually exclusive (disjoint count or partySize ranges, or a flag against its notFlag), or drop `replace` on one",
          });
        }
      }
    }
  }

  return problems;
}

/**
 * What a choice costs that its gates do not promise the party has. A
 * `takeItem` must be backed by `requiresItem`, `when.item`, or a `when.count`
 * over exactly the same ids with `min >= 1`; a `spendCoins` by
 * `when.coins.min` at least as large as the total spent. Returns one sentence
 * per problem, empty when the choice is honest.
 */
export function unbackedCosts(choice: Choice): string[] {
  const problems: string[] = [];
  let spent = 0;
  for (const effect of choice.effects ?? []) {
    if (effect.type === "spendCoins") spent += effect.amount;
    if (effect.type !== "takeItem") continue;
    const ids = typeof effect.itemId === "string" ? [effect.itemId] : effect.itemId;
    const when = choice.when;
    const single = ids.length === 1 ? ids[0] : undefined;
    const countOf = when?.count?.of;
    const countIds = countOf === undefined ? undefined : typeof countOf === "string" ? [countOf] : countOf;
    const backed =
      (single !== undefined && (choice.requiresItem === single || when?.item === single)) ||
      (countIds !== undefined &&
        (when?.count?.min ?? 0) >= 1 &&
        !countIds.some((id) => id.endsWith("*")) &&
        countIds.length === ids.length &&
        countIds.every((id) => ids.includes(id)));
    if (!backed) {
      problems.push(
        `takes "${ids.join(" or ")}" but is not gated on holding it (requiresItem, when.item, or when.count over the same ids with min >= 1)`,
      );
    }
  }
  if (spent > 0 && (choice.when?.coins?.min ?? 0) < spent) {
    problems.push(`spends ${spent} coins but is not gated on when.coins.min >= ${spent}`);
  }
  return problems;
}
