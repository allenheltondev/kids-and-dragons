/**
 * NarrationPanel — WorldView for every scene-like phase.
 *
 * The words are the game when there is no combat on screen (roadmap ch.3), so
 * this panel is typeset to be read from a sofa *and* inside the ~60% portrait
 * pane of Travel Mode. Container query units do both from one rule.
 *
 * spec §11: every line of narration and every choice label goes through
 * `speak()`. It is a no-op today; the point is that when it stops being one,
 * no game code changes.
 */

import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { speak } from "@kad/shared";
import type { SceneType } from "@kad/shared";
import { useRunState } from "../store";
import { Icon } from "./icons";
import "./shared.css";
import "./NarrationPanel.css";

const SCENE_LABEL: Record<SceneType, string> = {
  story: "The story",
  check: "A test",
  choice_point: "Everyone decides",
  rest: "A rest",
  encounter: "A fight",
};

const SCENE_ICON: Record<SceneType, string> = {
  story: "scroll",
  check: "d20",
  choice_point: "vote",
  rest: "rest",
  encounter: "swords",
};

/** "bramblewood-01" → "Bramblewood 01". Chapter titles live in chapter JSON,
 *  which the client does not load; the id is the honest fallback. */
function prettyChapter(chapterId: string): string {
  return chapterId
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function NarrationPanel(): ReactElement | null {
  const state = useRunState();
  const narration = state?.narration ?? "";
  const sceneId = state?.sceneId ?? null;
  const prompt = state?.prompt ?? null;
  const choices = prompt !== null && prompt.kind === "choice" ? prompt.options : null;

  /*
   * Everything read aloud is read here, and only here.
   *
   * WorldView exists on exactly one surface per player in both modes — a TV in
   * Party Mode, the top pane in Travel Mode — so putting the `speak()` calls on
   * the shared surface gives one voice. If PlayerPanel also spoke its choices,
   * a Travel Mode phone (which renders both surfaces) would say every line
   * twice.
   *
   * One utterance per scene, not per render. The key covers a narration swap
   * inside the same scene, which the live LLM layer can do (spec §10.2).
   */
  const spokenNarration = useRef<string | null>(null);
  useEffect(() => {
    const key = `${sceneId ?? "-"}:${narration}`;
    if (narration.trim() === "" || spokenNarration.current === key) return;
    spokenNarration.current = key;
    // A new scene's narration replaces the last one rather than queueing behind it.
    speak(narration, { source: "narration", interrupt: true });
  }, [sceneId, narration]);

  const choiceText = choices === null ? "" : choices.map((c) => c.label).join(". ");
  const spokenChoices = useRef<string | null>(null);
  useEffect(() => {
    if (choiceText === "" || spokenChoices.current === choiceText) return;
    spokenChoices.current = choiceText;
    speak(choiceText, { source: "choice" });
  }, [choiceText]);

  const rollText = prompt !== null && prompt.kind === "roll" ? prompt.prompt : "";
  const spokenRoll = useRef<string | null>(null);
  useEffect(() => {
    if (rollText === "" || spokenRoll.current === rollText) return;
    spokenRoll.current = rollText;
    speak(rollText, { source: "prompt" });
  }, [rollText]);

  if (state === null) return null;

  const sceneType = state.sceneType;

  return (
    <section className="narration" aria-live="polite">
      <header className="narration__head">
        {state.chapterId === null ? null : (
          <p className="narration__chapter kad-label">
            <Icon name="chapter" />
            <span>{prettyChapter(state.chapterId)}</span>
          </p>
        )}
        {sceneType === null ? null : (
          <h2 className="narration__title">
            <Icon name={SCENE_ICON[sceneType]} />
            <span>{SCENE_LABEL[sceneType]}</span>
          </h2>
        )}
      </header>

      <p className="narration__body">{narration}</p>

      {/*
        The shared screen shows *what* the choices are; the buttons live on the
        phones (spec §2). Read-only here — nothing on WorldView is tappable.
      */}
      {choices !== null && choices.length > 0 ? (
        <ul className="narration__choices">
          {choices.map((choice) => (
            <li className="narration__choice" key={choice.id}>
              <Icon name={choice.icon} />
              <span>{choice.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {prompt !== null && prompt.kind === "roll" ? (
        <p className="narration__prompt">
          <Icon name="d20" />
          <span>{prompt.prompt}</span>
        </p>
      ) : null}
    </section>
  );
}
