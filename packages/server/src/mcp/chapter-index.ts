/**
 * What the MCP server knows about the chapters without carrying them: each
 * chapter's current revision (hashed exactly as the API hashes it, from the
 * loaded chapter), its campaign and place in it, its planned and predicted
 * minutes, and the mini-games and fights it holds. The build writes it beside
 * the MCP bundle (`infra/build.mjs`, `chapter-index.json`); the timing tools
 * read it to say which revision is the text families play now, to put
 * observed minutes beside the plan and `content:pacing`'s prediction, to walk
 * a campaign in order, and to name the games and fights nobody has played yet.
 *
 * Without it (a build that did not write one, or a test) the tools still work
 * and fall back to "the most recently played revision".
 */

import fs from "node:fs";
import {
  CALIBRATION_SCENARIO_ID,
  UNCALIBRATED_MODEL,
  campaignMode,
  isPracticeCampaign,
  pacingReport,
  predictMinutes,
  scenarioById,
  type Campaign,
  type Chapter,
  type GameKind,
  type PacingScenario,
} from "@kad/shared";
import { chapterRevision } from "../handlers/timing.ts";

export interface ChapterIndexEntry {
  id: string;
  title: string;
  campaignId: string | null;
  /** 1-based place in its campaign's chapter list; in a graph campaign, an act number at most. */
  position: number | null;
  /** The revision sittings on the current text carry (`chapterRevision`). */
  revision: string;
  estimatedMinutes: number;
  /** `content:pacing`'s uncalibrated prediction on the calibration scenario. Not an observation. */
  predictedMinutes: { shortest: number | null; typical: number | null };
  scenes: number;
  games: Array<{ scene: string; game: GameKind }>;
  fights: Array<{ scene: string; foes: number; foeKinds: string[] }>;
}

export interface CampaignIndexEntry {
  id: string;
  title: string;
  mode: "ordered" | "graph";
  chapters: string[];
}

export interface ChapterIndex {
  builtAt: string;
  chapters: ChapterIndexEntry[];
  campaigns: CampaignIndexEntry[];
}

/** The slice of the content store the index reads. */
export interface IndexSource {
  chapterIds(): string[];
  chapter(id: string): Chapter | null;
  campaignIds(): string[];
  campaign(id: string): Campaign | null;
}

const round = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);

export function buildChapterIndex(content: IndexSource, now = new Date()): ChapterIndex {
  const all = content
    .campaignIds()
    .map((id) => content.campaign(id))
    .filter((c): c is Campaign => c !== null);
  // The practice is never timed (handlers/timing.ts), so it has no place here.
  const practice = new Set(all.filter((c) => isPracticeCampaign(c.id)).flatMap((c) => c.chapters));
  const campaigns: CampaignIndexEntry[] = all
    .filter((c) => !isPracticeCampaign(c.id))
    .map((c) => ({ id: c.id, title: c.title, mode: campaignMode(c), chapters: [...c.chapters] }));
  const home = new Map<string, { campaignId: string; position: number }>();
  for (const c of campaigns) c.chapters.forEach((id, i) => home.has(id) || home.set(id, { campaignId: c.id, position: i + 1 }));
  const calibration = scenarioById(CALIBRATION_SCENARIO_ID) as PacingScenario;
  const chapters = content
    .chapterIds()
    .map((id) => content.chapter(id))
    .filter((c): c is Chapter => c !== null && !practice.has(c.id))
    .map((chapter) => {
      const pacing = pacingReport(chapter, [calibration]).scenarios[0];
      const minutes = (m: Parameters<typeof predictMinutes>[0] | null | undefined) => (m ? round(predictMinutes(m, UNCALIBRATED_MODEL)) : null);
      const scenes = Object.entries(chapter.scenes);
      return {
        id: chapter.id,
        title: chapter.title,
        campaignId: home.get(chapter.id)?.campaignId ?? null,
        position: home.get(chapter.id)?.position ?? null,
        revision: chapterRevision(chapter),
        estimatedMinutes: chapter.estimatedMinutes,
        predictedMinutes: { shortest: minutes(pacing?.shortest), typical: minutes(pacing?.typical) },
        scenes: scenes.length,
        games: scenes.flatMap(([scene, s]) => (s.type === "interaction" ? [{ scene, game: s.interaction.kind }] : [])),
        fights: scenes.flatMap(([scene, s]) =>
          s.type === "encounter" && !s.autoResolve
            ? [{ scene, foes: s.enemies.reduce((t, e) => t + e.count, 0), foeKinds: [...new Set(s.enemies.map((e) => e.id))] }]
            : [],
        ),
      };
    });
  return { builtAt: now.toISOString(), chapters, campaigns };
}

/** The index the build wrote, or null when there is none or it does not parse. */
export function readChapterIndex(file: string | URL): ChapterIndex | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ChapterIndex;
    return Array.isArray(parsed.chapters) && Array.isArray(parsed.campaigns) ? parsed : null;
  } catch {
    return null;
  }
}

/** chapter id -> its current revision, for `timingFindings` and `latestRevisions`. */
export function currentRevisions(index: ChapterIndex | null | undefined): Map<string, string> {
  return new Map((index?.chapters ?? []).map((c) => [c.id, c.revision]));
}
