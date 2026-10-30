/**
 * WelcomeBack — PlayerView when I have no character here, but I have played
 * before.
 *
 * spec §5: a character "persists to the player's profile within the household
 * and can be reused across campaigns". So a phone that joins a new room is
 * asked who it is bringing before it is asked to make anybody: the heroes this
 * player has saved, at the level and tier they reached, and a way to make
 * someone new instead. With nobody saved, this is just the creation flow — the
 * first-ever evening looks exactly as it always did.
 *
 * Tap to choose, then confirm (spec §11): nothing is sent until "Play as …".
 * Bringing a hero is a SEAT_CHARACTER naming its id; the server reloads the
 * row, so nothing about the hero travels from this phone but which one.
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { ResolvedCharacter } from "@kad/shared";
import { useGameStore, useSend, useSynced } from "../store";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { CharacterPortrait } from "./CharacterPortrait";
import { CreationFlow } from "./CreationFlow";
import { Icon } from "./icons";
import "./shared.css";
import "./CreationFlow.css";
import { savedHeroLine } from "./save-copy";
import { crewChoices } from "./crew-copy";
import "./WelcomeBack.css";

function tierName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function WelcomeBack(): ReactElement {
  const state = useGameStore((s) => s.state);
  const listHeroes = useGameStore((s) => s.listHeroes);
  const savedHeroes = useGameStore((s) => s.savedHeroes);
  const send = useSend();
  const [heroes, setHeroes] = useState<ResolvedCharacter[] | null>(null);
  const [makeNew, setMakeNew] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Held while catching up after a drop, like every answer (#413).
  const synced = useSynced();
  // Why the server would not seat the hero, in its words: "Sparklehoof is in
  // the middle of another adventure" (#282) names her, so it is shown as is.
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // A list that cannot be fetched is the same as an empty one: the phone
    // can always make someone new, and must never be stuck on a spinner.
    listHeroes()
      .then((found) => {
        if (live) setHeroes(found);
      })
      .catch(() => {
        if (live) setHeroes([]);
      });
    return () => {
      live = false;
    };
  }, [listHeroes]);

  if (state?.crewSetup) return <CreationFlow crewName={crewChoices(state).current} />;

  if (makeNew || (heroes !== null && heroes.length === 0)) return <CreationFlow />;

  if (heroes === null) {
    return (
      <div className="creation creation--loading" role="status">
        <Spinner />
        <span>Looking for your heroes…</span>
      </div>
    );
  }

  const hero = heroes.find((h) => h.id === chosen) ?? null;

  const bring = async (): Promise<void> => {
    if (hero === null) return;
    setBusy(true);
    setRefused(null);
    // On success the server seats them and this screen gives way to the
    // player panel on the next patch; there is nothing to do here.
    const accepted = await send({ type: "SEAT_CHARACTER", characterId: hero.id });
    setBusy(false);
    if (!accepted) {
      setRefused(useGameStore.getState().error ?? "That hero could not join this game.");
    }
  };

  return (
    <section className="creation welcome-back" aria-labelledby="welcome-back-title">
      <header className="creation__head">
        <h2 className="creation__title" id="welcome-back-title">
          <Icon name="lantern" />
          <span>Welcome back! Who are you bringing?</span>
        </h2>
      </header>

      <div className="creation__body kad-scroll">
        <ul className="creation-grid welcome-back__heroes">
          {heroes.map((h) => {
            const on = h.id === chosen;
            return (
              <li key={h.id}>
                <button
                  type="button"
                  className={`creation-card welcome-back__hero kad-tap kad-focusable${on ? " creation-card--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setChosen(h.id)}
                >
                  <span className="welcome-back__art" aria-hidden="true">
                    <CharacterPortrait
                      backdrop
                      species={h.species}
                      accent={h.appearance.accent}
                      tier={h.tier}
                      characterClass={h.class}
                      lit={on}
                    />
                  </span>
                  <span className="creation-card__text">
                    <span className="creation-card__title">
                      <span>{h.name}</span>
                      <span className="creation-card__mark">
                        {on ? <Icon name="check" label="Chosen" /> : null}
                      </span>
                    </span>
                    {savedHeroes[h.id] ? (
                      <span className="creation-card__line kad-muted">{savedHeroLine(h.name, savedHeroes[h.id]!)}</span>
                    ) : null}
                    <span className="creation-card__line kad-muted">
                      <Icon name={h.class} />
                      <span>
                        Level {h.level} · {tierName(h.tier)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {refused ? (
          <p className="kad-chip kad-chip--bad kad-chip--wrap" role="alert">
            <Icon name="close" />
            <span>{refused.replace(/\.$/, "")}. Try another, or make a new hero for this one.</span>
          </p>
        ) : null}
      </div>

      <footer className="creation__foot">
        <Button variant="secondary" size="lg" icon={<Icon name="play" />} disabled={busy} onClick={() => setMakeNew(true)}>
          {refused ? "Make a new hero for this one" : "Make someone new"}
        </Button>
        <Button
          variant="primary"
          size="lg"
          icon={<Icon name="forward" />}
          disabled={hero === null || busy || !synced}
          onClick={() => void bring()}
        >
          {hero === null ? "Pick a hero" : busy ? "Joining…" : `Play as ${hero.name}`}
        </Button>
      </footer>
    </section>
  );
}
