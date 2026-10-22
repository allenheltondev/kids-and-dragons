/**
 * The back button in the top left corner, opposite display settings.
 *
 * It steps back one page, wherever you are: first out of whatever is open over
 * the page (a Field Guide entry, the pane you came from), then to the page the
 * app came from, and home when this is where the visit began. In a game it
 * appears only while something is open to step back out of, since going back
 * from the game itself is leaving it, which has its own button.
 */

import type { ReactElement } from "react";
import { goBack, useRoute } from "../router";
import { runBackStep, useHasBackStep } from "../store/back-steps";
import { Icon } from "../screens/icons";
import "./BackButton.css";

export function BackButton(): ReactElement | null {
  const route = useRoute();
  const hasStep = useHasBackStep();
  const showing =
    route.name === "journal" || route.name === "guide" || route.name === "account" || (route.name === "player" && hasStep);
  if (!showing) return null;
  return (
    <div className="kad-back">
      <button type="button" className="kad-back__button kad-focusable" aria-label="Go back"
        onClick={() => { if (!runBackStep()) goBack(); }}>
        <Icon name="back" />
      </button>
    </div>
  );
}
