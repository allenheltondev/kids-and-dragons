/**
 * The adventure book's place in the tray, for any kid seated at the game
 * (#299, #250; docs/camp.md §7, owner 2026-11-08).
 *
 * Her book is where her hero's kit and look are picked, and a kid who only
 * ever sees the game would never find it on the home screen. So every seated
 * kid has it here: on her own phone, and on a family tablet, where the kid
 * picked holds only the room session she was seated with and the home screen
 * offers her no book at all. A TV, which is nobody, is not offered it.
 *
 * It just goes to `/journal`, which reads her book (store `loadJournal`: her
 * phone's binding, or her seat on a tablet) while the game stays live behind
 * it, and whose Play goes back to the game. Seated, the book knows the game's
 * moment (screens/book-table.tsx): in downtime its kit and Style shelves hand
 * her to the game's Camp panel. The book is its own lazy chunk, so the tray
 * costs one button.
 */

import { navigate } from "../router";
import { useSession } from "../store";
import { TrayObject } from "../screens/TrayObjects";

export function BookTab({ className = "" }: { className?: string }): React.JSX.Element | null {
  const session = useSession();
  // A seated kid, whoever's device it is. A TV, which is nobody, is not offered it.
  if (!session?.playerId) return null;
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
