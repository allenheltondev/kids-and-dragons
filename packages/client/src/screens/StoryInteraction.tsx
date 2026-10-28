/**
 * A story interaction (#493) as the whole screen, on the TV and on every phone.
 *
 * The first family playtest found the games confusing: a small bordered widget under the
 * narration, an authored cue that read like an instruction manual, "Take a helping hand" on
 * every phone with no word about what it did, and nothing saying whose phone mattered or
 * whether to look up at the TV or down at the phone. So a game is now a board that fills the
 * pane, with a plain name, the story's cue, the board itself, and under it the one line that
 * matters: on the TV, who does what on which phone; on a phone, this person's own job.
 *
 * The engine and protocol are untouched: the TV is still display-only, and the phone still
 * sends the same intents it did.
 */
import { PaintedInteraction } from "./InteractionArt";
import { useEffect, useRef, useState } from "react";
import { interactionActor, playbackMs, speak } from "@kad/shared";
import type { InteractionAction, InteractionPrompt, PartyMember } from "@kad/shared";
import { useSend, useRunState, useMe, useGameStore, useSynced } from "../store";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";
import { Button } from "../ui/Button";
import { Board, KindControls } from "./InteractionExtras";
import { DiceCelebration } from "./DiceCelebration";
import { cue } from "../audio/cue";
import { GAME, HELPING_HAND, outcomeLine, phoneJob, tvStatus } from "./interaction-copy";
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

/**
 * The result, felt: confetti for a success or a helping hand, a little dust for a miss, on every
 * screen. Keyed on the attempt so a retry earns its own burst. Nothing under reduced motion; the
 * banner's words already say it.
 */
function Burst({ prompt }: { prompt: InteractionPrompt }) {
  if (prompt.phase !== "result" || reducedMotion()) return null;
  const kind = prompt.outcome === "failure" ? "miss" : "success";
  return <span className="game__burst" aria-hidden="true"><DiceCelebration key={`${prompt.openedSeq}:${prompt.attempt}`} kind={kind} seed={prompt.openedSeq * 31 + prompt.attempt} /></span>;
}

/** One sound for the room, from the TV only, so four phones do not chime over each other. */
function useResultSound(prompt: InteractionPrompt | null): void {
  const played = useRef<string | null>(null);
  const key = prompt ? `${prompt.openedSeq}:${prompt.attempt}:${prompt.phase}` : null;
  useEffect(() => {
    if (!prompt || key === null || played.current === key) return;
    played.current = key;
    if (prompt.phase === "active") cue("party-ready");
    if (prompt.phase === "result") cue(prompt.outcome === "failure" ? "chime-sour" : "chime-echo");
  }, [key, prompt]);
}

/** The game's name and the story's cue, the same heading on every screen. */
function GameHead({ prompt }: { prompt: InteractionPrompt }) {
  const game = GAME[prompt.spec.kind];
  return <header className="game__head">
    <span className="game__badge"><Icon name={game.icon} /> {game.name}</span>
    <h3 className="game__cue">{prompt.spec.cue}</h3>
  </header>;
}

/** Read-only shared feedback; the television never sends an intent. */
export function StoryInteractionWorld() {
  const state = useRunState();
  const prompt = state?.prompt?.kind === "interaction" ? state.prompt : null;
  const still = reducedMotion();
  const now = useClock(prompt?.phase === "active" && !still, prompt ? clockFor(prompt) : undefined);
  useResultSound(prompt);
  if (!prompt || !state) return null;
  const connected = state.party.filter((member) => member.connected).map((member) => member.playerId);
  const view = { prompt, party: state.party, connected, now };
  const status = tvStatus(view);
  return <section className={`story-interaction game game--tv game--${prompt.spec.kind} game--${prompt.phase}`} aria-label="Story interaction">
    <GameHead prompt={prompt} />
    <div className="game__board">
      <PaintedInteraction prompt={prompt} party={state.party} now={now} />
      {prompt.phase === "ready" && <p className="game-how"><Icon name={GAME[prompt.spec.kind].icon} /> {GAME[prompt.spec.kind].how}</p>}
      <Board prompt={prompt} party={state.party} now={now} />
      {prompt.phase === "result" && <p className={`game__outcome game__outcome--${prompt.outcome ?? "failure"}`}><Icon name={prompt.outcome === "failure" ? "shuffle" : "star"} /> {outcomeLine(prompt)}</p>}
    </div>
    <p className="game__status" role="status" key={status}><Icon name="phone" /><span>{status}</span></p>
    <Burst prompt={prompt} />
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
  const still = reducedMotion();
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
  const view = { prompt, party, connected, now };
  const job = phoneJob(view, playerId);
  // A phone that cannot aim (reduced motion) needs the help open, not folded away.
  const needsHand = still && mine && prompt.phase === "active" && (prompt.spec.kind === "precision" || prompt.spec.kind === "timing");
  return <section className={`story-interaction game game--phone game--${prompt.spec.kind} game--${prompt.phase}${mine ? " game--lead" : ""}`} aria-label="Interaction controls">
    <GameHead prompt={prompt} />
    <p className={`game__job game__job--${job.lookAt}`}>
      <span className="game__job-eye" aria-hidden="true"><Icon name={job.lookAt === "tv" ? "tv" : "phone"} /></span>
      <span className="game__job-text"><strong>{job.headline}</strong>{job.detail ? <span className="game__job-detail">{job.detail}</span> : null}</span>
    </p>
    <div className="game__board">
      <PaintedInteraction prompt={prompt} party={party} now={now} />
      {prompt.phase === "ready" && <p className="game-how"><Icon name={GAME[prompt.spec.kind].icon} /> {GAME[prompt.spec.kind].how}</p>}
      {prompt.phase === "active" && <Board prompt={prompt} party={party} now={now} answer={mine ? answer : []} playerId={playerId} />}
      {prompt.phase === "result" && <p className={`game__outcome game__outcome--${prompt.outcome ?? "failure"}`} role="status"><Icon name={prompt.outcome === "failure" ? "shuffle" : "star"} /> {outcomeLine(prompt)}</p>}
    </div>
    <div className="game__controls">
      {prompt.phase === "result" && <>
        <Button variant="primary" size="lg" block icon={<Icon name="forward" />} className="story-interaction__button game-action" disabled={busy} onClick={() => send({ action: "continue" })}>See what happens next</Button>
        {mine && <Button variant="secondary" size="lg" block icon={<Icon name="shuffle" />} className="story-interaction__button game-action" disabled={busy} onClick={() => send({ action: "retry" })}>Try again</Button>}
      </>}
      {prompt.phase === "ready" && mine && <Button variant="primary" size="lg" block icon={<Icon name="ready" />} className="story-interaction__button game-action" disabled={busy} onClick={() => send({ action: "start", relaxed })}>We’re ready</Button>}
      {prompt.phase === "active" && <>
        <KindControls prompt={prompt} playerId={playerId} connected={connected} mine={mine} now={now} busy={busy} send={send} answer={answer} setAnswer={setAnswer} holding={holding} setHolding={setHolding} />
        {mine && <div className="game-actions-row">
          <Button variant="ghost" icon={<Icon name="shuffle" />} className="story-interaction__button" disabled={busy} onClick={() => send({ action: "retry" })}>Start this attempt again</Button>
        </div>}
      </>}
    </div>
    <Burst prompt={prompt} />
    {prompt.phase !== "result" && <details className="game__help" open={needsHand || undefined}>
      <summary className="game__help-summary kad-focusable"><Icon name="hand" /> {HELPING_HAND.summary}</summary>
      {prompt.phase === "ready" && mine && <label className="game__help-option">
        <input type="checkbox" checked={relaxed} onChange={(event) => setRelaxed(event.target.checked)} /> <span><strong>Relaxed play</strong><small>{HELPING_HAND.relaxed}</small></span>
      </label>}
      <p className="game__help-text">{HELPING_HAND.hand}</p>
      <Button variant="secondary" block icon={<Icon name="hand" />} className="story-interaction__button" disabled={busy} onClick={() => send({ action: "assist" })}>Take a helping hand</Button>
    </details>}
  </section>;
}
