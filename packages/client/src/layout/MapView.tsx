/**
 * MapView — where the party is, as a surface (spec §2.2).
 *
 * The third surface, and the only one a shell shows *on request*: the world
 * and your controls are always one tap away, the map is the thing you bring up
 * when you want to know how far along the evening is. It is a surface rather
 * than a panel inside PlayerView so that both shells can place it the same way
 * they place the other two — a pane of its own in Travel Mode, a swap for the
 * controller on a Party Mode phone — without PlayerPanel growing a mode.
 *
 * SAME TWO RULES AS WorldView AND PlayerView: nothing in here reads the room
 * mode, and nothing in here uses a viewport unit. `.kad-surface--map` is a
 * size container like the other two; everything inside is `em`, `%` and
 * container units.
 */

import { ChapterMapPanel } from "../screens";

export function MapView(): React.JSX.Element {
  return (
    <div className="kad-surface kad-surface--map" data-surface="map">
      <ChapterMapPanel />
    </div>
  );
}
