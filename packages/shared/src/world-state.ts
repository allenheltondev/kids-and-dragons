/**
 * Graph campaigns — world state (#198).
 *
 * A graph campaign can declare **world facts** (`CampaignGraph.facts`): typed,
 * bounded values the journey carries beside its flags — a village standing,
 * displaced or restored; a wyrm sleeping, raging or cleared; favours owed to
 * the river folk, nought to three. Edges and nodes' `onComplete` rules write
 * them (`setFact`, `adjustFact`), guards and variants read them
 * (`GraphCondition.facts`), and the attempt stores what has been written
 * (`JourneyFacts.facts`). docs/campaigns/graph-campaigns.md, "World state",
 * is the contract; this file is the arithmetic of one fact — what a stored
 * value reads as, what a test admits, what a write leaves — so that the
 * runtime (`journey.ts`), the guard reader (`campaign-graph.ts`), the lint
 * (`campaign-graph-lint.ts`) and the screens cannot disagree about it.
 *
 * ---------------------------------------------------------------------------
 * WHY A FACT ALWAYS READS THROUGH ITS DECLARATION
 *
 * A save outlives the content it was made against. An author renames a
 * state, narrows a counter, drops a fact; a party saved last week still has
 * the old value on its row. Reading the stored value raw would hand a guard a
 * state the declaration says cannot exist, and the guard's answer would be a
 * guess. So every read goes through `readFact`, which has exactly one answer
 * for every stored value — the value itself when the declaration admits it,
 * the declared `initial` when it does not, a counter clamped into its
 * (possibly narrowed) bounds — and an absent value is simply the `initial`.
 * That one rule is what makes "a journey saved before #198" and "a fact added
 * after the party set out" need no migration at all.
 *
 * ---------------------------------------------------------------------------
 * WHY IMPORT-FREE
 *
 * `campaign-graph.ts` imports this, and tools/content/validate.mjs loads that
 * file (and the lint) straight under Node, which strips types but resolves no
 * `.js`-for-`.ts` specifiers. Type imports only, so the chain stays loadable.
 *
 * Nothing here writes anywhere but into the values it returns: a fact lives on
 * one attempt's journey, and the declarations it is read through are content —
 * shared by every household, and never mutated.
 */

import type {
  CounterFact,
  FactDomain,
  FactId,
  FactTest,
  FactValue,
  GraphEffect,
  JourneyFacts,
  WorldFact,
} from "./types/campaign-graph.js";

/** Every `WorldFact.domain`, in the order the tools group them. */
export const FACT_DOMAINS: readonly FactDomain[] = ["locale", "threat", "alliance", "route", "consequence"];

/**
 * The widest a counter may be (`max - min`). A counter is bounded so the lint
 * can enumerate it; this keeps the enumeration small enough that a handful of
 * counters do not, multiplied together, exhaust the search's state cap. A
 * world fact is a story state, not a score — twenty steps is already a lot.
 */
export const MAX_COUNTER_SPAN = 20;

/** The most states an enum fact may have, for the same reason. */
export const MAX_ENUM_VALUES = 12;

/** The effects that write a world fact. */
export type FactEffect = Extract<GraphEffect, { type: "setFact" | "adjustFact" }>;

/** One thing wrong with a fact's declaration, test or write, at a pointer suffix. */
export interface FactProblem {
  /** Relative to whatever holds it: `""`, `/values`, `/in/1`. */
  path: string;
  problem: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const clamp = (fact: CounterFact, value: number): number => Math.min(fact.max, Math.max(fact.min, value));

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The value a fact has before anything writes it. */
export function initialFact(fact: WorldFact): FactValue {
  return fact.type === "flag" ? fact.initial === true : fact.initial;
}

/**
 * What a stored value reads as, through its declaration — the one rule every
 * reader applies (see the file comment):
 *
 * - absent → `initial`;
 * - an enum member the declaration lists → itself; anything else → `initial`;
 * - an integer for a counter → itself, **clamped** into `[min, max]` (a save
 *   made before the bounds narrowed keeps as much of its meaning as fits);
 *   anything else → `initial`;
 * - a boolean for a flag → itself; anything else → `initial`.
 */
export function readFact(fact: WorldFact, raw: unknown): FactValue {
  switch (fact.type) {
    case "enum":
      return typeof raw === "string" && fact.values.includes(raw) ? raw : fact.initial;
    case "counter":
      return isInteger(raw) ? clamp(fact, raw) : fact.initial;
    case "flag":
      return typeof raw === "boolean" ? raw : fact.initial === true;
  }
}

/** The stored facts of a journey, or none when what is stored is not a record. */
export function storedFacts(journey: JourneyFacts): Readonly<Record<FactId, unknown>> {
  return isRecord(journey.facts) ? journey.facts : {};
}

/**
 * Every declared fact's current value, in authored order. Ids stored on the
 * journey that the declaration does not have are ignored — content can drop a
 * fact under a save, and a later build may know facts this one does not.
 */
export function worldFacts(
  facts: Readonly<Record<FactId, WorldFact>>,
  journey: JourneyFacts,
): Record<FactId, FactValue> {
  const stored = storedFacts(journey);
  const out: Record<FactId, FactValue> = {};
  for (const [id, fact] of Object.entries(facts)) out[id] = readFact(fact, stored[id]);
  return out;
}

/** Every value a fact can hold, in order: an enum's values, a counter's range, false/true. */
export function factDomainValues(fact: WorldFact): FactValue[] {
  switch (fact.type) {
    case "enum":
      return [...fact.values];
    case "counter": {
      const out: number[] = [];
      for (let value = fact.min; value <= fact.max; value += 1) out.push(value);
      return out;
    }
    case "flag":
      return [false, true];
  }
}

// ---------------------------------------------------------------------------
// Testing
// ---------------------------------------------------------------------------

/**
 * Does `value` pass `test`? A bare value is equality; an object's keys each
 * must hold (`in`, `not`, `min`, `max`). An absent value passes nothing — a
 * reader without the declarations, holding no stored value, cannot know.
 */
export function factTestHolds(test: FactTest, value: FactValue | undefined): boolean {
  if (value === undefined) return false;
  if (!isRecord(test)) return value === test;
  if (test.in !== undefined && !(test.in as FactValue[]).includes(value)) return false;
  if (test.not !== undefined && value === test.not) return false;
  if (test.min !== undefined && !(typeof value === "number" && value >= test.min)) return false;
  if (test.max !== undefined && !(typeof value === "number" && value <= test.max)) return false;
  return true;
}

/** The values of a fact's domain that pass a test — empty means it can never hold. */
export function factTestValues(fact: WorldFact, test: FactTest): FactValue[] {
  return factDomainValues(fact).filter((value) => factTestHolds(test, value));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * The value a fact holds after an effect, from `current` (already read
 * through the declaration). `setFact` writes its value (read through the
 * declaration, so a write the parser would have refused cannot store garbage);
 * `adjustFact` moves a counter and clamps it — and leaves any other kind of
 * fact as it was.
 */
export function writeFact(fact: WorldFact, current: FactValue, effect: FactEffect): FactValue {
  if (effect.type === "setFact") return readFact(fact, effect.value);
  if (fact.type !== "counter" || !isInteger(effect.by) || typeof current !== "number") return current;
  return clamp(fact, current + effect.by);
}

// ---------------------------------------------------------------------------
// Checking (parseCampaignGraph's half)
// ---------------------------------------------------------------------------

/** Is `value` a state this fact can be in? */
function inDomain(fact: WorldFact, value: unknown): boolean {
  switch (fact.type) {
    case "enum":
      return typeof value === "string" && fact.values.includes(value);
    case "counter":
      return isInteger(value) && value >= fact.min && value <= fact.max;
    case "flag":
      return typeof value === "boolean";
  }
}

const describeDomain = (fact: WorldFact): string =>
  fact.type === "enum"
    ? `one of ${fact.values.map((value) => `"${value}"`).join(", ")}`
    : fact.type === "counter"
      ? `an integer from ${fact.min} to ${fact.max}`
      : "true or false";

/**
 * What is wrong with one fact's declaration. Total over malformed input, like
 * the parser that calls it: a wrong type is a problem, never a throw.
 */
export function factDeclarationProblems(raw: unknown): FactProblem[] {
  const problems: FactProblem[] = [];
  const fail = (path: string, problem: string) => problems.push({ path, problem });
  if (!isRecord(raw)) {
    fail("", "a world fact must be an object");
    return problems;
  }
  if (!FACT_DOMAINS.includes(raw.domain as FactDomain)) {
    fail("/domain", `domain ${JSON.stringify(raw.domain)} is not one of ${FACT_DOMAINS.join(", ")}`);
  }
  if (raw.label !== undefined && (typeof raw.label !== "string" || raw.label.length === 0)) {
    fail("/label", "label must be a non-empty string");
  }
  if (raw.visible !== undefined && raw.visible !== true) fail("/visible", "visible is true or absent");
  switch (raw.type) {
    case "enum": {
      const values = raw.values;
      if (!Array.isArray(values) || values.length < 2 || values.length > MAX_ENUM_VALUES) {
        fail("/values", `an enum fact lists 2 to ${MAX_ENUM_VALUES} values`);
        break;
      }
      if (!values.every((value) => typeof value === "string" && value.length > 0)) {
        fail("/values", "every value is a non-empty string");
        break;
      }
      if (new Set(values).size !== values.length) fail("/values", "a value is listed twice");
      if (typeof raw.initial !== "string" || !values.includes(raw.initial)) {
        fail("/initial", `initial ${JSON.stringify(raw.initial)} is not one of the fact's values`);
      }
      break;
    }
    case "counter": {
      const { min, max, initial } = raw;
      if (!isInteger(min) || !isInteger(max) || !isInteger(initial)) {
        fail("", "a counter fact needs integer min, max and initial");
        break;
      }
      if (min >= max) fail("/max", `max (${max}) must be above min (${min})`);
      else if (max - min > MAX_COUNTER_SPAN) {
        fail("/max", `a counter spans at most ${MAX_COUNTER_SPAN} (this one spans ${max - min})`);
      }
      if (initial < min || initial > max) fail("/initial", `initial ${initial} is outside ${min}..${max}`);
      break;
    }
    case "flag":
      if (raw.initial !== undefined && typeof raw.initial !== "boolean") {
        fail("/initial", "a flag fact's initial is true or false");
      }
      break;
    default:
      fail("/type", `type ${JSON.stringify(raw.type)} is not enum, counter or flag`);
  }
  return problems;
}

/**
 * What is wrong with one test of a (well-declared) fact: a key its type does
 * not take, or a value outside its domain — a test for a state the fact can
 * never be in, which is always a typo.
 */
export function factTestProblems(fact: WorldFact, test: unknown): FactProblem[] {
  const problems: FactProblem[] = [];
  const fail = (path: string, problem: string) => problems.push({ path, problem });
  if (!isRecord(test)) {
    if (!inDomain(fact, test)) fail("", `${JSON.stringify(test)} is not a value of this fact (${describeDomain(fact)})`);
    return problems;
  }
  const allowed = fact.type === "enum" ? ["in", "not"] : fact.type === "counter" ? ["in", "not", "min", "max"] : [];
  const keys = Object.keys(test);
  if (keys.length === 0) fail("", "an empty test always holds; drop it or name a value");
  for (const key of keys) {
    if (!allowed.includes(key)) {
      fail(`/${key}`, `a ${fact.type} fact's test does not take "${key}"${fact.type === "flag" ? " (test it with true or false)" : ""}`);
      continue;
    }
    const value = test[key];
    if (key === "in") {
      if (!Array.isArray(value) || value.length === 0) fail("/in", "in lists at least one value");
      else value.forEach((each, i) => {
        if (!inDomain(fact, each)) fail(`/in/${i}`, `${JSON.stringify(each)} is not a value of this fact (${describeDomain(fact)})`);
      });
    } else if (!inDomain(fact, value)) {
      fail(`/${key}`, `${JSON.stringify(value)} is not a value of this fact (${describeDomain(fact)})`);
    }
  }
  return problems;
}

/** What is wrong with a `setFact` / `adjustFact` aimed at a (well-declared) fact. */
export function factEffectProblems(fact: WorldFact, effect: FactEffect): FactProblem[] {
  if (effect.type === "setFact") {
    return inDomain(fact, effect.value)
      ? []
      : [{ path: "/value", problem: `${JSON.stringify(effect.value)} is not a value of this fact (${describeDomain(fact)})` }];
  }
  if (fact.type !== "counter") {
    return [{ path: "/type", problem: `adjustFact moves a counter, and this fact is a ${fact.type} (use setFact)` }];
  }
  return isInteger(effect.by) && effect.by !== 0
    ? []
    : [{ path: "/by", problem: "by is a non-zero integer" }];
}
