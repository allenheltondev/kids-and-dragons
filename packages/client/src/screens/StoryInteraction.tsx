import { useEffect, useRef, useState } from "react";
import { interactionActor, interactionClues, playbackMs, precisionPosition, supportPlayers, supportsReady, speak } from "@kad/shared";
import type { InteractionAction, InteractionPrompt, PartyMember } from "@kad/shared";
import { useSend, useRunState, useMe, useGameStore, useSynced } from "../store";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";
import { ExtraControls, InteractionShow } from "./InteractionExtras";
import "./StoryInteraction.css";

/** Frame-rate only where a marker moves; untimed play needs a slow tick for playback and lease expiry. */
function useClock(active: boolean, everyMs?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    if (everyMs !== undefined) {
      const timer = setInterval(() => setNow(Date.now()), everyMs);
      return () => clearInterval(timer);
    }
    let frame = 0;
    const tick = () => { setNow(Date.now()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, everyMs]);
  return now;
}

const SLOW_CLOCK_MS = 250;
/**
 * Frame rate while a marker moves: precision and timing read the stop position from it, and
 * tracking animates its cups during playback. Everything else is static enough for a slow tick.
 */
function clockFor(prompt: InteractionPrompt): number | undefined {
  const { kind } = prompt.spec;
  if (kind === "precision" || kind === "timing") return undefined;
  if (kind === "tracking" && !prompt.relaxed && Date.now() - Date.parse(prompt.startedAt ?? "") < playbackMs(prompt.spec, false)) return undefined;
  return SLOW_CLOCK_MS;
}

function Meter({ prompt, now }: { prompt: InteractionPrompt; now: number }) {
  if (prompt.spec.kind !== "precision") return null;
  const width = Math.min(1, prompt.spec.width * (prompt.relaxed ? 2 : 1));
  const left = Math.max(0, prompt.spec.target - width / 2);
  const right = Math.min(1, prompt.spec.target + width / 2);
  const position = precisionPosition(now - Date.parse(prompt.startedAt ?? new Date(now).toISOString()), prompt.spec.periodMs);
  return <div className="story-interaction__track" role="img" aria-label="Moving marker with a gold target">
    <span className="story-interaction__target" style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }} />
    <span className="story-interaction__marker" style={{ left: `${position * 100}%` }} />
  </div>;
}

function outcomeLine(prompt: InteractionPrompt): string {
  return prompt.outcome === "success" ? "You did it together!" : prompt.outcome === "assisted" ? "A helping hand makes a way." : "That went a little differently. Try again, or see what happens next.";
}

/** Read-only shared feedback; the television never sends an intent. */
export function StoryInteractionWorld() {
  const state = useRunState();
  const prompt = state?.prompt?.kind === "interaction" ? state.prompt : null;
  const still = reducedMotion();
  const now = useClock(prompt?.phase === "active" && !still, prompt ? clockFor(prompt) : undefined);
  if (!prompt || !state) return null;
  const connected = state.party.filter((member) => member.connected).map((member) => member.playerId);
  return <section className="story-interaction" aria-label="Story interaction">
    <p>{prompt.spec.cue}</p>
    {prompt.phase === "active" && !still && <Meter prompt={prompt} now={now} />}
    {prompt.phase === "active" && <InteractionShow prompt={prompt} party={state.party} now={now} />}
    {prompt.spec.kind === "cooperate" && prompt.phase === "active" && <ul>
      {supportPlayers(prompt, connected).map((id) => <li key={id}>
        {state.party.find((member) => member.playerId === id)?.character.name}: {prompt.supports[id] === null || Date.parse(prompt.supports[id] ?? "") > now ? "holding the way" : "ready to help"}
      </li>)}
    </ul>}
    <p role="status">{prompt.phase === "result" ? outcomeLine(prompt) : prompt.phase === "ready" ? "Get ready together. Start whenever you like." : "Your actions make a way."}</p>
  </section>;
}

export function StoryInteractionControls() {
  const state = useRunState();
  const me = useMe();
  const send = useSend();
  const synced = useSynced();
  const [pending, setPending] = useState(0);
  const dispatch: ReturnType<typeof useSend> = async (intent) => {
    setPending((count) => count + 1);
    try { return await send(intent); }
    finally { setPending((count) => count - 1); }
  };
  const prompt = state?.prompt?.kind === "interaction" ? state.prompt : null;
  if (!prompt || !state || !me) return null;
  return <Controls key={`${prompt.openedSeq}:${prompt.attempt}`} prompt={prompt} party={state.party} playerId={me.playerId} dispatch={dispatch} busy={pending > 0 || !synced} />;
}

function Controls({ prompt, party, playerId, dispatch, busy }: {
  prompt: InteractionPrompt; party: PartyMember[]; playerId: string;
  dispatch: ReturnType<typeof useSend>; busy: boolean;
}) {
  const connected = party.filter((member) => member.connected).map((member) => member.playerId);
  const actor = interactionActor(prompt, connected);
  const mine = actor === playerId;
  const [relaxed, setRelaxed] = useState(reducedMotion);
  const [answer, setAnswer] = useState<string[]>([]);
  const [holding, setHolding] = useState(false);
  const now = useClock(prompt.phase === "active", clockFor(prompt));
  const latest = useRef({ prompt, busy, dispatch });
  latest.current = { prompt, busy, dispatch };
  const send = (action: InteractionAction) => void dispatch({ type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt, ...action });
  useEffect(() => { speak(prompt.spec.cue, { source: "prompt" }); }, [prompt.openedSeq, prompt.spec.cue]);
  // Hold leases expire without a release message, including a closed phone.
  // The ordinary sequenced action lane handles concurrent renewals and retries.
  useEffect(() => {
    if (!holding || prompt.phase !== "active") return;
    const post = (mode: "hold" | "release") => {
      const current = latest.current;
      const authoritative = useGameStore.getState().state?.prompt;
      if (current.prompt.phase !== "active" || authoritative?.kind !== "interaction" || authoritative.openedSeq !== current.prompt.openedSeq || authoritative.attempt !== current.prompt.attempt || authoritative.phase !== "active") return;
      void current.dispatch({ type: "INTERACT", openedSeq: current.prompt.openedSeq, attempt: current.prompt.attempt, action: "support", mode });
    };
    post("hold");
    const renew = window.setInterval(() => { if (!latest.current.busy) post("hold"); }, 1500);
    const release = () => setHolding(false);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      clearInterval(renew); window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release); post("release");
    };
  }, [holding, prompt.phase]);
  const button = (label: string, action: InteractionAction, disabled = false) =>
    <button className="story-interaction__button kad-focusable" disabled={busy || disabled} onClick={() => send(action)}>{label}</button>;
  return <section className="story-interaction" aria-label="Interaction controls">
    <h3>{prompt.spec.cue}</h3>
    {prompt.phase === "result" ? <>
      <p role="status">{outcomeLine(prompt)}</p>
      {button("See what happens next", { action: "continue" })}
      {mine && button("Try again", { action: "retry" })}
    </> : <>
      {prompt.phase === "ready" && (mine ? <>
        <label><input type="checkbox" checked={relaxed} onChange={(event) => setRelaxed(event.target.checked)} /> Relaxed play</label>
        {button("We’re ready", { action: "start", relaxed })}
      </> : <p>{party.find((member) => member.playerId === actor)?.character.name} can start when everyone is ready.</p>)}
      {prompt.phase === "active" && <>
        <InteractionShow prompt={prompt} party={party} now={now} />
        <ExtraControls prompt={prompt} playerId={playerId} connected={connected} mine={mine} now={now} busy={busy} send={send} />
        {prompt.spec.kind === "precision" && (mine ? <>
          {reducedMotion() ? <p>Take a helping hand below to complete this moment without aiming.</p> : <>
            <Meter prompt={prompt} now={now} />
            {button(prompt.spec.actionLabel, { action: "stop", position: precisionPosition(now - Date.parse(prompt.startedAt ?? ""), prompt.spec.periodMs) })}
            <p>Watch this marker. Tap when it reaches the gold. There is no countdown.</p>
          </>}
        </> : <p>Cheer your friend on!</p>)}
        {prompt.spec.kind === "cooperate" && <>
          {supportPlayers(prompt, connected).includes(playerId) && <>
            {prompt.relaxed || connected.length === 1 ? button(prompt.supports[playerId] === null ? "Remove support" : prompt.spec.supportLabel, { action: "support", mode: prompt.supports[playerId] === null ? "release" : "prop" }) :
              <button className="story-interaction__button story-interaction__hold kad-focusable" aria-pressed={holding}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setHolding(true); }}
                onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)} onLostPointerCapture={() => setHolding(false)} onBlur={() => setHolding(false)}
                onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHolding(true); } }}
                onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHolding(false); } }}>
                {holding ? "I’ve got it!" : prompt.spec.supportLabel}
              </button>}
            {button("Use a prop instead", { action: "support", mode: "prop" }, holding)}
          </>}
          {mine && button(prompt.spec.actionLabel, { action: "complete" }, !supportsReady(prompt, connected, new Date(now).toISOString()))}
        </>}
        {(prompt.spec.kind === "sequence" || prompt.spec.kind === "memory") && <>
          {prompt.spec.kind === "sequence" && <>
            <ul>{interactionClues(prompt, playerId, connected).map((clue, index) => <li key={index}>{clue}</li>)}</ul>
            <details><summary>Share all clues / help a friend</summary><ul>{prompt.spec.clues.map((clue, index) => <li key={index}>{clue}</li>)}</ul></details>
          </>}
          {mine && <>
            <p aria-live="polite">{answer.map((id) => prompt.spec.kind === "sequence" || prompt.spec.kind === "memory" ? prompt.spec.options.find((option) => option.id === id)?.label : id).join(" → ") || "Choose your path together."}</p>
            {prompt.spec.options.map((option) => <button className="story-interaction__button kad-focusable" key={option.id} disabled={busy || (prompt.spec.kind !== "sequence" && prompt.spec.kind !== "memory") || answer.length >= prompt.spec.answer.length || (prompt.spec.kind === "memory" && !prompt.relaxed && now - Date.parse(prompt.startedAt ?? "") < playbackMs(prompt.spec, prompt.relaxed) + 250)} onClick={() => setAnswer((current) => [...current, option.id])}><Icon name={option.icon} /> {option.label}</button>)}
            <button className="story-interaction__button kad-focusable" disabled={busy || !answer.length} onClick={() => setAnswer((current) => current.slice(0, -1))}>Change last step</button>
            {button(prompt.spec.actionLabel, { action: "answer", answer }, answer.length !== prompt.spec.answer.length)}
          </>}
        </>}
        {mine && button("Start this attempt again", { action: "retry" })}
      </>}
      {button("Take a helping hand", { action: "assist" })}
    </>}
  </section>;
}
