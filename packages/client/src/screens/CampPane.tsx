/**
 * "Camp": the crew's camp in the adventure book (docs/camp.md §7, §12.6; #629).
 *
 * The fifth object on the book's tray. It shows a crew's whole camp as the
 * phone's Camp panel does (StillCamp, `fit="width"`), pitched in the terrain
 * where the household last adventured (`campBackdropFamily`), with the kid's
 * hero at her tent and the crew's friends out by the fire: her buddy first,
 * then the friends who have been out least, as a table would choose them.
 *
 * Look-only, apart from what is hers alone:
 *
 *   - **The crew's camp** cannot change here: no spot, no purchase, no vote.
 *     Every piece is listed with its name and where it came from ("Found at
 *     the Ashspan Bridge"), and every friend with where the crew met it.
 *   - **Friends** can be tapped. With no TV to walk over on, a tapped friend
 *     says one of its reactions in a speech bubble under the friends' buttons,
 *     here only: nothing is sent, and no table hears it. Not over its head in
 *     the picture, where at camp scale it covered the figures' names.
 *   - **Her hero's kit** (tent, bedroll and pack, color, decorations) and her
 *     **buddy** in this crew's camp, first on the page: her pitch and one
 *     shelf of painted tiles at a time (BookKit.tsx), on the table's rules.
 *     While she is seated at a live game in downtime, a tap hands her to the
 *     game's Camp panel instead (book-table.tsx): there is one editor then.
 *     Every tap saves itself, behind the scenes (store/book-kit-sync.ts): at
 *     once, queued on the phone when there is no signal, and applied when it
 *     is sent, over anything changed meanwhile (the device wins, §11). Nothing
 *     says "saving" (owner, 2026-11-07); only a pick the server refused, or
 *     one the phone could not keep, says so.
 *
 * Named crew (a picker when her heroes sit with more than one), and a
 * first-visit word when there is nothing to show yet.
 * Lazy: JournalScreen loads this chunk the first time "Camp" is opened, so
 * none of the camp is in the journal chunk, let alone the first paint.
 */

import { useEffect, useId, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { bookKitChanges, friendsOut } from "@kad/shared";
import type { BookKitState, CampFriendCard, ClientIntent, HeroKitView, JournalCrewCamp, JournalFriend, JournalKit, JournalResponse, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { Icon } from "./icons";
import { FriendArt } from "./CampPanel";
import { BookKit, kitArtUrls } from "./BookKit";
import { BookTableNote, handOffToCamp, useBookTable } from "./book-table";
import { StillCamp } from "../world/StillCamp";
import { campLayoutFor } from "../world/lobby-camp";
import { campBackdropFamily } from "../world/camp-backdrop";
import { CREW_PIECE_ART, pieceName } from "../world/camp-scene";
import { CharacterPortrait } from "./CharacterPortrait";
import { loadPlayerDeviceToken } from "../store/persistence";
import { journalKitState, loadKitQueue, withQueuedKit } from "../store/kit-queue";
import { bookKitStatus, clearBookKitNotes, editBookKit, onBookKit, pendingKitEdits, type ApplyKit } from "../store/book-kit-sync";
import { warm } from "../sw/warm";
import "./CampPane.css";

export interface CampPaneProps {
  journal: JournalResponse;
  /** A fresh read (with a signal): the camp's art is saved for offline while there is one. */
  fresh: boolean;
  /** The hero the book has open, and a way to open another. */
  hero: ResolvedCharacter | null;
  onHero: (id: string) => void;
  /** A kit the server answered with, for the book's copy. */
  onKit: ApplyKit;
}

/** px of grass under the picture's band, so the names under the figures at its foot stay whole. */
const FOOT_ROOM = 30;

/** Which crew is open, for the life of the page, like the hero (JournalScreen `useChosenHero`). */
let chosenCrew: string | null | undefined;

/** Each friend's next reaction, round and round, for the life of the page. */
const reactionAt = new Map<string, number>();

export default function CampPane({ journal, fresh, hero, onHero, onKit }: CampPaneProps): ReactElement {
  const camp = journal.camp;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onBookKit(rerender), []);
  const [crewId, setCrewId] = useState<string | null | undefined>(chosenCrew);
  const crew = camp?.crews.find((c) => c.crew === (crewId ?? null)) ?? camp?.crews[0] ?? null;
  const chooseCrew = (id: string | null): void => {
    chosenCrew = id;
    setCrewId(id);
  };

  if (!camp || !crew) {
    return (
      <Frame>
        <section className="book-camp__empty" data-testid="book-camp-empty">
          <Icon name="rest" size="2.4em" />
          <h2 className="book-camp__empty-title">Your camp is on its way</h2>
          <p>Open your book once while your phone has a signal, and your crew's camp comes along for next time.</p>
        </section>
      </Frame>
    );
  }
  if (!hero) {
    return (
      <Frame>
        <section className="book-camp__empty" data-testid="book-camp-empty">
          <Icon name="rest" size="2.4em" />
          <h2 className="book-camp__empty-title">No hero at camp yet</h2>
          <p>Make a hero in your next game, and your camp will be waiting here.</p>
        </section>
      </Frame>
    );
  }
  return (
    <Frame>
      <CrewCamp
        key={`${hero.id}:${crew.crew ?? ""}`}
        journal={journal}
        crews={camp.crews}
        crew={crew}
        onCrew={chooseCrew}
        hero={hero}
        onHero={onHero}
        serverKit={camp.kits[hero.id] ?? null}
        fresh={fresh}
        onKit={onKit}
      />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      <div className="book-camp kad-scroll" data-testid="book-camp">{children}</div>
    </div>
  );
}

/** A hero at rest, as the camp seats her (the book has no table: she is the one seated). */
function seated(hero: ResolvedCharacter): PartyMember {
  return { character: hero, playerId: hero.ownerPlayerId, hp: hero.maxHp, down: false, connected: true, ready: false };
}

/** A kit as the table's screens draw and edit it, with her buddy in this crew's camp. */
function kitView(kit: JournalKit, crew: string | null): HeroKitView {
  const buddy = kit.buddies[crew ?? ""];
  const { buddies: _buddies, ...rest } = kit;
  return { ...rest, ...(buddy ? { buddy } : {}) };
}

/**
 * The run state the still camp reads (StillCamp, lobby-camp.ts), made from the
 * book: her hero seated alone, her kit, the crew's camp, and its friends out.
 * A lobby, outdoors, with nothing changed in it: the camp as it stands.
 */
function bookState(crews: readonly JournalCrewCamp[], crew: JournalCrewCamp, hero: ResolvedCharacter, kit: HeroKitView, out: readonly string[]): RunState {
  const first = crews.find((c) => c.crew === null);
  return {
    phase: "lobby",
    roomCode: "BOOK",
    runId: "book",
    visited: [],
    party: [seated(hero)],
    removed: [],
    kits: { [hero.id]: kit },
    camp: crew.camp,
    campMoment: {
      id: "book",
      kind: "lobby",
      outdoor: true,
      changes: {},
      friends: { rotation: crew.friends.map((f) => f.id), out: [...out], cards: crew.friends.map(card) },
    },
    ...(crew.crew ? { crew: crew.crew } : {}),
    crews: crews.filter((c) => c.crew !== null).map((c) => ({ id: c.crew!, name: c.name })),
    ...(first ? { firstCrewName: first.name } : {}),
  } as unknown as RunState;
}

function card(friend: JournalFriend): CampFriendCard {
  return { id: friend.id, name: friend.name, figure: friend.figure, ...(friend.size ? { size: friend.size } : {}) };
}

function CrewCamp({
  journal,
  crews,
  crew,
  onCrew,
  hero,
  onHero,
  serverKit,
  fresh,
  onKit,
}: {
  journal: JournalResponse;
  crews: readonly JournalCrewCamp[];
  crew: JournalCrewCamp;
  onCrew: (id: string | null) => void;
  hero: ResolvedCharacter;
  onHero: (id: string) => void;
  serverKit: JournalKit | null;
  fresh: boolean;
  onKit: ApplyKit;
}): ReactElement {
  const base = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const deviceToken = loadPlayerDeviceToken();
  // What she has changed and is not yet answered: the phone's queue, or a family tablet's sends in flight.
  const queue = [...loadKitQueue(deviceToken), ...pendingKitEdits()];
  const status = bookKitStatus();
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!words) return;
    const timer = setTimeout(() => setWords(null), 5000);
    return () => clearTimeout(timer);
  }, [words]);

  const shown = serverKit ? withQueuedKit(serverKit, hero.id, queue) : null;
  const kit = shown ? kitView(shown, crew.crew) : null;
  const out = friendsOut(crew.friends.map((f) => f.id), [kit?.buddy]);
  const family = campBackdropFamily(journal.whereabouts?.biome ?? null);
  const layout = campLayoutFor(crew.camp.frameStage, family);
  const state = kit ? bookState(crews, crew, hero, kit, out) : null;

  /*
   * A fresh read means a signal: save the camp's art (the backdrop, her tent and
   * gear, the pieces, the friends, the kit's choices) while there is one, so the
   * camp opens offline as it does now (sw/warm.ts). Read off what is drawn.
   */
  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => {
      const el = root.current;
      if (!el) return;
      const urls = new Set<string>();
      for (const img of el.querySelectorAll("img")) if (img.getAttribute("src")) urls.add(img.getAttribute("src")!);
      for (const image of el.querySelectorAll("image")) if (image.getAttribute("href")) urls.add(image.getAttribute("href")!);
      // And every shelf of her kit, opened or not (BookKit shows one shelf at a time).
      for (const url of kitArtUrls(serverKit ?? { unlocked: [] }, crew.friends.map(card))) urls.add(url);
      void warm([...urls].filter((u) => u.startsWith("/")), { essential: true });
    }, 1500);
    return () => clearTimeout(timer);
  }, [fresh, crew.crew, hero.id]);

  // Seated at a live game: in downtime its Camp panel is her editor (book-table.tsx).
  const table = useBookTable(hero.id);
  const edit = (change: Omit<Extract<ClientIntent, { type: "KIT_EDIT" }>, "type" | "characterId" | "revision">): void => {
    if (table?.downtime) {
      // Her decorations and buddy are lower in the panel than her tent, bedroll and color.
      handOffToCamp(table, { hero: hero.id, part: change.slots !== undefined || change.buddy !== undefined ? "decor" : "tent" });
      return;
    }
    if (!shown || !serverKit) return;
    const now: BookKitState = journalKitState(shown, crew.crew);
    const next: BookKitState = {
      style: change.style ?? now.style,
      tent: change.tent ?? now.tent,
      color: change.color !== undefined ? change.color : now.color,
      slots: change.slots ? [...change.slots] : now.slots,
      buddy: change.buddy !== undefined ? change.buddy : now.buddy,
    };
    setError(null);
    editBookKit({ characterId: hero.id, crew: crew.crew, changes: bookKitChanges(now, next) }, onKit).catch((e: unknown) => {
      setError(e instanceof Error && e.message ? e.message : "Your kit could not be saved.");
    });
  };

  const say = (friend: JournalFriend): void => {
    const at = reactionAt.get(friend.id) ?? 0;
    reactionAt.set(friend.id, at + 1);
    const text = friend.reactions[at % Math.max(1, friend.reactions.length)] ?? `${friend.name} is happy to see you.`;
    setWords({ id: friend.id, text });
  };

  const pieces = Object.keys(crew.sources).sort((a, b) => pieceName(a).localeCompare(pieceName(b)));
  const startingOut = crew.camp.owned.length === 0 && crew.friends.length === 0 && crew.camp.grownBy.length === 0;

  return (
    <div ref={root} className="book-camp__body">
      {journal.heroes.length > 1 ? (
        <div className="book-camp__heroes" role="radiogroup" aria-label="Whose kit">
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
                <CharacterPortrait backdrop hero={h} accent={h.appearance.accent} lit={h.id === hero.id} />
              </span>
              <span className="journal__pick-name">{h.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Only what could not be kept, never "saving" (owner, 2026-11-07): a refused pick, or a phone that could not hold it. */}
      {status.notes.length > 0 ? (
        <div className="book-camp__note" role="status" data-testid="book-camp-note">
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

      {kit && table ? <BookTableNote table={table} focus={{ hero: hero.id, part: "tent" }} /> : null}
      {kit ? (
        <BookKit hero={hero} kit={kit} friends={crew.friends.map(card)} edit={edit} />
      ) : (
        <p className="book-camp__from">{`${hero.name}'s kit comes along the next time your book opens with a signal.`}</p>
      )}

      <section className="book-camp__crew-camp" aria-labelledby={`${base}-camp`}>
        <header className="book-camp__head">
          <h2 className="book-camp__title" id={`${base}-camp`}>
            <Icon name="rest" />
            <span>{`${crew.name}'s camp`}</span>
          </h2>
        </header>

        {crews.length > 1 ? (
          <div className="book-camp__crews" role="radiogroup" aria-label="Which crew's camp" data-testid="book-camp-crews">
            {crews.map((c) => (
              <button
                key={c.crew ?? ""}
                type="button"
                role="radio"
                aria-checked={c.crew === crew.crew}
                className={`book-camp__crew kad-tap kad-focusable${c.crew === crew.crew ? " is-on" : ""}`}
                onClick={() => onCrew(c.crew)}
              >
                <Icon name="crew" />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        ) : null}

        {layout && state ? (
          <div className="book-camp__picture" aria-hidden="true">
            <StillCamp layout={layout} state={state} fit="width" footRoom={FOOT_ROOM} />
          </div>
        ) : null}

        {startingOut ? (
          <p className="book-camp__start" data-testid="book-camp-start">
            <Icon name="star" />
            <span>Your camp is just starting! Things your crew finds and friends you make on adventures show up here.</span>
          </p>
        ) : null}

        {crew.friends.length > 0 ? (
          <section className="book-camp__section" aria-labelledby={`${base}-friends`} data-testid="book-camp-friends">
            <h3 className="book-camp__heading" id={`${base}-friends`}>
              <Icon name="heart" />
              <span>Friends</span>
            </h3>
            <ul className="book-camp__friends">
              {crew.friends.map((friend) => (
                <li key={friend.id}>
                  <button type="button" className="book-camp__friend kad-focusable" onClick={() => say(friend)} data-friend={friend.id} aria-label={`Say hi to ${friend.name}`}>
                    <span className="book-camp__friend-art" aria-hidden="true">
                      <FriendArt card={card(friend)} />
                    </span>
                    <span className="book-camp__friend-name">{friend.name}</span>
                    <span className="book-camp__from">{friend.source}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className={`book-camp__said${words ? " is-on" : ""}`} role="status" aria-live="polite" data-testid="book-camp-said">
              {words ? `${crew.friends.find((f) => f.id === words.id)?.name ?? ""}: ${words.text}` : ""}
            </p>
            {crew.friends.length > out.length ? <p className="book-camp__from">Your crew's friends take turns at camp.</p> : null}
          </section>
        ) : null}

        {pieces.length > 0 ? (
          <section className="book-camp__section" aria-labelledby={`${base}-pieces`} data-testid="book-camp-pieces">
            <h3 className="book-camp__heading" id={`${base}-pieces`}>
              <Icon name="crew" />
              <span>Things in your camp</span>
            </h3>
            <p className="book-camp__from">Your crew changes these together, at the table.</p>
            <ul className="book-camp__pieces">
              {pieces.map((id) => {
                const art = CREW_PIECE_ART.find((p) => p.id === id)?.path;
                return (
                  <li key={id} className="book-camp__piece" data-piece={id}>
                    <span className="book-camp__piece-art" aria-hidden="true">
                      {art ? <img src={`/assets/${art}`} alt="" /> : <Icon name="crew" size="1.6em" />}
                    </span>
                    <span className="book-camp__piece-name">{pieceName(id)}</span>
                    <span className="book-camp__from">{crew.sources[id]}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </section>
    </div>
  );
}
