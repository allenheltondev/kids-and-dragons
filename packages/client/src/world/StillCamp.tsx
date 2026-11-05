/**
 * The camp as a still picture (docs/camp.md §8.7, #614, #620): the backdrop,
 * or the plains biome's own background standing in for it until it is
 * painted, every seated hero at her bedroll or tent, and the crew's pieces at
 * their hotspots. For a screen with no WebGL, and for a phone's Camp panel,
 * which is this picture with its hotspots tappable (`onSpot`). Framed the way
 * the moving camp is (camp-framing.ts `campFraming`): covering the pane's
 * width, slid so the camp stands in the window, its plain edges drawn on where
 * it stops short of the pane, and its heroes drawn smaller when the window is
 * too short for them at full size. No renderer: plain images and SVG,
 * positioned in percent of the backdrop's box, which is placed in px off the
 * pane's measured size.
 *
 * Art that is not painted yet is drawn as a labelled stand-in, as the moving
 * camp draws it (camp-stand-in.ts): a tent in her color with her name, a named
 * box for a piece.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { RunState } from "@kad/shared";
import type { CampLayout } from "./camp-layout";
import { BLEED_SOURCE, campBleed, campFit, campVisibleSpan, campWindow } from "./camp-framing";
import { LOBBY_CAMP_STAND_IN, campDressing, campHeroes, stillCampFigures } from "./lobby-camp";
import { lobbyInsetBottom, lobbyInsetTop, onLobbyInset, onLobbyInsetTop } from "./stage-inset";
import { campHeightPx, campMeasure } from "./camp-motion";
import { pieceHeightCm } from "./camp-layout";
import { ANCHOR_Y } from "./art-paths";
import { NOMINAL_PAINT } from "./figure-scale";
import { CampBedroll } from "./CampBedroll";
import { Campfire } from "./Campfire";
import { CAMP_KIT_STYLES, campKitStyle } from "./camp-kit-art";
import { campOwnedScale, campPieceOwner } from "./camp-ownership";
import { tentArt } from "./camp-scene";
import "./StaticStage.css";

/** The paint's share of a figure canvas's height: what a piece's size is measured against. */
const PAINT = ANCHOR_Y - NOMINAL_PAINT.top;
/** In the 1024 canvas: the ground, and the top of a nominally painted piece. */
const GROUND = 900;
const TOP = NOMINAL_PAINT.top * 1024;

/** Its painting, or the stand-in while that is owed. */
function ArtOr({ src, children }: { src: string | null; children: ReactNode }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{children}</>;
  return <img src={src} alt="" onError={() => setFailed(src)} />;
}

/** A ridge tent in her color, before her tent is painted. */
export function TentStandIn({ accent, decorations }: { accent: string; decorations: number }): React.JSX.Element {
  const w = 760;
  const diamonds = Array.from({ length: Math.min(3, decorations) }, (_, i) => {
    const x = 512 - w / 2 + ((i + 1) / (Math.min(3, decorations) + 1)) * w;
    const y = TOP + (GROUND - TOP) * (Math.abs(x - 512) / (w / 2)) + 60;
    return <path key={i} d={`M${x} ${y - 36}L${x + 36} ${y}L${x} ${y + 36}L${x - 36} ${y}Z`} fill="#ffd36e" stroke="#6b4f2a" strokeWidth="8" />;
  });
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" data-stand-in="tent">
      <path d={`M${512 - w / 2} ${GROUND}L512 ${TOP}L${512 + w / 2} ${GROUND}Z`} fill={accent} stroke="#3b2d1c" strokeWidth="14" />
      <path d={`M${512 - 100} ${GROUND}L512 ${GROUND - 450}L${512 + 100} ${GROUND}Z`} fill="#000" opacity=".35" />
      {diamonds}
    </svg>
  );
}

/** A named box, before a piece is painted. */
function PieceStandIn({ label }: { label: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" data-stand-in="piece">
      <rect x="392" y={TOP} width="240" height={GROUND - TOP} rx="30" fill="#2a2f4a" fillOpacity=".28" stroke="#8b6cf5" strokeWidth="12" />
      <text x="512" y={GROUND + 70} textAnchor="middle" dominantBaseline="middle" fontSize="90" fontWeight="700" fill="#fdf6e3" stroke="#1d1a2c" strokeWidth="18" paintOrder="stroke">
        {label}
      </text>
    </svg>
  );
}

/** The souvenir line beside her tent: a pennant per souvenir. */
function SouvenirStandIn({ accent, count }: { accent: string; count: number }): React.JSX.Element {
  const n = Math.min(4, count);
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" data-stand-in="souvenirs">
      <path d={`M232 ${GROUND}V${TOP}M792 ${GROUND}V${TOP}`} stroke="#6b4f2a" strokeWidth="24" />
      <path d={`M232 ${TOP + 60}Q512 ${TOP + 220} 792 ${TOP + 60}`} stroke="#e8dcc0" strokeWidth="10" fill="none" />
      {Array.from({ length: n }, (_, i) => {
        const x = 232 + ((i + 1) / (n + 1)) * 560;
        const y = TOP + 120;
        return <path key={i} d={`M${x - 50} ${y}L${x + 50} ${y}L${x} ${y + 150}Z`} fill={accent} stroke="#3b2d1c" strokeWidth="8" />;
      })}
    </svg>
  );
}

export interface StillCampProps {
  layout: CampLayout;
  state: RunState;
  /** The window's insets; absent, the lobby's panels' (stage-inset.ts). */
  insets?: { top: number; bottom: number };
  /** Tapping a shared hotspot picks for it (a phone's Camp panel); the named controls beside are the accessible way. */
  onSpot?: (hotspotId: string) => void;
  /** The hotspot a phone has open, ringed. */
  activeSpot?: string | null;
}

export function StillCamp({ layout, state, insets, onSpot, activeSpot = null }: StillCampProps): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const lobbyBottom = useSyncExternalStore(onLobbyInset, lobbyInsetBottom, lobbyInsetBottom);
  const lobbyTop = useSyncExternalStore(onLobbyInsetTop, lobbyInsetTop, lobbyInsetTop);
  const inset = insets?.bottom ?? lobbyBottom;
  const insetTop = insets?.top ?? lobbyTop;
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
  // The moving camp's one rule (camp-framing.ts `campFit`): heroes shrink,
  // never the painting, when the band would not fit the window at full size.
  const fit = pane.width > 0 && pane.height > 0
    ? campFit(pane.width, campWindow(pane.height, insetTop, inset), layout, heroes.map((hero) => hero.figure.heightCm))
    : null;
  const at = fit?.framing ?? null;
  const scale = fit?.figureScale ?? 1;
  const figures = stillCampFigures(layout, heroes, scale, at ? campVisibleSpan(pane.width, at, layout.canvas.width) : undefined);
  const box = at
    ? { left: at.x, top: at.y, width: layout.canvas.width * at.scale, height: layout.canvas.height * at.scale }
    : { left: 0, top: 0, width: 0, height: 0 };
  const bleed = at ? campBleed(pane.height, at, layout.canvas) : { top: 0, bottom: 0 };
  const measure = campMeasure(layout.canvas.height);
  const dressing = campDressing(state, layout);
  /** A piece's box height as a fraction of the frame, on `lane`, `heightCm` tall. */
  const sizeOf = (heightCm: number, laneScale: number, paint = PAINT, owner = 1) =>
    (campHeightPx(heightCm, measure) * owner * laneScale * scale) / paint / layout.canvas.height;
  // An edge strip: the painting's own plain top or bottom quarter, stretched
  // over what the pane has past that edge and flipped so the seam meets itself.
  const strip = (edge: "top" | "bottom", px: number) =>
    px > 0 ? (
      <div className={`kad-static-camp__bleed kad-static-camp__bleed--${edge}`} style={{ height: px }} aria-hidden="true">
        <img src={backdrop} alt="" style={{ height: px / BLEED_SOURCE }} />
      </div>
    ) : null;
  const nearest = [...layout.lanes.values()].sort((a, b) => b.y - a.y)[0];
  const fire = layout.frame.hotspots?.find((h) => h.kind === "cookfire") ?? layout.frame.pieces.find((p) => p.id === "campfire");

  return (
    <div ref={host} className="kad-static-camp" data-testid="static-camp" data-stage={layout.frame.stage}>
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
            <span className="kad-static-camp__name">{state.party.find(member => member.character.id === figure.id)?.character.name}</span>
          </span>
        ))}
        {layout.frame.pieces.map(piece => {
          const lane = layout.lanes.get(piece.lane);
          if (!lane) return null;
          const owner = campPieceOwner(layout, piece, heroes.map(hero => hero.figure));
          // Her stored style first; the id's hash only when none is stored (#633, #620).
          const kitStyle = owner && piece.id.startsWith("bedroll") ? campKitStyle(owner.id, owner.kitStyle) : null;
          const paintHeight = kitStyle ? CAMP_KIT_STYLES[kitStyle].paintHeight : PAINT;
          const size = sizeOf(pieceHeightCm(piece), lane.scale, paintHeight, campOwnedScale(owner, measure));
          const accent = owner?.accent ?? "#c9b99a";
          const tent = piece.id.startsWith("tent_") ? tentArt(owner?.tent ?? null, campKitStyle(owner?.id ?? piece.id, owner?.kitStyle)) : undefined;
          return <span key={piece.id} className="kad-static-camp__piece" data-piece={piece.id} style={{
            left: `${piece.x * 100}%`, top: `${lane.y * 100}%`, height: `${size * 100}%`, zIndex: Math.round(lane.y * 1000) - 1,
          }} data-mirrored={piece.id.startsWith("bedroll") && piece.x > .5 ? "true" : undefined}>
            {owner && kitStyle ? <CampBedroll style={kitStyle} accent={accent} />
              : piece.id === "campfire" ? <Campfire active={false} />
              : piece.id.startsWith("tent_") ? (
                <ArtOr src={tent ? `/assets/${tent.path}` : null}>
                  <TentStandIn accent={accent} decorations={(owner?.slots ?? []).filter((s) => s !== null).length} />
                </ArtOr>
              )
              : piece.id.startsWith("souvenirs_") ? (
                <ArtOr src={`/assets/${piece.path}`}><SouvenirStandIn accent={accent} count={owner?.souvenirs ?? 0} /></ArtOr>
              )
              : <ArtOr src={`/assets/${piece.path}`}><PieceStandIn label={piece.id.replace(/_/g, " ")} /></ArtOr>}
            {piece.id.startsWith("tent_") && owner?.name ? <span className="kad-static-camp__tag">{`${owner.name}'s tent`}</span> : null}
          </span>;
        })}
        {dressing.spots.map((spot) => {
          const lane = layout.lanes.get(spot.lane);
          if (!lane) return null;
          const size = sizeOf(spot.pieceId ? spot.heightCm : 120, lane.scale);
          const ring = spot.highlighted || activeSpot === spot.id;
          return (
            <span
              key={spot.id}
              className={`kad-static-camp__piece kad-static-camp__spot${ring ? " is-lit" : ""}${spot.pieceId ? "" : " is-empty"}`}
              data-spot={spot.id}
              data-spot-piece={spot.pieceId ?? ""}
              style={{ left: `${spot.x * 100}%`, top: `${lane.y * 100}%`, height: `${size * 100}%`, zIndex: Math.round(lane.y * 1000) - 1 }}
            >
              {spot.pieceId ? (
                <ArtOr src={spot.path ? `/assets/${spot.path}` : null}><PieceStandIn label={spot.label} /></ArtOr>
              ) : null}
              {spot.banner ? <span className="kad-static-camp__banner">{spot.banner}</span> : null}
              {onSpot && spot.pickable ? (
                // The picture's own tap target; the named control in the panel is the accessible one.
                <button type="button" className="kad-static-camp__tap" tabIndex={-1} aria-hidden="true" onClick={() => onSpot(spot.id)}>
                  {spot.pieceId ? null : <span className="kad-static-camp__spot-name">{spot.label}</span>}
                </button>
              ) : null}
            </span>
          );
        })}
        {nearest
          ? dressing.beside.map((piece, i) => {
              const x = (fire?.x ?? 0.5) + (i - (dressing.beside.length - 1) / 2) * 0.075;
              const size = sizeOf(Math.min(piece.heightCm, 120), nearest.scale);
              return (
                <span
                  key={piece.pieceId}
                  className="kad-static-camp__piece kad-static-camp__beside"
                  data-beside={piece.pieceId}
                  style={{ left: `${x * 100}%`, top: `${nearest.y * 100}%`, height: `${size * 100}%`, zIndex: Math.round(nearest.y * 1000) + 1 }}
                >
                  <ArtOr src={piece.path ? `/assets/${piece.path}` : null}><PieceStandIn label={piece.label} /></ArtOr>
                </span>
              );
            })
          : null}
      </div>
    </div>
  );
}
