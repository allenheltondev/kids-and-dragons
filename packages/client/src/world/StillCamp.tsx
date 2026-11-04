/**
 * The lobby's camp as a still picture, for a screen with no WebGL (docs/camp.md
 * §8.7, #614): the backdrop, or the plains biome's own background standing in
 * for it until it is painted, and every seated hero at their bedroll. Framed
 * the same way the moving camp is (camp-framing.ts `campFraming`): covering
 * the pane's width, slid so the camp stands in the lobby's window, its plain
 * edges drawn on where it stops short of the pane. No renderer: plain images,
 * positioned in percent of the backdrop's box, which is placed in px off the
 * pane's measured size.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RunState } from "@kad/shared";
import type { CampLayout } from "./camp-layout";
import { BLEED_SOURCE, campBleed, campFocusBand, campFraming, campWindow } from "./camp-framing";
import { LOBBY_CAMP_STAND_IN, campHeroes, stillCampFigures } from "./lobby-camp";
import { lobbyInsetBottom, lobbyInsetTop, onLobbyInset, onLobbyInsetTop } from "./stage-inset";

export function StillCamp({ layout, state }: { layout: CampLayout; state: RunState }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const inset = useSyncExternalStore(onLobbyInset, lobbyInsetBottom, lobbyInsetBottom);
  const insetTop = useSyncExternalStore(onLobbyInsetTop, lobbyInsetTop, lobbyInsetTop);
  const [backdrop, setBackdrop] = useState(`/assets/${layout.backdrop.path}`);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setPane({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const heroes = campHeroes(state);
  const figures = stillCampFigures(layout, heroes);
  const band = campFocusBand(layout, heroes.map((hero) => hero.figure.heightCm));
  const at = pane.width > 0 && pane.height > 0
    ? campFraming(pane.width, campWindow(pane.height, insetTop, inset), layout.canvas, band)
    : null;
  const box = at
    ? { left: at.x, top: at.y, width: layout.canvas.width * at.scale, height: layout.canvas.height * at.scale }
    : { left: 0, top: 0, width: 0, height: 0 };
  const bleed = at ? campBleed(pane.height, at, layout.canvas) : { top: 0, bottom: 0 };
  // An edge strip: the painting's own plain top or bottom quarter, stretched
  // over what the pane has past that edge and flipped so the seam meets itself.
  const strip = (edge: "top" | "bottom", px: number) =>
    px > 0 ? (
      <div className={`kad-static-camp__bleed kad-static-camp__bleed--${edge}`} style={{ height: px }} aria-hidden="true">
        <img src={backdrop} alt="" style={{ height: px / BLEED_SOURCE }} />
      </div>
    ) : null;

  return (
    <div ref={host} className="kad-static-camp" data-testid="static-camp">
      <div className="kad-static-camp__frame" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
        {strip("top", bleed.top)}
        {strip("bottom", bleed.bottom)}
        <img
          className="kad-static-camp__backdrop"
          src={backdrop}
          alt=""
          onError={() => {
            const standIn = `/assets/${LOBBY_CAMP_STAND_IN}`;
            if (backdrop !== standIn) setBackdrop(standIn);
          }}
        />
        {figures.map((figure) => (
          <span
            key={figure.id}
            className={`kad-static-camp__hero${figure.away ? " is-away" : ""}`}
            data-hero={figure.id}
            style={{
              left: `${figure.x * 100}%`,
              top: `${figure.y * 100}%`,
              height: `${figure.size * 100}%`,
              zIndex: Math.round(figure.y * 1000),
            }}
          >
            {figure.url ? <img src={figure.url} alt="" /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
