/**
 * The badge beside a choice that says what picking it leads to
 * (shared `choiceAhead`): a roll and its stat, a game, or a fight. Icon and
 * words both, never colour alone (spec §11). One place, so the TV's pills and
 * the phones' buttons say it the same way.
 */

import type { ChoiceAhead, StatId } from "@kad/shared";

const STAT_WORD: Record<StatId, string> = { might: "Might", quick: "Quick", clever: "Clever", heart: "Heart" };

export interface AheadBadge {
  icon: string;
  text: string;
}

export function aheadBadge(ahead: ChoiceAhead | undefined): AheadBadge | null {
  if (ahead === undefined) return null;
  switch (ahead.kind) {
    case "roll":
      return { icon: ahead.stat, text: ahead.party ? `Everyone rolls ${STAT_WORD[ahead.stat]}` : `${STAT_WORD[ahead.stat]} roll` };
    case "game":
      return { icon: "play", text: "Game" };
    case "fight":
      return { icon: "swords", text: "Fight" };
  }
}
