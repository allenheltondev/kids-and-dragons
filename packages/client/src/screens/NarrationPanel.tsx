/**
 * NarrationPanel — WorldView for every scene-like phase.
 *
 * The words are the game when there is no combat on screen (roadmap ch.3), so
 * this panel is typeset to be read from a sofa *and* inside the ~60% portrait
 * pane of Travel Mode. Container query units do both from one rule.
 *
 * spec §11: every line of narration and every choice label goes through
 * `speak()` (a no-op until a device turns read-aloud on, speech/read-aloud.ts).
 * The shared surface speaks the story; the options are spoken by the phone
 * that owns them (PlayerPanel).
 */

import { Suspense, lazy, useEffect, useLayoutEffect, useRef } from "react";
import type { ReactElement } from "react";
import { combatTurnAway, currentActorId, speak, turnHolderAway } from "@kad/shared";
import type { PartyMember } from "@kad/shared";
import type { ScenePriority } from "@kad/shared";
import { useAbilities, useItems, useParty, usePreviews, useRules, useRunState } from "../store";
import { describeCombatPreview, tablePreviews } from "../world/previews";
import { setStageInsetBottom } from "../world/stage-inset";
import { fitPlate, unfitPlate } from "./fit-plate";
import { Icon } from "./icons";
import { ClassToken } from "./ClassToken";
import { VoteTicks } from "./VoteTicks";
import { ClassPlaceRoll } from "./ClassPlace";
import { chapterHeading } from "./campaign-copy";
import { steppedAwayLine } from "./presence-copy";
import "./shared.css";
import "./NarrationPanel.css";

/** The rank-up moment (#314), fetched the first time a rank lands, never at first paint. */
const RankUpMoment = lazy(() => import("./RankUpMoment").then((module) => ({ default: module.RankUpMoment })));

/** "bramblewood-01" → "Bramblewood 01". The fallback for a run persisted
 *  before `chapterInfo` carried the real title. */
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

/**
 * The ribbon over a priority scene (chapter.ts `ScenePriority`): what the
 * table is told, in words an eight-year-old reads at a glance, about how much
 * this scene matters. A revelation is the one to remember; a clue is one to
 * notice. Said aloud ahead of the narration, so a listener gets it too.
 */
export const PRIORITY_RIBBON: Record<ScenePriority, { label: string; icon: string }> = {
  1: { label: "Remember this!", icon: "star" },
  2: { label: "A clue", icon: "eye" },
};

export function NarrationPanel(): ReactElement | null {
  const state = useRunState();
  const party = useParty();
  const items = useItems();
  const abilities = useAbilities();
  const rules = useRules();
  // Who is leaning toward what, on their phone, before "Do it!" (world/previews.ts).
  const leaning = tablePreviews(state, usePreviews());
  const narration = state?.narration ?? "";
  const sceneId = state?.sceneId ?? null;
  // Never in a fight: the caption strip has no room for a ribbon, and an
  // encounter cannot carry a priority anyway.
  const priority = state?.encounter != null ? null : state?.scenePriority ?? null;
  const ribbon = priority === null ? null : PRIORITY_RIBBON[priority];
  // The practice's line of what to tap (#255): shown under the words, in a
  // fight too, because that is where the board's lesson is.
  const hint = state?.hint ?? null;
  // The fitting stall's words (#312), on the TV under the story while it is open.
  const stallWords = state?.phase === "scene" && state.classPlace?.stall ? (rules?.fittingStall?.narration ?? null) : null;
  // Ranks that just landed (#310), while the scene they landed on is open and
  // never over a fight. One line each, the words of record; the moment (#314)
  // lifts the token over the stage for a few seconds beside them.
  const rankUps =
    state?.encounter == null && state?.rankUps && state.rankUps.sceneId === sceneId ? state.rankUps.ups : [];
  const rankUpText = rankUps.map((up) => (up.crow ? `${up.line} ${up.crow}` : up.line)).join(" ");
  const prompt = state?.prompt ?? null;
  const choices = prompt !== null && prompt.kind === "choice" ? prompt.options : null;
  /*
   * Whose story turn it is (spec §6.1), said on the shared screen because
   * that is where the table looks to find out. Named only while the holder is
   * at the table — once their phone drops, anyone may answer for them, and
   * the screen should not tell the room to wait on somebody who cannot tap.
   *
   * The line's seat lasts as long as the turn does, whoever is holding it:
   * a phone dropping and coming back only hides and shows the name, so it
   * cannot push the story down a line and back up again.
   */
  const turnPrompt =
    prompt !== null && prompt.kind === "choice" && !prompt.vote && prompt.forPlayerIds.length === 1;
  const turnName =
    turnPrompt && !turnHolderAway(party, prompt)
      ? party.find((m) => m.playerId === prompt.forPlayerIds[0])?.character.name ?? null
      : null;

  // Who stepped away (#258), and whether the fight is waiting on one of them.
  const away = party.filter((m) => !m.connected);
  const awayTurnId =
    away.length > 0 && state?.encounter && combatTurnAway(state) ? currentActorId(state.encounter) : null;
  const awayHoldsTurn = (member: PartyMember): boolean => member.character.id === awayTurnId;

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
    speak(ribbon === null ? narration : `${ribbon.label} ${narration}`, { source: "narration", interrupt: true });
    // The ribbon follows the scene, so a new one always arrives with new words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, narration]);

  /*
   * The hint, after the story and never instead of it: declared after the
   * narration's effect so it queues behind it, and before whose turn it is,
   * so "tap Roll" is heard before the name it is for. Once per scene.
   */
  const spokenHint = useRef<string | null>(null);
  useEffect(() => {
    const key = `${sceneId ?? "-"}:${hint ?? ""}`;
    if (hint === null || spokenHint.current === key) return;
    spokenHint.current = key;
    speak(hint, { source: "ui" });
  }, [sceneId, hint]);

  /* The fitting stall's words (#312), after the story: they are narration too (spec §11). */
  const spokenStall = useRef<string | null>(null);
  useEffect(() => {
    const key = `${sceneId ?? "-"}:${stallWords ?? ""}`;
    if (stallWords === null || spokenStall.current === key) return;
    spokenStall.current = key;
    speak(stallWords, { source: "narration" });
  }, [sceneId, stallWords]);

  /* The rank-up lines, after the story: once per scene. */
  const spokenRankUps = useRef<string | null>(null);
  useEffect(() => {
    const key = `${sceneId ?? "-"}:${rankUpText}`;
    if (rankUpText === "" || spokenRankUps.current === key) return;
    spokenRankUps.current = key;
    speak(rankUpText, { source: "ui" });
  }, [sceneId, rankUpText]);

  /*
   * Whose turn it is, and no more. The options themselves are read by the phone
   * that owns them (PlayerPanel), so a table of phones does not hear every
   * list twice; the shared screen announces only what is the room's business.
   */
  const choiceText = choices === null || turnName === null ? "" : `${turnName}'s turn.`;
  const spokenChoices = useRef<string | null>(null);
  useEffect(() => {
    if (choiceText === "" || spokenChoices.current === choiceText) return;
    spokenChoices.current = choiceText;
    speak(choiceText, { source: "prompt" });
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

  // In a fight the board is the thing to look at and the words are its
  // caption: the panel folds to a strip (NarrationPanel.css) so a phone's
  // world pane shows tiles, not a paragraph over them.
  const fighting = state?.encounter != null;

  /*
   * The plate's height, told to the stage (world/stage-inset.ts) so the story
   * frames its figures above the words rather than behind them. Nothing in a
   * fight: the board takes the whole pane and the caption floats over it.
   */
  const plate = useRef<HTMLDivElement | null>(null);
  /*
   * The plate's type steps down until the choices are on screen (fit-plate.ts). Before paint
   * for a new scene, so a long one never shows at the size that pushes its choices away; and
   * again when the pane, the text size or the font changes under the same words.
   */
  const fitKey = [
    narration,
    hint ?? "",
    rankUps.length,
    choices === null ? "" : choices.map((choice) => `${choice.id}:${choice.label}`).join("|"),
    prompt !== null && prompt.kind === "roll" ? prompt.prompt : "",
  ].join("\n");
  useLayoutEffect(() => {
    const element = plate.current;
    if (element === null) return;
    if (fighting) {
      unfitPlate(element);
      return;
    }
    fitPlate(element);
    if (typeof ResizeObserver === "undefined") return;
    // A resize, a text-size change and a font arriving all reshape the words, not the plate's
    // box; one frame later is soon enough, and keeps the observer out of its own way.
    let frame = 0;
    const refit = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitPlate(element));
    };
    const observer = new ResizeObserver(refit);
    observer.observe(element.parentElement ?? element);
    const body = element.querySelector(".narration__body");
    if (body !== null) observer.observe(body);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fighting, fitKey, state === null]);
  useEffect(() => {
    const element = plate.current;
    if (fighting || element === null) {
      setStageInsetBottom(0);
      return;
    }
    const report = (): void => setStageInsetBottom(element.getBoundingClientRect().height);
    report();
    if (typeof ResizeObserver === "undefined") return () => setStageInsetBottom(0);
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      setStageInsetBottom(0);
    };
  }, [fighting, state === null]);

  if (state === null) return null;

  return (
    <section
      className={`narration${fighting ? " narration--fight" : ""}${
        priority === null ? "" : ` narration--p${String(priority)}`
      }`}
      aria-live="polite"
    >
      <header className="narration__head">
        {state.chapterId === null ? null : (
          <h2 className="narration__chapter">
            <span>{chapterHeading(state) ?? prettyChapter(state.chapterId)}</span>
          </h2>
        )}

        {/*
          Hand-offs in the air (spec §9.4). On the shared screen for the same
          reason the choices are: the buttons belong to the phones, but the table
          should be able to see what is being passed around without reading over
          somebody's shoulder. Read-only, like everything else on WorldView.

          Up here rather than on the plate: an offer is two other people's
          business, and it used to arrive under the story and push the words
          the room was reading up the screen.
        */}
        {/*
          Who stepped away (#258): their phone dropped, or the host took them
          out. Not knocked down, which the board draws lying on the grid: up
          here, as words, with the figure faded on the stage. When the fight's
          clock is on one of them it says how the table goes on.
        */}
        {away.length === 0 ? null : (
          <ul className="narration__trades narration__away" data-testid="stepped-away">
            {away.map((member) => (
              <li className="narration__trade" key={member.playerId}>
                <Icon name="waiting" />
                <span>{steppedAwayLine(member.character.name, awayHoldsTurn(member))}</span>
              </li>
            ))}
          </ul>
        )}

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
      </header>

      {/*
        Keyed on the text so a new narration is a new element, which is what
        lets one CSS animation give every scene change a soft entrance —
        roadmap chapter 8's transitions, DOM half. The key is the content
        itself: same words, same node, no re-animation on unrelated patches.
      */}
      <div className="narration__plate" ref={plate}>
        <div className="narration__story">
          {choices !== null && choices.length > 0 && turnPrompt ? (
            <p className={`narration__turn${turnName === null ? " narration__turn--empty" : ""}`}>
              {turnName === null ? "\u00a0" : <>{turnName}&rsquo;s turn to choose</>}
            </p>
          ) : null}
          {ribbon === null ? null : (
            <p className="narration__ribbon" key={`ribbon:${narration}`}>
              <Icon name={ribbon.icon} />
              <span>{ribbon.label}</span>
            </p>
          )}
          <p className="narration__body" key={narration}>
            {narration}
          </p>
          {hint === null ? null : (
            <p className="narration__hint" key={`hint:${hint}`} data-testid="scene-hint">
              <Icon name="star" />
              <span>{hint}</span>
            </p>
          )}
          {/* Who switched at a class place (#311), while the way on waits. */}
          <ClassPlaceRoll />
          {rankUps.map((up) => (
            <p className="narration__hint" key={`rank:${up.characterId}:${up.rank}`} data-testid="rank-up">
              <ClassToken classId={up.class} rank={up.rank} size="sm" holdable={false} />
              <span>{up.crow ? `${up.line} ${up.crow}` : up.line}</span>
            </p>
          ))}
          {rankUps.length === 0 ? null : (
            <Suspense fallback={null}>
              <RankUpMoment
                ups={rankUps}
                party={party}
                rules={rules}
                momentKey={`${state.runId}:${sceneId ?? "-"}:${rankUps.map((up) => `${up.characterId}.${up.rank}`).join(",")}`}
              />
            </Suspense>
          )}
        </div>

        {/*
          The shared screen shows *what* the choices are; the buttons live on the
          phones (spec §2). Read-only here — nothing on WorldView is tappable.
        */}
        {choices !== null && choices.length > 0 ? (
          <ul className="narration__choices" data-count={choices.length > 6 ? "many" : choices.length}>
            {choices.map((choice) => {
              // A hover is a light, not a name: it only lights the option, so a
              // name appearing and disappearing cannot rewrap the label.
              const leaningNow = (leaning.choices[choice.id] ?? []).length > 0;
              // A locked vote is a tick in the voter's color, the same as on
              // the phones (PlayerPanel): a seat per voter, drawn from the
              // start, so a vote landing cannot grow the pill and rewrap the row.
              const votedIds =
                prompt?.kind === "choice"
                  ? Object.entries(prompt.votes ?? {})
                      .filter(([, choiceId]) => choiceId === choice.id)
                      .map(([playerId]) => playerId)
                  : [];
              return (
                <li
                  className={`narration__choice${leaningNow ? " narration__choice--picked" : ""}`}
                  key={choice.id}
                >
                  <Icon name={choice.icon} />
                  <span>{choice.label}</span>
                  {prompt?.kind === "choice" && prompt.vote ? (
                    <VoteTicks
                      className="narration__voters"
                      voterIds={
                        prompt.forPlayerIds.length > 0 ? prompt.forPlayerIds : party.map((m) => m.playerId)
                      }
                      votedIds={votedIds}
                      party={party}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {/*
          The fighter whose turn it is, mid-pick: the board rings what they are
          aiming at, and this names it, because a ring alone does not say
          *which* power is about to land.

          Its seat is held for the whole fight and the pick only fills it, on
          one line: a fighter tapping about on their phone must not shove the
          caption up and down the board under everybody else.
        */}
        {state.encounter ? (
          <p
            className={`narration__aim${leaning.combat === null ? " narration__aim--empty" : ""}`}
            role="status"
          >
            <Icon name="hand" />
            <span>
              {leaning.combat === null ? (
                "\u00a0"
              ) : (
                <>
                  <b>{leaning.combat.name}</b>:{" "}
                  {describeCombatPreview(leaning.combat.preview, state.encounter, abilities, items)}
                </>
              )}
            </span>
          </p>
        ) : null}

        {prompt !== null && prompt.kind === "roll" ? (
          <p className="narration__prompt">
            <Icon name="d20" />
            <span>{prompt.prompt}</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
