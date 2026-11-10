/**
 * Shared harness for the validate-*.test.mjs files: a copy of the real content
 * tree, one thing broken, the gate run over it. See validate-core.test.mjs for
 * why the cases break real content rather than a fixture.
 *
 * The copy is in memory. The real tree is read from disk once per test file
 * (`ContentSet.load`), each case takes a clone of it (the files are shared,
 * so a clone costs nothing), and the gate is called as a function
 * (`validateContent`). What a case reads back in `out` is the report exactly
 * as the command line prints it, so the assertions are on the same words an
 * author sees. validate-cli.test.ts spawns the real command line, to hold it
 * to printing that report and exiting on it.
 */
import { fileURLToPath } from "node:url";

import { ContentSet } from "./content-set.ts";
import { renderReport, validateContent, type Finding, type ReportEvent, type ValidateOptions } from "./validate-content.ts";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));

let real: ContentSet | null = null;

/**
 * A copy of the real tree to break: the content, the schemas that judge it,
 * and the asset manifest the biome check reads.
 */
export function copyTree(): ContentSet {
  real ??= ContentSet.load(REPO);
  return real.clone();
}

const pathOf = (parts: readonly string[]): string => parts.join("/");

/**
 * A file of the tree, parsed afresh: the caller may change what it gets.
 * Untyped on purpose: the cases reach into authored JSON of every shape to break it.
 */
export function readJson(tree: ContentSet, ...parts: string[]): any {
  return tree.readJson(pathOf(parts));
}

export function writeJson(tree: ContentSet, parts: readonly string[], value: unknown): void {
  tree.writeJson(pathOf(parts), value);
}

/** A file of the tree as text, for a case that edits it as text. */
export function readText(tree: ContentSet, ...parts: string[]): string {
  return tree.text(pathOf(parts));
}

/** Writes a file as given: text that is not JSON, or JSON a parse would not round-trip (a repeated key). */
export function writeText(tree: ContentSet, parts: readonly string[], text: string): void {
  tree.writeText(pathOf(parts), text);
}

export function removeFile(tree: ContentSet, ...parts: string[]): void {
  tree.remove(pathOf(parts));
}

export interface GateResult {
  /** The exit code the command line would give. */
  code: number;
  /** The report as the command line prints it, uncolored. */
  out: string;
  /** Every failure, structured. */
  findings: Finding[];
}

/**
 * Run the gate over `tree`. Never throws: like the process it stands in for,
 * a gate that crashes reports what it had said so far, the error, and code 1.
 *
 * `args` are the command line's: `--write-proofs` records clean graph walks
 * into `tree`. The class-place check is off, as it was for the staged trees
 * these cases used to hand the command line (its own suite turns it on).
 */
export function validate(tree: ContentSet, args: readonly string[] = [], options: ValidateOptions = {}): GateResult {
  const events: ReportEvent[] = [];
  try {
    const result = validateContent(tree, {
      classPlaces: false,
      writeProofs: args.includes("--write-proofs"),
      ...options,
      onEvent: (event) => events.push(event),
    });
    return { code: result.code, out: renderReport(result), findings: result.findings };
  } catch (error) {
    const said = renderReport({ events });
    return { code: 1, out: `${said}${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`, findings: [] };
  }
}

/** The chapter every graph case below bends, and its file name. */
export const CHAPTER = ["content", "chapters", "bramblewood-01.json"] as const;

/** Break one thing in a chapter, then run the gate. */
function withFile(parts: readonly string[], mutate: (chapter: any) => void): GateResult {
  const tree = copyTree();
  const chapter = readJson(tree, ...parts);
  mutate(chapter);
  writeJson(tree, parts, chapter);
  return validate(tree);
}

export function withChapter(mutate: (chapter: any) => void): GateResult {
  return withFile(CHAPTER, mutate);
}

export function withFirstSteps(mutate: (chapter: any) => void): GateResult {
  return withFile(["content", "chapters", "first-steps-01.json"], mutate);
}

/** The id of some scene that is not the entry — a safe thing to orphan. */
export function laterSceneOf(chapter: { entry: string; scenes: Record<string, unknown> }): string {
  const id = Object.keys(chapter.scenes).find((s) => s !== chapter.entry);
  if (!id) throw new Error("fixture: the chapter has only an entry scene");
  return id;
}
