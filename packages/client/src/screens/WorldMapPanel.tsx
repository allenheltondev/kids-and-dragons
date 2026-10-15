/**
 * WorldMapPanel — the realm, with the party standing on it (spec §2.2).
 *
 * The trail (ChapterMapPanel) answers "how far through tonight's story are
 * we?". This answers the other question a map gets asked — "where in the
 * world are we?" — with the realm painting itself and the party's faces on
 * the chapter's country. A chapter says where it is set (`biome`, which is a
 * biome or a settlement's slug), canon says where that is on the painting
 * (`content/world.json`, generated from the map anchors), and this draws the
 * two together.
 *
 * The painting is wider than a phone. It is shown fitted to the pane first,
 * because the shape of the realm is what makes "we are *here*" land, and two
 * buttons zoom it in steps; at every step the party stays centred, and the
 * pane scrolls natively in both directions for panning. No pinch handling of
 * our own — the browser's scroll is the gesture an eight-year-old already
 * knows, and it needs no code to go wrong.
 *
 * The usual two rules (layout/WorldView.tsx): nothing in here reads the room
 * mode, and nothing in here uses a viewport unit. Sizes are percentages of
 * the pane and `em` against `.kad-surface`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { FieldGuide, WorldMap, WorldPlace } from "@kad/shared";
import { useChapter, useParty, useRunState, useWorld, useGameStore } from "../store";
import { updateAtlasView, useAtlasNavigation } from "../store/atlas-navigation";
import { useFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { atlasLevel, regionalAnchor, visibleMapPlaces, visibleMapRoutes } from "./atlas-math";
import { FieldGuideDetail } from "./FieldGuideDetail";
import { markFieldGuideSeen } from "../store/field-guide-seen";
import { Button } from "../ui/Button";
import { CharacterPortrait } from "./CharacterPortrait";
import { loadFieldGuide, useEnsureChapter, useEnsureWorld } from "./content";
import { Icon } from "./icons";
import "./shared.css";
import "./WorldMapPanel.css";
import "./FieldGuide.css";

/** How far in each tap of "closer" goes; the first step is the whole realm. */
export const ZOOM_STEPS = [1, 2, 3] as const;
const ATLAS_ZOOM_STEPS = [1, 1.5, 2, 4] as const;

/**
 * The place a chapter is set in, or null when canon has not put it on the
 * map — which the panel says plainly rather than guessing a spot.
 */
export function placeOf(world: WorldMap, biome: string | undefined): WorldPlace | null {
  if (!biome) return null;
  return world.places[biome] ?? null;
}

/** "The Exchange, in The Sunward Fields" — a settlement names its country too. */
export function whereLine(world: WorldMap, place: WorldPlace): string {
  const parent = place.parent === null ? null : world.places[place.parent] ?? null;
  return parent ? `${place.title}, in ${parent.title}` : place.title;
}

export function WorldMapPanel(): ReactElement {
  useEnsureWorld();
  useEnsureChapter();
  const world = useWorld();
  const chapter = useChapter();
  const state = useRunState();
  const party = useParty();
  const runId = useGameStore((store) => store.session?.runId ?? "");
  const chapterId = state?.chapterId ?? null;
  const scope = JSON.stringify([runId, chapterId]);
  const { step, regionId, routeId, showRoutes, center } = useAtlasNavigation(scope);
  const setStep = (next: number | ((value: number) => number)) => updateAtlasView(scope, { step: typeof next === "function" ? next(step) : next, center: null });
  const setRegionId = (next: string | null) => updateAtlasView(scope, { regionId: next, center: null });
  const setRouteId = (next: string | null) => updateAtlasView(scope, { routeId: next, center: null });
  const setShowRoutes = (next: boolean) => updateAtlasView(scope, { showRoutes: next });
  const [entryId, setEntryId] = useState<string | null>(null);
  const [guide, setGuide] = useState<FieldGuide | null>(null);
  const [guideFailed, setGuideFailed] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const discoveries = useFieldGuideDiscoveries();
  const viewport = useRef<HTMLDivElement | null>(null);
  const marker = useRef<HTMLDivElement | null>(null);

  const ready = world !== null && chapter !== null && chapter.id === chapterId;
  const place = ready ? placeOf(world, chapter.biome) : null;
  const zoomSteps = world?.atlas ? ATLAS_ZOOM_STEPS : ZOOM_STEPS;
  const zoom = zoomSteps[step] ?? 1;
  const region = regionId ? world?.regions?.[regionId] : undefined;
  const regionPlace = regionId ? world?.places[regionId] : undefined;
  const crop = world?.atlas ? undefined : region;
  const partyAnchor = place ? (crop ? regionalAnchor(place.anchor, crop.bounds) : place.anchor) : null;
  const image = world?.atlas?.image ?? crop?.image ?? world?.image;
  const aspect = image ? image.width / image.height : 1;
  // Cover the pane at the first step: neighbors fill the screen, with no sheet gutters.
  const canvasWidth = Math.max(viewportSize.width, viewportSize.height * aspect) * zoom;
  const level = world?.atlas ? atlasLevel(world.atlas, canvasWidth * (globalThis.devicePixelRatio || 1)) : null;
  const tiles = level?.tiles ?? crop?.tiles;
  const tileImage = level?.image ?? crop?.image;
  const discovered = new Set(Object.keys(discoveries));
  const routes = world ? visibleMapRoutes(world.routes ?? [], world.places, discovered) : [];
  const atDetail = step === zoomSteps.length - 1;
  const selectedRoute = routes.find((route) => route.id === routeId);
  const selectEntry = (id: string | null) => {
    if (id) markFieldGuideSeen(id);
    setEntryId(id);
  };

  useEffect(() => {
    const view = viewport.current;
    if (!view || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(view);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    if (!entryId || !discoveries[entryId]) return;
    let live = true;
    setGuideFailed(false);
    loadFieldGuide().then((data) => { if (live) setGuide(data); }, () => { if (live) setGuideFailed(true); });
    return () => { live = false; };
  }, [entryId, discoveries]);

  /*
   * Keep the party in the middle of the pane: on open, and again every time
   * the zoom changes, because the painting grows around its top-left corner
   * and the party would otherwise slide off to the bottom right. Done by
   * hand against the viewport rather than `scrollIntoView`, which would also
   * scroll every ancestor and tug the whole pane.
   */
  useLayoutEffect(() => {
    const view = viewport.current;
    const pin = marker.current;
    // `scrollTo` is absent on elements in jsdom; the tests are not about panning.
    if (!view || typeof view.scrollTo !== "function") return;
    if (world?.atlas && canvasWidth <= 0) return;
    const focus = center ?? selectedRoute?.points[Math.floor(selectedRoute.points.length / 2)] ??
      (world?.atlas && regionPlace ? regionPlace.anchor : null);
    view.scrollTo({
      left: focus ? focus.x / 1000 * canvasWidth - view.clientWidth / 2 : pin ? pin.offsetLeft - view.clientWidth / 2 : 0,
      top: focus ? focus.y / 1000 * canvasWidth / aspect - view.clientHeight / 2 : pin ? pin.offsetTop - view.clientHeight / 2 : 0,
    });
  }, [zoom, place?.id, regionId, canvasWidth, routeId, scope]);

  // A new chapter is a new country: start from the whole realm again.
  useEffect(() => {
    setEntryId(null);
  }, [scope]);

  if (state === null || chapterId === null) {
    return (
      <section className="atlas atlas--empty" aria-label="World map">
        <p className="atlas__note kad-muted">
          <Icon name="map" />
          <span>The map fills in once the story begins.</span>
        </p>
      </section>
    );
  }

  if (!ready) {
    return (
      <section className="atlas atlas--empty" aria-label="World map" aria-busy="true">
        <p className="atlas__note kad-muted">
          <Icon name="map" />
          <span>Unrolling the map…</span>
        </p>
      </section>
    );
  }

  const canCloser = step < zoomSteps.length - 1;
  const canFurther = step > 0;

  return (
    <section className="atlas" aria-label="World map">
      <header className="atlas__head">
        <div className="atlas__words">
          <p className="atlas__where" role="status">
            {place
              ? `The party is in ${whereLine(world, place)}.`
              : "This chapter is somewhere the map does not show."}
          </p>
        </div>
        <div className="atlas__zoom" role="group" aria-label="Zoom">
          <Button
            variant="secondary"
            size="md"
            icon={<Icon name="minus" />}
            aria-label="Further away"
            disabled={!canFurther}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          />
          <Button
            variant="secondary"
            size="md"
            icon={<Icon name="plus" />}
            aria-label="Closer"
            disabled={!canCloser}
            onClick={() => setStep((s) => Math.min(zoomSteps.length - 1, s + 1))}
          />
        </div>
      </header>

      {world.regions && Object.keys(world.regions).length > 0 ? (
        <nav className="atlas__regions" aria-label="Map region">
          <Button size="md" variant="secondary" aria-pressed={!region}
            onClick={() => { setRegionId(null); setStep(0); setEntryId(null); setRouteId(null); }}>Whole realm</Button>
          {Object.keys(world.regions).map((id) => (
            <Button key={id} size="md" variant="secondary" aria-pressed={regionId === id}
              onClick={() => { setRegionId(id); setStep(world.atlas ? 1 : 0); setEntryId(null); setRouteId(null); }}>
              {world.places[id]?.title ?? id}
            </Button>
          ))}
        </nav>
      ) : null}
      {region ? <p className="atlas__region-note">{regionPlace?.title}: {region.description}</p> : null}
      {(world.routes?.length ?? 0) > 0 ? <div className="atlas__route-controls">
        <label><input type="checkbox" checked={showRoutes} onChange={(event) => setShowRoutes(event.target.checked)} /> Routes</label>
        {atDetail ? <span>Solid: mapped · Dashed: approximate</span> : <span>Routes appear at the closest zoom.</span>}
        {atDetail && showRoutes ? <details><summary>Roads and crossings ({routes.length})</summary>
          {routes.length === 0 ? <p>Discover places to learn their routes.</p> : routes.map((route) =>
            <button type="button" key={route.id} className="atlas__route-choice kad-focusable"
              aria-pressed={routeId === route.id} onClick={() => setRouteId(route.id)}>{route.title}</button>)}
        </details> : null}
        {atDetail && showRoutes && selectedRoute ? <p className="atlas__route-info">{selectedRoute.title} · {selectedRoute.travelModes.join(", ")} ·
          {selectedRoute.accuracy === "approximate" ? " Approximate course; conditions may vary." : " Mapped crossing."}</p> : null}
      </div> : null}

      {entryId && discoveries[entryId] ? (
        <aside className="atlas__entry" aria-label="Map discovery">
          {guide?.entries[entryId] ? <FieldGuideDetail guide={guide} entryId={entryId}
            onSelect={selectEntry} backLabel="Back to map" /> : <>
            <Button size="md" variant="secondary" onClick={() => setEntryId(null)}>Back to map</Button>
            <p>{guideFailed ? "The Field Guide could not load. Close this entry and try again." : guide ? "This discovery has no Field Guide entry yet." : "Opening your Field Guide…"}</p>
          </>}
        </aside>
      ) : null}

      <div className="atlas__viewport kad-scroll" ref={viewport} data-zoom={zoom}
        onScroll={(event) => {
          const view = event.currentTarget;
          const sheet = view.firstElementChild as HTMLElement | null;
          if (!sheet?.offsetWidth || !sheet.offsetHeight) return;
          updateAtlasView(scope, { center: {
            x: (view.scrollLeft + view.clientWidth / 2) / sheet.offsetWidth * 1000,
            y: (view.scrollTop + view.clientHeight / 2) / sheet.offsetHeight * 1000,
          } });
        }}>
        {/*
         * The sheet is `zoom` panes wide and keeps the painting's aspect, so
         * the anchors — percentages of the sheet — stay on their places at
         * every size.
         */}
        <div
          className="atlas__sheet"
          style={{
            inlineSize: world.atlas && canvasWidth > 0 ? `${canvasWidth}px` : `${String(zoom * 100)}%`,
            aspectRatio: `${String(image?.width)} / ${String(image?.height)}`,
          }}
          data-testid="atlas-sheet"
        >
          {world.atlas ? <img className="atlas__painting atlas__underlay" src={world.image.src} alt="" draggable={false} /> : null}
          {tiles && tileImage ? tiles.map((tile) => (
            <img key={tile.src} className="atlas__tile" src={tile.src} alt="" draggable={false}
              loading="lazy" width={tile.width} height={tile.height}
              style={{ left: `${tile.x / tileImage.width * 100}%`, top: `${tile.y / tileImage.height * 100}%`,
                width: `${tile.width / tileImage.width * 100}%`, height: `${tile.height / tileImage.height * 100}%` }} />
          )) : <img
            className="atlas__painting"
            src={world.image.src}
            width={world.image.width}
            height={world.image.height}
            alt=""
            draggable={false}
          />}
          {zoom >= 2 ? world.atlas?.patches?.map((patch) => (
            <div key={patch.id} className="atlas__detail-patch" data-patch={patch.id}
              style={{ left: `${patch.bounds.x / 10}%`, top: `${patch.bounds.y / 10}%`,
                width: `${patch.bounds.width / 10}%`, height: `${patch.bounds.height / 10}%` }}>
              {patch.tiles.map((tile) => <img key={tile.src} className="atlas__tile" alt="" src={tile.src}
                draggable={false} loading="lazy" width={tile.width} height={tile.height}
                style={{ left: `${tile.x / patch.image.width * 100}%`, top: `${tile.y / patch.image.height * 100}%`,
                  width: `${tile.width / patch.image.width * 100}%`, height: `${tile.height / patch.image.height * 100}%` }} />)}
            </div>
          )) : null}
          {atDetail && showRoutes ? <svg className="atlas__routes" aria-hidden="true"
            viewBox={crop ? `${crop.bounds.x} ${crop.bounds.y} ${crop.bounds.width} ${crop.bounds.height}` : "0 0 1000 1000"}
            preserveAspectRatio="none">
            {routes.map((route) => <g key={route.id} data-route={route.id} data-accuracy={route.accuracy}
              className={routeId === route.id ? "atlas__route--selected" : undefined}>
              <polyline className="atlas__route-halo" points={route.points.map((point) => `${point.x},${point.y}`).join(" ")} vectorEffect="non-scaling-stroke" />
              <polyline className="atlas__route-line" points={route.points.map((point) => `${point.x},${point.y}`).join(" ")} vectorEffect="non-scaling-stroke" />
            </g>)}
          </svg> : null}
          {visibleMapPlaces(world.places, new Set(Object.keys(discoveries))).map((known) => {
            const anchor = crop ? regionalAnchor(known.anchor, crop.bounds) : known.anchor;
            if (!anchor || known.id === place?.id) return null;
            const isDiscovered = Boolean(discoveries[known.id]);
            // Small-scale labels wait until zoomed in; region framing keeps them sparse.
            if (!region && step === 0 && known.kind === "location") return null;
            return isDiscovered ? (
              <button key={known.id} type="button" className="atlas__landmark kad-focusable"
                style={{ left: `${anchor.x / 10}%`, top: `${anchor.y / 10}%` }}
                onClick={() => selectEntry(known.id)} aria-label={`Read about ${known.title}`}>
                {known.title}
              </button>
            ) : <span key={known.id} className="atlas__landmark atlas__landmark--region"
              style={{ left: `${anchor.x / 10}%`, top: `${anchor.y / 10}%` }}>{known.title}</span>;
          })}
          {place && partyAnchor ? (
            <div
              className="atlas__pin"
              ref={marker}
              style={{
                left: `${String(partyAnchor.x / 10)}%`,
                top: `${String(partyAnchor.y / 10)}%`,
              }}
              data-place={place.id}
              aria-current="location"
            >
              <span className="atlas__party" aria-hidden="true">
                {party.slice(0, 4).map((member) => (
                  <span className="atlas__face" key={member.playerId}>
                    <CharacterPortrait
                      backdrop
                      species={member.character.species}
                      accent={member.character.appearance.accent}
                      characterClass={member.character.class}
                      tier={member.character.tier}
                      lit={false}
                      className="atlas__face-art"
                    />
                  </span>
                ))}
              </span>
              <span className="atlas__label">
                <span className="atlas__place">{place.title}</span>
                <span className="atlas__here">You are here</span>
                {discoveries[place.id] ? <button type="button" className="atlas__read kad-focusable"
                  onClick={() => selectEntry(place.id)} aria-label={`Read about ${place.title}`}>Field Guide</button> : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
