/**
 * The lobby's camp on the shared stage (docs/camp.md §3, §8.5, §8.7, #614):
 * when it is up, what it is told, and how it goes.
 *
 * PixiStage owns one of these beside the story scene and hands it every state
 * the store mirrors. It mounts the camp (world/camp.ts) over the scene while
 * the phase is the lobby's (lobby-camp.ts `campShownIn`), tells it who is
 * seated and what just happened to them (lobby-camp.ts `campCues`), and takes
 * it down when the lobby goes.
 *
 * Nothing waits on it (§12.6). On Begin the camp is told `setOff` and starts
 * to fade in the same call, and the scene under it is uncovered in that call
 * too, so the chapter's first scene is already there, fading in through the
 * camp as the crew walks off down the trail. The camp is destroyed when its
 * fade is over, or at once if the lobby comes back first; nothing about the
 * story is held for either.
 *
 * Pixi only through world/camp.ts and the ticker, so it runs against the fake
 * stage (testing/fake-stage.ts) in lobby-camp-stage.test.ts.
 */

import type { Application, Texture } from "pixi.js";
import type { RunState } from "@kad/shared";
import { createCamp, type CampStage } from "./camp";
import type { CampLayout } from "./camp-layout";
import { frameSeconds } from "./camp-motion";
import { LOBBY_CAMP_STAND_IN, begun, campCues, campDressing, campFriends, campHeroes, campLayoutFor, campSeed, campShownFor, campStage, type CampHero } from "./lobby-camp";
import { campBeatShown, onCampBeat } from "./camp-beat";

export { lobbyCampLayout } from "./lobby-camp";

/** How long the camp takes to fade off the scene after Begin. The story is up throughout. */
export const LEAVE_FADE_S = 2;

export interface LobbyCampOptions {
  /** Told whether the camp wholly covers it (scene.ts `setCovered`). */
  cover?: (covered: boolean) => void;
  /** Reduced motion at mount (a11y/prefs.ts); `setStill` follows changes. */
  still?: boolean;
  assetUrl?: (path: string) => string;
  loadTexture?: (url: string) => Promise<Texture>;
  /** The layout for a frame stage (lobby-camp.ts `campLayoutFor`); absent: always `layout`. */
  layoutFor?: (stage: number, biome?: string | null) => CampLayout | null;
}

export interface LobbyCamp {
  /** The run state, every time it changes, and whenever the chapter end's camp beat turns. */
  sync(state: RunState | null, biome?: string | null): void;
  resize(width: number, height: number): void;
  /** The lobby panels' covered height and the header's reach (stage-inset.ts `onLobbyInset`). */
  setInset(bottomPx: number, topPx?: number): void;
  setStill(still: boolean): void;
  /** The camp the lobby is showing, or null outside the lobby. */
  camp(): CampStage | null;
  /** A camp still fading off after Begin, or null. */
  leaving(): CampStage | null;
  destroy(): void;
}

export function createLobbyCamp(app: Application, layout: CampLayout, options: LobbyCampOptions = {}): LobbyCamp {
  const assetUrl = options.assetUrl ?? ((path: string) => `/assets/${path}`);
  let still = options.still ?? false;
  let size = { width: 0, height: 0 };
  let inset = 0;
  let insetTop = 0;
  let shown: CampStage | null = null;
  let fading: CampStage | null = null;
  let heroes: CampHero[] | null = null;
  let phase: string | null = null;
  let destroyed = false;
  let mounted: CampLayout = layout;
  let last: RunState | null = null;
  let lastBiome: string | null = null;
  /** The chapter end whose stage-up has been pitched, so it plays once. */
  let pitched: string | null = null;
  // A beat turning is read a moment later, on the state as it then stands: the
  // summary turns it off as the table goes back to the lobby, and the lobby's
  // own sync, in the same commit, keeps the camp up rather than refolding it.
  const offBeat = onCampBeat(() => {
    queueMicrotask(() => {
      if (!destroyed) sync(last, lastBiome);
    });
  });

  function dropFading(): void {
    fading?.destroy();
    fading = null;
  }

  function mount(state: RunState, at: CampLayout): CampStage {
    // A lobby back before the last one finished fading: that one is gone at once.
    dropFading();
    mounted = at;
    const camp = createCamp(app, at, {
      seed: campSeed(state),
      still,
      assetUrl,
      fallbackBackdrop: assetUrl(LOBBY_CAMP_STAND_IN),
      ...(options.loadTexture ? { loadTexture: options.loadTexture } : {}),
    });
    if (size.width > 0) camp.resize(size.width, size.height);
    camp.setInset(inset, insetTop);
    options.cover?.(true);
    return camp;
  }

  function leave(nextPhase: string | null): void {
    const camp = shown;
    if (!camp) return;
    shown = null;
    heroes = null;
    // Uncovered first: the story is drawn from this frame on, under the camp.
    options.cover?.(false);
    if (begun(phase, nextPhase)) camp.moment("setOff");
    dropFading();
    fading = camp;
  }

  function sync(state: RunState | null, biome: string | null = null): void {
    if (destroyed) return;
    const next = state?.phase ?? null;
    // No state yet is no lobby yet: a phone reloading mid-chapter must not flash a camp.
    last = state;
    lastBiome = biome;
    if (state && campShownFor(state, campBeatShown())) {
      const now = campHeroes(state);
      // The crew's frame stage, from its record: a camp that grew is pitched anew.
      const want = options.layoutFor?.(campStage(state), state.phase === "chapter_complete" ? biome : null) ?? layout;
      if (shown && want !== mounted) {
        shown.destroy();
        shown = null;
        heroes = null;
      }
      const first = shown === null;
      if (first) shown = mount(state, want);
      else shown!.setSeed(campSeed(state));
      const camp = shown!;
      camp.setFigures([...now.map((hero) => hero.figure), ...campFriends(state)]);
      camp.setDressing(campDressing(state, mounted));
      // The frame grew at this chapter's end (§4.1): the heroes pitch it, once.
      const grew = state.phase === "chapter_complete" && state.camp?.grew === true ? state.campMoment?.id ?? "grew" : null;
      if (grew !== null && grew !== pitched) {
        pitched = grew;
        camp.pitch();
      }
      for (const cue of campCues(first ? null : heroes, now)) {
        if (cue.kind === "setOff") camp.moment("setOff");
        else camp.moment(cue.kind, cue.id);
      }
      heroes = now;
    } else {
      leave(next);
    }
    phase = next;
  }

  function tick(): void {
    if (!fading) return;
    const view = fading.view;
    view.alpha = Math.max(0, view.alpha - frameSeconds(app.ticker.deltaMS) / LEAVE_FADE_S);
    if (view.alpha <= 0) dropFading();
  }
  app.ticker.add(tick);

  return {
    sync,
    resize(width, height) {
      size = { width, height };
      shown?.resize(width, height);
      fading?.resize(width, height);
    },
    setInset(bottomPx, topPx = 0) {
      // A 0 is the lobby's panels unmounting, which on Begin lands a moment
      // before the phase does: the camp keeps its frame to walk off in, rather
      // than sliding to the whole pane as it goes.
      if (bottomPx <= 0) return;
      inset = bottomPx;
      insetTop = topPx;
      shown?.setInset(bottomPx, topPx);
    },
    setStill(next) {
      still = next;
      shown?.setStill(next);
      fading?.setStill(next);
    },
    camp: () => shown,
    leaving: () => fading,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offBeat();
      app.ticker.remove(tick);
      shown?.destroy();
      shown = null;
      dropFading();
    },
  };
}
