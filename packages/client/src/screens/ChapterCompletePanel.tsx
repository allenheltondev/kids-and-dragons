/**
 * ChapterCompletePanel — WorldView when `phase === "chapter_complete"`.
 *
 * The end-of-sitting beat (spec §3, roadmap ch.3): XP for finishing the
 * chapter — not for killing things (spec §8.1) — what everyone is carrying,
 * and who grew.
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

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { speak } from "@kad/shared";
import type { TierId } from "@kad/shared";
import { useItems, useParty, useProgression, useRunState } from "../store";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import { useEnsureContent } from "./content";
import "./shared.css";
import "./ChapterCompletePanel.css";

export function ChapterCompletePanel(): ReactElement {
  useEnsureContent();
  const state = useRunState();
  const party = useParty();
  const items = useItems();
  const [leveled, setLeveled] = useState<Record<string, number>>({});
  const [transformed, setTransformed] = useState<Record<string, string>>({});

  useProgression(
    useCallback((event) => {
      for (const award of event.progression.awards ?? []) {
        if (award.leveledTo !== undefined) {
          setLeveled((prev) => ({ ...prev, [award.characterId]: award.leveledTo! }));
        }
        if (award.newTier !== undefined) {
          setTransformed((prev) => ({ ...prev, [award.characterId]: award.newTier! }));
        }
      }
    }, []),
  );

  const xp = state?.xpEarned ?? 0;
  /*
   * Absent means success, the same default `completeChapter` applies — a run
   * persisted before the field existed, or a chapter authored before setbacks
   * did, must not read as a setback on the strength of a missing key.
   */
  const setback = state?.chapterOutcome === "setback";
  const bonuses = state?.bonuses ?? [];
  const heading = setback ? "The story took a turn" : "Chapter finished!";

  // Spoken once — the summary is narration like any other (spec §11).
  const spoken = useRef(false);
  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    speak(
      setback
        ? `The story took a turn. The party earned ${String(xp)} experience, and the adventure keeps going.`
        : `Chapter finished! The party earned ${String(xp)} experience.`,
    );
  }, [xp, setback]);

  const questItems = party.flatMap((m) =>
    m.character.questItems.map((itemId) => ({ itemId, owner: m.character.name })),
  );

  return (
    <section className="complete" aria-labelledby="complete-heading">
      <header className="complete__head">
        <h2 className="complete__heading" id="complete-heading">
          {/* Icon and words carry the difference — never colour (spec §11). */}
          <Icon name={setback ? "scroll" : "trophy"} />
          <span>{heading}</span>
        </h2>
        <p className="complete__xp">
          <Icon name="star" />
          <span>
            {/* Per chapter, never per player (spec §8.1) — "for everyone" is
                the line that keeps the youngest player from counting hers
                against the adults'. */}
            <b>{xp}</b> XP for everyone
          </span>
        </p>
        {setback ? (
          <p className="complete__setback">
            <Icon name="forward" />
            <span>Not how you hoped — and the adventure carries on from here.</span>
          </p>
        ) : null}
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
          </h3>
          <ul className="complete__bonus-list">
            {bonuses.map((bonus) => (
              <li className="complete-bonus" key={bonus.id}>
                <Icon name="check" />
                <span className="complete-bonus__label">{bonus.label}</span>
                {/* A clamped objective can honestly pay 0 (the 25% budget is
                    shared). It still shows: the party did the thing. */}
                <span className="complete-bonus__xp kad-muted">+{bonus.xp}</span>
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
                  species={member.character.species}
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
