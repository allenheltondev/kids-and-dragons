/**
 * ChapterCompletePanel — WorldView when `phase === "chapter_complete"`.
 *
 * The end-of-sitting beat (spec §3, roadmap ch.3): XP for finishing the
 * chapter — not for killing things (spec §8.1) — what everyone is carrying,
 * and who grew.
 *
 * Level and tier *changes* come from the LEVEL_UP and TRANSFORM presentation
 * events rather than from state: `RunState` carries the party's current level,
 * not its previous one, and the protocol already announces the change
 * (architecture §4.2). A client that joined after the event simply sees the
 * new level without the fanfare, which is the right failure.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { speak } from "@kad/shared";
import { useItems, useParty, usePresentation, useRunState } from "../store";
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

  usePresentation(
    "LEVEL_UP",
    useCallback((event) => {
      if (event.kind !== "LEVEL_UP") return;
      setLeveled((prev) => ({ ...prev, [event.characterId]: event.level }));
    }, []),
  );

  usePresentation(
    "TRANSFORM",
    useCallback((event) => {
      if (event.kind !== "TRANSFORM") return;
      setTransformed((prev) => ({ ...prev, [event.characterId]: event.tier }));
    }, []),
  );

  const xp = state?.xpEarned ?? 0;

  // Spoken once — the summary is narration like any other (spec §11).
  const spoken = useRef(false);
  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    speak(`Chapter finished! The party earned ${String(xp)} experience.`);
  }, [xp]);

  const questItems = party.flatMap((m) =>
    m.character.questItems.map((itemId) => ({ itemId, owner: m.character.name })),
  );

  return (
    <section className="complete" aria-labelledby="complete-heading">
      <header className="complete__head">
        <h2 className="complete__heading" id="complete-heading">
          <Icon name="trophy" />
          <span>Chapter finished!</span>
        </h2>
        <p className="complete__xp">
          <Icon name="star" />
          <span>
            <b>{xp}</b> XP for everyone
          </span>
        </p>
      </header>

      <ul className="complete__party">
        {party.map((member) => {
          const newLevel = leveled[member.character.id];
          const newTier = transformed[member.character.id];
          return (
            <li className="complete-card" key={member.playerId}>
              <span className="complete-card__portrait" aria-hidden="true">
                <Icon name={member.character.species} size="2rem" />
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
