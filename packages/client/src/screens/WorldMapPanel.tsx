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
import type { WorldMap, WorldPlace } from "@kad/shared";
import { useChapter, useParty, useRunState, useWorld } from "../store";
import { Button } from "../ui/Button";
import { CharacterPortrait } from "./CharacterPortrait";
import { useEnsureChapter, useEnsureWorld } from "./content";
import { Icon } from "./icons";
import "./shared.css";
import "./WorldMapPanel.css";

/** How far in each tap of "closer" goes; the first step is the whole realm. */
export const ZOOM_STEPS = [1, 2, 3] as const;

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
  const [step, setStep] = useState(0);
  const viewport = useRef<HTMLDivElement | null>(null);
  const marker = useRef<HTMLDivElement | null>(null);

  const chapterId = state?.chapterId ?? null;
  const ready = world !== null && chapter !== null && chapter.id === chapterId;
  const place = ready ? placeOf(world, chapter.biome) : null;
  const zoom = ZOOM_STEPS[step] ?? 1;

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
    if (!view || !pin || typeof view.scrollTo !== "function") return;
    view.scrollTo({
      left: pin.offsetLeft - view.clientWidth / 2,
      top: pin.offsetTop - view.clientHeight / 2,
    });
  }, [zoom, place?.id]);

  // A new chapter is a new country: start from the whole realm again.
  useEffect(() => {
    setStep(0);
  }, [chapterId]);

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

  const canCloser = step < ZOOM_STEPS.length - 1;
  const canFurther = step > 0;

  return (
    <section className="atlas" aria-label="World map">
      <header className="atlas__head">
        <div className="atlas__words">
          <p className="atlas__realm kad-muted">
            <Icon name="map" />
            <span>{world.title}</span>
          </p>
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
            onClick={() => setStep((s) => Math.min(ZOOM_STEPS.length - 1, s + 1))}
          />
        </div>
      </header>

      <div className="atlas__viewport kad-scroll" ref={viewport} data-zoom={zoom}>
        {/*
         * The sheet is `zoom` panes wide and keeps the painting's aspect, so
         * the anchors — percentages of the sheet — stay on their places at
         * every size.
         */}
        <div
          className="atlas__sheet"
          style={{
            inlineSize: `${String(zoom * 100)}%`,
            aspectRatio: `${String(world.image.width)} / ${String(world.image.height)}`,
          }}
          data-testid="atlas-sheet"
        >
          <img
            className="atlas__painting"
            src={world.image.src}
            width={world.image.width}
            height={world.image.height}
            alt=""
            draggable={false}
          />
          {place ? (
            <div
              className="atlas__pin"
              ref={marker}
              style={{
                left: `${String(place.anchor.x / 10)}%`,
                top: `${String(place.anchor.y / 10)}%`,
              }}
              data-place={place.id}
              aria-current="location"
            >
              <span className="atlas__party" aria-hidden="true">
                {party.slice(0, 4).map((member) => (
                  <span className="atlas__face" key={member.playerId}>
                    <CharacterPortrait
                      species={member.character.species}
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
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
