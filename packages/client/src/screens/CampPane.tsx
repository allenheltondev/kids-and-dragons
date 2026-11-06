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
 *     **buddy** in this crew's camp change exactly as on the phone's Camp
 *     panel (CampPanel.tsx `KitEditor`, the table's rules), through the book's
 *     own write (store/book-kit-sync.ts): at once, queued on the phone when
 *     there is no signal ("Saved on this phone…"), and merged field by field
 *     when it is sent, with a short note for anything somebody else changed
 *     meanwhile.
 *
 * Named crew (a picker when her heroes sit with more than one), when it was
 * last synced, and a first-visit word when there is nothing to show yet.
 * Lazy: JournalScreen loads this chunk the first time "Camp" is opened, so
 * none of the camp is in the journal chunk, let alone the first paint.
 */

import { useEffect, useId, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { bookKitChanges, friendsOut } from "@kad/shared";
import type { BookKitState, CampFriendCard, ClientIntent, HeroKitView, JournalCrewCamp, JournalFriend, JournalKit, JournalResponse, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { Icon } from "./icons";
import { FriendArt, KitEditor } from "./CampPanel";
import { StillCamp } from "../world/StillCamp";
import { campLayoutFor } from "../world/lobby-camp";
import { campBackdropFamily } from "../world/camp-backdrop";
import { pieceName } from "../world/camp-scene";
import { CharacterPortrait } from "./CharacterPortrait";
import { loadPlayerDeviceToken } from "../store/persistence";
import { journalKitState, loadKitQueue, withQueuedKit } from "../store/kit-queue";
import { bookKitStatus, clearBookKitNotes, editBookKit, onBookKit, type ApplyKit } from "../store/book-kit-sync";
import { warm } from "../sw/warm";
import "./CampPane.css";

export interface CampPaneProps {
  journal: JournalResponse;
  /** "Last synced earlier today", or "Synced just now": said by the book, which knows when it read. */
  synced: string;
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

export default function CampPane({ journal, synced, fresh, hero, onHero, onKit }: CampPaneProps): ReactElement {
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
        synced={synced}
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
  synced,
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
  synced: string;
  fresh: boolean;
  onKit: ApplyKit;
}): ReactElement {
  const base = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const deviceToken = loadPlayerDeviceToken();
  const queue = loadKitQueue(deviceToken);
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
  const waiting = queue.some((e) => e.characterId === hero.id);
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
      void warm([...urls].filter((u) => u.startsWith("/")), { essential: true });
    }, 1500);
    return () => clearTimeout(timer);
  }, [fresh, crew.crew, hero.id]);

  const dispatch = (intent: ClientIntent): void => {
    if (intent.type !== "KIT_EDIT" || !shown || !serverKit) return;
    const now: BookKitState = journalKitState(shown, crew.crew);
    const next: BookKitState = {
      style: intent.style ?? now.style,
      tent: intent.tent ?? now.tent,
      color: intent.color !== undefined ? intent.color : now.color,
      slots: intent.slots ? [...intent.slots] : now.slots,
      buddy: intent.buddy !== undefined ? intent.buddy : now.buddy,
    };
    setError(null);
    editBookKit({ characterId: hero.id, crew: crew.crew, changes: bookKitChanges(now, next), revision: serverKit.revision }, onKit).catch((e: unknown) => {
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
      <header className="book-camp__head">
        <h2 className="book-camp__title">
          <Icon name="rest" />
          <span>{`${crew.name}'s camp`}</span>
        </h2>
        <p className="book-camp__synced kad-muted" data-testid="book-camp-synced">
          <Icon name="waiting" />
          <span>{synced}</span>
        </p>
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

      {waiting && status.offline ? (
        <p className="book-camp__queued" role="status" data-testid="book-camp-queued">
          <Icon name="check" />
          <span>Saved on this phone, will share when you're back online.</span>
        </p>
      ) : waiting ? (
        <p className="book-camp__queued book-camp__queued--sending" role="status" data-testid="book-camp-sending">
          <Icon name="waiting" />
          <span>Saving…</span>
        </p>
      ) : null}
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
                <CharacterPortrait backdrop species={h.species} accent={h.appearance.accent} tier={h.tier} characterClass={h.class} lit={h.id === hero.id} />
              </span>
              <span className="journal__pick-name">{h.name}</span>
            </button>
          ))}
        </div>
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
                <button type="button" className="camp-option camp-option--friend book-camp__friend kad-focusable" onClick={() => say(friend)} data-friend={friend.id}>
                  <span className="camp-option__art camp-option__art--friend" aria-hidden="true">
                    <FriendArt card={card(friend)} />
                  </span>
                  <span className="camp-option__label">{`Say hi to ${friend.name}`}</span>
                </button>
                <span className="book-camp__from">{friend.source}</span>
              </li>
            ))}
          </ul>
          <p className="book-camp__said" role="status" aria-live="polite" data-testid="book-camp-said">
            {words ? `${crew.friends.find((f) => f.id === words.id)?.name ?? ""}: ${words.text}` : ""}
          </p>
          {crew.friends.length > out.length ? <p className="book-camp__from">Your crew's friends take turns at camp.</p> : null}
        </section>
      ) : null}

      {kit ? (
        <KitEditor member={seated(hero)} kit={kit} held={false} dispatch={dispatch} friends={crew.friends.map(card)} />
      ) : (
        <p className="book-camp__from">{`${hero.name}'s kit comes along the next time your book opens with a signal.`}</p>
      )}

      <section className="book-camp__section" aria-labelledby={`${base}-pieces`} data-testid="book-camp-pieces">
        <h3 className="book-camp__heading" id={`${base}-pieces`}>
          <Icon name="crew" />
          <span>In your crew's camp</span>
        </h3>
        <p className="book-camp__from">Your crew changes these together, at the table.</p>
        <ul className="book-camp__pieces">
          {pieces.map((id) => (
            <li key={id} className="book-camp__piece" data-piece={id}>
              <span className="book-camp__piece-name">{pieceName(id)}</span>
              <span className="book-camp__from">{crew.sources[id]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
