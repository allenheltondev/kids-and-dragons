/**
 * What Riftlight can pay (review on #405). XP is paid once per chapter per
 * attempt, so the most any route pays is every chapter's award once: 23
 * ordinary chapters at 140 and the convergence at 650, 3,870 in all. Levels
 * are not capped at 8 (the curve runs on, and is meant to grow), so this pins
 * the authored awards rather than a level: a change to them should be one
 * somebody meant.
 */
import { describe, expect, it } from "vitest";
import { campaign, chapters } from "./riftlight-test-support.ts";

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

  // The authored budget only: the runtime's once-per-chapter settlement, and
  // replays across attempts (#407), are the progression code's to test.
  it(`pins the total first-completion reward budget at ${String(FULL_ROUTE_XP)}`, () => {
    const total = [...chapters.values()].reduce((sum, chapter) => sum + (chapter.xpAward ?? 0), 0);
    expect(total).toBe(FULL_ROUTE_XP);
  });
});
