/** Planning estimates for the draft regions; never recorded family observations. */
import fs from "node:fs";
import path from "node:path";
import { pacingReport, predictMinutes, UNCALIBRATED_MODEL } from "../../packages/shared/src/chapter-pacing.ts";
import type { Chapter } from "@kad/shared";

const root = path.resolve(import.meta.dirname, "../..");
const fastTable = { wordsPerMinute: 160, secondsPerDecision: 25, secondsPerCheck: 20, secondsPerEncounter: 240, secondsPerScene: 3 };
const round = (n: number) => Math.round(n * 10) / 10;
console.log(JSON.stringify({
  status: "uncalibrated-estimates-not-family-observations",
  ordinaryNodeTargetMinutes: [30, 40],
  defaultModel: UNCALIBRATED_MODEL,
  fastTableSensitivityModel: fastTable,
  chapters: ["stone-counters", "whale-road", "buried-bridge", "the-wrong-valley", "reading-room", "the-island-due-back", "stuttering-flats", "bone-yard", "wyrm-nest", "squall-temple", "convergence", "finale"].map((id) => {
    const chapter = JSON.parse(fs.readFileSync(path.join(root, `content/chapters/riftlight-${id}.json`), "utf8")) as Chapter;
    const report = pacingReport(chapter);
    return {
      id: chapter.id, authoredScenes: Object.keys(chapter.scenes).length, metadataBudgetMinutes: chapter.estimatedMinutes,
      scenarios: report.scenarios.map(({ scenario, shortest, typical }) => ({
        id: scenario.id, shortest, typical,
        shortestLowerMinutes: shortest && round(predictMinutes({ ...shortest, words: shortest.wordsMin })),
        typicalMinutes: typical && round(predictMinutes(typical)),
        fastTableShortestLowerMinutes: shortest && round(predictMinutes({ ...shortest, words: shortest.wordsMin }, fastTable)),
      })),
    };
  }),
}, null, 2));
