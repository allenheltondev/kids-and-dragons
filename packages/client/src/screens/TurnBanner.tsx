/**
 * "Skyclaw's turn!" — across the shared screen each time the fight's clock
 * lands on a hero.
 *
 * The board already rings the active figure, but a ring is something you find
 * once you are looking at the board; a table of kids is looking at each other.
 * The banner is what tells the room whose phone matters now. Monster turns
 * get none: they resolve in a beat on their own, and a banner for every wisp
 * would bury the one that means "you".
 *
 * Keyed on the turn, not on the state, so a patch inside one turn (a step, a
 * hit) never replays it. The animation shows it and takes it away; there is
 * no timer to clean up and nothing to tap.
 */

import type { ReactElement } from "react";
import { currentActor } from "@kad/shared";
import { useParty, useRunState } from "../store";
import { CharacterPortrait } from "./CharacterPortrait";
import "./TurnBanner.css";

export function TurnBanner(): ReactElement | null {
  const state = useRunState();
  const party = useParty();
  const encounter = state?.encounter ?? null;
  if (!encounter) return null;
  const active = currentActor(encounter);
  if (!active || active.side !== "party") return null;
  const member = party.find((m) => m.character.id === active.id);
  const name = member?.character.name ?? active.name;

  return (
    <div className="turn-banner" key={`${active.id}:${encounter.round}:${encounter.turnIndex}`} role="status">
      {member ? (
        <CharacterPortrait
          backdrop
          species={member.character.species}
          accent={member.character.appearance.accent}
          tier={member.character.tier}
          characterClass={member.character.class}
          className="turn-banner__face"
        />
      ) : null}
      <span>{name}&rsquo;s turn!</span>
    </div>
  );
}
