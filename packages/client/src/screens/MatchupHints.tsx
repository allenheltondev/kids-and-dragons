/**
 * The phone's matchup reminders (docs/matchups.md "Presentation"): what the
 * fight means for *this* hero, and a badge on the hero's own check. The field
 * guide teaches; these only nudge, in a line or two, with a plus or minus
 * glyph and words so the sign never rides on colour (spec §11).
 *
 * Both render nothing without matchups (no rules table, an exempt campaign
 * such as Gemfall, nothing that touches this hero), so those screens are
 * exactly what they were.
 */

import type { ReactElement } from "react";
import type { Chapter, EncounterState, PartyMember } from "@kad/shared";
import { useBestiary, useCampaign, useRules } from "../store";
import { Icon } from "./icons";
import { checkBadges, chipsForHero } from "./matchup-copy";
import "./MatchupHints.css";

/** What the fight means for this hero: only the first round, so the board keeps its rows later. */
export function HeroFightHints({ encounter, heroId }: { encounter: EncounterState; heroId: string }): ReactElement | null {
  const rules = useRules();
  const campaign = useCampaign();
  if (encounter.round > 1) return null;
  const chips = chipsForHero(rules, campaign?.id, encounter, heroId);
  if (chips.length === 0) return null;
  return (
    <ul className="matchup-hints" aria-label="Worth knowing for you">
      {chips.map(({ hint, sign }) => (
        <li key={hint.id} className={`matchup-hints__item matchup-hints__item--${sign}`}>
          <Icon name={sign} />
          <span>{hint.text}</span>
          <span className="kad-sr-only">{sign === "plus" ? " Good for you." : " Tricky for you."}</span>
        </li>
      ))}
    </ul>
  );
}

/** A small badge per matchup on the check this hero is about to roll ("Sneak: Bigfoot are loud."). */
export function CheckMatchupBadges({
  chapter,
  sceneId,
  hero,
}: {
  chapter: Chapter | null;
  sceneId: string;
  hero: PartyMember["character"];
}): ReactElement | null {
  const rules = useRules();
  const campaign = useCampaign();
  const bestiary = useBestiary();
  const scene = chapter?.scenes[sceneId];
  const badges = checkBadges(rules, campaign?.id, hero, scene?.type === "check" ? scene : null, 2, bestiary);
  if (badges.length === 0) return null;
  return (
    <ul className="matchup-hints matchup-hints--check" aria-label="What helps or hurts this roll">
      {badges.map((badge) => (
        <li key={badge.id} className={`matchup-hints__item matchup-hints__item--${badge.sign}`}>
          <Icon name={badge.sign} />
          <span>{badge.text}</span>
          <span className="kad-sr-only">{badge.sign === "plus" ? " Helps you." : " Makes it harder."}</span>
        </li>
      ))}
    </ul>
  );
}
