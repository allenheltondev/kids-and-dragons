/**
 * Watching (#388): what a phone shows when every seat is taken and none is
 * theirs, or when its kid chose "Just watch" (`JustWatch`, below). A full
 * table used to be one line, "This table is full", and nothing to do. Now it
 * says why they are watching, then gives them the game to follow and a row of
 * cheers to send to the shared screen. A kid who chose to watch can go back
 * to making a hero whenever a seat is open.
 *
 * Nothing here is a game control. A spectator is never in the party, so no
 * vote, roll or turn waits on them, and nothing on this screen can make one.
 * The World tab is the story itself, as the TV shows it; this pane is the
 * goal, a line on what the party is doing, and the cheers.
 *
 * The cheer buttons rest for `CHEER_COOLDOWN_MS` after each tap, so a kid
 * mashing them almost never meets the server's own limit (handlers/cheer.ts).
 *
 * The usual rules (layout/PlayerView.tsx): nothing here reads the room mode,
 * and nothing uses a viewport unit.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  CHEER_COOLDOWN_MS,
  CHEERS,
  CHOSE_TO_WATCH_MESSAGE,
  choseToWatch,
  SPECTATOR_MESSAGE,
  TABLE_FULL_MESSAGE,
  tableFull,
} from "@kad/shared";
import { cue } from "../audio/cue";
import { useGameStore, useRunState, useSession } from "../store";
import { Button } from "../ui/Button";
import { ChapterGoalCard } from "./ChapterGoal";
import { Icon } from "./icons";
import { watchingLine } from "./presence-copy";
import "./Spectating.css";

export function Spectating({ hidden = false }: { hidden?: boolean }): ReactElement {
  const state = useRunState();
  const playerId = useSession()?.playerId;
  const cheer = useGameStore((store) => store.cheer);
  const spectate = useGameStore((store) => store.spectate);
  const [going, setGoing] = useState(false);
  // The cheer just sent, lit while the buttons rest.
  const [sent, setSent] = useState<string | null>(null);
  const rest = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (rest.current !== null) clearTimeout(rest.current);
  }, []);

  const send = (id: string): void => {
    if (sent !== null) return;
    cue("tap");
    setSent(id);
    void cheer(id);
    rest.current = setTimeout(() => {
      rest.current = null;
      setSent(null);
    }, CHEER_COOLDOWN_MS);
  };

  const doing = state ? watchingLine(state) : null;
  // Why they are watching: the full table says so; a kid who chose it is told
  // they chose it, and while a seat is open they can take it.
  const full = state !== null && tableFull(state, playerId);
  const chose = state !== null && choseToWatch(state, playerId);
  const play = (): void => {
    setGoing(true);
    void spectate(false).finally(() => setGoing(false));
  };
  return (
    <section className="spectating kad-scroll" data-testid="table-full" aria-label="Watching" hidden={hidden}>
      <div className="spectating__head" role="status">
        <Icon name="eye" size="var(--kad-icon-md)" />
        <p className="spectating__full">{full ? TABLE_FULL_MESSAGE : CHOSE_TO_WATCH_MESSAGE}</p>
        <p className="spectating__watch">{SPECTATOR_MESSAGE}</p>
        {chose && !full ? (
          <Button variant="secondary" icon={<Icon name="plus" />} disabled={going} onClick={play}>
            Make my hero
          </Button>
        ) : null}
      </div>

      <ChapterGoalCard place="phone" />
      {doing ? <p className="spectating__doing" data-testid="spectating-doing">{doing}</p> : null}
      <p className="spectating__hint">
        <Icon name="globe" />
        <span>Tap World to watch the story.</span>
      </p>

      <div className="spectating__cheers" role="group" aria-label="Cheer">
        {CHEERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`spectating__cheer kad-tap kad-focusable${sent === option.id ? " spectating__cheer--sent" : ""}`}
            aria-label={option.label}
            disabled={sent !== null}
            onClick={() => send(option.id)}
          >
            <Icon name={option.icon} size="var(--kad-icon-lg)" />
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * "Just watch" (#388): a row above the creation flow for a kid who would
 * rather watch this time. One tap, on their own phone; the watch screen has
 * "Make my hero" to come back while a seat is open.
 */
export function JustWatch({ hidden = false }: { hidden?: boolean }): ReactElement {
  const spectate = useGameStore((store) => store.spectate);
  const [going, setGoing] = useState(false);
  const watch = (): void => {
    setGoing(true);
    void spectate(true).finally(() => setGoing(false));
  };
  return (
    <div className="just-watch" hidden={hidden} data-testid="just-watch">
      <p className="just-watch__line">Not playing this time?</p>
      <Button variant="ghost" icon={<Icon name="eye" />} disabled={going} onClick={watch}>
        Just watch
      </Button>
    </div>
  );
}
