/**
 * The room's cheers, on the shared screen (#388): a small eye and a number
 * while anybody is watching a full table, and each cheer they send rising
 * from the bottom of the screen to the top, at a spot across picked at
 * random, fading out gradually as it goes.
 *
 * Nothing here waits, blocks or asks for a tap: the layer lets every tap
 * through. It never says who is watching or who cheered, only how many are
 * watching, and that count stands at the left end of the story plate
 * (stage-inset.ts).
 *
 * Only on a surface that is the room's screen (WorldView's
 * `gatesPresentations`): a party phone keeps its world pane mounted behind
 * the controls, and the heroes' own phones never show cheers.
 *
 * The usual rules (layout/WorldView.tsx): nothing here reads the room mode,
 * and nothing uses a viewport unit.
 */

import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { cheerById, watchers } from "@kad/shared";
import { useCheers, useGameStore, useRunState } from "../store";
import type { HeardCheer } from "../store/contract";
import { onStageInset, stageInsetBottom } from "../world/stage-inset";
import { Icon } from "./icons";
import "./RoomCheers.css";

/** How long one cheer floats before it is let go. Matches RoomCheers.css. */
export const CHEER_FLOAT_MS = 5000;

/**
 * Where across the screen a cheer rises, as a percent of its width: anywhere
 * but the very edges, where half the picture would be off the screen.
 */
export function cheerX(random: () => number = Math.random): number {
  return 6 + random() * 88;
}

export function RoomCheers(): ReactElement | null {
  const state = useRunState();
  const cheers = useCheers();
  const [inset, setInset] = useState(stageInsetBottom);
  useEffect(() => onStageInset(setInset), []);

  const watching = state ? watchers(state).length : 0;
  if (watching === 0 && cheers.length === 0) return null;
  const style = { "--cheers-bottom": `${String(inset)}px` } as CSSProperties;
  return (
    <div className="room-cheers" style={style} data-testid="room-cheers">
      <div className="room-cheers__sky" aria-hidden="true">
        {cheers.map((heard) => (
          <Floating key={heard.key} heard={heard} />
        ))}
      </div>
      {watching > 0 ? (
        <p className="room-cheers__watching" data-testid="watching" aria-label={`Watching: ${String(watching)}`}>
          <Icon name="eye" />
          <span aria-hidden="true">{watching}</span>
        </p>
      ) : null}
    </div>
  );
}

function Floating({ heard }: { heard: HeardCheer }): ReactElement | null {
  const drop = useGameStore((store) => store.dropCheer);
  // Let go on a timer, not on `animationend`: reduced motion stills the
  // animation, and a cheer that never ended would never leave.
  useEffect(() => {
    const timer = setTimeout(() => drop(heard.key), CHEER_FLOAT_MS);
    return () => clearTimeout(timer);
  }, [drop, heard.key]);
  // Picked once, so a re-render never moves a cheer already on its way up.
  const [x] = useState(() => cheerX());
  const cheer = cheerById(heard.cheer);
  if (!cheer) return null;
  const style = { "--cheer-x": `${x.toFixed(1)}%` } as CSSProperties;
  return (
    <span className="room-cheers__cheer" style={style} data-testid="cheer">
      <Icon name={cheer.icon} />
    </span>
  );
}
