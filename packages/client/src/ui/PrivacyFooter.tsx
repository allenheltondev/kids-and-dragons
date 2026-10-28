/**
 * The page footer (#523): the quiet "Privacy" link, with the grown-up's guide beside it, on every
 * screen that is not the game itself and every place a kid can land directly: a direct room link,
 * hero creation, the pre-game lobby, the adventure book, the grown-up's pages, a closed room.
 *
 * Both links open in a tab of their own, so a kid partway through naming a hero loses nothing by
 * tapping one, and neither page needs an account or a room. The guide leaves itself out of its own
 * footer (`guide={false}`). The footer stays out of the game proper on purpose.
 */

import type { ReactElement } from "react";
import "./PrivacyFooter.css";

export function PrivacyFooter({ guide = true }: { guide?: boolean } = {}): ReactElement {
  return (
    <footer className="privacy-footer">
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
    </footer>
  );
}
