/**
 * The quiet privacy link (#523) for every screen that is not the game itself and
 * every place a kid can land directly: a direct room link, hero creation, the
 * pre-game lobby, the adventure book, the grown-up's pages, a closed room.
 *
 * It opens `/privacy` in a tab of its own, so a kid partway through naming a
 * hero loses nothing by tapping it, and the page needs no account and no room.
 * The start screens carry their own copy of the same link (`home__footer`); this
 * is the one for everywhere else. It stays out of the game proper on purpose.
 */

import type { ReactElement } from "react";
import "./PrivacyFooter.css";

export function PrivacyFooter(): ReactElement {
  return (
    <footer className="privacy-footer">
      <a className="privacy-footer__link kad-focusable" href="/privacy" target="_blank" rel="noopener">
        Privacy
      </a>
    </footer>
  );
}
