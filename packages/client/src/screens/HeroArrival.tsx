import { useEffect, useState, useSyncExternalStore } from "react";
import { useRunState, useSession } from "../store";
import { cue } from "../audio/cue";
import { CharacterPortrait } from "./CharacterPortrait";
import { heroArrivalSnapshot, subscribeHeroArrival, takeHeroArrival, type HeroArrivalTicket } from "./hero-arrival";
import "./HeroArrival.css";

export const HERO_ARRIVAL_MS = 2200;

/** A brief, nonblocking hello after creation, never inferred from reconnects. */
export function HeroArrival(): React.JSX.Element | null {
  const pending = useSyncExternalStore(subscribeHeroArrival, heroArrivalSnapshot);
  const [active, setActive] = useState<HeroArrivalTicket | null>(null);
  const session = useSession();
  const state = useRunState();
  useEffect(() => {
    if (!pending || !session) return;
    if (!takeHeroArrival(pending)) return;
    if (pending.runId !== session.runId || pending.playerId !== session.playerId) return;
    setActive(pending);
    if (!state?.quiet) cue("choice");
  }, [pending, session, state?.quiet]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(null), HERO_ARRIVAL_MS);
    return () => clearTimeout(timer);
  }, [active]);
  if (!active || active.runId !== session?.runId) return null;
  const hero = active.hero;
  return <div className="hero-arrival" role="status" aria-live="polite">
    <CharacterPortrait species={hero.species} characterClass={hero.class} tier={hero.tier}
      accent={hero.appearance.accent} lit className="hero-arrival__portrait" />
    <strong>Meet {hero.name}!</strong>
    <span>Your adventure is waiting.</span>
  </div>;
}
