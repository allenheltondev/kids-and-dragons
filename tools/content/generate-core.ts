/**
 * The chapter generator's loop — pure, and therefore testable without a key.
 *
 * Roadmap chapter 6: "CLI chapter generator using `claude-opus-5`: prompt →
 * chapter JSON → schema validation." The three arrows are the whole design, and
 * the middle one is the least interesting part.
 *
 * ---------------------------------------------------------------------------
 * THE LOOP IS THE PRODUCT, NOT THE PROMPT
 *
 * A chapter is a 25-scene graph against an 850-line schema, with cross-file
 * rules a schema cannot express — every `goto` resolving, every scene reachable,
 * every scene reaching an ending, every `itemId` in the catalog, every objective
 * flag actually set by some effect, the bonus XP under §8.2's 25% cap. A
 * first draft of that will have mistakes. So will a second one, from a person.
 *
 * What this project already has is a **gate that knows all of those rules** and
 * prints them in sentences aimed at whoever has to fix the chapter
 * (`tools/content/validate.mjs`). The generator's job is to put the model on the
 * inside of that loop: generate, run the real gate, hand back its exact
 * complaints, repeat. Nothing here re-implements a rule, and nothing here can
 * emit a chapter the build would reject — the loop only stops when the gate is
 * green.
 *
 * That is also why this file has no Anthropic SDK import and no fetch. `ask` and
 * `check` are injected, so the loop's behaviour — how it feeds problems back,
 * when it gives up, what it does with an unparseable answer — is checked by
 * `generate-core.test.ts` against fakes, in CI, with no API key and no network.
 * `generate.ts` is the thin wiring that supplies the real two.
 */

/** One turn of the conversation, in the shape the Messages API takes. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateInput {
  /** What the author asked for, in their own words. */
  brief: string;
  /** Sends the conversation and returns the model's text. */
  ask: (turns: Turn[]) => Promise<string>;
  /**
   * The gate. Returns the problems with a candidate chapter — empty means it
   * would pass the build.
   *
   * Takes `unknown` rather than `Chapter` on purpose: the thing being checked is
   * a parsed blob from a language model, and typing it as a valid chapter before
   * anything has validated it would be the lie the whole loop exists to catch.
   */
  check: (candidate: unknown) => Promise<string[]>;
  /**
   * How many times to ask. Attempts after the first are repairs, and each one
   * carries the previous answer plus the gate's complaints about it.
   */
  maxAttempts?: number;
  /** Progress, for a human watching a CLI. */
  log?: (line: string) => void;
}

export interface GenerateResult {
  /** The chapter, or null if it never passed. */
  chapter: unknown | null;
  /** How many times the model was asked. */
  attempts: number;
  /** What was still wrong when it gave up. Empty on success. */
  problems: string[];
  /** The whole conversation, for a `--transcript` flag or a bug report. */
  turns: Turn[];
}

/** Attempts after the first are repairs; three is two repairs. */
export const DEFAULT_ATTEMPTS = 4;

/**
 * Pulls the chapter object out of a reply.
 *
 * Models fence JSON in ```json blocks about as often as they don't, and a
 * generator that failed on the fence would burn a repair round on formatting
 * rather than on the chapter. Both shapes are accepted; anything else comes back
 * as a problem the model can act on rather than as a thrown error.
 */
export function readChapter(reply: string): { chapter: unknown } | { problem: string } {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(reply);
  const body = (fenced?.[1] ?? reply).trim();

  // The brace-to-brace slice handles a reply with prose either side of an
  // unfenced object, which is the other common shape.
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { problem: "The reply contained no JSON object. Reply with the chapter JSON and nothing else." };
  }

  try {
    return { chapter: JSON.parse(body.slice(start, end + 1)) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { problem: `The JSON did not parse: ${detail}` };
  }
}

/**
 * The repair turn — the gate's own words, handed back unedited.
 *
 * Deliberately not summarised or reworded. `validate.mjs` writes its failures
 * for whoever has to fix the chapter ("did you mean: scene_shrine?", "flags set
 * here: ..."), and those hints are the most useful thing in the loop. Rewriting
 * them into a terser form would throw away the part that does the work.
 */
export function repairTurn(problems: string[]): string {
  return [
    "That chapter does not pass `npm run content:validate`. The build gate reported:",
    "",
    ...problems.map((problem) => `  ${problem}`),
    "",
    "Fix every one of them and reply with the complete corrected chapter JSON.",
    "Do not reply with a patch or a description of the change — reply with the whole file.",
  ].join("\n");
}

/**
 * Generate, check, repair, until it passes or the attempts run out.
 *
 * Returns rather than throws when it fails. An author who has spent four rounds
 * of a large model on a chapter wants to see the last candidate and what was
 * still wrong with it — throwing would leave them with a stack trace and
 * nothing to read.
 */
export async function generateChapter(input: GenerateInput): Promise<GenerateResult> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_ATTEMPTS);
  const log = input.log ?? (() => undefined);

  const turns: Turn[] = [{ role: "user", content: input.brief }];
  let problems: string[] = [];
  let chapter: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log(attempt === 1 ? "Writing the chapter…" : `Repairing (attempt ${String(attempt)})…`);

    const reply = await input.ask(turns);
    turns.push({ role: "assistant", content: reply });

    const parsed = readChapter(reply);
    if ("problem" in parsed) {
      // A reply that is not a chapter is not a chapter the gate can check, so
      // this stands in for its output and the loop is otherwise identical.
      problems = [parsed.problem];
      chapter = null;
    } else {
      chapter = parsed.chapter;
      problems = await input.check(chapter);
      if (problems.length === 0) {
        log(`Clean on attempt ${String(attempt)}.`);
        return { chapter, attempts: attempt, problems: [], turns };
      }
    }

    log(`${String(problems.length)} problem${problems.length === 1 ? "" : "s"}.`);
    if (attempt < maxAttempts) turns.push({ role: "user", content: repairTurn(problems) });
  }

  return { chapter, attempts: maxAttempts, problems, turns };
}
