/**
 * The crew's full camp on the shared stage (docs/camp.md §3, §3.2, §8.5, §8.7,
 * #614, #620, #625): when it is up, what it is told, and how it goes.
 *
 * PixiStage owns one of these beside the story scene and hands it every state
 * the store mirrors, with the chapter it has loaded. It mounts the camp
 * (world/camp.ts) over the scene while the shared screen shows the full camp
 * (lobby-camp.ts `campShownFor`): the lobby, the chapter end's camp beat, and
 * an outdoor rest scene. It tells it who is seated and what just happened to
 * them (lobby-camp.ts `campCues`), and takes it down when the moment goes.
 * The backdrop is the chapter's terrain's (camp-backdrop.ts
 * `campBackdropFamily`), so a camp pitched in another terrain is pitched anew.
 *
 * An outdoor rest crossfades in: the camp comes up over the scene's own
 * picture, which stays drawn underneath until the camp wholly covers it. The
 * scene's narration is on its plate as at any scene, so the camp stands in
 * the window above the plate (the stage insets), not under the lobby's panels.
 *
 * Nothing waits on it (§12.6). On Begin the camp is told `setOff` and starts
 * to fade in the same call, and the scene under it is uncovered in that call
 * too, so the chapter's first scene is already there, fading in through the
 * camp as the crew walks off down the trail. Go on at a rest is the same fade
 * without the walk. The camp is destroyed when its fade is over, or at once
 * if the camp comes back first; nothing about the story is held for either.
 *
 * Pixi only through world/camp.ts and the ticker, so it runs against the fake
 * stage (testing/fake-stage.ts) in lobby-camp-stage.test.ts.
 */

import type { Application, Texture } from "pixi.js";
import type { Chapter, RunState } from "@kad/shared";
import { createCamp, type CampStage } from "./camp";
import type { CampLayout } from "./camp-layout";
import { frameSeconds } from "./camp-motion";
import {
  LOBBY_CAMP_STAND_IN,
  begun,
  campCues,
  campDressing,
  campFamilyFor,
  campHeroes,
  campSeed,
  campShownFor,
  campStage,
  outdoorRest,
  type CampHero,
} from "./lobby-camp";
import { campBeatShown, onCampBeat } from "./camp-beat";
import { campFriendFigures, friendFigureId } from "./camp-friends";
import type { TapVerdict } from "./camp-taps";

export { lobbyCampLayout } from "./lobby-camp";

/** How long the camp takes to fade off the scene after Begin. The story is up throughout. */
export const LEAVE_FADE_S = 2;
/** How long an outdoor rest's camp takes to come up over the scene's own picture (§3). */
export const ENTER_FADE_S = 1.2;

export interface LobbyCampOptions {
  /** Told whether the camp wholly covers it (scene.ts `setCovered`). */
  cover?: (covered: boolean) => void;
  /** Reduced motion at mount (a11y/prefs.ts); `setStill` follows changes. */
  still?: boolean;
  assetUrl?: (path: string) => string;
  loadTexture?: (url: string) => Promise<Texture>;
  /**
   * The layout for a frame stage in a terrain family (lobby-camp.ts
   * `campLayoutFor`); absent: always `layout`.
   */
  layoutFor?: (stage: number, family: string) => CampLayout | null;
}

/** The chapter as the camp needs it: which one, and its terrain. */
export type CampChapter = Pick<Chapter, "id" | "biome">;

export interface LobbyCamp {
  /**
   * The run state and the chapter this screen has loaded, every time either
   * changes, and whenever the chapter end's camp beat turns. A chapter that is
   * not the state's own is ignored (the fallback terrain until it loads).
   */
  sync(state: RunState | null, chapter?: CampChapter | null): void;
  resize(width: number, height: number): void;
  /** The lobby panels' covered height and the header's reach (stage-inset.ts `onLobbyInset`). */
  setInset(bottomPx: number, topPx?: number): void;
  /** The narration plate's height and its head's reach (stage-inset.ts `onStageInset`): a rest's window. */
  setStageInset(bottomPx: number, topPx?: number): void;
  setStill(still: boolean): void;
  /**
   * A kid tapped a friend on her phone (#624, `GameStore.friendTaps`): the
   * camp up now acts it out, or drops it (camp-taps.ts). Nothing without a camp.
   */
  tapFriend(tap: { friendId: string; heroId: string; words: string }): TapVerdict;
  /** The camp the shared screen is showing, or null when it shows none. */
  camp(): CampStage | null;
  /** A camp still fading off after Begin or Go on, or null. */
  leaving(): CampStage | null;
  destroy(): void;
}

export function createLobbyCamp(app: Application, layout: CampLayout, options: LobbyCampOptions = {}): LobbyCamp {
  const assetUrl = options.assetUrl ?? ((path: string) => `/assets/${path}`);
  let still = options.still ?? false;
  let size = { width: 0, height: 0 };
  let inset = 0;
  let insetTop = 0;
  let stageInset = 0;
  let stageInsetTop = 0;
  let shown: CampStage | null = null;
  /** Whether the camp shown is a rest's, framed above the narration plate. */
  let shownAtRest = false;
  /** An outdoor rest's camp still coming up over the scene; the scene stays drawn until it is up. */
  let entering = false;
  let fading: CampStage | null = null;
  let heroes: CampHero[] | null = null;
  let phase: string | null = null;
  let destroyed = false;
  let mounted: CampLayout = layout;
  let last: RunState | null = null;
  let lastChapter: CampChapter | null = null;
  /** Each friend out at its friend spot, kept while it stays out (camp-friends.ts `friendSpots`). */
  let spots = new Map<string, number>();
  /** The chapter end whose stage-up has been pitched, so it plays once. */
  let pitched: string | null = null;
  // A beat turning is read a moment later, on the state as it then stands: the
  // summary turns it off as the table goes back to the lobby, and the lobby's
  // own sync, in the same commit, keeps the camp up rather than refolding it.
  const offBeat = onCampBeat(() => {
    queueMicrotask(() => {
      if (!destroyed) sync(last, lastChapter);
    });
  });

  function dropFading(): void {
    fading?.destroy();
    fading = null;
  }

  /** The window the camp stands in: under the lobby's panels, or, at a rest, above the narration plate. */
  function applyInset(camp: CampStage): void {
    if (shownAtRest) camp.setInset(stageInset, stageInsetTop);
    else camp.setInset(inset, insetTop);
  }

  function mount(state: RunState, at: CampLayout, crossfade: boolean): CampStage {
    // A camp back before the last one finished fading: that one is gone at once.
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
    applyInset(camp);
    // Crossfading in over the scene: the scene stays drawn under it until it is up.
    entering = crossfade && !still;
    if (entering) camp.view.alpha = 0;
    options.cover?.(!entering);
    return camp;
  }

  function leave(nextPhase: string | null): void {
    const camp = shown;
    if (!camp) return;
    shown = null;
    heroes = null;
    entering = false;
    // Uncovered first: the story is drawn from this frame on, under the camp.
    options.cover?.(false);
    if (begun(phase, nextPhase)) camp.moment("setOff");
    dropFading();
    fading = camp;
  }

  function sync(state: RunState | null, chapter?: CampChapter | null): void {
    if (destroyed) return;
    if (chapter !== undefined) lastChapter = chapter;
    const next = state?.phase ?? null;
    // No state yet is no lobby yet: a phone reloading mid-chapter must not flash a camp.
    last = state;
    if (state && campShownFor(state, campBeatShown())) {
      const atRest = outdoorRest(state);
      // At a rest the heroes are resting, not lining up at the trailhead: Ready is the lobby's.
      const now = campHeroes(state).map((hero) => (atRest ? { ...hero, ready: false } : hero));
      // The crew's frame stage, from its record, pitched in the chapter's
      // terrain (§3.1): a camp that grew, or moved terrain, is pitched anew.
      const want = options.layoutFor?.(campStage(state), campFamilyFor(state, lastChapter)) ?? layout;
      if (shown && (want !== mounted || atRest !== shownAtRest)) {
        shown.destroy();
        shown = null;
        heroes = null;
      }
      const first = shown === null;
      if (first) {
        shownAtRest = atRest;
        shown = mount(state, want, atRest);
      } else shown!.setSeed(campSeed(state));
      const camp = shown!;
      // The friends out (§4.4; #624), each at its friend spot, beside the heroes.
      const friends = campFriendFigures(state, first ? new Map() : spots);
      spots = new Map(friends.map((f) => [f.id.slice("friend:".length), f.friend]));
      camp.setFigures([...now.map((hero) => hero.figure), ...friends]);
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
    const dt = frameSeconds(app.ticker.deltaMS);
    if (shown && entering) {
      shown.view.alpha = Math.min(1, shown.view.alpha + dt / ENTER_FADE_S);
      if (shown.view.alpha >= 1) {
        entering = false;
        options.cover?.(true);
      }
    }
    if (!fading) return;
    const view = fading.view;
    view.alpha = Math.max(0, view.alpha - dt / LEAVE_FADE_S);
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
      if (shown && !shownAtRest) shown.setInset(bottomPx, topPx);
    },
    setStageInset(bottomPx, topPx = 0) {
      // The plate is gone between scenes for a beat; the rest's camp keeps its frame.
      if (bottomPx <= 0) return;
      stageInset = bottomPx;
      stageInsetTop = topPx;
      if (shown && shownAtRest) shown.setInset(bottomPx, topPx);
    },
    setStill(next) {
      still = next;
      shown?.setStill(next);
      fading?.setStill(next);
      if (next && shown && entering) {
        entering = false;
        shown.view.alpha = 1;
        options.cover?.(true);
      }
    },
    tapFriend(tap) {
      if (!shown) return "dropped";
      return shown.tapFriend({ figureId: friendFigureId(tap.friendId), heroId: tap.heroId, words: tap.words });
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
