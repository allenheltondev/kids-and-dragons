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

import { CreationFlow, PlayerPanel } from "../screens";
import { useMe, useRunState } from "../store";

export function PlayerView(): React.JSX.Element {
  const phase = useRunState()?.phase ?? "lobby";
  const me = useMe();

  // No party member for this device means no character yet — the creation flow
  // owns the screen until there is one (spec §5).
  const creating = phase === "creation" && me === null;

  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      {creating ? <CreationFlow /> : <PlayerPanel />}
    </div>
  );
}
