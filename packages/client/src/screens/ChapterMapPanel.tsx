/**
 * ChapterMapPanel — where the party is (spec §2.2, "the map").
 *
 * The world pane shows *this* scene: the art, the words, the faces. It does not
 * show where this scene sits in the evening — how far the party has come, how
 * many roads it passed, whether the end is near. On a TV that is answered by
 * the room ("we've done the stream, the shrine is next"); on a phone in the
 * back of a car it is the question an eight-year-old asks every three minutes,
 * and until now nothing on the phone could answer it.
 *
 * This is the answer: the chapter drawn as a trail, top to bottom, with the
 * scenes the party has played marked and named, the party's portraits standing
 * on the one it is in, and everything it has not reached yet drawn as fog —
 * dots without names. The shape of the road ahead is visible (there *is* more,
 * and it forks) but nothing about it is spoiled, which is the same deal a
 * paper map in a fantasy novel offers.
 *
 * Layout is `chapterMap()` from `@kad/shared`, the same longest-path layering
 * the authoring viewer draws (`npm run content:graph`). Reusing it means the
 * picture a player sees and the picture an author checks agree about the shape
 * of the chapter, and it means the hard part — turning a graph with loops into
 * rows that read downward — is already tested without a browser.
 *
 * The usual two rules hold (layout/WorldView.tsx): nothing in here reads the
 * room mode, and nothing in here uses a viewport unit. The roads are an SVG
 * scaled to the pane's width; the stops are HTML placed in percentages over
 * it, so the labels are real text in `em` rather than glyphs in a drawing.
 */

import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { chapterMap } from "@kad/shared";
import type { Chapter, MapEdge, MapNode, RunState, SceneId } from "@kad/shared";
import { useChapter, useParty, useRunState } from "../store";
import { CharacterPortrait } from "./CharacterPortrait";
import { useEnsureChapter } from "./content";
import { Icon } from "./icons";
import "./shared.css";
import "./ChapterMapPanel.css";

// --- The trail, as data ------------------------------------------------------

/** A scene on the map, with what this party knows about it. */
export interface TrailStop extends MapNode {
  /** The party is standing here right now. */
  here: boolean;
  /** The party has been here this run (including `here`). */
  seen: boolean;
  /** What the stop is called on the map — only meaningful once `seen`. */
  label: string;
  /** Position in the drawing, as a fraction of the picture's width/height. */
  x: number;
  y: number;
}

export interface TrailRoad extends MapEdge {
  /** Both ends seen: the party walked this. */
  walked: boolean;
  /** From a seen scene into one not yet reached: a road leading into the fog. */
  ahead: boolean;
}

export interface Trail {
  stops: TrailStop[];
  roads: TrailRoad[];
  /** Aspect ratio of the picture — width over height — so the host can size it. */
  aspect: number;
  /** How many stops the widest row holds; a stop's label may be this wide. */
  columns: number;
  /** Reachable scenes the party has seen, and how many there are to see. */
  seenCount: number;
  totalCount: number;
}

/**
 * The ids are authored for an author (`scene_singing_stream`, `check_wisps`,
 * `rest_mossbank`), and the map is read by a child. Strip the type prefix the
 * authoring convention puts in front, and make words of the rest. A scene with
 * nothing left after the prefix (`end`, `ending`) is named for what it is.
 */
const ID_PREFIX = /^(scene|check|choice_point|choice|encounter|fight|rest|ending|end|walk)(?=_|$)/;

const TYPE_WORD: Record<string, string> = {
  story: "A place",
  check: "A test",
  choice_point: "A crossroads",
  rest: "A rest",
  encounter: "A fight",
};

export function sceneLabel(id: SceneId, type: string): string {
  const rest = id.replace(ID_PREFIX, "").replace(/^[_-]+/, "");
  const words = rest
    .split(/[_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  if (words.length === 0) return TYPE_WORD[type] ?? "A place";
  return words.join(" ");
}

/** The icon for a kind of stop, drawn beside its name once it has been seen. */
export function stopIcon(type: string): string {
  switch (type) {
    case "check":
      return "dice";
    case "choice_point":
      return "vote";
    case "rest":
      return "rest";
    case "encounter":
      return "swords";
    default:
      return "scroll";
  }
}

/* Drawing constants, in abstract units: a cell per column, a row per depth. */
const CELL_W = 1;
/* Rows a little tighter than columns: a name hangs under its stop, nothing
   hangs beside it, and a 24-scene chapter should not be three screens tall. */
const ROW_H = 0.8;
/** Never narrower than this many cells, so a one-column chapter is not a stripe. */
const MIN_COLUMNS = 3;

/**
 * Lay the chapter out as a trail for this run.
 *
 * `visited` is optional on the run and readers coalesce (types/state.ts): a run
 * in flight across a deploy has no trail yet, and that gives a map with one
 * named stop — the current one — rather than a crash.
 */
export function mapTrail(chapter: Chapter, state: Pick<RunState, "sceneId" | "visited">): Trail {
  const map = chapterMap(chapter);
  const seen = new Set<SceneId>(state.visited ?? []);
  if (state.sceneId !== null) seen.add(state.sceneId);

  // Only the reachable story is drawn. Orphans are an author's problem
  // (`content:validate` reports them), and a dot for a scene nobody can reach
  // would be a lie about the road.
  const nodes = map.nodes.filter((node) => node.reachable);
  const rows = new Map<number, MapNode[]>();
  for (const node of nodes) {
    const bucket = rows.get(node.row) ?? [];
    bucket.push(node);
    rows.set(node.row, bucket);
  }
  const columns = Math.max(MIN_COLUMNS, ...[...rows.values()].map((row) => row.length));
  const rowCount = Math.max(1, map.depth);
  const width = columns * CELL_W;
  const height = rowCount * ROW_H;

  const stops: TrailStop[] = nodes.map((node) => {
    const row = rows.get(node.row) ?? [node];
    // Centre each row rather than left-align it, so a lone scene between two
    // forks sits on the spine instead of hugging the edge.
    const offset = (node.column - (row.length - 1) / 2) * CELL_W;
    return {
      ...node,
      here: node.id === state.sceneId,
      seen: seen.has(node.id),
      label: sceneLabel(node.id, node.type),
      x: (width / 2 + offset) / width,
      y: ((node.row + 0.5) * ROW_H) / height,
    };
  });

  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const roads: TrailRoad[] = map.edges
    .filter((edge) => byId.has(edge.from) && byId.has(edge.to))
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      const fromSeen = from?.seen ?? false;
      const toSeen = to?.seen ?? false;
      return { ...edge, walked: fromSeen && toSeen, ahead: fromSeen && !toSeen };
    });

  return {
    stops,
    roads,
    aspect: width / height,
    columns,
    seenCount: stops.filter((stop) => stop.seen).length,
    totalCount: stops.length,
  };
}

// --- The drawing ---------------------------------------------------------------

/**
 * The road between two stops as an SVG path, in the picture's unit square.
 * A gentle S-curve rather than a straight line: a straight line between two
 * centred rows is vertical and every fork overlaps on the spine. A loop (an
 * edge that points back up the page) bows out to the side so it is visibly a
 * way back rather than a second road down.
 */
function roadPath(from: TrailStop, to: TrailStop, backward: boolean): string {
  const x1 = from.x * 100;
  const y1 = from.y * 100;
  const x2 = to.x * 100;
  const y2 = to.y * 100;
  if (backward) {
    const bow = x1 <= 50 ? -14 : 14;
    return `M ${x1} ${y1} C ${x1 + bow} ${y1 + 8}, ${x2 + bow} ${y2 - 8}, ${x2} ${y2}`;
  }
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function ChapterMapPanel(): ReactElement {
  useEnsureChapter();
  const chapter = useChapter();
  const state = useRunState();
  const party = useParty();
  const sceneId = state?.sceneId ?? null;

  /*
   * Bring the party into view. A chapter is drawn top to bottom and a party
   * eight scenes in is below the fold of a phone, so a map that opened at the
   * top would answer "where are we?" with a scroll — which is the question
   * the map exists to save. Centred, so the road just walked and the road
   * ahead are both on screen.
   *
   * Done by hand against the trail rather than with `scrollIntoView`, which
   * also scrolls every ancestor that can scroll and tugs the whole pane (the
   * same reason as the atlas, WorldMapPanel). `scrollTo` is absent on elements
   * in jsdom, hence the guard; the tests are not about scrolling.
   */
  const trailRef = useRef<HTMLElement | null>(null);
  const hereRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const trail = trailRef.current;
    const here = hereRef.current;
    if (!trail || !here || typeof trail.scrollTo !== "function") return;
    const port = trail.getBoundingClientRect();
    const stop = here.getBoundingClientRect();
    trail.scrollTo({
      top: trail.scrollTop + (stop.top + stop.height / 2) - (port.top + port.height / 2),
    });
  }, [sceneId, chapter]);

  // Nothing to draw before the evening has a chapter: the lobby, or a room
  // that has not started. Say so, rather than show a blank pane that looks
  // like something failed to load.
  if (state === null || state.chapterId === null) {
    return (
      <section className="trail trail--empty" aria-label="Map">
        <p className="trail__note kad-muted">
          <Icon name="map" />
          <span>The map fills in once the story begins.</span>
        </p>
      </section>
    );
  }

  // The chapter is fetched by id (`useEnsureChapter`); a stale one from the
  // previous chapter must not be drawn under this run's scene ids.
  if (chapter === null || chapter.id !== state.chapterId) {
    return (
      <section className="trail trail--empty" aria-label="Map" aria-busy="true">
        <p className="trail__note kad-muted">
          <Icon name="map" />
          <span>Unrolling the map…</span>
        </p>
      </section>
    );
  }

  const trail = mapTrail(chapter, state);
  const here = trail.stops.find((stop) => stop.here) ?? null;
  const finished = state.phase === "chapter_complete";

  return (
    <section className="trail kad-scroll" aria-label="Map" ref={trailRef}>
      <header className="trail__head">
        <h2 className="trail__title">{chapter.title}</h2>
        <p className="trail__progress" role="status">
          {finished
            ? "The chapter is finished."
            : here
              ? `The party is at ${here.label}.`
              : "The party is on the road."}{" "}
          <span className="kad-muted">
            {String(trail.seenCount)} of {String(trail.totalCount)} places seen.
          </span>
        </p>
      </header>

      {/*
       * The picture. Width is the pane; height follows from the chapter's own
       * shape via `aspect-ratio`, and a long chapter scrolls. Stops are placed
       * in percentages so they stay on their roads at every size.
       */}
      <div
        className="trail__picture"
        style={{ aspectRatio: String(trail.aspect), "--trail-columns": String(trail.columns) } as React.CSSProperties}
        data-testid="trail-picture"
      >
        <svg
          className="trail__roads"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {trail.roads.map((road) => {
            const from = trail.stops.find((stop) => stop.id === road.from);
            const to = trail.stops.find((stop) => stop.id === road.to);
            if (!from || !to) return null;
            const tone = road.walked ? "walked" : road.ahead ? "ahead" : "fog";
            return (
              <path
                key={`${road.from}>${road.to}:${road.label}`}
                className={`trail__road trail__road--${tone}${road.backward ? " trail__road--back" : ""}`}
                d={roadPath(from, to, road.backward)}
                data-tone={tone}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <ol className="trail__stops" aria-label="Places">
          {trail.stops.map((stop) => (
            <li
              key={stop.id}
              ref={stop.here ? hereRef : undefined}
              className={[
                "trail__stop",
                stop.seen ? "trail__stop--seen" : "trail__stop--fog",
                stop.here ? "trail__stop--here" : "",
                stop.entry ? "trail__stop--start" : "",
                stop.terminal ? "trail__stop--end" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${String(stop.x * 100)}%`, top: `${String(stop.y * 100)}%` }}
              data-scene={stop.id}
              data-seen={stop.seen}
              aria-current={stop.here ? "location" : undefined}
              aria-hidden={stop.seen ? undefined : true}
            >
              {stop.here ? (
                /*
                 * The party, standing on the map. Avatars rather than a pin:
                 * "where is the party" is answered by *seeing the party*, and
                 * a child finds her own face faster than any marker.
                 */
                <span className="trail__party" aria-hidden="true">
                  {party.slice(0, 4).map((member) => (
                    <span className="trail__face" key={member.playerId}>
                      <CharacterPortrait
                        backdrop
                        species={member.character.species}
                        accent={member.character.appearance.accent}
                        characterClass={member.character.class}
                        tier={member.character.tier}
                        lit={false}
                        className="trail__face-art"
                      />
                    </span>
                  ))}
                </span>
              ) : (
                <span className="trail__dot" aria-hidden="true">
                  {stop.seen ? <Icon name={stopIcon(stop.type)} /> : null}
                </span>
              )}
              {stop.seen ? (
                <span className="trail__name">
                  {stop.label}
                  {stop.here ? <span className="trail__here">You are here</span> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      <p className="trail__legend kad-muted" aria-hidden="true">
        <span className="trail__legend-item">
          <span className="trail__dot trail__dot--legend" />
          <span>Been there</span>
        </span>
        <span className="trail__legend-item">
          <span className="trail__dot trail__dot--legend trail__dot--fog" />
          <span>Not yet</span>
        </span>
      </p>
    </section>
  );
}
