/**
 * The lobby's camp as a still picture, for a screen with no WebGL (docs/camp.md
 * §8.7, #614): the backdrop, or the plains biome's own background standing in
 * for it until it is painted, and every seated hero at their bedroll. Framed
 * the same way the moving camp is (camp-layout.ts `campFrame`), clear of the
 * lobby's panels. No renderer: plain images, positioned in percent of the
 * backdrop's box, which is placed in px off the pane's measured size.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RunState } from "@kad/shared";
import { campFrame, campGround, type CampLayout } from "./camp-layout";
import { LOBBY_CAMP_STAND_IN, campHeroes, stillCampFigures } from "./lobby-camp";
import { lobbyInsetBottom, onLobbyInset, storyStageHeight } from "./stage-inset";

export function StillCamp({ layout, state }: { layout: CampLayout; state: RunState }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const inset = useSyncExternalStore(onLobbyInset, lobbyInsetBottom, lobbyInsetBottom);
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

  const figures = stillCampFigures(layout, campHeroes(state));
  const at = pane.width > 0 && pane.height > 0
    ? campFrame(pane.width, pane.height, inset, layout.canvas, campGround(layout), storyStageHeight(pane.width, pane.height, inset))
    : null;
  const box = at
    ? { left: at.x, top: at.y, width: layout.canvas.width * at.scale, height: layout.canvas.height * at.scale }
    : { left: 0, top: 0, width: 0, height: 0 };

  return (
    <div ref={host} className="kad-static-camp" data-testid="static-camp">
      <div className="kad-static-camp__frame" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
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
