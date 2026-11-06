/**
 * The camp as a still picture (docs/camp.md §8.7, #614, #620): the backdrop,
 * or the plains biome's own background standing in for it until it is
 * painted, every seated hero at her bedroll or tent, and the crew's pieces at
 * their hotspots. For a screen with no WebGL, and for a phone's Camp panel,
 * which is this picture with its hotspots tappable (`onSpot`).
 *
 * On the shared screen it is framed the way the moving camp is (camp-boxes.ts
 * `campFitFor`): covering the pane's width, slid so the camp stands in the
 * window, its plain edges drawn on where it stops short of the pane, and its
 * heroes drawn smaller when the window is too short for them at full size.
 *
 * In a phone's Camp panel (`fit="width"`) the panel is for picking spots, so
 * it shows the camp's whole width instead: the painting is scaled to the
 * panel's width and cropped to the camp's band (sky and foreground trimmed,
 * never the sides), and every pickable spot gets a chip under the picture,
 * big enough for a child's finger (docs/accessibility.md `--kad-touch-min`),
 * with a thin line up to its spot.
 *
 * Every piece is placed from the same boxes the moving camp draws
 * (camp-boxes.ts `campBoxes`): a hero's gear fitted to her, a shared piece at
 * its true height and width. Art that is not painted yet is a quiet stand-in,
 * as the moving camp draws it (camp-stand-in.ts): a soft tent in her color, a
 * pale rounded silhouette for a piece, and a small label laid out clear of the
 * others. No renderer: plain images and SVG, positioned in percent of the
 * backdrop's box, which is placed in px off the pane's measured size.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { RunState } from "@kad/shared";
import type { CampLayout } from "./camp-layout";
import { BLEED_SOURCE, campBleed, campFocusBand, campVisibleSpan, campWindow, type CampFraming } from "./camp-framing";
import { LOBBY_CAMP_STAND_IN, campDressing, campFriends, campHeroes, stillCampFigures } from "./lobby-camp";
import leafArt from "../assets/painted/leaf.webp";
import { campAccent } from "./camp-accents";
import { lobbyInsetBottom, lobbyInsetTop, onLobbyInset, onLobbyInsetTop } from "./stage-inset";
import { ANCHOR_Y } from "./art-paths";
import { NOMINAL_PAINT } from "./figure-scale";
import { CampBedroll, CampClothArt } from "./CampBedroll";
import { Campfire } from "./Campfire";
import { CAMP_KIT_STYLES, campKitStyle, campTentCloth } from "./camp-kit-art";
import { campPieceOwner } from "./camp-ownership";
import { campBoxes, campFitFor, campReachOf, campRowScale, piecePainting, rectOf, type CampBox, type CampBoxInput } from "./camp-boxes";
import { chipRows } from "./camp-chips";
import { campPaint } from "./camp-paint";
import { hotspotName, tentArt } from "./camp-scene";
import "./StaticStage.css";

/** The paint's share of a figure canvas's height: what a piece's size is measured against. */
const PAINT = ANCHOR_Y - NOMINAL_PAINT.top;
/** In the 1024 canvas: the ground, and the top of a nominally painted piece. */
const GROUND = 900;
const TOP = NOMINAL_PAINT.top * 1024;
/** A phone chip's row, px: the touch target and the gap under it. */
const CHIP_ROW = 60;

/** Its painting, or the stand-in while that is owed (and the owed one is reported, for its label). */
function ArtOr({ src, children, onMissing }: { src: string | null; children: ReactNode; onMissing?: (src: string) => void }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{children}</>;
  return (
    <img
      src={src}
      alt=""
      onError={() => {
        setFailed(src);
        onMissing?.(src);
      }}
    />
  );
}

/** A soft-edged tent in her color, before her tent is painted; `width` is its drawn width over its height. */
export function TentStandIn({ accent, decorations, width = 1.1, owned = true }: { accent: string; decorations: number; width?: number; owned?: boolean }): React.JSX.Element {
  const h = GROUND - TOP;
  const w = Math.min(1000, h * width);
  const l = 512 - w / 2;
  const r = 512 + w / 2;
  const d = `M${l} ${GROUND}C${512 - w * 0.41} ${GROUND - h * 0.35} ${512 - w * 0.17} ${GROUND - h * 0.82} ${512 - w * 0.05} ${GROUND - h * 0.98}Q512 ${TOP - h * 0.02} ${512 + w * 0.05} ${GROUND - h * 0.98}C${512 + w * 0.17} ${GROUND - h * 0.82} ${512 + w * 0.41} ${GROUND - h * 0.35} ${r} ${GROUND}Z`;
  const count = Math.min(3, decorations);
  const dots = Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / (count + 1);
    const x = 512 - w * 0.42 + t * w * 0.3;
    const y = GROUND - h * (0.12 + 0.62 * t);
    return <circle key={i} cx={x} cy={y} r={h * 0.045} fill="#ffd36e" />;
  });
  const fill = owned ? accent : "#c9b99a";
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" data-stand-in="tent" data-owned={owned ? "true" : "false"} overflow="visible">
      <path d={d} fill={fill} opacity={owned ? 0.92 : 0.45} stroke={fill} strokeOpacity=".35" strokeWidth="26" strokeLinejoin="round" />
      <path d={`M${512 - w * 0.04} ${GROUND - h * 0.97}C${512 - w * 0.22} ${GROUND - h * 0.7} ${512 - w * 0.38} ${GROUND - h * 0.3} ${512 - w * 0.46} ${GROUND}L${512 - w * 0.1} ${GROUND}Z`} fill="#fff" opacity={owned ? 0.12 : 0.06} />
      <path d={`M${512 - w * 0.13} ${GROUND}Q${512 - w * 0.12} ${GROUND - h * 0.5} 512 ${GROUND - h * 0.52}Q${512 + w * 0.12} ${GROUND - h * 0.5} ${512 + w * 0.13} ${GROUND}Z`} fill="#000" opacity={owned ? 0.3 : 0.12} />
      {dots}
    </svg>
  );
}

/** A pale, rounded silhouette at a piece's true height and width (`width`, over its height), before it is painted. */
function PieceStandIn({ width }: { width: number }): React.JSX.Element {
  const h = GROUND - TOP;
  const w = Math.max(40, h * width);
  const r = Math.min(w, h) * 0.45;
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" data-stand-in="piece" overflow="visible">
      <rect x={512 - w / 2} y={TOP} width={w} height={h} rx={r} fill="#f3ead6" fillOpacity=".2" stroke="#f3ead6" strokeOpacity=".32" strokeWidth="10" />
    </svg>
  );
}

/** The souvenir line on her tent: a pennant per souvenir. */
function SouvenirStandIn({ accent, count }: { accent: string; count: number }): React.JSX.Element {
  const n = Math.min(4, count);
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" data-stand-in="souvenirs">
      <path d={`M232 ${GROUND}V${TOP}M792 ${GROUND}V${TOP}`} stroke="#6b4f2a" strokeWidth="20" strokeOpacity=".8" />
      <path d={`M232 ${TOP + 60}Q512 ${TOP + 220} 792 ${TOP + 60}`} stroke="#e8dcc0" strokeWidth="10" fill="none" strokeOpacity=".8" />
      {Array.from({ length: n }, (_, i) => {
        const x = 232 + ((i + 1) / (n + 1)) * 560;
        const y = TOP + 120;
        return <path key={i} d={`M${x - 50} ${y}L${x + 50} ${y}L${x} ${y + 150}Z`} fill={accent} opacity=".9" />;
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
  /** "cover", the shared screen's framing; "width", a phone's Camp panel: the whole camp across, its band only. */
  fit?: "cover" | "width";
}

export function StillCamp({ layout, state, insets, onSpot, activeSpot = null, fit: mode = "cover" }: StillCampProps): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const lobbyBottom = useSyncExternalStore(onLobbyInset, lobbyInsetBottom, lobbyInsetBottom);
  const lobbyTop = useSyncExternalStore(onLobbyInsetTop, lobbyInsetTop, lobbyInsetTop);
  const inset = insets?.bottom ?? lobbyBottom;
  const insetTop = insets?.top ?? lobbyTop;
  const paintedBackdrop = `/assets/${layout.backdrop.path}`;
  const [failedBackdrop, setFailedBackdrop] = useState<string | null>(null);
  const usingFallback = failedBackdrop === paintedBackdrop;
  const backdrop = usingFallback ? `/assets/${LOBBY_CAMP_STAND_IN}` : paintedBackdrop;
  const accent = usingFallback ? undefined : campAccent(layout.backdrop.family);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const owed = (src: string): void => setMissing((was) => (was.has(src) ? was : new Set([...was, src])));

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
  const dressing = campDressing(state, layout);
  const input: Omit<CampBoxInput, "figureScale"> = {
    heroes: heroes.map(({ figure }) => ({
      seat: figure.seat!,
      heightCm: figure.heightCm,
      id: figure.id,
      ...(figure.species ? { species: figure.species } : {}),
      ...(figure.name ? { name: figure.name } : {}),
      kitStyle: figure.kitStyle ?? null,
      tent: figure.tent ?? null,
      souvenirs: figure.souvenirs ?? 0,
    })),
    spots: dressing.spots,
    beside: dressing.beside,
  };
  const heights = heroes.map((hero) => hero.figure.heightCm);
  const W = layout.canvas.width;
  const H = layout.canvas.height;

  // The framing: the shared screen's cover-fit, or the panel's whole width.
  let at: CampFraming | null = null;
  let scale = 1;
  let rootHeight: number | undefined;
  let bandPx = 0;
  let bandTop = 0;
  if (mode === "width" && pane.width > 0) {
    scale = layout.frame.hotspots ? campRowScale(layout, input) : 1;
    const reach = layout.frame.hotspots ? campReachOf(layout, campBoxes(layout, { ...input, figureScale: 1 })) : [];
    const band = campFocusBand(layout, heights, scale, reach);
    const s = pane.width / W;
    bandTop = band.top;
    bandPx = (band.bottom - band.top) * H * s;
    at = { scale: s, x: 0, y: -band.top * H * s };
  } else if (mode === "cover" && pane.width > 0 && pane.height > 0) {
    const fitted = campFitFor(pane.width, campWindow(pane.height, insetTop, inset), layout, input, 0.5, heights);
    at = fitted.framing;
    scale = fitted.figureScale;
  }
  const boxes = campBoxes(layout, { ...input, figureScale: scale });
  const boxOf = new Map(boxes.map((b) => [b.id, b]));
  const visible = at && mode === "cover" ? campVisibleSpan(pane.width, at, W) : undefined;
  const figures = stillCampFigures(layout, heroes, scale, visible, campFriends(state));
  const box = at ? { left: at.x, top: at.y, width: W * at.scale, height: H * at.scale } : { left: 0, top: 0, width: 0, height: 0 };
  let bleed = at && mode === "cover" ? campBleed(pane.height, at, layout.canvas) : { top: 0, bottom: 0 };

  // A phone's chips: one per pickable spot, under the picture.
  const chips = mode === "width" && onSpot && at
    ? chipRows(
        dressing.spots.filter((spot) => spot.pickable).map((spot) => {
          // Its line may drop from anywhere across the middle of its piece's painting.
          const b = boxOf.get(`spot:${spot.id}`);
          const r = b ? rectOf(b) : null;
          const inset = r ? (r.r - r.l) * 0.1 : 0;
          return {
            id: spot.id,
            label: hotspotName(spot.kind),
            x: spot.x * W * at!.scale,
            ...(r ? { x0: (r.l + inset) * at!.scale, x1: (r.r - inset) * at!.scale } : {}),
          };
        }),
        pane.width,
      )
    : [];
  const chipRowsCount = chips.reduce((n, chip) => Math.max(n, chip.row + 1), 0);
  if (mode === "width") {
    rootHeight = Math.max(120, bandPx + chipRowsCount * CHIP_ROW + (chipRowsCount > 0 ? 8 : 0));
    // The chips stand on the painting's own grass, drawn on past its foot when they reach that far.
    if (at) bleed = campBleed(rootHeight, at, layout.canvas);
  }

  /** A piece's square canvas as a fraction of the frame's height, for its box's drawn height: its painting's own footprint (camp-paint.ts), or the nominal one. */
  const canvasOf = (b: CampBox, path?: string | null, paint = PAINT) => {
    const painted = campPaint(path);
    return b.height / (painted ? painted.bottom - painted.top : paint) / H;
  };
  const strip = (edge: "top" | "bottom", px: number) =>
    px > 0 ? (
      <div className={`kad-static-camp__bleed kad-static-camp__bleed--${edge}`} style={{ height: px }} aria-hidden="true">
        <img src={backdrop} alt="" style={{ height: px / BLEED_SOURCE }} />
      </div>
    ) : null;
  // Labels show over stand-ins only: a painting says what it is.
  const labelled = (b: CampBox, src: string | null) => b.label && (src === null || missing.has(src));
  const label = (b: CampBox, src: string | null) =>
    labelled(b, src) ? (
      <span
        key={`label:${b.id}`}
        className="kad-static-camp__label"
        data-label={b.id}
        style={{
          left: `${(b.label!.x / W) * 100}%`,
          top: `${(b.label!.y / H) * 100}%`,
          fontSize: (b.label!.size / H) * box.height,
        }}
      >
        {b.label!.text}
      </span>
    ) : null;
  const labels: ReactNode[] = [];
  // A piece's canvas stands on its ground contact; its box is centred on what is painted.
  const at01 = (b: CampBox) => ({ left: `${(b.anchor / W) * 100}%`, top: `${(b.ground / H) * 100}%` });
  const names: ReactNode[] = [];

  return (
    <div
      ref={host}
      className={`kad-static-camp${mode === "width" ? " kad-static-camp--fit-width" : ""}`}
      data-testid="static-camp"
      data-stage={layout.frame.stage}
      data-figure-scale={scale.toFixed(3)}
      style={rootHeight !== undefined ? { height: rootHeight } : undefined}
    >
      <div className="kad-static-camp__frame" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
        {strip("top", bleed.top)}
        {strip("bottom", bleed.bottom)}
        <img
          className="kad-static-camp__backdrop"
          src={backdrop}
          alt=""
          onError={() => setFailedBackdrop(paintedBackdrop)}
        />
        {accent && (
          <img className="kad-static-camp__accent" src={accent.url} alt="" style={{
            left: `${100 * accent.x / W}%`,
            top: `${100 * accent.y / H}%`,
            width: `${100 * accent.width / W}%`,
            transform: `rotate(${accent.angle}deg)`,
            transformOrigin: `${100 * accent.pivotX / accent.width}% ${100 * accent.pivotY / accent.height}%`,
          }} />
        )}
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
            {figure.id === "friend:mosshorn" && <span className="kad-static-camp__leaf"><img src={leafArt} alt="" /></span>}
            <span className="kad-static-camp__name">{state.party.find(member => member.character.id === figure.id)?.character.name}</span>
          </span>
        ))}
        {layout.frame.pieces.map(piece => {
          const lane = layout.lanes.get(piece.lane);
          const b = boxOf.get(piece.id);
          if (!lane || !b) return null;
          const owner = campPieceOwner(layout, piece, heroes.map(hero => hero.figure));
          // Her stored style first; the id's hash only when none is stored (#633, #620).
          const kitStyle = owner && piece.id.startsWith("bedroll") ? campKitStyle(owner.id, owner.kitStyle) : null;
          const size = canvasOf(b, piecePainting(piece, owner).path, kitStyle ? CAMP_KIT_STYLES[kitStyle].paintHeight : PAINT);
          const accent = owner?.accent ?? "#c9b99a";
          // Her tent, as the moving camp and the boxes pick it (camp-boxes.ts `piecePainting`).
          const tent = piece.id.startsWith("tent_") ? tentArt(owner?.tent ?? null, owner ? campKitStyle(owner.id, owner.kitStyle) : "rolled") : undefined;
          const tentSrc = tent ? `/assets/${tent.path}` : null;
          if (piece.id.startsWith("tent_")) labels.push(label(b, tentSrc));
          return <span key={piece.id} className="kad-static-camp__piece" data-piece={piece.id} data-owner={owner?.id} data-aspect={(b.width / b.height).toFixed(4)} style={{
            ...at01(b), height: `${size * 100}%`, zIndex: Math.round(lane.y * 1000) - 1,
          }} data-mirrored={piece.id.startsWith("bedroll") && piece.x > .5 ? "true" : undefined}>
            {owner && kitStyle ? <CampBedroll style={kitStyle} accent={accent} />
              : piece.id === "campfire" ? <Campfire active={false} />
              : tent && tentSrc ? <CampClothArt path={tentSrc} tent={tent.id} cloth={owner?.accent ? campTentCloth(tent.id) : undefined} accent={accent} onMissing={owed} fallback={
                <TentStandIn accent={accent} owned={owner !== undefined} width={b.width / b.height} decorations={(owner?.slots ?? []).filter((s) => s !== null).length} />
              } />
              : piece.id.startsWith("souvenirs_") ? (
                <ArtOr src={`/assets/${piece.path}`}><SouvenirStandIn accent={accent} count={owner?.souvenirs ?? 0} /></ArtOr>
              )
              : <ArtOr src={`/assets/${piece.path}`}><PieceStandIn width={b.width / b.height} /></ArtOr>}
          </span>;
        })}
        {dressing.spots.map((spot) => {
          const lane = layout.lanes.get(spot.lane);
          if (!lane) return null;
          const b = boxOf.get(`spot:${spot.id}`);
          const ring = spot.highlighted || activeSpot === spot.id;
          if (!b && !ring && !(onSpot && spot.pickable)) return null;
          const empty = { height: (lane.scale * scale * 120 * 0.26) / 160 / PAINT };
          const src = spot.path ? `/assets/${spot.path}` : null;
          if (b) labels.push(label(b, src));
          // The crew's name, under its banner pole's foot (camp-boxes.ts), clear of the flag.
          if (b?.name && mode === "cover") {
            names.push(
              <span
                key={`name:${b.id}`}
                className="kad-static-camp__banner"
                data-banner-name={spot.id}
                style={{ left: `${(b.name.x / W) * 100}%`, top: `${(b.name.y / H) * 100}%`, fontSize: (b.name.size / H) * box.height }}
              >
                {b.name.text.split("\n").map((line, i) => <span key={i}>{line}</span>)}
              </span>,
            );
          }
          return (
            <span
              key={spot.id}
              className={`kad-static-camp__piece kad-static-camp__spot${ring ? " is-lit" : ""}${spot.pieceId ? "" : " is-empty"}`}
              data-spot={spot.id}
              data-spot-piece={spot.pieceId ?? ""}
              style={{
                left: `${spot.x * 100}%`,
                top: `${lane.y * 100}%`,
                height: `${(b ? canvasOf(b, spot.pieceId ? spot.path : null) : empty.height) * 100}%`,
                zIndex: Math.round(lane.y * 1000) - 1,
              }}
            >
              {spot.pieceId && b ? (
                <ArtOr src={src} onMissing={owed}><PieceStandIn width={b.width / b.height} /></ArtOr>
              ) : null}
              {onSpot && spot.pickable && mode === "cover" ? (
                // The picture's own tap target; the named control in the panel is the accessible one.
                <button type="button" className="kad-static-camp__tap" tabIndex={-1} aria-hidden="true" onClick={() => onSpot(spot.id)} />
              ) : null}
            </span>
          );
        })}
        {dressing.beside.map((piece) => {
          const b = boxOf.get(`beside:${piece.pieceId}`);
          if (!b) return null;
          const src = piece.path ? `/assets/${piece.path}` : null;
          labels.push(label(b, src));
          return (
            <span
              key={piece.pieceId}
              className="kad-static-camp__piece kad-static-camp__beside"
              data-beside={piece.pieceId}
              style={{ ...at01(b), height: `${canvasOf(b, piece.path) * 100}%`, zIndex: Math.round((b.ground / H) * 1000) + 1 }}
            >
              <ArtOr src={src} onMissing={owed}><PieceStandIn width={b.width / b.height} /></ArtOr>
            </span>
          );
        })}
        {mode === "cover" ? labels : null}
        {names}
      </div>
      {chips.length > 0 && at ? (
        <div className="kad-static-camp__chips" style={{ top: bandPx }} aria-hidden="true">
          {chips.map((chip) => {
            const spot = dressing.spots.find((s) => s.id === chip.id)!;
            const ground = ((layout.lanes.get(spot.lane)?.y ?? 0) - bandTop) * H * at!.scale;
            const top = 4 + chip.row * CHIP_ROW;
            return (
              <span key={chip.id}>
                {chip.x !== null ? <span className="kad-static-camp__leader" style={{ left: chip.x, top: ground - bandPx, height: bandPx - ground + top }} /> : null}
                <button
                  type="button"
                  tabIndex={-1}
                  className={`kad-static-camp__chip${activeSpot === chip.id ? " is-active" : ""}`}
                  data-chip={chip.id}
                  style={{ left: chip.left, top, width: chip.width }}
                  onClick={() => onSpot!(chip.id)}
                >
                  {chip.label.split("\n").map((line) => <span key={line}>{line}</span>)}
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
