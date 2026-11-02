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
import { crewChoices, heroBlockedLine, heroHoldLine, heroHoldNote } from "./crew-copy";
import "./WelcomeBack.css";

function tierName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function WelcomeBack(): ReactElement {
  const state = useGameStore((s) => s.state);
  const listHeroes = useGameStore((s) => s.listHeroes);
  const savedHeroes = useGameStore((s) => s.savedHeroes);
  // What holds each hero, and what this room would do with her: a hero it
  // cannot seat says why on her own card, before anybody taps (#282, crews).
  const heldHeroes = useGameStore((s) => s.heldHeroes);
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
  // A hero this room could not seat when the list came is asked about again
  // on a tap: her other table may have let her go since (review of #596).
  const [rechecking, setRechecking] = useState<string | null>(null);

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

  const recheck = async (id: string): Promise<void> => {
    setRechecking(id);
    try {
      const found = await listHeroes();
      setHeroes(found);
      if (found.some((h) => h.id === id) && !useGameStore.getState().heldHeroes[id]?.blocked) setChosen(id);
    } catch {
      // Still blocked as far as anybody knows; the card keeps saying why.
    } finally {
      setRechecking(null);
    }
  };

  const hero = heroes.find((h) => h.id === chosen) ?? null;
  const note = hero && heldHeroes[hero.id] ? heroHoldNote(hero.name, heldHeroes[hero.id]!) : null;

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
            const hold = heldHeroes[h.id];
            const blocked = Boolean(hold?.blocked);
            const tone = blocked ? "bad" : hold?.crew || hold?.at ? "warn" : "calm";
            return (
              <li key={h.id}>
                <button
                  type="button"
                  className={`creation-card welcome-back__hero kad-tap kad-focusable${on ? " creation-card--on" : ""}${blocked ? " welcome-back__hero--blocked" : ""}`}
                  aria-pressed={on}
                  // Still focusable and read out, so the reason is never hidden; only choosing is off.
                  aria-disabled={blocked || undefined}
                  aria-busy={rechecking === h.id || undefined}
                  onClick={() => {
                    if (!blocked) setChosen(h.id);
                    else if (rechecking === null) void recheck(h.id);
                  }}
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
                    {/* A stopped game's own line already says where; the hold adds only another crew. */}
                    {hold && (!savedHeroes[h.id] || hold.crew) ? (
                      <span className={`creation-card__line welcome-back__hold welcome-back__hold--${tone}`}>
                        <Icon name={hold.crew ? "crew" : hold.at ? "travel" : "story"} />
                        <span>{heroHoldLine(hold)}</span>
                      </span>
                    ) : null}
                    {blocked ? (
                      <span className="kad-chip kad-chip--bad kad-chip--wrap welcome-back__blocked">{heroBlockedLine(hold!)}</span>
                    ) : null}
                    {blocked ? (
                      <span className="creation-card__line kad-muted">
                        {rechecking === h.id ? "Checking…" : "Tap to check again"}
                      </span>
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

        {note && !refused ? (
          <p className="kad-chip kad-chip--warn kad-chip--wrap welcome-back__note" role="status">
            <Icon name="crew" />
            <span>{note}</span>
          </p>
        ) : null}

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
