/**
 * HomeScreen — the only screen with no session behind it.
 *
 * Two jobs, very unequal: join a game with a room code (architecture §4.5) —
 * what nearly every visitor, and every child, is here to do — or start one
 * (choosing Party or Phone mode, spec §2). Joining leads and stands alone;
 * starting is a grown-up's job and sits behind a quiet "Want to host?" link, so
 * a child sees one thing to do. Everything else in the app assumes a session
 * exists.
 *
 * Joining asks for no name: the character-creation flow asks "What's your
 * name?" where it means something. The only name field left is under the host
 * link, for Phone Mode, where the host is seated as a player straight away.
 */

import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import type { RoomMode } from "@kad/shared";
import { useGameStore } from "../store";
import { useKeepsakeStore } from "../store/keepsake";
// The one normalize helper for typed and prefilled codes — the router owns the
// code shape, and a second filter here is how /p/AB1C once prefilled as "ABC".
import { ROOM_CODE_LENGTH as CODE_LENGTH, navigate, normalizeCodeInput as normalizeCode } from "../router";
import { loadPlayerDeviceToken } from "../store/persistence";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import { EntryScene } from "./EntryScene";
import "./shared.css";
import "./HomeScreen.css";

const CODE_SLOTS = [0, 1, 2, 3];

const MODE_BLURB: Record<RoomMode, string> = {
  party: "This screen becomes the TV. Everyone joins from their phones.",
  travel: "Phones only. Everyone sees the world and their own controls.",
};

const MODE_ICON: Record<RoomMode, string> = { party: "party", travel: "travel" };

/*
 * A family tablet's home (#250) loads on demand: only a shared tablet ever
 * draws it, and every phone's first paint would otherwise carry it
 * (tools/perf/bundle-budget.ts).
 */
const SharedHome = lazy(() => import("./SharedHome").then((module) => ({ default: module.SharedHome })));

/*
 * The sign-in panel loads the first time somebody opens it, for the same
 * reason: it is a grown-up's errand, and the join screen is what every phone
 * is waiting to see. Closed, it draws nothing, so nothing waits on it.
 */
const SignInFlow = lazy(() => import("./SignInFlow").then((module) => ({ default: module.SignInFlow })));

/** The sign-in panel, fetched only once it is open. Shared by both homes. */
export function LazySignInFlow(): ReactElement | null {
  const open = useKeepsakeStore((s) => s.step) !== "closed";
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SignInFlow />
    </Suspense>
  );
}

export function HomeScreen(): ReactElement {
  // A family tablet is nobody, so it asks who is playing instead (#250).
  const shared = useKeepsakeStore((s) => s.shared);
  if (!shared) return <PersonalHome />;
  return (
    <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Finding your family" showLabel /></div>}>
      <SharedHome />
    </Suspense>
  );
}

function PersonalHome(): ReactElement {
  const createRoom = useGameStore((s) => s.createRoom);
  const openOnThisScreen = useGameStore((s) => s.openOnThisScreen);
  const joinRoom = useGameStore((s) => s.joinRoom);

  /**
   * Set when a `/p/:code` URL was opened without a stored session — which is
   * exactly what scanning the lobby QR does. Scanning and then being asked to
   * retype the code you just scanned would make the QR pointless, so it seeds
   * the field and the join section leads.
   */
  const pendingCode = useGameStore((s) => s.pendingCode);

  const [displayName, setDisplayName] = useState("");
  const [hosting, setHosting] = useState(false);
  const [mode, setMode] = useState<RoomMode>("party");
  const [code, setCode] = useState(() => normalizeCode(pendingCode ?? ""));
  const [busy, setBusy] = useState<null | "create" | "join">(null);
  const [error, setError] = useState<string | null>(null);

  const nameFieldId = useId();
  const nameHintId = useId();
  const hostPanelId = useId();

  // Whether this deployment has a user pool at all. Asked once, here, because
  // HomeScreen is the first thing a fresh phone renders (§4.5).
  const checkKeepsake = useKeepsakeStore((s) => s.check);
  const openKeepsake = useKeepsakeStore((s) => s.open);
  const signInAvailable = useKeepsakeStore((s) => s.available) === true;
  const account = useKeepsakeStore((s) => s.account);
  useEffect(() => {
    void checkKeepsake();
  }, [checkKeepsake]);

  /*
   * Whether this phone has a book to open: it has been a player (not only a
   * TV) and so has a binding. Read without minting an identity. Signing in
   * from the card below is what binds a brand-new phone to its household, so
   * this is read again each time that flow moves on — the identity is written
   * before the step changes — and the book appears the moment it exists.
   */
  const keepsakeStep = useKeepsakeStore((s) => s.step);
  const hasPlayed = useMemo(() => loadPlayerDeviceToken() !== null, [keepsakeStep, account]);

  const trimmedName = displayName.trim();
  const codeReady = code.length === CODE_LENGTH;
  // Party Mode is started from the TV, and the TV is nobody (spec §2.1): it
  // needs no name. Phone Mode seats the host as a player, so it does.
  const startReady = mode === "party" || trimmedName.length > 0;

  const onCodeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setCode(normalizeCode(e.target.value));
  }, []);

  // `attach()` resolves the URL after this screen has already mounted, so the
  // lazy initial value above can miss it. Seed once, and never over anything
  // already typed.
  useEffect(() => {
    if (pendingCode === null) return;
    setCode((current) => (current === "" ? normalizeCode(pendingCode) : current));
  }, [pendingCode]);

  const start = useCallback(async () => {
    setError(null);
    setBusy("create");
    try {
      if (mode === "party") await openOnThisScreen();
      else await createRoom(mode, trimmedName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not start the game.");
    } finally {
      setBusy(null);
    }
  }, [createRoom, openOnThisScreen, mode, trimmedName]);

  const join = useCallback(async () => {
    setError(null);
    setBusy("join");
    try {
      await joinRoom(code, "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not work. Try again?");
    } finally {
      setBusy(null);
    }
  }, [joinRoom, code]);

  return (
    <main className="home entry-scene-host">
      <EntryScene scene="home-market" />
      <div className="home__inner kad-stack">
        <header className="home__masthead">
          <h1 className="home__title">
            <img
              className="home__logo"
              src="/brand/dragon-mark.png"
              alt=""
              width={512}
              height={512}
              fetchPriority="high"
            />
            <span className="home__wordmark">
              Kids <span className="home__ampersand">&amp;</span><br />
              Dragons
            </span>
          </h1>
        </header>

        {/* Hosting anchors the cards to the top: picking Phone Mode adds a
            name field, and in a centred column that lifted the very tile
            just tapped. Joining, where nothing grows, stays centred. */}
        <div className={`home__body${hosting ? " home__body--top" : ""}`}>
          <section className="home__card home__card--join" aria-labelledby="home-join" hidden={hosting}>
            <h2 className="home__card-title" id="home-join">
              <Icon name="qr" />
              <span>Join a game</span>
            </h2>
            <p className="home__hint home__join-hint">Type the four letters on the big screen.</p>

            {/*
              One real input behind four big boxes: on-screen keyboards, paste and
              backspace all behave, and the boxes stay legible for small hands.
            */}
            <label className="home__code">
              <input
                className="home__code-input"
                type="text"
                value={code}
                onChange={onCodeChange}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                maxLength={CODE_LENGTH}
                enterKeyHint="go"
                aria-label="Room code, four letters"
              />
              <div className="home__code-boxes" aria-hidden="true">
                {CODE_SLOTS.map((i) => (
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
              onClick={() => void join()}
            >
              {busy === "join" ? "Joining…" : "Join a game"}
            </Button>

            <div className="home__host-toggle">
              <button
                type="button"
                className="home__link kad-focusable"
                aria-controls={hostPanelId}
                onClick={() => setHosting(true)}
              >
                Want to host? Set up a game
              </button>
            </div>
          </section>

          {/*
           * Between games (`/journal`): your hero, their bag, the map and the
           * Field Guide, with no game to play. Only for a phone that has played
           * before — one that never has, or a TV that only hosted, would open
           * an empty book — and quiet,
           * second to joining, because joining is what nearly everyone is here
           * to do.
           */}
          {hasPlayed ? (
            <section className="home__card home__journal" aria-labelledby="home-journal" hidden={hosting}>
              <h2 className="home__card-title" id="home-journal">
                <Icon name="scroll" />
                <span>Your adventure book</span>
              </h2>
              <p className="home__hint kad-muted">Look at your hero, the map and the Field Guide.</p>
              <Button variant="secondary" size="lg" block icon={<Icon name="forward" />}
                onClick={() => navigate({ name: "journal" })}>
                Open your book
              </Button>
            </section>
          ) : null}

          <section
            className="home__card home__host"
            id={hostPanelId}
            aria-labelledby="home-start"
            hidden={!hosting}
          >
            <h2 className="home__card-title" id="home-start">
              <Icon name="play" />
              <span>Start a game</span>
            </h2>

            <div className="home__modes" role="radiogroup" aria-label="How are you playing?">
              {(["party", "travel"] as const).map((m) => (
                <label
                  key={m}
                  className={`home__mode kad-tap${mode === m ? " home__mode--on" : ""}`}
                >
                  <input
                    className="home__mode-radio"
                    type="radio"
                    name="room-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  <span className="home__mode-icon" aria-hidden="true">
                    <Icon name={MODE_ICON[m]} size="2em" />
                  </span>
                  <span className="home__mode-text">
                    <span className="home__mode-name">
                      {m === "party" ? "Party Mode" : "Phone Mode"}
                      {/* spec §11 — selection is shown by a check glyph, not
                          colour. Its seat is always there; only the glyph
                          comes and goes. */}
                      <span className="home__mode-mark">
                        {mode === m ? <Icon name="check" label="Selected" /> : null}
                      </span>
                    </span>
                    <span className="home__mode-blurb kad-muted">{MODE_BLURB[m]}</span>
                  </span>
                </label>
              ))}
            </div>

            {mode === "travel" ? (
              <div className="home__field">
                <label className="home__label" htmlFor={nameFieldId}>
                  <Icon name="name" />
                  <span>Your name</span>
                </label>
                <input
                  id={nameFieldId}
                  className="home__text-input kad-focusable"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Type your name"
                  autoComplete="nickname"
                  enterKeyHint="done"
                  maxLength={20}
                  aria-describedby={nameHintId}
                />
                <p id={nameHintId} className="home__hint kad-muted">
                  This is the name the others see.
                </p>
              </div>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              icon={<Icon name="play" />}
              disabled={!startReady || busy !== null}
              onClick={() => void start()}
            >
              {busy === "create" ? "Starting…" : mode === "party" ? "Open the lobby here" : "Start a game"}
            </Button>

            <div className="home__host-toggle">
              <button
                type="button"
                className="home__link kad-focusable"
                onClick={() => setHosting(false)}
              >
                Back to joining
              </button>
            </div>
          </section>

          {/*
           * One seat for "working on it" and "that didn't work", there whether
           * or not either is. The body is centred, so a line that mounted here
           * nudged every card above it up by half its height, right under the
           * button that had just been tapped.
           */}
          <div className="home__status">
            {busy !== null ? (
              /* A div, not a p: Spinner renders a div, and a block element
                 inside a <p> is invalid HTML that React warns about at runtime. */
              <div className="home__busy kad-row" role="status">
                <Spinner size="sm" />
                <span>{busy === "create" ? "Making a room…" : "Looking for that room…"}</span>
              </div>
            ) : null}

            {error !== null ? (
              <p className="home__error kad-chip kad-chip--bad kad-chip--wrap" role="alert">
                <Icon name="close" />
                <span>{error}</span>
              </p>
            ) : null}
          </div>

          {/*
           * Sign in or create an account (§4.5). Always reachable where sign-in
           * works, because an adult who wants their characters to outlive a
           * week should not have to finish a chapter to find the door. Last and
           * quiet, since nobody needs it to play.
           *
           * Signing in, not "keep these": an account that already has a
           * household goes back to it and picks who this phone is, even if the
           * phone has started a guest game since. Only a brand-new account keeps
           * the guest household this phone is playing in (or gets a fresh one).
           * The server makes that call (`linkAccount` `preferExisting`), because
           * only it knows whether the account owns anything yet.
           */}
          {signInAvailable ? (
            <section className="home__card home__account" aria-labelledby="home-account">
              <h2 className="home__card-title" id="home-account">
                <Icon name="lantern" />
                {account !== null ? "Your adventurers are saved" : "Save your adventurers"}
              </h2>
              {account !== null ? (
                <p className="home__hint kad-muted" role="status">
                  Signed in as <b className="home__account-email">{account.email}</b>
                </p>
              ) : (
                <>
                  <p className="home__hint kad-muted">
                    For grown-ups. Without an account, characters fade after a week away.
                  </p>
                  <Button
                    variant="secondary"
                    block
                    icon={<Icon name="envelope" />}
                    onClick={() => {
                      openKeepsake("restore", "home");
                    }}
                  >
                    Sign in or create an account
                  </Button>
                </>
              )}
              {/* A tablet the kids take turns on (#250): bound to the family,
                  not to whoever played on it last. */}
              <div className="home__host-toggle">
                <button
                  type="button"
                  className="home__link kad-focusable"
                  onClick={() => {
                    openKeepsake("share", "home");
                  }}
                >
                  Do the kids share this device? Make it a family tablet
                </button>
              </div>
              {/* #248: a club, a class, the cousins. One grown-up or several. */}
              <div className="home__host-toggle">
                <button
                  type="button"
                  className="home__link kad-focusable"
                  onClick={() => {
                    openKeepsake("organize", "home");
                  }}
                >
                  Running games for kids from other families? Run a group
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <LazySignInFlow />
    </main>
  );
}
