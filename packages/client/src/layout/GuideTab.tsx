/**
 * The Field Guide's place in the tray (#112) — a permanent fourth destination
 * beside World, You and Map, on every phone, in every phase: the lobby, a
 * story scene, a rest and the middle of a fight.
 *
 * It is a peer of the bag, not a pane of its own: the guide renders inside the
 * player pane (PlayerPanel's `guide` section), so opening it never unmounts a
 * half-made aim, and tapping You comes straight back to the bag with the
 * "Your turn" entry on it. That is why it never blocks a turn — the You tab
 * keeps its ★ badge while the guide is open, and nothing here sends an intent.
 *
 * The painted journal gives the guide its own recognizable tray object.
 */

import { openGuide } from "../store/player-navigation";
import { TrayObject } from "../screens/TrayObjects";

export interface GuideTabProps {
  /** True while the player pane is showing and the guide is open in it. */
  on: boolean;
  /** Bring the player pane forward (the layout owns which pane shows). */
  onShowPlayer: () => void;
  /** Layout-specific classes the other tabs carry (Travel's `kad-travel__tab`). */
  className?: string;
  onClassName?: string;
}

export function GuideTab({ on, onShowPlayer, className = "", onClassName = "" }: GuideTabProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${className} kad-tray__tab kad-tap kad-focusable${on ? ` ${onClassName} kad-tray__tab--on` : ""}`.trim().replace(/\s+/g, " ")}
      aria-pressed={on}
      onClick={() => { openGuide(); onShowPlayer(); }}
    >
      <span className="kad-tray__object">
        <TrayObject name="fieldGuide" />
      </span>
      <span className="kad-tray__label">Guide</span>
    </button>
  );
}
