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

import { Button } from "../ui/Button";
import { Icon } from "../screens/icons";
import { useLayoutMode, useSend, useSession } from "../store";

export function ModeSwitch(): React.JSX.Element | null {
  const mode = useLayoutMode();
  const send = useSend();
  const isDisplay = (useSession()?.playerId ?? "") === "";

  if (isDisplay) return null;
  const next = mode === "party" ? "travel" : "party";

  return (
    <Button
      variant="ghost"
      size="md"
      className="kad-mode-switch"
      icon={<Icon name={next === "travel" ? "phone" : "party"} />}
      onClick={() => void send({ type: "SET_MODE", mode: next })}
      title={
        mode === "party"
          ? "Show the world on the phones instead of the TV"
          : "Hand the world back to the TV"
      }
    >
      {mode === "party" ? "No TV?" : "Use a TV"}
    </Button>
  );
}
