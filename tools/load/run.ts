#!/usr/bin/env node
/**
 * Load and soak test: many rooms at once (#319). `npm run load -- --help`.
 *
 * Drives N simulated tables through the real HTTP API of a running server and
 * reports requests per second, latency percentiles per route, the rate of 429
 * and `STALE_SEQ`, and errors. It never touches the store: the base URL is the
 * only way in, so it measures what a family's phones would meet.
 *
 * Anonymous play only. Every table is a guest household that expires on its
 * own; nobody signs in, nobody is claimed, and each room is closed at the end,
 * so nothing permanent is left behind (docs/review/load-README.md).
 */

import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { makeRng } from "@kad/shared";
import { loadContent } from "../../packages/server/src/content/loader.ts";
import { Api } from "./client.ts";
import { Recorder, renderMarkdown, type Report } from "./metrics.ts";
import { Table, newTally, type OpenRoom, type Tally, type TableOptions } from "./table.ts";

export const HELP = `Load test: many rooms at once.

  npm run load -- --base-url <url> [options]

  --base-url <url>        The server to test. Default http://localhost:8787 (the dev server).
  --tables <n>            Simultaneous tables. Default 3.
  --phones <2-4>          Phones per table, host included. Default 3.
  --duration <seconds>    How long to keep tables playing. Default 60. A table that finishes
                          its session opens a new room until the time is up.
  --ramp <10,50,100>      Instead of --tables, run these table counts one after another,
                          each for --duration seconds, with --cooldown between.
  --cooldown <seconds>    Pause between ramp stages. Default 10.
  --spread <seconds>      Tables start spread over this long. Default 10.
  --think <ms>            Mean pause between a phone's taps. Default 1500.
  --heartbeat <ms>        Presence heartbeat interval. Default 20000, as a real phone's.
  --campaign <id>         Campaign the host starts. Default the-hollow-crown, whose first chapter has a fight.
  --checks <n>            Checks to roll before a session counts as played. Default 1.
  --max-steps <n>         A session gives up on its chapter after this many steps. Default 400.
  --verbose               Say why each session ended.
  --seed <text>           Seed for the script's own choices. Default load.
  --out <file>            Also write the report (Markdown) to this file.
  --strict                Exit 1 on any error, any room left open, no heartbeat sent, or no session
                          that reached a fight. This is what the CI smoke run asks for.
`;

interface Config {
  baseUrl: string;
  stages: number[];
  phones: number;
  duration: number;
  cooldown: number;
  spread: number;
  campaign: string;
  seed: string;
  out: string | undefined;
  strict: boolean;
  table: TableOptions;
}

export function parseConfig(argv: string[]): Config | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      "base-url": { type: "string", default: "http://localhost:8787" },
      tables: { type: "string", default: "3" },
      phones: { type: "string", default: "3" },
      duration: { type: "string", default: "60" },
      ramp: { type: "string" },
      cooldown: { type: "string", default: "10" },
      spread: { type: "string", default: "10" },
      think: { type: "string", default: "1500" },
      heartbeat: { type: "string", default: "20000" },
      campaign: { type: "string", default: "the-hollow-crown" },
      checks: { type: "string", default: "1" },
      "max-steps": { type: "string", default: "400" },
      verbose: { type: "boolean", default: false },
      seed: { type: "string", default: "load" },
      out: { type: "string" },
      strict: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) return null;
  const whole = (name: string, raw: string, min: number, max = Number.MAX_SAFE_INTEGER): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be a whole number from ${min} to ${max}, not "${raw}"`);
    return n;
  };
  const stages = values.ramp
    ? values.ramp.split(",").map((s) => whole("ramp", s.trim(), 1))
    : [whole("tables", values.tables!, 1)];
  return {
    baseUrl: values["base-url"]!,
    stages,
    phones: whole("phones", values.phones!, 2, 4),
    duration: whole("duration", values.duration!, 1),
    cooldown: whole("cooldown", values.cooldown!, 0),
    spread: whole("spread", values.spread!, 0),
    campaign: values.campaign!,
    seed: values.seed!,
    out: values.out,
    strict: values.strict!,
    table: {
      phones: whole("phones", values.phones!, 2, 4),
      campaign: values.campaign!,
      thinkMs: whole("think", values.think!, 0),
      heartbeatMs: whole("heartbeat", values.heartbeat!, 1),
      checks: whole("checks", values.checks!, 0),
      maxSteps: whole("max-steps", values["max-steps"]!, 1),
      verbose: values.verbose!,
    },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface StageResult {
  tables: number;
  report: Report;
  tally: Tally;
}

async function runStage(config: Config, tables: number, api: Api, recorder: Recorder, open: Set<OpenRoom>, content: Awaited<ReturnType<typeof loadContent>>): Promise<StageResult> {
  const tally = newTally();
  const rng = makeRng(`${config.seed}-${tables}`);
  const random = () => rng.next();
  const started = Date.now();
  const deadline = started + config.duration * 1000;
  const stopping = () => Date.now() >= deadline || interrupted;
  const ctx = { api, content, options: config.table, open, stopping, tally, random };

  await Promise.all(
    Array.from({ length: tables }, async (_, i) => {
      await sleep((i / tables) * config.spread * 1000);
      const table = new Table(i, ctx);
      // A table that finishes early opens another room: a soak keeps the load on.
      do await table.session();
      while (!stopping());
    }),
  );
  return { tables, report: recorder.report((Date.now() - started) / 1000), tally };
}

let interrupted = false;

/** Close whatever is still open: an interrupted run must not leave rooms behind. */
async function closeLeftovers(api: Api, open: Set<OpenRoom>, tally: Tally): Promise<void> {
  for (const room of [...open]) {
    const closed = await api.call("POST", `/api/room/${room.code}/close`, {
      route: "POST /api/room/:code/close",
      deviceToken: room.deviceToken,
      body: {},
    });
    if (closed.status === 200 || closed.status === 404) {
      tally.roomsClosed += 1;
      open.delete(room);
    }
  }
}

export function renderStage(result: StageResult): string {
  const t = result.tally;
  return [
    `### ${result.tables} tables`,
    "",
    `Sessions: ${t.sessions}, of which ${t.sessionsThatFought} rolled their checks and finished a fight, ${t.sessionsAbandoned} gave up, ${t.sessionsCutShort} cut short by the end of the stage. ` +
      `Rooms opened ${t.roomsOpened}, closed ${t.roomsClosed}, close failures ${t.closeFailures}.`,
    "",
    renderMarkdown(result.report),
  ].join("\n");
}

async function main(): Promise<number> {
  const config = parseConfig(process.argv.slice(2));
  if (!config) {
    console.log(HELP);
    return 0;
  }
  const content = await loadContent();
  const open = new Set<OpenRoom>();
  process.on("SIGINT", () => {
    interrupted = true;
    console.error("interrupted: finishing the step and closing every room");
  });

  const sections: string[] = [`# Load run against ${config.baseUrl}`, "", `${new Date().toISOString()}. ${config.phones} phones per table, ${config.duration}s per stage, think ${config.table.thinkMs}ms, heartbeat ${config.table.heartbeatMs}ms, campaign ${config.campaign}.`, ""];
  let failed = false;
  for (const [i, tables] of config.stages.entries()) {
    if (i > 0 && !interrupted) await sleep(config.cooldown * 1000);
    if (interrupted) break;
    // A recorder per stage: each stage's numbers are its own.
    const recorder = new Recorder();
    const api = new Api(config.baseUrl, recorder);
    console.error(`stage: ${tables} tables for ${config.duration}s`);
    const result = await runStage(config, tables, api, recorder, open, content);
    await closeLeftovers(api, open, result.tally);
    sections.push(renderStage(result), "");
    const t = result.tally;
    const beats = result.report.routes.find((route) => route.route === "POST /api/presence")?.count ?? 0;
    if (result.report.errors > 0 || t.closeFailures > 0 || open.size > 0 || t.sessionsThatFought === 0 || beats === 0) failed = true;
  }
  const text = sections.join("\n");
  console.log(text);
  if (config.out) writeFileSync(config.out, `${text}\n`);
  if (open.size > 0) console.error(`${open.size} room(s) could not be closed; they expire on their own (6 hours): ${[...open].map((r) => r.code).join(", ")}`);
  return config.strict && failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}
