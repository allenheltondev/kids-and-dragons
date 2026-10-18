/**
 * JournalScreen — between games (`/journal`).
 *
 * A phone that is not in a game can still open the things a game leaves
 * behind and just look: your hero, the bag they carry, the atlas with every
 * country the household has found, and the Field Guide. Nothing here sends an
 * intent or can change anything, so there is nothing to get wrong — it is the
 * book you leaf through in the car, not the table.
 *
 * Shaped like Travel Mode on purpose (layout/TravelLayout.tsx): one surface at
 * a time over the same tray of objects, so the journal and the game feel like
 * one place. The tray's last object is the way into a game, and it goes home,
 * where joining and hosting already live.
 *
 * Its data is one read (`GET /api/journal`), authorised by this phone's
 * device binding rather than a room, because there is no room. Where there is
 * no signal it opens last time's copy and says so (`JournalLoad.savedAt`);
 * the service worker (src/sw/) is what lets the page, the map and the guide
 * open there too.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { JournalFinishedCampaign, JournalResponse, PartyMember, ResolvedCharacter } from "@kad/shared";
import { navigate } from "../router";
import { useGameStore, useItems, useWorld } from "../store";
import { setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { setJournalFinders } from "../store/journal-finders";
import { selectGuideEntry } from "../store/player-navigation";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { CharacterPortrait } from "./CharacterPortrait";
import { CharacterSheet } from "./CharacterSheet";
import { FieldGuide } from "./FieldGuide";
import { Icon } from "./icons";
import { TrayObject } from "./TrayObjects";
import { Atlas, AtlasUnrolling, placeOf } from "./WorldMapPanel";
import { loadFieldGuide, useEnsureContent, useEnsureWorld } from "./content";
import { offlineArtFor, warm } from "../sw/warm";
import "./shared.css";
import "./JournalScreen.css";

export type JournalPane = "hero" | "map" | "guide" | "me";

/**
 * Her own page (#299) is a chunk of its own, fetched the first time "Me" is
 * opened: the book's first look stays the hero, and nothing of the page is in
 * the journal chunk, let alone the first paint.
 */
const ProfilePane = lazy(() => import("./ProfilePane"));

/**
 * A saved hero as the sheet and the atlas want them: a party member at full
 * health, standing nowhere in particular. Between games nobody is hurt.
 */
export function restingMember(hero: ResolvedCharacter): PartyMember {
  return {
    character: hero,
    playerId: hero.ownerPlayerId,
    hp: hero.maxHp,
    down: false,
    connected: true,
    ready: false,
  };
}

type Load =
  | { status: "loading" }
  /** `savedAt` set: last time's book, because the server could not be reached. */
  | { status: "ready"; journal: JournalResponse; savedAt: string | null }
  /** This phone has never played: no binding, so nobody to look at. */
  | { status: "new" }
  | { status: "failed" };

export function JournalScreen(): ReactElement {
  const loadJournal = useGameStore((s) => s.loadJournal);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pane, setPane] = useState<JournalPane>("hero");

  useEffect(() => {
    let live = true;
    // A retry over a saved copy keeps showing it until something better lands.
    setLoad((was) => (was.status === "ready" ? was : { status: "loading" }));
    loadJournal().then(
      (found) => {
        if (live) setLoad(found === null ? { status: "new" } : { status: "ready", ...found });
      },
      () => {
        if (live) setLoad({ status: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [loadJournal, attempt]);

  /*
   * The guide reads the household's book from its own store, which a room
   * normally feeds. Out of a room the journal feeds it, and takes it away
   * again on the way out so the next room starts from its own book.
   */
  const journal = load.status === "ready" ? load.journal : null;
  useEffect(() => {
    if (journal === null) return;
    setFieldGuideDiscoveries(journal.fieldGuide);
    setJournalFinders(journal.finders);
    return () => {
      setFieldGuideDiscoveries(null);
      setJournalFinders(null);
      selectGuideEntry(null);
    };
  }, [journal]);

  /*
   * A fresh read means a signal: save the art the book shows offline while
   * there is one (sw/warm.ts). The map and the guide's index both open
   * without it, but a painting is what a map is for.
   */
  const fresh = load.status === "ready" && load.savedAt === null;
  useEffect(() => {
    if (!fresh || journal === null) return;
    let live = true;
    const loadWorld = useGameStore.getState().loadWorld;
    void Promise.all([loadWorld(), loadFieldGuide().catch(() => null)]).then(([, guide]) => {
      if (!live) return;
      void warm(offlineArtFor(useGameStore.getState().world, guide, Object.keys(journal.fieldGuide)), { essential: true });
    });
    return () => {
      live = false;
    };
  }, [fresh, journal]);

  const play = useCallback(() => navigate({ name: "home" }), []);

  if (load.status !== "ready") {
    return (
      <main className="journal journal--waiting">
        <div className="journal__card">
          {load.status === "loading" ? (
            <div className="journal__busy" role="status">
              <Spinner />
              <span>Opening your adventure book…</span>
            </div>
          ) : (
            <>
              <h1 className="journal__title">
                <Icon name="scroll" />
                <span>{load.status === "new" ? "Your adventure book is empty" : "The book would not open"}</span>
              </h1>
              <p className="journal__hint kad-muted">
                {load.status === "new"
                  ? "Join a game and make a hero. Everything you find goes in here."
                  : "We could not reach your adventures just now."}
              </p>
              {load.status === "failed" ? (
                <Button variant="secondary" size="lg" block icon={<Icon name="forward" />}
                  onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </Button>
              ) : null}
              <Button variant="primary" size="lg" block icon={<Icon name="play" />} onClick={play}>
                Play a game
              </Button>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="kad-travel journal">
      <nav className="kad-travel__bar kad-tray" aria-label="What to look at">
        <TrayTab on={pane === "hero"} object="satchel" label="Hero" onClick={() => setPane("hero")} />
        <TrayTab on={pane === "map"} object="map" label="Map" onClick={() => setPane("map")} />
        <TrayTab on={pane === "guide"} object="fieldGuide" label="Guide" onClick={() => setPane("guide")} />
        {load.journal.profile ? (
          <TrayTab on={pane === "me"} object="scroll" label="Me" onClick={() => setPane("me")} />
        ) : null}
        <TrayTab on={false} object="lantern" label="Play" onClick={play} />
      </nav>
      {load.savedAt !== null ? (
        <p className="journal__stale" role="status">
          <Icon name="waiting" />
          <span>No signal — this is your book from {savedWhen(load.savedAt)}.</span>
          <button type="button" className="journal__stale-retry kad-focusable" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      ) : null}
      <div className="kad-travel__pane" data-pane={pane} data-showing>
        {pane === "hero" ? <HeroPane journal={load.journal} onPlay={play} /> : null}
        {pane === "map" ? <MapPane journal={load.journal} /> : null}
        {pane === "me" ? (
          <Suspense fallback={<div className="journal__busy" role="status"><Spinner /><span>Opening your page…</span></div>}>
            <ProfilePane journal={load.journal} />
          </Suspense>
        ) : null}
        {pane === "guide" ? (
          <div className="kad-surface kad-surface--player" data-surface="player">
            <FieldGuide backToBag={false} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** "earlier today", "yesterday", or a date — a kid reads "from last time", not a timestamp. */
export function savedWhen(savedAt: string, now: Date = new Date()): string {
  const saved = new Date(savedAt);
  if (Number.isNaN(saved.getTime())) return "last time";
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(saved)) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  return saved.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function TrayTab({ on, object, label, onClick }: {
  on: boolean;
  object: Parameters<typeof TrayObject>[0]["name"];
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button"
      className={`kad-travel__tab kad-tray__tab kad-tap kad-focusable${on ? " kad-travel__tab--on kad-tray__tab--on" : ""}`}
      aria-pressed={on} onClick={onClick}>
      <span className="kad-tray__object"><TrayObject name={object} /></span>
      <span className="kad-tray__label">{label}</span>
    </button>
  );
}

/**
 * Which hero is open, remembered for the life of the page so the map and the
 * sheet agree on who is standing where. Module state, like MapView's flip.
 */
let chosenHero: string | null = null;

function useChosenHero(heroes: readonly ResolvedCharacter[]): [ResolvedCharacter | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(chosenHero);
  const hero = heroes.find((h) => h.id === id) ?? heroes[0] ?? null;
  const choose = (next: string): void => {
    chosenHero = next;
    setId(next);
  };
  return [hero, choose];
}

function HeroPane({ journal, onPlay }: { journal: JournalResponse; onPlay: () => void }): ReactElement {
  useEnsureContent();
  const items = useItems();
  const [hero, choose] = useChosenHero(journal.heroes);

  if (hero === null) {
    return (
      <div className="kad-surface kad-surface--player" data-surface="player">
        <section className="journal__empty">
          <Icon name="name" size="2.4em" />
          <p>No hero yet. Make one in your next game, and they will be waiting here.</p>
          <Button variant="primary" size="lg" icon={<Icon name="play" />} onClick={onPlay}>
            Play a game
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      <section className="journal__hero kad-scroll">
        {journal.heroes.length > 1 ? (
          <ul className="journal__heroes" aria-label="Your heroes">
            {journal.heroes.map((h) => {
              const on = h.id === hero.id;
              return (
                <li key={h.id}>
                  <button type="button" className={`journal__pick kad-tap kad-focusable${on ? " journal__pick--on" : ""}`}
                    aria-pressed={on} onClick={() => choose(h.id)}>
                    <span className="journal__pick-art" aria-hidden="true">
                      <CharacterPortrait backdrop species={h.species} accent={h.appearance.accent}
                        tier={h.tier} characterClass={h.class} lit={on} />
                    </span>
                    <span className="journal__pick-name">{h.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <CharacterSheet key={hero.id} member={restingMember(hero)} isMe items={items} explore />
        <FinishedAdventures lines={journal.finished?.[hero.id] ?? []} />
      </section>
    </div>
  );
}

/**
 * The adventures this hero has seen to the end (#283). Her own record, so one
 * she finished at a friend's table is here too. Nothing shows until there is
 * one: a new hero's book has no empty list in it.
 */
function FinishedAdventures({ lines }: { lines: readonly JournalFinishedCampaign[] }): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <section className="journal__finished" aria-label="Adventures finished">
      <h2 className="journal__finished-title">
        <Icon name="star" />
        <span>Adventures finished</span>
      </h2>
      <ul className="journal__finished-list">
        {lines.map((line) => (
          <li key={line.campaignId} className="journal__finished-line">
            <Icon name="check" />
            <span>{line.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MapPane({ journal }: { journal: JournalResponse }): ReactElement {
  useEnsureWorld();
  const world = useWorld();
  const [hero] = useChosenHero(journal.heroes);
  return (
    <div className="kad-surface kad-surface--map" data-surface="map">
      <div className="kad-map__host" data-map="world">
        {world === null ? <AtlasUnrolling /> : (
          <Atlas world={world} place={placeOf(world, journal.whereabouts?.biome)}
            party={hero ? [restingMember(hero)] : []} scope="journal" here="last" />
        )}
      </div>
    </div>
  );
}
