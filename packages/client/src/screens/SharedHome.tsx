/**
 * SharedHome: the home screen of a family tablet (#250).
 *
 * A shared tablet is nobody. So instead of "join a game" it opens on "who's
 * playing?": the household's profiles as big faces, no typing. Tapping one
 * picks that kid for the next room only; the server answers the join with a
 * room session and never a device token, and the session lives in this tab.
 * When the room ends (or the next kid opens the room's QR, which is a fresh
 * tab) the tablet is back here, asking again.
 *
 * Kids pick freely: no grown-up approves a seat. The grown-up's only control
 * is "Forget this tablet", at the bottom and quiet, behind a sign-in.
 */

import { randomName } from "./creationContent";
import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import type { SharedDevicePlayer, SharedSeatRequest } from "@kad/shared";
import { useGameStore } from "../store";
import { useKeepsakeStore } from "../store/keepsake";
import { VISITOR_CODE_LENGTH as CODE_LENGTH, codeComplete, codeSlots, normalizeCodeInput as normalizeCode } from "../router";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import { LazySignInFlow } from "./HomeScreen";
import { EntryScene } from "./EntryScene";
import "./shared.css";
import "./HomeScreen.css";
import "./SharedHome.css";


/** Mirrors the server's `NEW_PLAYER_NAME_MAX`. */
const NAME_MAX = 24;

/** Who was tapped: a face from the household, or a new kid by name. */
type Pick = { player: SharedDevicePlayer } | { newName: string };

export function SharedHome(): ReactElement {
  const loadSharedPlayers = useGameStore((s) => s.loadSharedPlayers);
  const joinRoom = useGameStore((s) => s.joinRoom);
  const createRoom = useGameStore((s) => s.createRoom);
  const openOnThisScreen = useGameStore((s) => s.openOnThisScreen);
  const pendingCode = useGameStore((s) => s.pendingCode);
  const refreshShared = useKeepsakeStore((s) => s.refreshShared);
  const openKeepsake = useKeepsakeStore((s) => s.open);
  const keepsakeStep = useKeepsakeStore((s) => s.step);
  const signInAvailable = useKeepsakeStore((s) => s.available) === true;

  const [players, setPlayers] = useState<SharedDevicePlayer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [code, setCode] = useState(() => normalizeCode(pendingCode ?? ""));
  const [busy, setBusy] = useState<null | "join" | "create" | "screen">(null);
  const [error, setError] = useState<string | null>(null);
  const nameFieldId = useId();

  /*
   * The faces are read fresh whenever the picker is what is showing: when it
   * first appears, when somebody taps "Pick again", and when the tablet comes
   * back into view. A tablet left open on the counter all week otherwise never
   * shows the cousin a grown-up added from their phone on Tuesday.
   */
  const picking = pick === null;
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") setSeen((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    loadSharedPlayers().then(
      (found) => {
        if (!live) return;
        // Forgotten since it was set up: HomeScreen goes back to an ordinary start.
        if (found === null) refreshShared();
        else {
          setPlayers(found);
          setLoadError(null);
        }
      },
      (err: unknown) => {
        // A refresh that fails keeps the faces already showing; only an empty
        // picker has nothing better to say than the error.
        if (live) setLoadError((current) => current ?? (err instanceof Error ? err.message : "We couldn\u2019t find your family."));
      },
    );
    return () => {
      live = false;
    };
  }, [picking, seen, loadSharedPlayers, refreshShared]);

  useEffect(() => {
    if (pendingCode === null) return;
    setCode((current) => (current === "" ? normalizeCode(pendingCode) : current));
  }, [pendingCode]);

  const seat: SharedSeatRequest | null =
    pick === null ? null : "player" in pick ? { playerId: pick.player.id } : { newPlayer: pick.newName };
  const name = pick === null ? "" : "player" in pick ? pick.player.displayName : pick.newName;
  const codeReady = codeComplete(code);

  const go = useCallback(
    async (how: "join" | "create") => {
      if (!seat) return;
      setError(null);
      setBusy(how);
      try {
        if (how === "join") await joinRoom(code, name, seat);
        else await createRoom("travel", name, seat);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn’t work. Try again?");
        // A forgotten tablet is told so by the server, and stops being one.
        refreshShared();
      } finally {
        setBusy(null);
      }
    },
    [seat, code, name, joinRoom, createRoom, refreshShared],
  );

  /** The tablet becomes the TV (#274): nobody is picked, nobody is seated. */
  const showOnThisScreen = useCallback(async () => {
    setError(null);
    setBusy("screen");
    try {
      await openOnThisScreen();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn’t work. Try again?");
      // A forgotten tablet is told so by the server, and stops being one.
      refreshShared();
    } finally {
      setBusy(null);
    }
  }, [openOnThisScreen, refreshShared]);

  return (
    <main className="home entry-scene-host">
      <EntryScene scene="home-market" />
      <div className="home__inner kad-stack">
        <div className="home__body">
          {pick === null ? (
            <section className="home__card shared-home__picker" aria-labelledby="shared-home-who">
              <h1 className="home__card-title shared-home__title" id="shared-home-who">
                Who&rsquo;s playing?
              </h1>

              {players === null && loadError === null ? (
                <div className="home__busy kad-row" role="status">
                  <Spinner size="sm" />
                  <span>Finding your family…</span>
                </div>
              ) : null}
              {loadError !== null && players === null ? (
                <p className="home__error kad-chip kad-chip--bad kad-chip--wrap" role="alert">
                  <Icon name="close" />
                  <span>{loadError}</span>
                </p>
              ) : null}

              {players !== null ? (
                <ul className="shared-home__faces">
                  {players.map((player) => (
                    <li key={player.id}>
                      <button
                        type="button"
                        className="shared-home__face kad-tap kad-focusable"
                        onClick={() => setPick({ player })}
                      >
                        <span
                          className="shared-home__avatar"
                          style={{ background: player.color }}
                          aria-hidden="true"
                        >
                          {initialOf(player.displayName)}
                        </span>
                        <span className="shared-home__name">{player.displayName}</span>
                        {player.heroes[0] ? (
                          <span className="shared-home__hero kad-muted">{player.heroes[0]}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className="shared-home__face shared-home__face--new kad-tap kad-focusable"
                      aria-expanded={addingNew}
                      onClick={() => {
                        setNewName((current) => (current === "" ? randomName() : current));
                        setAddingNew(true);
                      }}
                    >
                      <span className="shared-home__avatar" aria-hidden="true">
                        <Icon name="plus" size="1.2em" />
                      </span>
                      <span className="shared-home__name">Someone new</span>
                    </button>
                  </li>
                </ul>
              ) : null}

              {addingNew ? (
                <form
                  className="home__field"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = newName.trim();
                    if (trimmed) setPick({ newName: trimmed });
                  }}
                >
                  <label className="home__label" htmlFor={nameFieldId}>
                    <Icon name="name" />
                    <span>Your adventurer name</span>
                  </label>
                  <input
                    id={nameFieldId}
                    className="home__text-input kad-focusable"
                    type="text"
                    value={newName}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                    placeholder="Type your name"
                    autoComplete="off"
                    enterKeyHint="go"
                    maxLength={NAME_MAX}
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    icon={<Icon name="shuffle" />}
                    onClick={() => setNewName(randomName())}
                  >
                    Surprise me
                  </Button>
                  <p className="home__hint kad-muted">
                    Pick a nickname or an adventurer name, never your real name.
                  </p>
                  <Button type="submit" variant="primary" size="lg" icon={<Icon name="forward" />} disabled={!newName.trim()}>
                    That&rsquo;s me
                  </Button>
                </form>
              ) : null}

              <div className="home__host-toggle">
                <button
                  type="button"
                  className="home__link kad-focusable"
                  disabled={busy !== null}
                  onClick={() => void showOnThisScreen()}
                >
                  Show the game on this screen
                </button>
              </div>
            </section>
          ) : (
            <section className="home__card home__card--join" aria-labelledby="shared-home-join">
              <h1 className="home__card-title" id="shared-home-join">
                <Icon name="qr" />
                <span>Hi, {name}!</span>
              </h1>
              <p className="home__hint home__join-hint">Type the four letters on the big screen.</p>

              <label className="home__code">
                <input
                  className="home__code-input"
                  type="text"
                  value={code}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCode(normalizeCode(e.target.value))}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={CODE_LENGTH}
                  enterKeyHint="go"
                  aria-label="Room code, four letters, or six for a visitor"
                />
                <div className="home__code-boxes" aria-hidden="true" data-slots={codeSlots(code)}>
                  {Array.from({ length: codeSlots(code) }, (_, i) => i).map((i) => (
                    <span
                      key={i}
                      className={`home__code-box${code.length === i ? " home__code-box--next" : ""}${code[i] ? " home__code-box--filled" : ""}`}
                    >
                      {code[i] ?? ""}
                    </span>
                  ))}
                </div>
              </label>

              <Button
                variant="primary"
                size="lg"
                className={`home__join${codeReady ? " home__join--ready" : ""}`}
                icon={<Icon name="forward" />}
                disabled={!codeReady || busy !== null}
                onClick={() => void go("join")}
              >
                {busy === "join" ? "Joining…" : "Join a game"}
              </Button>

              <div className="home__host-toggle">
                <button
                  type="button"
                  className="home__link kad-focusable"
                  disabled={busy !== null}
                  onClick={() => void go("create")}
                >
                  Or start a Phone Mode game here
                </button>
                <button
                  type="button"
                  className="home__link kad-focusable"
                  disabled={busy !== null}
                  onClick={() => {
                    setPick(null);
                    setError(null);
                  }}
                >
                  Not {name}? Pick again
                </button>
              </div>
            </section>
          )}

          <div className="home__status">
            {busy !== null ? (
              <div className="home__busy kad-row" role="status">
                <Spinner size="sm" />
                <span>{busy === "join" ? "Looking for that room…" : "Making a room…"}</span>
              </div>
            ) : null}
            {error !== null ? (
              <p className="home__error kad-chip kad-chip--bad kad-chip--wrap" role="alert">
                <Icon name="close" />
                <span>{error}</span>
              </p>
            ) : null}
          </div>

          {/* The grown-up's one control here: quiet, last, behind a sign-in. */}
          {signInAvailable && keepsakeStep === "closed" ? (
            <div className="home__host-toggle shared-home__forget">
              <button
                type="button"
                className="home__link kad-focusable"
                onClick={() => {
                  openKeepsake("forget", "home");
                }}
              >
                Grown-ups: forget this tablet
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <LazySignInFlow />
    </main>
  );
}

/** The big letter on a face. Grapheme-aware enough for a name that starts with an emoji. */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : "?";
}
