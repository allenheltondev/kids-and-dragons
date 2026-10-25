/**
 * XpMeter - how far a hero is toward the next level.
 *
 * A slim bar with "current / needed XP" under it, drawn from the hero's own XP
 * and the level thresholds in content/rules.json (`levelXp`). At the top level
 * it says so instead of drawing a bar that can never fill. XP the party has
 * already earned this chapter (story wins and roll wins are paid at the end of
 * the chapter) shows as a small "+N" so a good roll visibly counts for
 * something right away.
 */

import type { ReactElement } from "react";
import type { ResolvedCharacter } from "@kad/shared";
import { useRules, useRunState } from "../store";
import "./XpMeter.css";

export function XpMeter({ character }: { character: ResolvedCharacter }): ReactElement | null {
  const rules = useRules();
  const run = useRunState();
  if (!rules) return null;
  const xp = Math.max(0, character.xp);
  const floor = character.level <= 1 ? 0 : (rules.levelXp[character.level - 2] ?? 0);
  const next = rules.levelXp[character.level - 1];
  const pending = run?.phase === "chapter_complete" ? 0 : (run?.xpEarned ?? 0);

  if (next === undefined) {
    return (
      <span className="xp-meter" role="status">
        <span className="xp-meter__label">Top level! {xp} XP</span>
      </span>
    );
  }
  const span = Math.max(1, next - floor);
  const filled = Math.min(1, Math.max(0, (xp - floor) / span));
  return (
    <span className="xp-meter">
      <span
        className="xp-meter__bar"
        role="progressbar"
        aria-label="XP toward the next level"
        aria-valuemin={floor}
        aria-valuemax={next}
        aria-valuenow={Math.min(xp, next)}
      >
        <span className="xp-meter__fill" style={{ width: `${String(Math.round(filled * 100))}%` }} />
      </span>
      <span className="xp-meter__label">
        {xp} / {next} XP
        {pending > 0 ? <span className="xp-meter__pending"> +{pending} this chapter</span> : null}
      </span>
    </span>
  );
}
