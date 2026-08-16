/**
 * PlaytestPanel — the author's cheat drawer (roadmap chapter 6).
 *
 * Two controls, both of which exist so that reaching a branch is not the same
 * as playing to it: jump to any scene in the chapter, and load the next d20.
 * The engine owns both (playtest.ts); this is the surface.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT IS AND IS NOT
 *
 * It renders **only under `import.meta.env.DEV`**, and the gate is at the call
 * site in `PlayerView` rather than inside this component. Vite replaces that
 * expression with a literal `false` in the production build, so the branch is
 * dead there and the component falls out of the bundle with it — where an
 * `if (!DEV) return null` inside this file would ship the whole drawer and
 * leave a boolean as the only thing between it and a player. Verified rather
 * than assumed: `npm run build` puts no `PLAYTEST_GOTO` anywhere in `dist`.
 * (The stylesheet beside this file does ride along — Vite cannot tree-shake a
 * CSS import — so the production bundle carries a few `.playtest__` rules that
 * style nothing. Dead selectors, not a dead switch.)
 *
 * That is the third of the three locks in playtest.ts, and the weakest of them
 * on purpose: it is a *convenience* — the real refusal is the server's, and it
 * is a server refusal precisely because a client-side lock is one a client can
 * lie about.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES ON THE PHONE
 *
 * It is a floating drawer over PlayerView rather than a separate `/playtest`
 * route, because playtesting is done with the thing running: the author has
 * three browser tabs open, the chapter is in progress, and warping to a scene
 * has to leave the party, the flags and the hit points exactly where they were.
 * A route would mean leaving the run to reach the controls for it.
 *
 * It obeys PlayerView's rules despite being a dev tool — no `vh`, no shrinking
 * touch targets — because a dev tool that breaks the layout it sits in makes
 * the layout harder to judge, which is the thing the author is here to do.
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { DIE_MAX, DIE_MIN } from "@kad/shared";
import type { Chapter, SceneId } from "@kad/shared";
import { useChapter, useRunState, useSend } from "../store";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import "./shared.css";
import "./PlaytestPanel.css";

/** The icon each scene type gets in the list, so the shape of the chapter reads. */
const SCENE_ICON: Record<string, string> = {
  story: "scroll",
  check: "dice",
  encounter: "swords",
  rest: "rest",
  choice_point: "map",
  ending: "trophy",
};

/**
 * Every scene, entry first and the rest in authored order.
 *
 * Authored order rather than alphabetical or graph order. A chapter file is
 * written roughly in the order it is played, so the author's own ordering is
 * the one they can find things in — and a topological sort would reorder the
 * list every time a branch changed, which is the opposite of what a list you
 * scan by muscle memory needs.
 *
 * Exported so the ordering is testable without a DOM.
 */
export function sceneList(chapter: Chapter): { id: SceneId; type: string }[] {
  const ids = Object.keys(chapter.scenes);
  const ordered = [chapter.entry, ...ids.filter((id) => id !== chapter.entry)];
  return ordered
    .filter((id) => chapter.scenes[id] !== undefined)
    .map((id) => ({ id, type: chapter.scenes[id]?.type ?? "story" }));
}

export function PlaytestPanel(): ReactElement | null {
  const chapter = useChapter();
  const run = useRunState();
  const send = useSend();
  const [open, setOpen] = useState(false);

  // Nothing to jump to before a chapter is loaded, and no roll to load a die
  // for either. The toggle would be a button that opens an empty box.
  if (!chapter || !run) return null;

  const loaded = run.playtestDie ?? null;
  const scenes = sceneList(chapter);

  if (!open) {
    return (
      <div className="playtest playtest--shut">
        <Button
          variant="ghost"
          size="md"
          icon={<Icon name="shuffle" />}
          onClick={() => setOpen(true)}
        >
          {/* The loaded die shows on the closed toggle. An author who forgot
              they pinned a 1 would otherwise spend a while wondering why the
              party cannot pass a check. */}
          Playtest{loaded === null ? "" : ` · d20 = ${String(loaded)}`}
        </Button>
      </div>
    );
  }

  return (
    <section className="playtest playtest--open kad-scroll" aria-label="Playtest tools">
      <header className="playtest__head">
        <h3 className="playtest__title">
          <Icon name="shuffle" />
          <span>Playtest</span>
        </h3>
        <Button variant="ghost" size="md" icon={<Icon name="close" />} onClick={() => setOpen(false)}>
          Close
        </Button>
      </header>
      <p className="playtest__note kad-muted">
        Local only. A deployed server refuses both of these.
      </p>

      <div className="playtest__block">
        <h4 className="playtest__heading">The next roll</h4>
        <div className="playtest__dice">
          {Array.from({ length: DIE_MAX - DIE_MIN + 1 }, (_, i) => i + DIE_MIN).map((die) => (
            <Button
              key={die}
              variant={loaded === die ? "primary" : "secondary"}
              size="md"
              selected={loaded === die}
              className="playtest__die"
              onClick={() => void send({ type: "PLAYTEST_SET_DIE", die })}
            >
              {String(die)}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="md"
          block
          icon={<Icon name="dice" />}
          disabled={loaded === null}
          onClick={() => void send({ type: "PLAYTEST_SET_DIE", die: null })}
        >
          {loaded === null ? "Rolling honestly" : `Stop forcing ${String(loaded)}`}
        </Button>
      </div>

      <div className="playtest__block">
        <h4 className="playtest__heading">Jump to a scene</h4>
        <ul className="playtest__scenes">
          {scenes.map(({ id, type }) => (
            <li key={id}>
              <Button
                variant={run.sceneId === id ? "primary" : "secondary"}
                size="md"
                block
                selected={run.sceneId === id}
                icon={<Icon name={SCENE_ICON[type] ?? "scroll"} />}
                onClick={() => void send({ type: "PLAYTEST_GOTO", sceneId: id })}
              >
                <span className="playtest__scene-id">{id}</span>
                <span className="playtest__scene-type kad-muted">{type}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
