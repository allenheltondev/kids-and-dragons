/**
 * The adventure book's place in the tray, for a kid seated at the game
 * (#299, #250; docs/camp.md §7, owner 2026-11-08).
 *
 * Her book is where her hero's kit and look are picked, and a kid who only
 * ever sees the game would never find it on the home screen. So it is on the
 * tray **while her kit and look can change**: in downtime (the lobby, a rest,
 * the chapter's end), when the book hands her taps to the game's Camp panel
 * (screens/book-table.tsx). In a scene, a check or a fight nothing of hers
 * changes, and her phone's tray stays the game's four.
 *
 * A family tablet is nobody's: the kid picked holds only the room session she
 * was seated with, the home screen offers her no book at all, and this is her
 * only way to it, so there it is always on the tray. A TV, which is nobody,
 * is not offered it.
 *
 * It just goes to `/journal`, which reads her book (store `loadJournal`: her
 * phone's binding, or her seat on a tablet) while the game stays live behind
 * it, and whose Play goes back to the game. The book is its own lazy chunk,
 * so the tray costs one button.
 */

import { campMomentKind } from "@kad/shared";
import { navigate } from "../router";
import { useGameStore, useSession } from "../store";
import { loadPlayerDeviceToken } from "../store/persistence";
import { TrayObject } from "../screens/TrayObjects";

export function BookTab({ className = "" }: { className?: string }): React.JSX.Element | null {
  const session = useSession();
  const downtime = useGameStore((store) => store.state !== null && campMomentKind(store.state) !== null);
  // A seated kid: on her own phone while her kit and look can change, on a family tablet always.
  if (!session?.playerId) return null;
  if (!downtime && loadPlayerDeviceToken() !== null) return null;
  return (
    <button type="button" className={`${className} kad-tray__tab kad-tap kad-focusable`.trim()}
      onClick={() => navigate({ name: "journal" })}>
      <span className="kad-tray__object">
        <TrayObject name="scroll" />
      </span>
      <span className="kad-tray__label">Book</span>
    </button>
  );
}
