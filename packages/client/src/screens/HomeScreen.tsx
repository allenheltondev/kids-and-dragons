/**
 * HomeScreen — the only screen with no session behind it.
 *
 * Two jobs: join a game with a room code (architecture §4.5), what nearly
 * every visitor and every child is here to do, or host one (choosing Party or
 * Phone mode, spec §2). Joining leads; hosting is the one other button. A phone
 * that has played also gets its adventure book. Everything else, signing in,
 * moving a hero between devices, family tablets and groups, is a grown-up's
 * errand on `/account`, behind one quiet link: a home screen with nine ways
 * out had a grown-up who came to host tapping "I play here already".
 *
 * Installed as an app with nothing in its storage (#412), it asks one thing
 * first: was there a hero in Safari to bring over, or is this a fresh start?
 * Until that is answered nothing here can join, host or make anybody.
 *
 * Joining asks for no name: the character-creation flow asks "What's your
 * name?" where it means something. The only name field left is under the host
 * link, for Phone Mode, where the host is seated as a player straight away.
 */

import { randomName } from "./creationContent";
import { Suspense, useCallback, useEffect, useId, useMemo, useState } from "react";
import { ChunkBoundary, lazyChunk } from "../ui/ChunkBoundary";
import type { ChangeEvent, ReactElement } from "react";
import type { RoomMode } from "@kad/shared";
import { useGameStore } from "../store";
import { useKeepsakeStore } from "../store/keepsake";
import { takeMoveLink } from "./move-link";
// The one normalize helper for typed and prefilled codes — the router owns the
// code shape, and a second filter here is how /p/AB1C once prefilled as "ABC".
import { VISITOR_CODE_LENGTH as CODE_LENGTH, codeComplete, codeSlots, navigate, normalizeCodeInput as normalizeCode, pairingFromSearch, useRoute } from "../router";
import { loadLocationName, loadPlayerDeviceToken, loadSharedDevice } from "../store/persistence";
import { browserEnv, browserName, needsFirstLaunchChoice } from "../install/detect";
import { firstLaunch as firstLaunchRecord } from "../install/remember";
import { InstallCard } from "../install/InstallCard";
import { FirstLaunchChoice } from "../install/FirstLaunch";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { useBusy } from "../sw/busy";
import { Icon } from "./icons";
import { EntryScene } from "./EntryScene";
import { TableNameField } from "./TableNameField";
import "./shared.css";
import "./HomeScreen.css";
import { PrivacyFooter } from "../ui/PrivacyFooter";


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
const SharedHome = lazyChunk(() => import("./SharedHome"), (module) => module.SharedHome);

/*
 * The sign-in panel loads the first time somebody opens it, for the same
 * reason: it is a grown-up's errand, and the join screen is what every phone
 * is waiting to see. Closed, it draws nothing, so nothing waits on it.
 */
const SignInFlow = lazyChunk(() => import("./SignInFlow"), (module) => module.SignInFlow);

/** The sign-in panel, fetched only once it is open. Shared by both homes. */
export function LazySignInFlow(): ReactElement | null {
  const open = useKeepsakeStore((s) => s.step) !== "closed";
  const close = useKeepsakeStore((s) => s.close);
  if (!open) return null;
  return (
    <ChunkBoundary
      inline
      className="kad-chunk-float"
      message="Sign-in couldn’t open."
      extra={<Button variant="ghost" onClick={close}>Not now</Button>}
    >
      <Suspense fallback={null}>
        <SignInFlow />
      </Suspense>
    </ChunkBoundary>
  );
}

export function HomeScreen(): ReactElement {
  // A family tablet is nobody, so it asks who is playing instead (#250).
  const shared = useKeepsakeStore((s) => s.shared);
  if (!shared) return <PersonalHome />;
  return (
    <ChunkBoundary message="This tablet’s start page couldn’t load.">
      <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Finding your family" showLabel /></div>}>
        <SharedHome />
      </Suspense>
    </ChunkBoundary>
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

  /*
   * Pairing (#281) lives on `/account`, and its QR opens it there. A pairing
   * link to the home screen, `/?pair=CODE`, from before that is passed along.
   */
  useEffect(() => {
    if (typeof window === "undefined" || pairingFromSearch(window.location.search) === null) return;
    navigate(`/account${window.location.search}`, { replace: true });
  }, []);

  const [displayName, setDisplayName] = useState(() => randomName());
  const [hosting, setHosting] = useState(false);
  // What the family calls its table, kept on the device so the TV remembers it.
  const [location, setLocation] = useState(() => loadLocationName());

  const [mode, setMode] = useState<RoomMode>("party");
  const [code, setCode] = useState(() => normalizeCode(pendingCode ?? ""));
  const [busy, setBusy] = useState<null | "create" | "join">(null);
  // A code half typed or the host form open is unsaved work: no update reload meanwhile.
  useBusy("home-form", hosting || code.length > 0);
  const [error, setError] = useState<string | null>(null);

  const nameFieldId = useId();
  const nameHintId = useId();
  const hostPanelId = useId();

  // Whether this deployment has a user pool at all. Asked once, here, because
  // HomeScreen is the first thing a fresh phone renders (§4.5).
  const checkKeepsake = useKeepsakeStore((s) => s.check);
  const openKeepsake = useKeepsakeStore((s) => s.open);
  const signInAvailable = useKeepsakeStore((s) => s.available) === true;
  useEffect(() => {
    void checkKeepsake();
  }, [checkKeepsake]);

  /*
   * A scanned move code (#251) lands here as `/?move=…`: straight into "Run a
   * group", where it waits, typed in, for the grown-up to sign in and choose
   * where the kid is going. The organizer store is fetched for it, never for
   * the first paint. The link comes off the URL only once the code is held
   * (move-link.ts), and a home screen left before then opens nothing.
   */
  useEffect(() => {
    if (!signInAvailable || typeof window === "undefined") return;
    let left = false;
    void takeMoveLink({
      location: window.location,
      replaceUrl: (next) => window.history.replaceState(window.history.state, "", next),
      load: () => import("../store/organizer").then((module) => module.useOrganizerStore.getState()),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }).then((code) => {
      if (code && !left) openKeepsake("organize", "home");
    });
    return () => {
      left = true;
    };
  }, [signInAvailable, openKeepsake]);

  /*
   * Whether this phone has a book to open: it has been a player (not only a
   * TV) and so has a binding. Read without minting an identity, and again each
   * time a sign-in moves on (a move link's organizer flow opens over this
   * screen), so the book appears the moment it exists.
   */
  const keepsakeStep = useKeepsakeStore((s) => s.step);
  const hasPlayed = useMemo(() => loadPlayerDeviceToken() !== null, [keepsakeStep]);

  /*
   * The installed app's first launch (#412), recorded as pending at boot
   * (main.tsx) before anything could mint an identity, so a TV's room opened
   * first does not answer it. Only reads: nothing here makes anybody.
   */
  const [installEnv] = useState(browserEnv);
  const atHome = useRoute().name === "home";
  const [firstLaunch, setFirstLaunch] = useState(() =>
    needsFirstLaunchChoice({
      pending: firstLaunchRecord() === "pending",
      hasPlayer: loadPlayerDeviceToken() !== null,
      sharedDevice: loadSharedDevice() !== null,
    }),
  );

  const trimmedName = displayName.trim();
  const codeReady = codeComplete(code);
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
      if (mode === "party") await openOnThisScreen(location);
      else await createRoom(mode, trimmedName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not start the game.");
    } finally {
      setBusy(null);
    }
  }, [createRoom, openOnThisScreen, mode, trimmedName, location]);

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

  if (firstLaunch) {
    return (
      <main className="home entry-scene-host">
        <EntryScene scene="home-market" />
        <div className="home__inner kad-stack">
          <Masthead />
          <div className="home__body">
            <FirstLaunchChoice browser={browserName(installEnv)} onFresh={() => setFirstLaunch(false)} />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="home entry-scene-host">
      <EntryScene scene="home-market" />
      <div className="home__inner kad-stack">
        <Masthead />

        {/* Hosting anchors the cards to the top: picking Phone Mode adds a
            name field, and in a centred column that lifted the very tile
            just tapped. Joining, where nothing grows, stays centred. */}
        <div className={`home__body${hosting ? " home__body--top" : ""}`}>
          <section className="home__card home__card--join" aria-labelledby="home-join" hidden={hosting}>
            <h2 className="home__card-title" id="home-join">
              <Icon name="qr" />
              <span>Join a game</span>
            </h2>
            <p className="home__hint home__join-hint">Ask your grown-up for the room code, then type it here.</p>

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
              onClick={() => void join()}
            >
              {busy === "join" ? "Joining…" : "Join a game"}
            </Button>
          </section>

          {/* A real button, not a quiet link: a grown-up who came to host
              has to find it without reading every line on the screen. */}
          {hosting ? null : (
            <Button
              variant="secondary"
              size="lg"
              block
              icon={<Icon name="play" />}
              aria-controls={hostPanelId}
              onClick={() => setHosting(true)}
            >
              Host a game
            </Button>
          )}

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

          {/* Installing (#412): quiet, last of the ways in, and only where
              this browser really can. Only at `/`: a room's link that lands
              here for want of a session is somebody on their way to a game. */}
          {hosting || !atHome ? null : <InstallCard />}

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

            {mode === "party" ? <TableNameField value={location} onChange={setLocation} /> : null}

            {mode === "travel" ? (
              <div className="home__field">
                <label className="home__label" htmlFor={nameFieldId}>
                  <Icon name="name" />
                  <span>Your adventurer name</span>
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
                <Button
                  variant="secondary"
                  size="md"
                  icon={<Icon name="shuffle" />}
                  onClick={() => setDisplayName(randomName())}
                >
                  Surprise me
                </Button>
                <p id={nameHintId} className="home__hint kad-muted">
                  Everyone sees this one. Pick a nickname or an adventurer name, never your real name.
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

            {/* The grown-up's guide (#257): how to run a session, for someone
                who has never seen the game. Its own route and chunk. */}
            <div className="home__host-toggle">
              <button type="button" className="home__link kad-focusable" onClick={() => navigate({ name: "guide" })}>
                New to running a game? Read the grown-up&rsquo;s guide
              </button>
            </div>

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
           * Sign in, move a hero to another device, a family tablet, a group:
           * a grown-up's errands, on a page of their own, so the start screen
           * keeps to joining and hosting. Last and quiet, since nobody needs
           * any of it to play.
           */}
          <div className="home__host-toggle home__guide" hidden={hosting}>
            <button type="button" className="home__link kad-focusable" onClick={() => navigate({ name: "account" })}>
              {signInAvailable ? "Grown-ups: sign in, or move a hero to another device" : "Move a hero to another device"}
            </button>
          </div>
        </div>
      </div>

      {/* The privacy policy (#523): the page's footer, there whether joining or hosting. */}
      <PrivacyFooter />

      <LazySignInFlow />
    </main>
  );
}

function Masthead(): ReactElement {
  return (
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
  );
}
