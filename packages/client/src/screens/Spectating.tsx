/**
 * Watching a full table (#388): what a phone shows when every seat is taken
 * and none is theirs. It used to be one line, "This table is full", and
 * nothing to do. Now it says so, then gives them the game to follow and a row
 * of cheers to send to the shared screen.
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
import { CHEER_COOLDOWN_MS, CHEERS, SPECTATOR_MESSAGE, TABLE_FULL_MESSAGE } from "@kad/shared";
import { cue } from "../audio/cue";
import { useGameStore, useRunState } from "../store";
import { ChapterGoalCard } from "./ChapterGoal";
import { Icon } from "./icons";
import { watchingLine } from "./presence-copy";
import "./Spectating.css";

export function Spectating({ hidden = false }: { hidden?: boolean }): ReactElement {
  const state = useRunState();
  const cheer = useGameStore((store) => store.cheer);
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
  return (
    <section className="spectating kad-scroll" data-testid="table-full" aria-label="Watching" hidden={hidden}>
      <div className="spectating__head" role="status">
        <Icon name="eye" size="var(--kad-icon-md)" />
        <p className="spectating__full">{TABLE_FULL_MESSAGE}</p>
        <p className="spectating__watch">{SPECTATOR_MESSAGE}</p>
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
