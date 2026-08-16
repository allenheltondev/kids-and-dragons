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
import { useItems, useParty, useRunState } from "../store";
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

/**
 * "Sparklehoof wants to give Thistle a Sunbloom Draught."
 *
 * Third person and on the shared surface, because a hand-off is a table event
 * rather than a private one (spec §9.4 — it is "the point in the session where
 * the three of you talk to each other"). Said out loud on the TV, the giving
 * is something the room hears; said only on the receiving phone, it is a card
 * that appears while she is looking at the television.
 */
function offerLine(
  offer: { fromPlayerId: string; toPlayerId: string; itemId: string },
  nameOf: (playerId: string) => string,
  itemName: (itemId: string) => string,
): string {
  return `${nameOf(offer.fromPlayerId)} wants to give ${nameOf(offer.toPlayerId)} a ${itemName(offer.itemId)}.`;
}

export function NarrationPanel(): ReactElement | null {
  const state = useRunState();
  const party = useParty();
  const items = useItems();
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

  /*
   * Hand-offs (spec §9.4). `trades` is optional on RunState — a run persisted
   * before trading existed comes back without it — so it is coalesced here.
   *
   * Announced **per offer id**, not per rendering of the whole list. Keying on
   * the joined text re-announced everything whenever the list changed shape: a
   * second offer arriving turned "A" into "A B" and said A again, resolving A
   * turned "A B" into "B" and said B again, and the item catalog arriving
   * late turned "a thing" into "a Sunbloom Draught" and said the lot. Three
   * people at a table get interrupted by every one of those.
   *
   * An id is derived from the three things that identify a hand-off, so
   * re-offering the same item to the same person after a decline is
   * deliberately not re-announced either.
   */
  const nameOfPlayer = (playerId: string): string =>
    party.find((m) => m.playerId === playerId)?.character.name ?? "Someone";
  const nameOfItem = (itemId: string): string => items?.[itemId]?.name ?? "thing";
  const trades = state?.trades ?? [];
  const spokenOffers = useRef<Set<string>>(new Set());
  /*
   * Read through a ref so the effect depends on the offer *ids* alone. The
   * sentence is built from party names and the item catalog, both of which can
   * arrive after the offer; depending on the text would make their arrival a
   * reason to speak again.
   */
  const line = useRef(offerLine);
  line.current = offerLine;
  const namesRef = useRef({ nameOfPlayer, nameOfItem });
  namesRef.current = { nameOfPlayer, nameOfItem };
  const pending = trades.filter((offer) => !spokenOffers.current.has(offer.id));
  const pendingKey = pending.map((offer) => offer.id).join("|");
  useEffect(() => {
    if (pendingKey === "") return;
    const fresh = (state?.trades ?? []).filter((offer) => !spokenOffers.current.has(offer.id));
    if (fresh.length === 0) return;
    for (const offer of fresh) spokenOffers.current.add(offer.id);
    // Never `interrupt` — the scene's own narration outranks it, and an offer
    // is an aside rather than a new beat.
    speak(
      fresh
        .map((offer) =>
          line.current(offer, namesRef.current.nameOfPlayer, namesRef.current.nameOfItem),
        )
        .join(" "),
      { source: "prompt" },
    );
    // `state` is read through the guard above rather than depended on: only a
    // genuinely new offer id may cause a new utterance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

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

      {/*
        Hand-offs in the air (spec §9.4). On the shared screen for the same
        reason the choices are: the buttons belong to the phones, but the table
        should be able to see what is being passed around without reading over
        somebody's shoulder. Read-only, like everything else on WorldView.
      */}
      {trades.length === 0 ? null : (
        <ul className="narration__trades">
          {trades.map((offer) => (
            <li className="narration__trade" key={offer.id}>
              <Icon name={items?.[offer.itemId]?.icon ?? "bag"} />
              <span>
                <b>{nameOfPlayer(offer.fromPlayerId)}</b> offers{" "}
                {nameOfItem(offer.itemId)} to <b>{nameOfPlayer(offer.toPlayerId)}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
