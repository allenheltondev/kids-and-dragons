/**
 * "Look": her hero's name style in the adventure book (docs/hero-looks.md
 * §8.1; #664), on the tray beside Camp.
 *
 * Built like the kit's dressing room (CampPane.tsx, BookKit.tsx): her hero up
 * top wearing the look as she taps, then the Nameplate and Title shelves
 * (LookEditor.tsx `BookLook`). Every tap saves itself, behind the scenes,
 * through the kit's own queue, sender and endpoint, with the look's fields as
 * change kinds of their own (store/kit-queue.ts, store/book-kit-sync.ts): at
 * once with a signal, queued on the phone without one, the last choice for
 * each field standing. A family tablet keeps nothing: its taps show at once
 * from memory and are sent in order. Nothing says "saving"; only a pick the
 * server could not keep says so.
 *
 * Lazy: JournalScreen loads this chunk the first time "Look" is opened.
 */

import { useEffect, useReducer, useState } from "react";
import type { ReactElement } from "react";
import type { JournalResponse, ResolvedCharacter } from "@kad/shared";
import { Icon } from "./icons";
import { BookLook, type LookChange } from "./LookEditor";
import { HeroName } from "./HeroName";
import { CharacterPortrait } from "./CharacterPortrait";
import { loadPlayerDeviceToken } from "../store/persistence";
import { loadKitQueue, withQueuedLook } from "../store/kit-queue";
import { bookKitStatus, clearBookKitNotes, editBookKit, onBookKit, pendingKitEdits, type ApplyKit } from "../store/book-kit-sync";
import { BOOK_LOOK_FIELDS, type BookKitChange } from "@kad/shared";
import "./BookKit.css";
import "./CampPane.css";

export interface LookPaneProps {
  journal: JournalResponse;
  /** The hero the book has open, and a way to open another. */
  hero: ResolvedCharacter | null;
  onHero: (id: string) => void;
  /** What the server answered with, for the book's copy. */
  onKit: ApplyKit;
}

export default function LookPane({ journal, hero, onHero, onKit }: LookPaneProps): ReactElement {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onBookKit(rerender), []);
  const [error, setError] = useState<string | null>(null);

  if (!hero) {
    return (
      <Frame>
        <section className="book-camp__empty" data-testid="book-look-empty">
          <Icon name="star" size="2.4em" />
          <h2 className="book-camp__empty-title">No hero yet</h2>
          <p>Make a hero in your next game, and you can pick her nameplate and title here.</p>
        </section>
      </Frame>
    );
  }

  // What she has changed and is not yet answered: the phone's queue, or a family tablet's sends in flight.
  const queue = [...loadKitQueue(loadPlayerDeviceToken()), ...pendingKitEdits()];
  const look = withQueuedLook(hero.look, hero.id, queue);
  const status = bookKitStatus();

  const edit = (change: LookChange): void => {
    const changes: BookKitChange[] = [];
    for (const field of BOOK_LOOK_FIELDS) {
      const after = change[field];
      if (after === undefined || after === look[field]) continue;
      changes.push({ field, before: look[field], after });
    }
    if (changes.length === 0) return;
    setError(null);
    editBookKit({ characterId: hero.id, crew: null, changes }, onKit).catch((e: unknown) => {
      setError(e instanceof Error && e.message ? e.message : "Your look could not be saved.");
    });
  };

  return (
    <Frame>
      <div className="book-camp__body">
        {journal.heroes.length > 1 ? (
          <div className="book-camp__heroes" role="radiogroup" aria-label="Whose look">
            {journal.heroes.map((h) => (
              <button
                key={h.id}
                type="button"
                role="radio"
                aria-checked={h.id === hero.id}
                className={`journal__pick kad-tap kad-focusable${h.id === hero.id ? " journal__pick--on" : ""}`}
                onClick={() => onHero(h.id)}
              >
                <span className="journal__pick-art" aria-hidden="true">
                  <CharacterPortrait backdrop species={h.species} accent={h.appearance.accent} tier={h.tier} characterClass={h.class} lit={h.id === hero.id} />
                </span>
                <span className="journal__pick-name">
                  <HeroName name={h.name} look={withQueuedLook(h.look, h.id, queue)} />
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {status.notes.length > 0 ? (
          <div className="book-camp__note" role="status" data-testid="book-look-note">
            <Icon name="hand" />
            <p>{status.notes.join(" ")}</p>
            <button type="button" className="book-camp__note-ok kad-tap kad-focusable" onClick={clearBookKitNotes}>
              OK
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="book-camp__error" role="alert">
            {error}
          </p>
        ) : null}

        <BookLook hero={hero} look={look} edit={edit} />
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      <div className="book-camp book-look-page kad-scroll" data-testid="book-look">{children}</div>
    </div>
  );
}
