/**
 * PlayerView — your private controller (spec §2).
 *
 * ===========================================================================
 * SAME TWO RULES AS WorldView, AND THEY ARE JUST AS LOAD-BEARING HERE:
 *
 *   1. NOTHING IN HERE MAY READ THE ROOM MODE. This subtree is the entire
 *      screen on a Party Mode phone and a ~40% pane in Travel Mode. It renders
 *      the same either way; only the shell knows the difference.
 *
 *   2. NO `vw`, `vh`, `dvh`, `svh`, OR `lvh` ANYWHERE INSIDE. Size against
 *      `.kad-surface--player`, which is a size container: `%`, `cqw`/`cqh`,
 *      `em`. An action bar pinned with `100vh` looks right on a phone in Party
 *      Mode and hangs off the bottom of the pane in Travel Mode — which is
 *      exactly the rework the roadmap's "Travel layout first" rule exists to
 *      prevent.
 *
 *   And a third that only bites here: touch targets never shrink. The pane gets
 *   smaller in Travel Mode; the buttons do not (spec §11).
 * ===========================================================================
 */

import { useEffect } from "react";
import type { ReactNode } from "react";
import { PlayerPanel, SignInFlow, WelcomeBack } from "../screens";
import { FieldGuideToast } from "../screens/FieldGuideNews";
import { ArrivalNotices } from "../screens/ArrivalNotices";
import { CatchUp } from "../screens/CatchUp";
import { HostControls } from "../screens/HostControls";
// Imported by path rather than through the `screens` barrel on purpose: the
// barrel is what every surface pulls in, and the playtest drawer should reach
// exactly one call site — the one below, behind `import.meta.env.DEV`.
import { PlaytestPanel } from "../screens/PlaytestPanel";
import { isSpectator, tableFull } from "@kad/shared";
import { JustWatch, Spectating } from "../screens/Spectating";
import { useMe, useRunState, useSession } from "../store";
import { dismissPlayerSheet, usePlayerNavigation } from "../store/player-navigation";
import { FieldGuide } from "../screens/FieldGuide";
import { useKeepsakeStore } from "../store/keepsake";
import { usePresenceBeat } from "../sync/presence-beat";
import { useReconnectOnWake } from "../sync/wake-reconnect";

export function PlayerView({ roomControls }: { roomControls?: ReactNode }): React.JSX.Element {
  const me = useMe();
  const session = useSession();
  const runId = session?.runId;
  const state = useRunState();
  useEffect(() => { dismissPlayerSheet(); }, [runId]);
  // "Still here" to the server, the only way production learns a phone has
  // gone (#258). A phone only: the TV renders no PlayerView.
  usePresenceBeat();
  // Back from another app, a locked screen or a frozen background: a fresh
  // stream and a catch-up, before this phone offers last scene's question.
  useReconnectOnWake();

  /*
   * Ask once whether this deployment can offer sign-in at all (§4.5). It is a
   * single cached GET that 404s on a laptop, and asking here rather than at the
   * moment of the offer means the button is never a step that has to wait for
   * a network round trip to find out whether it exists.
   */
  const check = useKeepsakeStore((s) => s.check);
  useEffect(() => {
    void check();
  }, [check]);

  // No party member for this device means no character yet — the creation flow
  // owns the screen until there is one (spec §5).
  //
  // The trigger is "I have no character", and nothing else. A brand-new room
  // sits in `lobby` until the first CREATE_CHARACTER arrives, so gating on
  // `phase === "creation"` would leave the first player with nothing to tap.
  // Gating on the lobby phases at all would strand someone who joins after the
  // chapter has started — the engine seats a late character at any phase, so
  // this offers the flow at any phase too.
  //
  // WelcomeBack comes first: a player who has saved heroes is asked whether to
  // bring one before being asked to make anybody (spec §5), and one who has
  // none goes straight through to the creation flow.
  const creating = me === null;
  // Every seat is taken and none is ours (#389): say so before anybody builds
  // a hero the engine would refuse, and let them watch and cheer instead
  // (#388). Read from every patch, so a seat that opens (the host takes
  // somebody out) puts the creation flow back.
  const full = creating && state !== null && tableFull(state, session?.playerId);
  // Watching (#388): the table is full, or this kid chose "Just watch" on this
  // phone. The creation flow stays mounted (hidden) behind a choice to watch,
  // so a half-made hero survives changing their mind.
  const watching = full || (creating && state !== null && isSpectator(state, session?.playerId));
  // The tray's Guide tab works before there is a character too. PlayerPanel
  // shows the guide itself once there is one; until then it stands over the
  // creation flow, which stays mounted (hidden) so a half-made hero survives.
  const section = usePlayerNavigation((navigation) => navigation.section);
  const guideOverCreation = creating && section === "guide";

  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      {/* Who just joined (#267), for the host to keep or remove. In the flow,
          never over this player's own controls. */}
      <ArrivalNotices placement="inline" />
      {/* Running the room (#263): the roster, Remove, lock and close. Only on
          the device that opened it, folded away until the host opens it. */}
      <HostControls placement="inline" />
      {/* Back mid-chapter, or joining partway (#258): what the party is doing
          and where your hero is, in one line. Nothing until it has something
          to say. */}
      <CatchUp />
      {guideOverCreation ? <FieldGuide /> : null}
      {watching ? <Spectating hidden={guideOverCreation} /> : null}
      {creating && !full ? (
        <>
          {/* Not playing this time (#388): one tap to watch instead. */}
          {!watching ? <JustWatch hidden={guideOverCreation} /> : null}
          <div className="player-view__creation" hidden={guideOverCreation || watching}><WelcomeBack /></div>
        </>
      ) : null}
      {!creating ? <PlayerPanel roomControls={roomControls} /> : null}
      {/* A panel over the surface, not a route: the game keeps running behind
          it and closing it costs nobody their place. Renders nothing until
          somebody opens it. */}
      <SignInFlow />
      {/* Field Guide finds; waits while a turn prompt is open. */}
      <FieldGuideToast />
      {/*
       * Roadmap chapter 6's playtest drawer — warp to a scene, load the next
       * d20. `import.meta.env.DEV` is replaced with a literal `false` in the
       * production build, so the branch is dead code there and the component
       * drops out of the bundle with it.
       *
       * This is a convenience, not the boundary. The refusal that matters is
       * the server's (`playtest.ts`), because a lock the client holds is one a
       * client can lie about.
       */}
      {import.meta.env.DEV ? <PlaytestPanel /> : null}
    </div>
  );
}
