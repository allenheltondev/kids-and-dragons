#!/usr/bin/env node
/**
 * The campaign journey inspector — `npm run content:journey`. (#202)
 *
 *   npm run content:journey -- --campaign rift-sampler                  # outline, findings, coverage
 *   npm run content:journey -- --campaign rift-sampler --format mermaid # a diagram to paste into a PR
 *   npm run content:journey -- --campaign path/to/x.campaign.json --format dot
 *   npm run content:journey -- --campaign rift-sampler --format json    # everything, for scripts
 *   npm run content:journey -- --campaign rift-sampler --playtest       # drive the real runtime
 *   npm run content:journey -- --campaign rift-sampler --walk random --seed 7 --runs 50
 *   npm run content:journey -- --campaign rift-sampler --path to-orchard,orchard-to-mill:setback
 *   npm run content:journey -- --campaign rift-sampler --save saved-journey.json
 *   npm run content:journey -- --all                                    # every graph campaign
 *
 * `--campaign` takes a file or an id (looked up among the fixtures in
 * packages/shared/src/fixtures, then content/campaigns). Fixtures need no
 * chapter files: their chapters are placeholders, which the explorer reads as
 * "may write any flag", the same conservative reading `content:validate` gives
 * a chapter that did not load.
 *
 * What it does and does not do is the doc's ("Inspection and playtest
 * tooling (#202)" in docs/campaigns/graph-campaigns.md). In short: it reads the
 * explorer behind the lint, so it can say where a party can and cannot go; and
 * it drives the runtime, so it can say whether the runtime keeps its promises
 * while they do. It never writes anything.
 *
 * Exit status: 1 when the lint finds an error, a playtest breaks an invariant,
 * or a checked save is broken; 0 otherwise. A diagram format prints the diagram
 * and nothing else, so the output pipes straight into a file.
 *
 * An ordered campaign (no `graph`) is skipped, not an error: Gemfall and the
 * Hollow Crown have no places-and-doors to inspect, and this tool does not touch
 * how they load or play (`content:continuity` and `content:validate` own them).
 */

import fs from "node:fs";
import process from "node:process";
import { lintCampaignGraph } from "@kad/shared";
import type { GraphFinding } from "@kad/shared";
import {
  campaignFiles,
  chapterFlagsFrom,
  isGraphSubject,
  loadChapters,
  outline,
  readSubject,
  resolveCampaign,
  toDot,
  toMermaid,
  toSummary,
} from "./journey-graph.ts";
import type { GraphSubject } from "./journey-graph.ts";
import { exploreRoutes, playtest } from "./journey-explore.ts";
import type { PlaytestReport, RouteCoverage } from "./journey-explore.ts";
import { checkJourneySave } from "./journey-save.ts";
import type { SaveCheck } from "./journey-save.ts";

const tty = process.stdout.isTTY;
const RED = tty ? "\u001b[31m" : "";
const GREEN = tty ? "\u001b[32m" : "";
const YELLOW = tty ? "\u001b[33m" : "";
const DIM = tty ? "\u001b[2m" : "";
const BOLD = tty ? "\u001b[1m" : "";
const OFF = tty ? "\u001b[0m" : "";

type Format = "text" | "mermaid" | "dot" | "json";

interface Args {
  campaign?: string;
  all: boolean;
  format: Format;
  walk?: "random" | "replay" | "all";
  seed: number;
  runs: number;
  paths: string[][];
  save?: string;
  maxSteps?: number;
  maxStates?: number;
  help: boolean;
}

const USAGE = `usage: npm run content:journey -- (--campaign <file-or-id> | --all) [options]
  --format text|mermaid|dot|json   output (default text)
  --playtest                       replay the explorer's paths and 25 seeded random walks through the runtime
  --walk random|replay|all         choose the playtest strategy (random uses --seed and --runs)
  --seed N  --runs K               random walks (defaults 1 and 25)
  --path a,b,c                     one scripted walk; edge:setback plays the chapter before that exit as a setback
  --save file.json                 check a stored journey against the campaign
  --max-steps N  --max-states N    bounds for a walk / for the explorer`;

function parseArgs(argv: string[]): Args | string {
  const args: Args = { all: false, format: "text", seed: 1, runs: 25, paths: [], help: false };
  const need = (i: number, flag: string): string => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    return value;
  };
  const whole = (value: string, flag: string): number => {
    if (!/^\d+$/.test(value)) throw new Error(`${flag} needs a whole number, got "${value}"`);
    return Number(value);
  };
  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]!;
      switch (arg) {
        case "--campaign": args.campaign = need(i, arg); i += 1; break;
        case "--all": args.all = true; break;
        case "--format": {
          const value = need(i, arg);
          if (!["text", "mermaid", "dot", "json"].includes(value)) throw new Error(`--format is text, mermaid, dot or json, not "${value}"`);
          args.format = value as Format;
          i += 1;
          break;
        }
        case "--playtest": args.walk = "all"; break;
        case "--walk": {
          const value = need(i, arg);
          if (!["random", "replay", "all"].includes(value)) throw new Error(`--walk is random, replay or all, not "${value}"`);
          args.walk = value as Args["walk"];
          i += 1;
          break;
        }
        case "--seed": args.seed = whole(need(i, arg), arg); i += 1; break;
        case "--runs": args.runs = whole(need(i, arg), arg); i += 1; break;
        case "--path": args.paths.push(need(i, arg).split(",").filter((each) => each !== "")); i += 1; break;
        case "--save": args.save = need(i, arg); i += 1; break;
        case "--max-steps": args.maxSteps = whole(need(i, arg), arg); i += 1; break;
        case "--max-states": args.maxStates = whole(need(i, arg), arg); i += 1; break;
        case "--help":
        case "-h": args.help = true; break;
        default: throw new Error(`unknown option ${arg}`);
      }
    }
  } catch (error) {
    return (error as Error).message;
  }
  return args;
}

// ---------------------------------------------------------------------------
// One campaign
// ---------------------------------------------------------------------------

interface Inspection {
  subject: GraphSubject;
  findings: GraphFinding[];
  search: { states: number; complete: boolean };
  coverage: RouteCoverage;
  playtest?: PlaytestReport;
  save?: SaveCheck;
}

function inspect(subject: GraphSubject & { graph: NonNullable<GraphSubject["graph"]> }, args: Args): Inspection {
  const chapters = loadChapters();
  const options = {
    chapterFlags: chapterFlagsFrom(chapters),
    routeSets: subject.campaign.routeSets,
    ...(args.maxStates === undefined ? {} : { maxStates: args.maxStates }),
  };
  const { findings, search: stats } = lintCampaignGraph(subject.graph, options);
  const { search, coverage } = exploreRoutes(subject.graph, options);

  const wantRandom = args.walk === "random" || args.walk === "all";
  const wantReplay = args.walk === "replay" || args.walk === "all";
  const report =
    args.walk !== undefined || args.paths.length > 0
      ? playtest(subject.graph, subject.campaign, {
          chapterFlags: options.chapterFlags,
          ...(args.maxSteps === undefined ? {} : { maxSteps: args.maxSteps }),
          paths: args.paths,
          ...(wantRandom ? { random: { seed: args.seed, runs: args.runs } } : {}),
          ...(wantReplay ? { replay: { search, coverage } } : {}),
        })
      : undefined;

  const save =
    args.save === undefined
      ? undefined
      : checkJourneySave(subject.graph, JSON.parse(fs.readFileSync(args.save, "utf8")) as unknown);
  return { subject, findings, search: stats, coverage, ...(report ? { playtest: report } : {}), ...(save ? { save } : {}) };
}

const failed = (result: Inspection): boolean =>
  result.findings.some((finding) => finding.severity === "error") ||
  (result.playtest?.violations.length ?? 0) > 0 ||
  (result.save?.issues.some((issue) => issue.severity === "error") ?? false);

function printText(result: Inspection): void {
  const { subject, coverage } = result;
  const graph = subject.graph!;
  console.log(`${BOLD}${subject.file}${OFF}`);
  console.log(outline(subject.campaign, graph));

  console.log(`\n${BOLD}Lint${OFF}`);
  if (result.findings.length === 0) console.log(`  ${GREEN}clean${OFF}`);
  for (const finding of result.findings) {
    const colour = finding.severity === "error" ? RED : YELLOW;
    console.log(`  ${colour}${finding.severity.padEnd(7)}${OFF} ${finding.code}  ${finding.path}\n          ${finding.message}\n          ${DIM}${finding.hint}${OFF}`);
  }

  console.log(`\n${BOLD}Route coverage${OFF}  ${DIM}(${coverage.states} state(s) explored${coverage.complete ? "" : ", TRUNCATED: the answers below are partial"})${OFF}`);
  const entered = coverage.nodes.filter((node) => node.entered).length;
  const taken = coverage.edges.filter((edge) => edge.traversable).length;
  console.log(`  nodes   ${entered}/${coverage.nodes.length} entered by some playthrough`);
  console.log(`  edges   ${taken}/${coverage.edges.length} traversable`);
  console.log(`  endings ${coverage.endingsReached}/${coverage.endings.length} reachable`);
  if (coverage.unreachableNodes.length > 0) console.log(`  ${RED}unreachable (no chain of edges):${OFF} ${coverage.unreachableNodes.join(", ")}`);
  if (coverage.neverEntered.length > 0) console.log(`  ${RED}never entered (edges exist, every one is shut when the party could use it):${OFF} ${coverage.neverEntered.join(", ")}`);
  for (const ending of coverage.endings) {
    console.log(`  ending ${ending.id}: ${ending.shortest ? `${ending.shortest.edges.length} step(s): ${ending.shortest.text}` : `${RED}not reachable${OFF}`}`);
  }
  for (const edge of coverage.edges.filter((each) => !each.traversable)) {
    console.log(`  ${YELLOW}edge ${edge.id} is never traversable${OFF}`);
  }
  if (coverage.consumed.length > 0) {
    console.log(`  used-up links (${coverage.consumed.length}):`);
    for (const link of coverage.consumed) {
      console.log(`    ${link.edge}  ${link.reason}  in ${link.states} state(s); ${link.stillWinnable ? "an ending stays reachable" : `${RED}an ending is NOT always reachable afterwards${OFF}`}`);
      console.log(`      ${DIM}first used up: ${link.firstSpent.text}${OFF}`);
    }
  }
  if (coverage.noEndingWinnable) console.log(`  ${RED}no playthrough reaches an ending${OFF}`);
  if (coverage.softlocks.length === 0) console.log(`  softlocks: ${GREEN}none${OFF}`);
  for (const lock of coverage.softlocks) {
    console.log(`  ${RED}softlock (${lock.kind}) at ${lock.node}${OFF}: ${lock.path.text}`);
    for (const block of lock.blocks) console.log(`      ${block.edge}: ${block.reason}`);
  }

  if (result.playtest) {
    const report = result.playtest;
    const graphCovered = report.covered;
    console.log(`\n${BOLD}Playtest${OFF}  ${DIM}(${report.walks.length} walk(s) through the real runtime)${OFF}`);
    console.log(`  covered ${graphCovered.nodes.length}/${graph.nodeOrder.length} nodes, ${graphCovered.edges.length}/${graph.edgeOrder.length} edges, ${graphCovered.endings.length}/${graph.endings.length} endings`);
    if (report.violations.length === 0) console.log(`  invariants: ${GREEN}all held${OFF}`);
    for (const violation of report.violations.slice(0, 20)) {
      console.log(`  ${RED}${violation.code}${OFF} in ${violation.walk} at step ${violation.step}: ${violation.message}`);
      console.log(`      ${DIM}${violation.trail.join(" ")}${OFF}`);
    }
    if (report.violations.length > 20) console.log(`  ... and ${report.violations.length - 20} more`);
  }

  if (result.save) {
    console.log(`\n${BOLD}Save check${OFF}  ${result.save.verdict === "ok" ? GREEN : RED}${result.save.verdict}${OFF}${result.save.loadable ? "" : "  (the server would refuse to load it)"}`);
    for (const issue of result.save.issues) {
      console.log(`  ${issue.severity === "error" ? RED : YELLOW}${issue.severity.padEnd(7)}${OFF} ${issue.class}  ${issue.path || "/"}  ${issue.message}`);
    }
  }
}

function jsonOf(result: Inspection): unknown {
  const graph = result.subject.graph!;
  return {
    file: result.subject.file,
    graph: toSummary(result.subject.campaign, graph),
    findings: result.findings,
    search: result.search,
    coverage: result.coverage,
    ...(result.playtest
      ? {
          playtest: {
            walks: result.playtest.walks.map(({ walk, steps, ended, at }) => ({ walk, steps, ended, at })),
            covered: result.playtest.covered,
            violations: result.playtest.violations,
          },
        }
      : {}),
    ...(result.save ? { save: result.save } : {}),
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(`${args}\n${USAGE}`);
    return 2;
  }
  if (args.help || (args.campaign === undefined && !args.all)) {
    console.log(USAGE);
    return args.help ? 0 : 2;
  }

  let files: string[];
  if (args.all) {
    const { fixtures, content } = campaignFiles();
    files = [...fixtures, ...content];
  } else {
    const file = resolveCampaign(args.campaign!);
    if (!file) {
      console.error(`no campaign "${args.campaign}": not a file, and no fixture or content campaign has that id or name`);
      return 2;
    }
    files = [file];
  }

  let status = 0;
  const jsons: unknown[] = [];
  for (const file of files) {
    const subject = readSubject(file);
    if (!isGraphSubject(subject)) {
      if (subject.problems.length > 0) {
        console.error(`${subject.file}: the graph declaration has ${subject.problems.length} problem(s); run npm run content:validate`);
        for (const { path, problem } of subject.problems) console.error(`  ${path}: ${problem}`);
        status = 1;
      } else if (args.format === "text") {
        console.log(`${DIM}${subject.file}: ordered campaign (no graph), skipped${OFF}`);
      }
      continue;
    }
    if (args.format === "mermaid" || args.format === "dot") {
      console.log(args.format === "mermaid" ? toMermaid(subject.campaign, subject.graph) : toDot(subject.campaign, subject.graph));
      continue;
    }
    const result = inspect(subject, args);
    if (failed(result)) status = 1;
    if (args.format === "json") jsons.push(jsonOf(result));
    else {
      printText(result);
      console.log("");
    }
  }
  if (args.format === "json") console.log(JSON.stringify(jsons.length === 1 ? jsons[0] : jsons, null, 2));
  return status;
}

process.exitCode = main();
