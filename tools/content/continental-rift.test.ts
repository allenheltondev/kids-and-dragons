/**
 * The Continental Rift vertical slice (#203) against the content gate.
 *
 * The slice is a fixture — it lives in packages/shared/src/fixtures, so the
 * loader and `content:validate` never read it and nothing ships it — but it is
 * meant to be the worked example a real graph campaign is written from
 * (docs/campaigns/graph-campaigns-authoring.md). So it is held to everything a
 * shipped campaign would be, not just to what a fixture needs:
 *
 *   - the schemas an editor sees (campaign, chapter, map), strict;
 *   - `content:validate` itself, on a copy of the real tree with the slice
 *     dropped into `content/` — chapters, board, campaign, graph lint with the
 *     chapters' real flag writes — with no failure and no warning;
 *   - the graph lint and the route explorer with the slice's *own* chapters
 *     (the journey CI gate, journey-tools.test.ts, already walks it as a
 *     fixture whose chapters it cannot see); and as each table it is played by;
 *   - `npm run content:journey -- --campaign continental-rift-slice --playtest`
 *     runs clean, and the diagram in the authoring guide is the one the tool
 *     draws today.
 *
 * The end-to-end playthrough through the server is
 * packages/server/src/handlers/continental-rift.test.ts.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, describe, expect, it } from "vitest";
import { checkEncounterEnvironment, lintCampaignGraph, parseCampaignGraph, validateChapter } from "@kad/shared";
import type { Campaign, EncounterMap, ParsedCampaignGraph } from "@kad/shared";
import { REPO_ROOT, chapterFlagsFrom, loadChapters, toMermaid } from "./journey-graph.ts";
import { exploreRoutes, playtest } from "./journey-explore.ts";

const FIXTURES = path.join(REPO_ROOT, "packages", "shared", "src", "fixtures");
const SLICE_DIR = path.join(FIXTURES, "continental-rift");
const CAMPAIGN_FILE = path.join(FIXTURES, "continental-rift.campaign.json");
const MAP_FILE = path.join(SLICE_DIR, "ice-shelf.map.json");
const GUIDE = path.join(REPO_ROOT, "docs", "campaigns", "graph-campaigns-authoring.md");

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const campaign = readJson<Campaign>(CAMPAIGN_FILE);
const chapters = loadChapters(path.join(SLICE_DIR, "chapters"));
const board = readJson<EncounterMap>(MAP_FILE);
const graph = parseCampaignGraph(campaign).graph as ParsedCampaignGraph;
const options = { chapterFlags: chapterFlagsFrom(chapters), routeSets: campaign.routeSets };

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
for (const file of fs.readdirSync(path.join(REPO_ROOT, "schemas")).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(readJson(path.join(REPO_ROOT, "schemas", file)));
}
function judge(schemaFile: string, doc: unknown) {
  const validate = ajv.getSchema(readJson<{ $id: string }>(path.join(REPO_ROOT, "schemas", schemaFile)).$id)!;
  const ok = validate(doc);
  return { ok, errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
}

describe("the slice's files", () => {
  it("one chapter file per listed chapter, each claiming the slice, and nothing else", () => {
    expect([...chapters.keys()].sort()).toEqual([...campaign.chapters].sort());
    for (const chapter of chapters.values()) expect(chapter.campaignId).toBe(campaign.id);
  });

  it("validate against the schemas content:validate uses", () => {
    const verdicts = [
      ["campaign", judge("campaign.schema.json", campaign)],
      ["map", judge("map.schema.json", board)],
      ...[...chapters.values()].map((chapter) => [chapter.id, judge("chapter.schema.json", chapter)] as const),
    ] as const;
    for (const [name, { ok, errors }] of verdicts) expect(ok, `${name}\n${errors.join("\n")}`).toBe(true);
  });

  it("every chapter is a sound scene graph, and the environment fits its board", () => {
    for (const chapter of chapters.values()) {
      expect(validateChapter(chapter), chapter.id).toEqual([]);
      for (const scene of Object.values(chapter.scenes)) {
        if (scene.type !== "encounter") continue;
        expect(scene.map).toBe(board.id);
        expect(checkEncounterEnvironment(scene, board), chapter.id).toEqual([]);
      }
    }
    // The slice exercises #201: exactly one fight happens *in* the rift.
    const environmental = [...chapters.values()].filter((c) =>
      Object.values(c.scenes).some((s) => s.type === "encounter" && s.environment !== undefined),
    );
    expect(environmental.map((c) => c.id)).toEqual(["cr-glacier"]);
  });

  it("is not content: nothing of it lives where the loader or the gate reads", () => {
    const shipped = (dir: string) => fs.readdirSync(path.join(REPO_ROOT, "content", dir));
    for (const file of shipped("campaigns")) {
      expect(readJson<Campaign>(path.join(REPO_ROOT, "content", "campaigns", file)).id).not.toBe(campaign.id);
    }
    for (const id of campaign.chapters) expect(shipped("chapters")).not.toContain(`${id}.json`);
    for (const file of shipped("maps")) expect(readJson<EncounterMap>(path.join(REPO_ROOT, "content", "maps", file)).id).not.toBe(board.id);
  });
});

describe("the slice's graph, read with its own chapters", () => {
  it("lints with no finding at all — not even a warning", () => {
    const { findings, search } = lintCampaignGraph(graph, options);
    expect(findings).toEqual([]);
    expect(search.complete).toBe(true);
  });

  it("covers every place, way and ending, with no softlock, and the runtime agrees on every walk", () => {
    const { search, coverage } = exploreRoutes(graph, options);
    expect(coverage.complete).toBe(true);
    expect(coverage.softlocks).toEqual([]);
    expect(coverage.nodes.every((node) => node.entered)).toBe(true);
    expect(coverage.edges.every((edge) => edge.traversable)).toBe(true);
    expect(coverage.endingsReached).toBe(2);
    const report = playtest(graph, campaign, { chapterFlags: options.chapterFlags, random: { seed: 203, runs: 40 }, replay: { search, coverage } });
    expect(report.violations).toEqual([]);
    expect(report.covered.nodes).toEqual(graph.nodeOrder);
    expect(report.covered.edges).toEqual(graph.edgeOrder);
    expect(report.covered.endings).toEqual(graph.endings);
  });

  // Each table explored as itself (#199): ways it cannot take are not taken.
  it.each([
    ["a Starweaver alone", ["starweaver"], ["heart", "delta"]],
    ["a Thornguard and a Songkeeper", ["thornguard", "songkeeper"], ["heart", "delta"]],
    ["a Duskrunner alone", ["duskrunner"], ["heart", "delta"]],
    ["nobody gated at all", [], ["heart", "delta"]],
  ] as const)("%s can reach both endings, with no softlock", (_name, classes, endings) => {
    const party = { classes: [...classes], items: [] };
    const { search, coverage } = exploreRoutes(graph, { ...options, party });
    expect(coverage.softlocks).toEqual([]);
    expect(coverage.endings.filter((ending) => ending.reached).map((ending) => ending.id)).toEqual(endings);
    const report = playtest(graph, campaign, { chapterFlags: options.chapterFlags, random: { seed: 7, runs: 10 }, replay: { search, coverage }, party });
    expect(report.violations).toEqual([]);
  });

  it("offers the attune way only where a Starweaver could have earned it", () => {
    // Without a Starweaver the counter can still rise (the peaks are anyone's),
    // but sensing is theirs, so a table without one never reaches 3.
    const without = exploreRoutes(graph, { ...options, party: { classes: ["thornguard"], items: [] } }).search;
    const withOne = exploreRoutes(graph, { ...options, party: { classes: ["starweaver"], items: [] } }).search;
    const highest = (search: typeof without) => Math.max(...search.states.map((state) => Number(state.facts.facts?.attunement ?? 0)));
    expect(highest(without)).toBe(1);
    expect(highest(withOne)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// content:validate, on a copy of the real tree with the slice in content/
// ---------------------------------------------------------------------------

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

describe("content:validate, with the slice dropped into content/", { timeout: 120_000 }, () => {
  it("passes, with no failure and no warning for any of its files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-slice-"));
    temps.push(dir);
    fs.cpSync(path.join(REPO_ROOT, "content"), path.join(dir, "content"), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, "schemas"), path.join(dir, "schemas"), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, "assets", "world"), path.join(dir, "assets", "world"), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, "assets", "manifest.json"), path.join(dir, "assets", "manifest.json"));
    fs.cpSync(CAMPAIGN_FILE, path.join(dir, "content", "campaigns", `${campaign.id}.json`));
    for (const id of campaign.chapters) {
      fs.cpSync(path.join(SLICE_DIR, "chapters", `${id}.json`), path.join(dir, "content", "chapters", `${id}.json`));
    }
    fs.cpSync(MAP_FILE, path.join(dir, "content", "maps", `${board.id}.json`));

    let out = "";
    let code = 0;
    try {
      // A new graph, so a new proof, written as an author would (content:proofs).
      out = execFileSync(process.execPath, [path.join(REPO_ROOT, "tools", "content", "validate.mjs"), "--write-proofs"], {
        env: { ...process.env, KAD_CONTENT_ROOT: dir, KAD_CLASS_PLACES: "off", NO_COLOR: "1" },
        encoding: "utf8",
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? 1;
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(code, out).toBe(0);
    const ours = out.split("\n").filter((line) => /cr-|cr_ice_shelf|continental-rift/.test(line));
    expect(ours.filter((line) => !/^\s+pass\s/.test(line)), out).toEqual([]);
    expect(out).toMatch(/pass\s+content\/campaigns\/continental-rift-slice\.json\s+campaign\s+\(graph v1: 6 node\(s\), 9 edge\(s\), 2 ending\(s\)/);
    expect(out).toMatch(/pass\s+content\/chapters\/cr-glacier\.json\s+graph/);
  });
});

// ---------------------------------------------------------------------------
// The CLI, and the guide's diagram
// ---------------------------------------------------------------------------

function cli(args: string[]) {
  const tsx = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const run = spawnSync(process.execPath, [tsx, path.join(REPO_ROOT, "tools", "content", "journey.ts"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 90_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("npm run content:journey on the slice", { timeout: 120_000 }, () => {
  it("--playtest runs clean: lint clean, everything covered, every invariant held", () => {
    const run = cli(["--campaign", campaign.id, "--playtest"]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain("Lint\n  clean");
    expect(run.stdout).toContain("nodes   6/6 entered by some playthrough");
    expect(run.stdout).toContain("softlocks: none");
    expect(run.stdout).toMatch(/covered 6\/6 nodes, 9\/9 edges, 2\/2 endings/);
    expect(run.stdout).toContain("invariants: all held");
  });

  it("the authoring guide's diagram is the one the tool draws", () => {
    const run = cli(["--campaign", campaign.id, "--format", "mermaid"]);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(toMermaid(campaign, graph).trim());
    const guide = fs.readFileSync(GUIDE, "utf8").replace(/\r\n/g, "\n");
    const block = /```mermaid\n([\s\S]*?)```/.exec(guide.slice(guide.indexOf("<!-- continental-rift-diagram -->")));
    expect(block, "the guide carries the slice's diagram after its marker").not.toBeNull();
    expect(block![1]!.trim()).toBe(toMermaid(campaign, graph).trim());
  });
});
