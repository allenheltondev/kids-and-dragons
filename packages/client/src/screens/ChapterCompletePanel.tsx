/**
 * ChapterCompletePanel — WorldView when `phase === "chapter_complete"`.
 *
 * The end-of-sitting beat (spec §3, roadmap ch.3): XP for finishing the
 * chapter, which the party shares, plus each hero's own XP for her rolls that
 * went well (spec §8.2). Not XP for killing things (spec §8.1). Also what
 * everyone is carrying, and who grew.
 *
 * Level and tier *changes* come from the **progression** channel rather than
 * from state: `RunState` carries the party's current level, not its previous
 * one, so "who grew" is not derivable from the snapshot.
 *
 * They used to be read off `LEVEL_UP` and `TRANSFORM` *presentation* events,
 * and those chips never once rendered at a table: nothing in the codebase has
 * ever constructed either presentation. The server puts level and tier
 * crossings in `progression.awards` — the channel documented for exactly this,
 * and the one `TransformCutscene` plays off — while `Presentation` carries one
 * event per patch and the patch that crosses a tier has already spent its one
 * on CHAPTER_COMPLETE.
 *
 * A client that joined after the event simply sees the new level without the
 * fanfare, which is the right failure.
 *
 * How the chapter *ended* comes from state rather than from an event, because
 * it is a fact about the run and not a beat: a phone that reconnects onto the
 * summary has to read the same ending as the two that watched it happen.
 *
 * A setback is drawn as a different ending, never as a loss (spec §8.2). It
 * pays half rather than nothing precisely so the evening still counts, and the
 * screen has to say the same thing the rule does — the party is not being told
 * they wasted a sitting. There is no red anywhere in this file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { revelationsOf, speak } from "@kad/shared";
import type { TierId } from "@kad/shared";
import { useGameStore, useItems, useParty, useProgression, useRunState } from "../store";
import type { ProgressionEvent } from "../store/contract";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import { campaignEndHeading, campaignEndLine } from "./campaign-copy";
import { fightEndingIcon, fightEndingLine } from "./fight-ending-copy";
import { useEnsureChapter, useEnsureContent } from "./content";
import { ChapterGoalCard } from "./ChapterGoal";
import "./shared.css";
import "./ChapterCompletePanel.css";

/** Who levelled up and who crossed a tier, by character id. */
interface Grown {
  leveled: Record<string, number>;
  transformed: Record<string, string>;
}

/** `grown` with one progression update's awards on top — the same object back
    when the update says nothing new, so a replay costs no render. */
function withAwards(grown: Grown, event: ProgressionEvent | null): Grown {
  let next = grown;
  for (const award of event?.progression.awards ?? []) {
    const { characterId, leveledTo, newTier } = award;
    if (leveledTo !== undefined && next.leveled[characterId] !== leveledTo) {
      next = { ...next, leveled: { ...next.leveled, [characterId]: leveledTo } };
    }
    if (newTier !== undefined && next.transformed[characterId] !== newTier) {
      next = { ...next, transformed: { ...next.transformed, [characterId]: newTier } };
    }
  }
  return next;
}

export function ChapterCompletePanel(): ReactElement {
  useEnsureContent();
  useEnsureChapter();
  const state = useRunState();
  const chapter = useGameStore((s) => s.chapter);
  const party = useParty();
  const items = useItems();
  /*
   * Seeded from the store on the first render, not only from the subscription
   * below: the update that ended the chapter has normally landed before this
   * panel mounts, and delivered in an effect the chips arrived a frame after
   * the cards and pushed everything under them down. The subscription replays
   * the same update on mount (a no-op now) and carries any later one.
   */
  const [grown, setGrown] = useState<Grown>(() =>
    withAwards({ leveled: {}, transformed: {} }, useGameStore.getState().progression),
  );
  const { leveled, transformed } = grown;

  useProgression(
    useCallback((event) => {
      setGrown((prev) => withAwards(prev, event));
    }, []),
  );

  const xp = state?.xpEarned ?? 0;
  /*
   * Heroes this chapter had paid before (#408): it pays each hero once, ever,
   * so they earned nothing this time and the line says so instead of "for
   * everyone". Absent on every chapter that paid the whole table.
   */
  const alreadyPaid = useMemo(() => new Set(state?.xpAlreadyPaid ?? []), [state?.xpAlreadyPaid]);
  const nobodyPaid = party.length > 0 && party.every((m) => alreadyPaid.has(m.character.id));
  const xpLine = nobodyPaid
    ? "Everyone here has earned this chapter's XP before."
    : alreadyPaid.size > 0
      ? `${String(xp)} XP for each hero new to this chapter.`
      : null;
  /*
   * Each hero's own XP for her rolls that went well (`heroRollXp`), under the
   * party's line. The party line is what everyone earned; this is what each
   * hero earned on top, for her own rolls. Only a hero this chapter has not
   * paid before gets one, and nothing shows when nobody earned the XP again.
   */
  const heroRollXp = state?.heroRollXp;
  const ownRolls = useMemo(
    () =>
      nobodyPaid
        ? []
        : party.flatMap((m) => {
            const own = heroRollXp?.[m.character.id] ?? 0;
            return own > 0 && !alreadyPaid.has(m.character.id) ? [{ name: m.character.name, xp: own }] : [];
          }),
    [nobodyPaid, party, heroRollXp, alreadyPaid],
  );
  /*
   * Absent means success, the same default `completeChapter` applies — a run
   * persisted before the field existed, or a chapter authored before setbacks
   * did, must not read as a setback on the strength of a missing key.
   */
  const setback = state?.chapterOutcome === "setback";
  const bonuses = state?.bonuses ?? [];
  // The chapter that ended the whole campaign gets the campaign's ending.
  const ended = state?.campaign?.ended;
  const heading =
    campaignEndHeading(state?.campaign) ?? (setback ? "The story took a turn" : "Chapter finished!");
  const endLine = campaignEndLine(state?.campaign);
  /*
   * The recap: every priority-1 scene the party walked through, in its own
   * authored words (chapter.ts `ScenePriority`), so the table hears the
   * revelation again before bed. Read off the trail and the chapter in play;
   * until the chapter has loaded, or on a road with no revelation, there is
   * none and nothing below changes shape.
   */
  const visited = state?.visited;
  const chapterId = state?.chapterId ?? null;
  const flags = state?.flags;
  const coins = state?.coins;
  const recap = useMemo(
    () =>
      chapter && chapter.id === chapterId && visited
        ? revelationsOf(chapter, visited, {
            members: party.map((member) => member.character),
            flags: flags ?? {},
            coins: coins ?? 0,
          })
        : [],
    [chapter, chapterId, visited, party, flags, coins],
  );
  // How each fight in a place that fought back ended (#220). Absent on every
  // run without one, and then nothing below changes shape.
  const fightEndings = state?.fightEndings ?? [];

  /*
   * Spoken once — the summary is narration like any other (spec §11). Held
   * until the chapter has loaded, so the recap is in the same utterance rather
   * than missing from it; a chapter that never loads never holds it up.
   */
  const spoken = useRef(false);
  const chapterReady = chapter !== null && chapter.id === chapterId;
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (chapterReady) return;
    const timer = setTimeout(() => { setWaited(true); }, 1500);
    return () => { clearTimeout(timer); };
  }, [chapterReady]);
  useEffect(() => {
    if (spoken.current || (!chapterReady && !waited)) return;
    spoken.current = true;
    speak(
      [
        endLine !== null
          ? `${heading} ${endLine}`
          : setback
            ? xpLine === null
              ? `The story took a turn. The party earned ${String(xp)} experience, and the adventure keeps going.`
              : `The story took a turn. ${xpLine} The adventure keeps going.`
            : `Chapter finished! ${xpLine ?? `The party earned ${String(xp)} experience.`}`,
        // Read aloud too, because a recap that only exists on the television is
        // a recap nobody hears — the §11 seam is where every line of narration
        // goes and this is narration. Appended to the same utterance rather
        // than spoken separately so it cannot interrupt or be interrupted.
        ...ownRolls.map((r) => `${r.name} earned ${String(r.xp)} experience from their own good rolls.`),
        ...fightEndings.map(fightEndingLine),
        ...recap,
      ].join(" "),
    );
  }, [xp, xpLine, ownRolls, setback, recap, heading, endLine, fightEndings, chapterReady, waited]);

  const questItems = party.flatMap((m) =>
    m.character.questItems.map((itemId) => ({ itemId, owner: m.character.name })),
  );

  return (
    <section className="complete" aria-labelledby="complete-heading">
      <header className="complete__head">
        <h2 className="complete__heading" id="complete-heading">
          {/* Icon and words carry the difference — never colour (spec §11). */}
          <Icon name={ended === "complete" ? "crown" : setback || ended === "failed" ? "scroll" : "trophy"} />
          <span>{heading}</span>
        </h2>
        {endLine !== null ? (
          <p className="complete__campaign-end">
            <Icon name={ended === "complete" ? "star" : "charm"} />
            <span>{endLine}</span>
          </p>
        ) : null}
        {/* The goal the chapter set out with (#356), and what got ticked on the way. */}
        <ChapterGoalCard place="world" />
        <p className="complete__xp">
          <Icon name="star" />
          <span>
            {/* Story XP is per chapter and shared (spec §8.2) — "for everyone" is
                the line that keeps the youngest player from counting hers
                against the adults'. Only a hero the chapter paid before is
                left out of it (#408), and her card says why. */}
            {nobodyPaid ? (
              xpLine
            ) : (
              <>
                <b>{xp}</b> {alreadyPaid.size > 0 ? "XP for each hero new to this chapter" : "XP for everyone"}
              </>
            )}
          </span>
        </p>
        {ownRolls.length === 0 ? null : (
          <p className="complete__xp">
            <Icon name="star" />
            <span>From their own good rolls: {ownRolls.map((r) => `${r.name} +${String(r.xp)}`).join(", ")}</span>
          </p>
        )}
        {setback && ended === undefined ? (
          <p className="complete__setback">
            <Icon name="forward" />
            <span>Not how you hoped, and the adventure carries on from here.</span>
          </p>
        ) : null}
        {fightEndings.map((ending, i) => (
          <p className="complete__fight" key={i}>
            <Icon name={fightEndingIcon(ending)} />
            <span>{fightEndingLine(ending)}</span>
          </p>
        ))}
        {recap.map((line, i) => (
          <p className="complete__recap" key={i}>
            <Icon name="scroll" />
            <span>{line}</span>
          </p>
        ))}
      </header>

      {/*
       * spec §8.2 — objectives pay the whole party or nobody, and they pay on a
       * setback too, because they are about what the party *did* on the way and
       * not about which ending it arrived at. Itemised rather than folded
       * silently into the total: the XP above already includes these, and a
       * number nobody can account for teaches the table that the number is
       * arbitrary.
       */}
      {bonuses.length === 0 ? null : (
        <div className="complete__bonuses">
          <h3 className="complete__bonus-heading">
            <Icon name="star" />
            <span>And you did these too</span>
            {/* Mixed table: the objectives' XP is for the new heroes only. */}
            {alreadyPaid.size > 0 && !nobodyPaid ? <span className="kad-muted"> (new heroes earn these)</span> : null}
          </h3>
          <ul className="complete__bonus-list">
            {bonuses.map((bonus) => (
              <li className="complete-bonus" key={bonus.id}>
                <Icon name="check" />
                <span className="complete-bonus__label">{bonus.label}</span>
                {/* When nobody earns the chapter's XP again, its objectives'
                    XP is withheld with the rest: they are shown as done, not
                    as XP. A clamped objective can honestly pay 0 (the 25%
                    budget is shared). It still shows: the party did the thing. */}
                {nobodyPaid ? (
                  <span className="complete-bonus__xp kad-muted">Already claimed</span>
                ) : (
                  <span className="complete-bonus__xp kad-muted">+{bonus.xp}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="complete__party">
        {party.map((member) => {
          const newLevel = leveled[member.character.id];
          const newTier = transformed[member.character.id];
          return (
            <li className="complete-card" key={member.playerId}>
              {/*
               * The new tier if they crossed one this chapter, not the tier
               * they walked in with. The cutscene has already played the moment
               * itself; this is the receipt for it, so the summary and the beat
               * that preceded it agree about what she is now.
               */}
              <span className="complete-card__portrait" aria-hidden="true">
                <CharacterPortrait
                  backdrop
                  species={member.character.species}
                  accent={member.character.appearance.accent}
                  tier={(newTier as TierId | undefined) ?? member.character.tier}
                  characterClass={member.character.class}
                  className="complete-card__art"
                  lit={newTier !== undefined}
                />
              </span>
              <span className="complete-card__text">
                <span className="complete-card__name">{member.character.name}</span>
                <span className="complete-card__chips">
                  <span className="kad-chip">
                    <Icon name="levelup" />
                    <span>Level {newLevel ?? member.character.level}</span>
                  </span>
                  {alreadyPaid.has(member.character.id) ? (
                    <span className="kad-chip">
                      <Icon name="check" />
                      <span>XP earned here before</span>
                    </span>
                  ) : null}
                  {newLevel === undefined ? null : (
                    <span className="kad-chip kad-chip--ok">
                      <Icon name="star" />
                      <span>Levelled up!</span>
                    </span>
                  )}
                  {newTier === undefined ? null : (
                    <span className="kad-chip kad-chip--warn">
                      <Icon name="clever" />
                      <span>New look: {newTier}</span>
                    </span>
                  )}
                </span>
                {/* The point the level brought can't be spent here — only at a
                    Rest scene while the next chapter is in play — so the
                    moment it is earned is the moment to say where it goes. */}
                {newLevel === undefined ? null : (
                  <span className="complete-card__hint kad-muted">
                    <Icon name="rest" />
                    <span>New stat point! Spend it on your phone at the next rest stop.</span>
                  </span>
                )}
                {/* spec §9.5: what is in the bag right now is provisional until
                    the campaign is finished, so it is shown as "carrying", not
                    "won". */}
                <span className="complete-card__loot">
                  {member.character.inventory.length === 0 ? (
                    <span className="kad-muted">Empty bag</span>
                  ) : (
                    member.character.inventory.map((entry, i) => (
                      <span className="kad-chip" key={`${entry.itemId}-${String(i)}`}>
                        <Icon name={items?.[entry.itemId]?.icon ?? entry.kind} />
                        <span>{items?.[entry.itemId]?.name ?? entry.itemId}</span>
                      </span>
                    ))
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      {questItems.length === 0 ? null : (
        <div className="complete__quest">
          <h3 className="complete__quest-heading">
            <Icon name="quest" />
            <span>What the party found</span>
          </h3>
          <ul className="complete__quest-list">
            {questItems.map((entry) => (
              <li className="kad-chip" key={`${entry.owner}-${entry.itemId}`}>
                <Icon name={items?.[entry.itemId]?.icon ?? "quest"} />
                <span>
                  {items?.[entry.itemId]?.name ?? entry.itemId}{" "}
                  <span className="kad-muted">({entry.owner})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="complete__next kad-muted">
        <Icon name="travel" />
        <span>Tap “Keep going” on your phone.</span>
      </p>
    </section>
  );
}
