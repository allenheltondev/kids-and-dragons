/**
 * Top-level composition.
 *
 * The whole of the mode branch in this client lives in `pickLayout` below —
 * roughly ten lines, which is the entire point of architecture §4.6. Mode
 * selects composition; it never forks a feature.
 *
 *   no session          → <HomeScreen/>
 *   /journal            → <JournalScreen/> (between games: nothing to play,
 *                         everything to look at — no room, no session)
 *   /guide              → <GuideScreen/> (the grown-up's guide, #257)
 *   /privacy            → <PrivacyScreen/> (the privacy policy, #523)
 *   /account            → <AccountScreen/> (sign-in, devices, tablets, groups)
 *   /tv/:code           → PartyLayout world  (a pure display client, spec §2.1)
 *   /p/:code   party    → PartyLayout player
 *   /p/:code   travel   → TravelLayout       (both surfaces, one at a time)
 */

import { Suspense, useEffect } from "react";
// Directly, not through the `screens` barrel: the barrel re-exports every
// panel in the room, and each one imports its stylesheet, so a static import of
// the barrel is a static import of all of them — the lazy room below would
// still be fetched before the join screen could paint.
import { HomeScreen } from "./screens/HomeScreen";
import { ArrivalNotices } from "./screens/ArrivalNotices";
import { navigate, routeCode, useRoute } from "./router";
import { useGameStore, useLayoutMode, useRunState, useChapter, useMe } from "./store";
import { Button, ConnectionBanner, ErrorToast, Spinner } from "./ui";
import { BackButton } from "./ui/BackButton";

import { setQuiet } from "./quiet";
import { STOPPED_MESSAGE } from "./screens/save-copy";
import { musicForScene } from "./audio/scene-audio";
import { PhoneMagic } from "./ui/PhoneMagic";
import { useDisplayDock } from "./ui/display-dock";
import { ChunkBoundary, lazyChunk } from "./ui/ChunkBoundary";
import { PrivacyFooter } from "./ui/PrivacyFooter";

/*
 * The room — both shells and everything they compose: the player panel, the
 * fight controls, the maps, the journey, character creation — loads on
 * demand, the way WorldView loads the renderer. The first paint is the join
 * screen, and nobody on it can see a single one of those panels yet; every
 * phone fetching them before it could type a room code is what had the entry
 * chunk pinned at its budget (tools/perf/bundle-budget.ts). Every feature the
 * room gains now lands in these chunks rather than in that number.
 *
 * Nothing waits on this that was not already waiting: a URL with a room code
 * starts both downloads the moment the app mounts (`prefetchRoom`, below), in
 * parallel with attaching the session, which is the "Joining the room" spinner
 * anyway. The import promises are the module cache — calling them again from
 * `lazy()` costs nothing.
 */
// Read-aloud (#261) loads after first paint: nobody on the join screen can hear it yet,
// and the entry chunk is at its budget (tools/perf/bundle-budget.ts).
const loadSpeech = () => import("./speech");
const ReadAloudControl = lazyChunk(loadSpeech, (module) => module.ReadAloudControl);

// Display settings (#262): the panel loads after first paint like read-aloud. The saved
// settings themselves are applied in main.tsx, before the first paint, from a few hundred bytes.
const loadA11y = () => import("./a11y");
const A11yControl = lazyChunk(loadA11y, (module) => module.A11yControl);

// Help (#256): the "?" and the press-and-hold sheet load after first paint too, for the same reason.
const loadHelp = () => import("./help");
const HelpControl = lazyChunk(loadHelp, (module) => module.HelpControl);

// The update reload (#456): asks the worker for updates on wake and moves the page onto a new
// build at a calm moment. Nothing to draw, so it loads after first paint like the controls.
const ConvergeOnUpdate = lazyChunk(() => import("./sw/ConvergeOnUpdate"), (module) => module.ConvergeOnUpdate);

// Sound (#318): the engine, its synth and the sample table load after first paint. The
// control sits in a corner, nobody can hear anything before a first tap, and the
// engine cannot start before then anyway. `audio` (the barrel) re-exports the engine, so
// nothing on the home screen may import it; the cue seam is `audio/cue`.
const AudioControl = lazyChunk(() => import("./audio/AudioControl"), (module) => module.AudioControl);

const loadPartyLayout = () => import("./layout/PartyLayout");
const loadTravelLayout = () => import("./layout/TravelLayout");
const PartyLayout = lazyChunk(loadPartyLayout, (module) => module.PartyLayout);
const TravelLayout = lazyChunk(loadTravelLayout, (module) => module.TravelLayout);

function prefetchRoom(display: boolean): void {
  // A failed prefetch is not an error worth a toast: rendering the layout
  // imports it again, and that attempt is the one its `ChunkBoundary` reports.
  void loadPartyLayout().catch(() => undefined);
  // The television is always a Party Mode display (spec §2.1); only a phone
  // can find itself in Travel Mode.
  if (!display) void loadTravelLayout().catch(() => undefined);
}

function RoomLoading(): React.JSX.Element {
  // The same spinner as attaching, so a cold load reads as one continuous
  // "joining" rather than two different waits.
  return (
    <div className="kad-boot">
      <Spinner size="lg" label="Joining the room" showLabel />
    </div>
  );
}

// Running the room from the TV that opened it (#263). Only a host display draws
// it, so no phone's first paint pays for it.
const HostControls = lazyChunk(() => import("./screens/HostControls"), (module) => module.HostControls);
// Its Room button, in the corner row (#257).
const RoomButton = lazyChunk(() => import("./screens/HostControls"), (module) => module.RoomButton);
// The same chunk: the host of a stopped game may let a hero go (#259).
const LetHeroGo = lazyChunk(() => import("./screens/HostControls"), (module) => module.LetHeroGo);

// What only a shared screen does (#264): wake lock, waking up, "About this
// screen". A phone never loads it.
const DisplayExtras = lazyChunk(() => import("./display/DisplayExtras"), (module) => module.DisplayExtras);
// The shared screen's own controls in the corner row: Tap for sound and About this screen (#257).
const DisplayCornerControls = lazyChunk(() => import("./display/DisplayExtras"), (module) => module.DisplayCornerControls);

// The adventure book (`/journal`) is a route of its own, between games, and
// loads on demand like the room: nobody on the join screen needs it yet.
const JournalScreen = lazyChunk(() => import("./screens/JournalScreen"), (module) => module.JournalScreen);

// The grown-up's guide (`/guide`, #257): words and pictures nobody on the join
// screen is waiting for, so a chunk of its own.
const GuideScreen = lazyChunk(() => import("./guide/GuideScreen"), (module) => module.default);

// Accounts and devices (`/account`): the grown-up's errands, kept off the join
// screen and out of its chunk.
const AccountScreen = lazyChunk(() => import("./screens/AccountScreen"), (module) => module.default);

// The privacy policy (`/privacy`, #523): public, and linked from the start screens.
const PrivacyScreen = lazyChunk(() => import("./screens/PrivacyScreen"), (module) => module.default);

export function App(): React.JSX.Element {
  const route = useRoute();
  const session = useGameStore((store) => store.session);
  const connection = useGameStore((store) => store.connection);
  const attach = useGameStore((store) => store.attach);
  const loadContent = useGameStore((store) => store.loadContent);
  const mode = useLayoutMode();
  const state = useRunState();
  const chapter = useChapter();
  const me = useMe();
  const home = !routeCode(route) || !session;
  const enabled = home || route.name === "tv" || mode === "travel";
  const inEntry = state?.phase === "lobby" || state?.phase === "creation";
  const creating = inEntry && me === null && route.name !== "tv";
  const ready = !!state?.party.length && state.party.every((member) => member.ready);
  const soundtrack = home || creating ? "entry-home" : inEntry ? "entry-lobby" : musicForScene(chapter, state);
  const tv = route.name === "tv";
  const dock = useDisplayDock(tv);

  // Rules and items are static content, not game state (roadmap, "Content as
  // data"). Idempotent, so strict mode's double-invoke costs nothing.
  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  // This device's read-aloud switch (#261): as it was left, or on by default on the TV.
  useEffect(() => {
    void loadSpeech().then((module) => module.startReadAloud(tv)).catch(() => undefined);
  }, [tv]);

  // A TV remote's arrows (display/remote-focus.ts): always on the shared screen; on the start
  // screen, where a TV hosts its room before it is one, only once a remote shows itself (an arrow
  // with nothing focused), so a laptop's or a phone's keyboard keeps the page as it was. A chunk
  // of its own, after first paint.
  const remote = tv ? "always" : route.name === "home" ? "on-first-arrow" : null;
  useEffect(() => {
    if (remote === null) return;
    let stop: (() => void) | null = null;
    let live = true;
    void import("./display/remote-focus").then(
      (module) => { if (live) stop = module.installRemoteFocus(document, { armed: remote === "always" }); },
      () => undefined,
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [remote]);

  // The host's quiet mode (#260) reaches every device in the room as run state.
  const roomQuiet = state?.quiet === true;
  useEffect(() => {
    setQuiet(roomQuiet);
    return () => setQuiet(false);
  }, [roomQuiet]);

  /**
   * Recover from the URL alone. This is what makes "hard-refresh anything
   * without losing state" true on every surface (architecture §4.3, roadmap
   * Chapter 2): the room code is in the path, the session token is in
   * localStorage, and the TV needs neither.
   */
  useEffect(() => {
    // The manifest's share target (#461): on to the room it names, or home.
    if (route.name === "share") {
      // Loaded on demand: the parser is only ever needed on this one route.
      void import("./install/share-target").then(({ shareDestination }) => {
        navigate(shareDestination(window.location.search), { replace: true });
      });
      return;
    }
    const code = routeCode(route);
    if (!code) return;
    prefetchRoom(route.name === "tv");
    void attach(code, route.name === "tv" ? "display" : "player");
  }, [route, attach]);

  return (
    <PhoneMagic enabled={route.name !== "tv"}>
      {/* One corner row for the device's own controls, so they share a place instead of
          fighting over it: help (#256), display settings (#262) and read-aloud (#261) to the left of sound, sound anchored right. */}
      <div className="kad-corner">
        {/* One wait, so they land together; a boundary each, so one that fails to load is
            simply not in the row and the others still are (#329). */}
        <Suspense fallback={null}>
          <ChunkBoundary quiet><HelpControl /></ChunkBoundary>
          <ChunkBoundary quiet><A11yControl /></ChunkBoundary>
          <ChunkBoundary quiet><ReadAloudControl /></ChunkBoundary>
        </Suspense>
        {/* The row is anchored to the right, so a control that arrives on its right pushes the others
            along under a finger already on its way to them. Hold sound's place until the engine lands. */}
        <ChunkBoundary quiet>
          <Suspense fallback={enabled ? <span className="kad-corner__slot" aria-hidden="true" /> : null}>
            <AudioControl enabled={enabled} soundtrack={soundtrack} readinessKey={home ? "" : state?.runId ?? ""} ready={!home && inEntry && ready} />
          </Suspense>
        </ChunkBoundary>
        {/* The shared screen's own controls (#257), in the row with the device's rather than
            over its headings and its story: Room, About this screen, Tap for sound. */}
        {route.name === "tv" && session ? (
          <ChunkBoundary quiet>
            <Suspense fallback={null}>
              {session.host ? <RoomButton /> : null}
              <DisplayCornerControls />
            </Suspense>
          </ChunkBoundary>
        ) : null}
      </div>
      {/* Opposite the corner row: one page back, wherever you are. */}
      <BackButton />
      {pickLayout()}
      {/* On the shared screen the toast and the banner stand in its column, below. */}
      {tv ? null : <ErrorToast />}
      {/* Shell-level like the toast, and for the same reason: a dropped
          connection is true on every surface in every mode at once. */}
      {tv ? null : <ConnectionBanner />}
      <ChunkBoundary quiet>
        <Suspense fallback={null}>
          <ConvergeOnUpdate />
        </Suspense>
      </ChunkBoundary>
      {/* The shared display's right-hand column (#257): the host's stop offer and room
          panel (#263), who just joined (#267), a rejection, a dropped connection and the
          Field Guide's news (portalled in from WorldView), one under the other so none
          covers another. It stands below the chapter's goal and above the story plate
          (ui/display-dock.ts), and nothing in it waits for a tap to go. The Room button
          itself sits in the corner row. A host's phone shows all of these in its own view
          (layout/PlayerView). */}
      <div className="kad-display-stack" style={dock}>
        {tv && session?.host ? (
          <ChunkBoundary inline message="The host controls couldn’t load.">
            <Suspense fallback={null}>
              <HostControls placement="float" button={false} />
            </Suspense>
          </ChunkBoundary>
        ) : null}
        <ArrivalNotices placement="float" />
        {tv ? <ConnectionBanner /> : null}
        {tv ? <ErrorToast placement="dock" /> : null}
      </div>
      {route.name === "tv" && session ? (
        <ChunkBoundary quiet>
          <Suspense fallback={null}>
            <DisplayExtras controls={false} />
          </Suspense>
        </ChunkBoundary>
      ) : null}
    </PhoneMagic>
  );

  function pickLayout(): React.JSX.Element {
    if (route.name === "journal") {
      return (
        <ChunkBoundary message="Your adventure book couldn’t open.">
          <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Opening your adventure book" showLabel /></div>}>
            <JournalScreen />
          </Suspense>
        </ChunkBoundary>
      );
    }
    if (route.name === "guide") {
      return (
        <ChunkBoundary message="The guide couldn’t open.">
          <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Opening the guide" showLabel /></div>}>
            <GuideScreen />
          </Suspense>
        </ChunkBoundary>
      );
    }
    if (route.name === "privacy") {
      return (
        <ChunkBoundary message="The privacy page couldn’t open.">
          <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Opening the privacy page" showLabel /></div>}>
            <PrivacyScreen />
          </Suspense>
        </ChunkBoundary>
      );
    }
    if (route.name === "account") {
      return (
        <ChunkBoundary message="That page couldn’t open.">
          <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Opening" showLabel /></div>}>
            <AccountScreen />
          </Suspense>
        </ChunkBoundary>
      );
    }
    const code = routeCode(route);

    if (!code || !session) {
      // Attaching a known session shouldn't flash the home screen at a room
      // we're two hundred milliseconds away from being inside.
      if (code && connection === "connecting") {
        return (
          <div className="kad-boot">
            <Spinner size="lg" label="Joining the room" showLabel />
          </div>
        );
      }
      return <HomeScreen />;
    }

    // Taken out of the game by whoever opened the room (#267). The server
    // already refuses this phone everything; this is what it says about it.
    if (session.playerId && state?.removed?.includes(session.playerId)) {
      return <RemovedScreen />;
    }
    // Closed by whoever opened it (#263): over for every screen, the TV too.
    if (state?.closed) return <ClosedScreen />;

    return (
      <ChunkBoundary message="The game couldn’t load.">
        <Suspense fallback={<RoomLoading />}>
          {route.name === "tv" ? (
            <PartyLayout surface="world" />
          ) : mode === "travel" ? (
            <TravelLayout />
          ) : (
            <PartyLayout surface="player" />
          )}
        </Suspense>
      </ChunkBoundary>
    );
  }
}

/** What every screen shows once the host closes the room (#263). */
function ClosedScreen(): React.JSX.Element {
  const leave = useGameStore((store) => store.leave);
  // Stopped for today (#259) is a save, not an ending.
  const stopped = useGameStore((store) => store.state?.stopped === true);
  const host = useGameStore((store) => store.session?.host === true);
  return (
    <div className="kad-boot" role="alert">
      <div className="kad-removed">
        <p>
          {stopped
            ? STOPPED_MESSAGE
            : "The person running this game closed the room. Your heroes are kept, ready for next time."}
        </p>
        {stopped && host ? (
          <ChunkBoundary quiet>
            <Suspense fallback={null}>
              <LetHeroGo />
            </Suspense>
          </ChunkBoundary>
        ) : null}
        <Button onClick={leave}>Back to the start</Button>
        <PrivacyFooter />
      </div>
    </div>
  );
}

/** What a phone the host took out of the game sees, instead of the game. */
function RemovedScreen(): React.JSX.Element {
  const leave = useGameStore((store) => store.leave);
  return (
    <div className="kad-boot" role="alert">
      <div className="kad-removed">
        <p>The person running this game took this phone out of it.</p>
        <Button onClick={leave}>Back to the start</Button>
        <PrivacyFooter />
      </div>
    </div>
  );
}
