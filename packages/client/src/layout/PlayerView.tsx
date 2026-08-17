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
import { CreationFlow, PlayerPanel, SignInFlow } from "../screens";
// Imported by path rather than through the `screens` barrel on purpose: the
// barrel is what every surface pulls in, and the playtest drawer should reach
// exactly one call site — the one below, behind `import.meta.env.DEV`.
import { PlaytestPanel } from "../screens/PlaytestPanel";
import { useMe } from "../store";
import { useKeepsakeStore } from "../store/keepsake";

export function PlayerView(): React.JSX.Element {
  const me = useMe();

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
  const creating = me === null;

  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      {creating ? <CreationFlow /> : <PlayerPanel />}
      {/* A panel over the surface, not a route: the game keeps running behind
          it and closing it costs nobody their place. Renders nothing until
          somebody opens it. */}
      <SignInFlow />
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
