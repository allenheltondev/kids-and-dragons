/**
 * The mid-session mode switch (spec §2.2, roadmap chapter 2): the laptop dies
 * and a phone absorbs the WorldView, or the TV comes back and the phones hand
 * it over again.
 *
 * It lives in `layout/` because switching the mode *is* a layout change — it is
 * the one action whose entire subject is where the two surfaces land. That also
 * keeps the rule in WorldView/PlayerView absolute: those subtrees still cannot
 * read the room mode, and a rule with one exception grows a second.
 *
 * It is never rendered on a display client. The TV has no input at all (spec
 * §2.1); the phones are where every control lives.
 */

import { TrayObject } from "../screens/TrayObjects";
import { cue } from "../audio/cue";
import { useLayoutMode, useSend, useSession } from "../store";

export function ModeSwitch(): React.JSX.Element | null {
  const mode = useLayoutMode();
  const send = useSend();
  const isDisplay = (useSession()?.playerId ?? "") === "";

  if (isDisplay) return null;
  const next = mode === "party" ? "travel" : "party";

  // Room settings owns this control; the bottom tray keeps its four destinations.
  return (
    <button
      type="button"
      className="kad-mode-switch kad-room-mode kad-tap kad-focusable"
      onClick={() => {
        cue("tap");
        void send({ type: "SET_MODE", mode: next });
      }}
      // Explain which device will carry the world after switching.
      aria-label={mode === "party" ? "No TV? Show the world on the phones" : "Use a TV for the world"}
      title={
        mode === "party"
          ? "Show the world on the phones instead of the TV"
          : "Hand the world back to the TV"
      }
    >
      <span className="kad-tray__object">
        <TrayObject name={next === "travel" ? "phone" : "tv"} />
      </span>
      <span>{mode === "party" ? "Play on phones instead" : "Use a TV for the world"}</span>
    </button>
  );
}
