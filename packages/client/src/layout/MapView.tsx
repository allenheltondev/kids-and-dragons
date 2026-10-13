/**
 * MapView — where the party is, as a surface (spec §2.2).
 *
 * The third surface, and the only one a shell shows *on request*: the world
 * and your controls are always one tap away, the map is the thing you bring up
 * when you want to know where you are. It is a surface rather than a panel
 * inside PlayerView so that both shells can place it the same way they place
 * the other two — a pane of its own in Travel Mode, a swap for the controller
 * on a Party Mode phone — without PlayerPanel growing a mode.
 *
 * Two maps answer two questions, and a flip at the top chooses:
 *
 *   World — the realm painting, the party's faces on the chapter's country.
 *           "Where in the world are we?"
 *   Route — tonight's chapter as a trail, the scenes played named and the
 *           road ahead in fog. "How far through the story are we?"
 *
 * World is first because it is the picture; the route is the itinerary. The
 * choice is remembered across opens for the life of the page — a player who
 * keeps checking the trail should not be handed the painting every time.
 *
 * SAME TWO RULES AS WorldView AND PlayerView: nothing in here reads the room
 * mode, and nothing in here uses a viewport unit. `.kad-surface--map` is a
 * size container like the other two; everything inside is `em`, `%` and
 * container units.
 */

import { useState } from "react";
import { ChapterMapPanel, Icon, WorldMapPanel } from "../screens";

export type MapKind = "world" | "route";

/** The last map looked at on this page. Module state on purpose — see above. */
let remembered: MapKind = "world";

export function MapView(): React.JSX.Element {
  const [kind, setKindState] = useState<MapKind>(remembered);
  const setKind = (next: MapKind): void => {
    remembered = next;
    setKindState(next);
  };

  return (
    <div className="kad-surface kad-surface--map" data-surface="map">
      <nav className="kad-map__flip" aria-label="Which map">
        <button
          type="button"
          className={`kad-map__flip-tab kad-tap kad-focusable${kind === "world" ? " kad-map__flip-tab--on" : ""}`}
          aria-pressed={kind === "world"}
          onClick={() => setKind("world")}
        >
          <Icon name="map" />
          <span>World</span>
        </button>
        <button
          type="button"
          className={`kad-map__flip-tab kad-tap kad-focusable${kind === "route" ? " kad-map__flip-tab--on" : ""}`}
          aria-pressed={kind === "route"}
          onClick={() => setKind("route")}
        >
          <Icon name="steps" />
          <span>Route</span>
        </button>
      </nav>
      <div className="kad-map__host" data-map={kind}>
        {kind === "world" ? <WorldMapPanel /> : <ChapterMapPanel />}
      </div>
    </div>
  );
}
