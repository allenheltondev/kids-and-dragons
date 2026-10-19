/**
 * The adventure book's place in the tray, for a kid seated on a family tablet
 * (#299, #250).
 *
 * A phone kid finds her book on the home screen, because her phone is hers and
 * remembers her. A family tablet is nobody's: the kid picked holds only the
 * room session she was seated with, so the home screen offers her no book and
 * the book has to be reachable from inside the game. This is that way: one
 * more object on the tray, only on a seat that has no device token of its own.
 *
 * It just goes to `/journal`, which reads her book with her seat (store
 * `loadJournal`); the book is its own lazy chunk, so the tray costs one button.
 */

import { navigate } from "../router";
import { useSession } from "../store";
import { loadPlayerDeviceToken } from "../store/persistence";
import { TrayObject } from "../screens/TrayObjects";

export function BookTab({ className = "" }: { className?: string }): React.JSX.Element | null {
  const session = useSession();
  // A seated kid on a device that is not hers. A phone that remembers her, and
  // a TV, which is nobody, are not offered it here.
  if (!session?.playerId || loadPlayerDeviceToken() !== null) return null;
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
