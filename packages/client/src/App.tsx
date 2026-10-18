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
 *   /tv/:code           → PartyLayout world  (a pure display client, spec §2.1)
 *   /p/:code   party    → PartyLayout player
 *   /p/:code   travel   → TravelLayout       (both surfaces, one at a time)
 */

import { Component, Suspense, lazy, useEffect, type ReactNode } from "react";
// Directly, not through the `screens` barrel: the barrel re-exports every
// panel in the room, and each one imports its stylesheet, so a static import of
// the barrel is a static import of all of them — the lazy room below would
// still be fetched before the join screen could paint.
import { HomeScreen } from "./screens/HomeScreen";
import { ArrivalNotices } from "./screens/ArrivalNotices";
import { routeCode, useRoute } from "./router";
import { useGameStore, useLayoutMode, useRunState, useChapter, useMe } from "./store";
import { Button, ConnectionBanner, ErrorToast, Spinner } from "./ui";

import { AudioControl } from "./audio";
import { setQuiet } from "./quiet";
import { musicForScene } from "./audio/scene-audio";
import { PhoneMagic } from "./ui/PhoneMagic";

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
const ReadAloudControl = lazy(() => loadSpeech().then((module) => ({ default: module.ReadAloudControl })));

const loadPartyLayout = () => import("./layout/PartyLayout");
const loadTravelLayout = () => import("./layout/TravelLayout");
const PartyLayout = lazy(() => loadPartyLayout().then((module) => ({ default: module.PartyLayout })));
const TravelLayout = lazy(() => loadTravelLayout().then((module) => ({ default: module.TravelLayout })));

function prefetchRoom(display: boolean): void {
  // A failed prefetch is not an error worth a toast: rendering the layout
  // imports it again, and that attempt is the one `RoomBoundary` reports.
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

/**
 * What a room that could not load looks like, instead of a blank page.
 *
 * The likeliest way here is a deploy: a phone left on the join screen keeps
 * the old index, the deploy deletes the old hashed chunks (scripts/deploy.sh
 * syncs `bundle/` with --delete), and the room it asks for no longer exists.
 * Reloading is the whole fix, and it loses nothing — the room code is in the
 * URL and the session is in localStorage (architecture §4.3) — so that is
 * the one thing the button does.
 */
class RoomBoundary extends Component<{ children: ReactNode; message?: string }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="kad-boot" role="alert">
        <div>
          <p>{this.props.message ?? "The room couldn’t load."}</p>
          <Button onClick={() => { location.reload(); }}>Try again</Button>
        </div>
      </div>
    );
  }
}

// Running the room from the TV that opened it (#263). Only a host display draws
// it, so no phone's first paint pays for it.
const HostControls = lazy(() =>
  import("./screens/HostControls").then((module) => ({ default: module.HostControls })),
);

// The adventure book (`/journal`) is a route of its own, between games, and
// loads on demand like the room: nobody on the join screen needs it yet.
const JournalScreen = lazy(() =>
  import("./screens/JournalScreen").then((module) => ({ default: module.JournalScreen })),
);

// What the game keeps about a family (#252): a page for grown-ups, loaded only
// when one opens it.
const WhatWeStore = lazy(() =>
  import("./screens/WhatWeStore").then((module) => ({ default: module.WhatWeStore })),
);

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

  // Rules and items are static content, not game state (roadmap, "Content as
  // data"). Idempotent, so strict mode's double-invoke costs nothing.
  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  // This device's read-aloud switch, if it was left on (#261).
  useEffect(() => {
    void loadSpeech().then((module) => module.startReadAloud()).catch(() => undefined);
  }, []);

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
    const code = routeCode(route);
    if (!code) return;
    prefetchRoom(route.name === "tv");
    void attach(code, route.name === "tv" ? "display" : "player");
  }, [route, attach]);

  return (
    <PhoneMagic enabled={route.name !== "tv"}>
      {/* One corner row for the device's own controls, so they share a place instead of
          fighting over it: read-aloud (#261) to the left of sound, sound anchored right. */}
      <div className="kad-corner">
        <Suspense fallback={null}>
          <ReadAloudControl />
        </Suspense>
        <AudioControl enabled={enabled} soundtrack={soundtrack} readinessKey={home ? "" : state?.runId ?? ""} ready={!home && inEntry && ready} />
      </div>
      {pickLayout()}
      <ErrorToast />
      {/* Shell-level like the toast, and for the same reason: a dropped
          connection is true on every surface in every mode at once. */}
      <ConnectionBanner />
      {/* Who just joined (#267), on the shared display. A host's phone shows
          them in its own view instead (layout/PlayerView). */}
      <ArrivalNotices placement="float" />
      {route.name === "tv" && session?.host ? (
        <Suspense fallback={null}>
          <HostControls placement="float" />
        </Suspense>
      ) : null}
    </PhoneMagic>
  );

  function pickLayout(): React.JSX.Element {
    if (route.name === "whatWeStore") {
      return (
        <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Opening" showLabel /></div>}>
          <WhatWeStore />
        </Suspense>
      );
    }
    if (route.name === "journal") {
      return (
        <RoomBoundary message="Your adventure book couldn’t open.">
          <Suspense fallback={<div className="kad-boot"><Spinner size="lg" label="Opening your adventure book" showLabel /></div>}>
            <JournalScreen />
          </Suspense>
        </RoomBoundary>
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
      <RoomBoundary>
        <Suspense fallback={<RoomLoading />}>
          {route.name === "tv" ? (
            <PartyLayout surface="world" />
          ) : mode === "travel" ? (
            <TravelLayout />
          ) : (
            <PartyLayout surface="player" />
          )}
        </Suspense>
      </RoomBoundary>
    );
  }
}

/** What every screen shows once the host closes the room (#263). */
function ClosedScreen(): React.JSX.Element {
  const leave = useGameStore((store) => store.leave);
  return (
    <div className="kad-boot" role="alert">
      <div className="kad-removed">
        <p>The person running this game closed the room. Your heroes are kept, ready for next time.</p>
        <Button onClick={leave}>Back to the start</Button>
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
      </div>
    </div>
  );
}
