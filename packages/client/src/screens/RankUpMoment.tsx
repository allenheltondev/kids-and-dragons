/**
 * The rank-up moment (#314, docs/class-mastery.md §5): a rank has landed at the
 * end of a fight, or on a class's own choice, and the token glows and gains its
 * notch.
 *
 * Two halves, both around #310's one line ("Mira is a Thornguard Apprentice
 * now! New move: Shove."), which stays the words of record:
 *
 *   - **The shared screen** lifts the token up over the stage for a few seconds
 *     and lets it go (`RANK_UP_MS`). It is a picture, not a dialog: it takes no
 *     taps, covers no choice (the choices are on the phones, and it lets every
 *     pointer through), and is hidden from screen readers, because the line
 *     under the story already says it and read-aloud already reads it, once.
 *   - **The earning kid's phone** draws the line as a card with the token on
 *     it, in the line's own place above the choices, so nothing moves under a
 *     thumb that a plain line would not have moved.
 *
 * A Duskrunner's crow has its say in both (docs/class-mastery.md §2): it lands
 * on the token's card, says it, and is gone.
 *
 * Loaded on first rank-up, never at first paint: until it arrives the phone
 * shows the plain line and the TV shows nothing extra.
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { notchesFor, rankTitle } from "@kad/shared";
import type { ClassDef, ClassId, PartyMember, RankUp, RulesContent } from "@kad/shared";
import { useGameStore } from "../store";
import { ClassToken } from "./ClassToken";
import { Icon } from "./icons";
import "./RankUpMoment.css";

/** How long the shared screen holds the moment up: long enough to cheer, short enough not to stall. */
export const RANK_UP_MS = 4000;

/** What the crow says, short enough for a picture: the line under the story has the whole of it. */
const CROW_SAYS = "Don't mess with us.";

function titleOf(up: RankUp, rules: RulesContent | null): string {
  const classDef = (rules?.classes as Partial<Record<ClassId, ClassDef>> | undefined)?.[up.class];
  // Before the rules land, the class id titled reads the same as its name.
  return rankTitle(classDef ?? { name: `${up.class[0]!.toUpperCase()}${up.class.slice(1)}` }, up.rank);
}

function Crow(): ReactElement {
  return <Icon name="crow" className="rankup__crow-bird" />;
}

/**
 * Moments whose time is up, kept so a screen redrawn mid-scene does not cheer
 * twice. Kept only while the ranks are still on the state: the engine clears
 * `rankUps` when the scene changes, a chapter starts or the party is back in
 * the lobby, and that ends the occurrence. The same hero earning the same rank
 * on the same scene again (a failed campaign played over, in the same room's
 * run or a new one) is a new moment, and cheers.
 */
const finished = new Set<string>();

/** Test seam: forget which moments have been shown. */
export function resetRankUpMoments(): void {
  finished.clear();
}

useGameStore.subscribe((store) => {
  if (finished.size > 0 && !store.state?.rankUps) finished.clear();
});

/**
 * The shared screen's moment: up for `RANK_UP_MS`, then gone for good for
 * these ranks, however often the state is redrawn while the scene is open.
 */
export function RankUpMoment({
  ups,
  party,
  rules,
  momentKey,
}: {
  ups: readonly RankUp[];
  party: readonly PartyMember[];
  rules: RulesContent | null;
  /** Which landing this is; a new key is a new moment. */
  momentKey: string;
}): ReactElement | null {
  const [, setDone] = useState(0);
  useEffect(() => {
    if (finished.has(momentKey)) return undefined;
    const timer = setTimeout(() => {
      finished.add(momentKey);
      setDone((n) => n + 1);
    }, RANK_UP_MS);
    return () => clearTimeout(timer);
  }, [momentKey]);
  if (ups.length === 0 || finished.has(momentKey)) return null;
  return (
    <div className="rankup" aria-hidden="true" data-testid="rank-up-moment">
      {ups.map((up) => {
        const hero = party.find((m) => m.character.id === up.characterId)?.character;
        return (
          <div className="rankup__card" key={`${up.characterId}:${up.rank}`}>
            <ClassToken classId={up.class} rank={up.rank} size="lg" glow fresh={notchesFor(up.rank)} holdable={false} />
            <span className="rankup__words">
              <span className="rankup__name">{hero?.name ?? ""}</span>
              <span className="rankup__title">{titleOf(up, rules)}!</span>
              {up.crow ? (
                <span className="rankup__crow">
                  <Crow />
                  <span>{CROW_SAYS}</span>
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The earning kid's phone: the line, as a card with the token glowing on it. */
export function RankUpCard({ up }: { up: RankUp }): ReactElement {
  return (
    <div className="rankup-card" data-testid="player-rank-up">
      <ClassToken classId={up.class} rank={up.rank} size="md" glow fresh={notchesFor(up.rank)} owner="your" />
      <span className="rankup-card__words">
        <span className="rankup-card__line">{up.line}</span>
        {up.crow ? (
          <span className="rankup-card__crow">
            <Crow />
            <span>{up.crow}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
