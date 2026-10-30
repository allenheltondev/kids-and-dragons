/**
 * The page footer (#523): the grown-up's guide and the quiet "Privacy" link, over the copyright line,
 * on every screen that is not the game itself and every place a kid can land directly: a direct room
 * link, the pre-game lobby, the adventure book, the grown-up's pages, a closed room.
 *
 * Both links open in a tab of their own, so a kid partway through naming a hero loses nothing by
 * tapping one, and neither page needs an account or a room. The guide leaves itself out of its own
 * footer (`guide={false}`). `compact` drops the copyright line while a phone waits in the lobby.
 * PhoneFrame keeps pregame links below navigation, including while making a hero.
 * The footer disappears once the adventure starts.
 */

import type { ReactElement } from "react";
import "./PrivacyFooter.css";

/** Who holds the copyright shown in the footer. */
export const COPYRIGHT_HOLDER = "Ready, Set, Cloud!";

export function PrivacyFooter({
  guide = true,
  compact = false,
  year = new Date().getFullYear(),
}: { guide?: boolean; compact?: boolean; year?: number } = {}): ReactElement {
  return (
    <footer className="privacy-footer">
      <div className="privacy-footer__links">
        {guide ? (
          <>
            <a className="privacy-footer__link kad-focusable" href="/guide" target="_blank" rel="noopener">
              Grown-up&rsquo;s guide
            </a>
            <span className="privacy-footer__dot" aria-hidden="true">·</span>
          </>
        ) : null}
        <a className="privacy-footer__link kad-focusable" href="/privacy" target="_blank" rel="noopener">
          Privacy
        </a>
      </div>
      {compact ? null : (
        <small className="privacy-footer__copy">&copy; {year} {COPYRIGHT_HOLDER}</small>
      )}
    </footer>
  );
}
