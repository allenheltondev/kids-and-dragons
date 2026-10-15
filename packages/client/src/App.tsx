/**
 * Top-level composition.
 *
 * The whole of the mode branch in this client lives in `pickLayout` below —
 * roughly ten lines, which is the entire point of architecture §4.6. Mode
 * selects composition; it never forks a feature.
 *
 *   no session          → <HomeScreen/>
 *   /tv/:code           → PartyLayout world  (a pure display client, spec §2.1)
 *   /p/:code   party    → PartyLayout player
 *   /p/:code   travel   → TravelLayout       (both surfaces, one at a time)
 */

import { useEffect } from "react";
import { HomeScreen } from "./screens";
import { PartyLayout } from "./layout/PartyLayout";
import { TravelLayout } from "./layout/TravelLayout";
import { routeCode, useRoute } from "./router";
import { useGameStore, useLayoutMode, useRunState, useChapter, useMe } from "./store";
import { ConnectionBanner, ErrorToast, Spinner } from "./ui";

import { AudioControl } from "./audio";
import { musicForScene } from "./audio/scene-audio";
import { PhoneMagic } from "./ui/PhoneMagic";

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

  /**
   * Recover from the URL alone. This is what makes "hard-refresh anything
   * without losing state" true on every surface (architecture §4.3, roadmap
   * Chapter 2): the room code is in the path, the session token is in
   * localStorage, and the TV needs neither.
   */
  useEffect(() => {
    const code = routeCode(route);
    if (!code) return;
    void attach(code, route.name === "tv" ? "display" : "player");
  }, [route, attach]);

  return (
    <PhoneMagic enabled={route.name !== "tv"}>
      <AudioControl enabled={enabled} soundtrack={soundtrack} readinessKey={home ? "" : state?.runId ?? ""} ready={!home && inEntry && ready} />
      {pickLayout()}
      <ErrorToast />
      {/* Shell-level like the toast, and for the same reason: a dropped
          connection is true on every surface in every mode at once. */}
      <ConnectionBanner />
    </PhoneMagic>
  );

  function pickLayout(): React.JSX.Element {
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

    if (route.name === "tv") return <PartyLayout surface="world" />;
    return mode === "travel" ? <TravelLayout /> : <PartyLayout surface="player" />;
  }
}
