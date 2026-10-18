/**
 * The catch-up (#258, spec §8.4): one line for a kid whose phone comes back
 * mid-chapter, or who sits down partway through, saying what the party is
 * doing and where their hero is. "Got it" puts it away; so does the story
 * moving on.
 *
 * When it shows, read off this phone's own view of the run (nothing on the
 * server marks "came back", and nothing needs to):
 *
 * - **Seated mid-chapter for the first time this page has seen.** A page
 *   that opens on a chapter in progress with this player already in the party
 *   is a phone coming back (a refresh, a dead battery, a new tab): "Welcome
 *   back". One whose player only appears later, from the creation flow or a
 *   saved hero, is a late joiner: "Welcome".
 * - **The channel dropped and came back, and the story moved while it was
 *   down.** The scene, the fight's turn or the open question differ from
 *   before the gap (`situationKey`). A blip that missed nothing says nothing.
 *
 * Starting a chapter from the lobby is neither: this page saw the party
 * before the story began.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useConnection, useMe, useRunState } from "../store";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { catchUpLine, midChapter, sceneKey, situationKey } from "./presence-copy";
import "./CatchUp.css";

/** How long after the channel reopens a changed story still counts as missed. */
const GAP_SETTLE_MS = 4000;

export function CatchUp(): ReactElement | null {
  const state = useRunState();
  const me = useMe();
  const connection = useConnection();
  // `scene` is where it was said, so walking on to the next scene puts it away.
  const [shown, setShown] = useState<{ returning: boolean; scene: string } | null>(null);

  // Whether this page's first look at the run already had this player in it.
  const firstHadMe = useRef<boolean | null>(null);
  // Whether this player's first appearance has been answered.
  const greeted = useRef(false);
  // Where the story stood when the channel went down; null while it is up.
  const gap = useRef<{ key: string; reopenedAt: number | null } | null>(null);

  useEffect(() => {
    if (!state) return;
    if (firstHadMe.current === null) firstHadMe.current = me !== null;
    if (me === null) return;
    const key = situationKey(state);
    const scene = sceneKey(state);
    if (!greeted.current) {
      greeted.current = true;
      if (midChapter(state)) setShown({ returning: firstHadMe.current, scene });
      return;
    }
    const missed = gap.current;
    if (missed && missed.reopenedAt !== null) {
      if (Date.now() - missed.reopenedAt > GAP_SETTLE_MS) {
        gap.current = null;
      } else if (missed.key !== key) {
        gap.current = null;
        if (midChapter(state)) setShown({ returning: true, scene });
        return;
      }
    }
    // The story moving on puts an old catch-up away: it is about then, not now.
    setShown((current) => (current && current.scene !== scene ? null : current));
  }, [state, me]);

  useEffect(() => {
    if (connection === "reconnecting" || connection === "error") {
      if (gap.current === null && state && me) gap.current = { key: situationKey(state), reopenedAt: null };
    } else if (connection === "open" && gap.current && gap.current.reopenedAt === null) {
      gap.current = { ...gap.current, reopenedAt: Date.now() };
    }
    // `state` and `me` are read at the moment the connection changes, on purpose.
  }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown || !state || !me) return null;
  return (
    <div className="catch-up" role="status" data-testid="catch-up">
      <Icon name="players" />
      <p className="catch-up__line">{catchUpLine(state, me, shown.returning)}</p>
      <Button variant="ghost" size="md" icon={<Icon name="check" />} onClick={() => setShown(null)}>
        Got it
      </Button>
    </div>
  );
}
