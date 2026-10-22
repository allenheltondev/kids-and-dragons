/**
 * What Riftlight can pay (review on #405). XP is paid once per chapter per
 * attempt, so the most any route pays is every chapter's award once: 23
 * ordinary chapters at 140 and the convergence at 650, 3,870 in all.
 *
 * Level 9 starts at 4,700, so a hero who enters with 830 XP or more and
 * completes every place reaches level 9, past the design's level-8 target.
 * The owner accepted that for completionists rather than trim the awards
 * (docs/campaigns/continental-rift/routes-and-endings.md). This pins the
 * numbers, so a reward change cannot move that line unnoticed.
 */
import { describe, expect, it } from "vitest";
import { levelForXp } from "@kad/shared";
import { campaign, chapters, rules } from "./riftlight-test-support.ts";

const FULL_ROUTE_XP = 3870;

describe("Riftlight's XP", () => {
  it("pays 140 a chapter and 650 at the convergence, and nothing else", () => {
    expect(chapters.size).toBe(24);
    for (const chapter of chapters.values()) {
      expect(chapter.xpAward, chapter.id).toBe(chapter.id === "riftlight-convergence" ? 650 : 140);
      expect(chapter.objectives ?? [], chapter.id).toEqual([]);
      expect(JSON.stringify(chapter), chapter.id).not.toContain('"grantXp"');
    }
    expect(campaign.chapters).toHaveLength(24);
  });

  it(`pays at most ${String(FULL_ROUTE_XP)} on any route, which reaches level 9 only from 830 XP in`, () => {
    const total = [...chapters.values()].reduce((sum, chapter) => sum + (chapter.xpAward ?? 0), 0);
    expect(total).toBe(FULL_ROUTE_XP);
    expect(levelForXp(rules, 829 + total)).toBe(8);
    expect(levelForXp(rules, 830 + total)).toBe(9);
  });
});
