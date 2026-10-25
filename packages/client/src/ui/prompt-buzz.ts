/**
 * A short buzz when a question arrives on a phone (#465).
 *
 * The phone is the only place a player answers, and a question can arrive while
 * the screen is busy with something else, so one short tick says "yours". It is
 * an enhancement: browsers without `navigator.vibrate` (iOS Safari) stay silent.
 *
 * Buzzes only for a question this player can answer, while the page is visible,
 * once per question. Never on the TV or a shared tablet (no player), and never
 * when reduced motion is set. A question already open when the page mounts is
 * not new, so it does not buzz.
 */

import { useEffect, useRef } from "react";
import type { RunState } from "@kad/shared";
import { isPromptForPlayer, useGameStore } from "../store";
import { loadSharedDevice } from "../store/persistence";
import { reducedMotion } from "../a11y/prefs";

export const PROMPT_BUZZ_MS = 30;

export interface BuzzInput {
  /** Identity of the question this player can answer now, or null. */
  key: string | null;
  /** The question last buzzed on this device, so one question buzzes once. */
  buzzed: string | null;
  /** The signed-in player's id; "" on the TV and on a shared tablet. */
  playerId: string;
  /** This device is a shared household tablet (`loadSharedDevice`). */
  sharedDevice: boolean;
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  /** The reduced-motion setting, or the device's own preference. */
  reduced: boolean;
  /** `navigator.vibrate` is a function here. */
  supported: boolean;
}

/** The decision: buzz now or not. Pure, so every rule is tested without a browser. */
export function shouldBuzz(input: BuzzInput): boolean {
  return input.key !== null
    && input.key !== input.buzzed
    && input.playerId !== ""
    && !input.sharedDevice
    && input.visible
    && !input.reduced
    && input.supported;
}

/**
 * A stable identity for the question on screen: the chapter, how many scenes
 * the party has visited (so a revisited scene is a new question), and what is
 * being asked. Votes and the rest of a group check moving do not change it.
 */
export function promptKey(state: RunState): string | null {
  const prompt = state.prompt;
  if (!prompt) return null;
  const where = "sceneId" in prompt ? prompt.sceneId : "characterId" in prompt ? prompt.characterId : "";
  return `${state.chapterId ?? ""}:${state.visited?.length ?? 0}:${prompt.kind}:${where}`;
}

function vibrateSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Buzzes once for each new question this player can answer. Mount it on the player's phone. */
export function usePromptBuzz(): void {
  // The question this player can answer, or null. A primitive, so the store only re-renders this on a change.
  const key = useGameStore((store) => {
    const state = store.state;
    const playerId = store.session?.playerId ?? "";
    if (!state || !isPromptForPlayer(state.prompt, playerId, state.party)) return null;
    return promptKey(state);
  });
  const buzzed = useRef<string | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    // The first run is the mount: a question already open then is not new.
    if (!primed.current) {
      primed.current = true;
      buzzed.current = key;
      return;
    }
    const playerId = useGameStore.getState().session?.playerId ?? "";
    const go = shouldBuzz({
      key,
      buzzed: buzzed.current,
      playerId,
      sharedDevice: loadSharedDevice() !== null,
      visible: typeof document === "undefined" || document.visibilityState === "visible",
      reduced: reducedMotion(),
      supported: vibrateSupported(),
    });
    if (!go) return;
    buzzed.current = key;
    try {
      navigator.vibrate(PROMPT_BUZZ_MS);
    } catch {
      /* Optional hardware feedback: a refusal is not an error. */
    }
  }, [key]);
}
