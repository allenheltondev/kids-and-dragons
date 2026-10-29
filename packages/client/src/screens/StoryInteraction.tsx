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
 * The TV remains display-only. Phones send the interaction intents; the server owns the
 * shared lift, continuous cooperation progress, outcomes and story branches.
 */
import { PaintedInteraction } from "./InteractionArt";
import { useEffect, useRef, useState } from "react";
import { cooperationProgress, interactionActor, interactionStartLocal, playbackMs, speak, supportsReady } from "@kad/shared";
import type { InteractionAction, InteractionPrompt, PartyMember } from "@kad/shared";
import { useSend, useRunState, useMe, useGameStore, useSynced } from "../store";
import { clockGap } from "../store/server-clock";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";
import { Button } from "../ui/Button";
import { Board, KindControls, lampAt } from "./InteractionExtras";
import { litStep, padNote, saysGo, stampFor } from "./game-feel";
import { useRelayArrival } from "./RelayGame";
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

/** Each attempt's start on this device's clock, fixed the first time this device sees it. */
const localStarts = new Map<string, number>();

/**
 * This device's clock moved onto the server's for the attempt under way, so `now - startedAt`
 * reads the same on the TV and every phone whatever their clocks say (interactionStartLocal):
 * the marker, the lamp, a memory pattern and a cup shuffle play at the server's pace everywhere.
 * Fixed per attempt, so a better clock estimate arriving mid-sweep never makes the marker jump.
 */
function serverNow(runId: string | undefined, prompt: InteractionPrompt | null, updatedAt: string | undefined, now: number): number {
  if (!prompt?.startedAt || !updatedAt) return now;
  const key = `${runId}:${prompt.openedSeq}:${prompt.attempt}:${prompt.startedAt}`;
  if (!localStarts.has(key)) {
    if (localStarts.size >= 32) localStarts.clear();
    localStarts.set(key, interactionStartLocal(prompt.startedAt, updatedAt, Date.now(), clockGap()));
  }
  return now - localStarts.get(key)! + Date.parse(prompt.startedAt);
}

/** Measure a server-authored lift from receipt using monotonic elapsed time.
 * Receipt may trail the server slightly; it must never finish a lift early.
 * Renewals preserve this anchor, while retries and roster changes restart it.
 */
function useCooperationClock(prompt: InteractionPrompt | null, localNow: number, team: string): number {
  const anchor = useRef({ key: "", server: 0, received: 0 });
  if (prompt?.spec.kind !== "cooperate" || prompt.phase !== "active") return localNow;
  const key = `${prompt.openedSeq}:${prompt.attempt}:${prompt.steadySince ?? ""}:${team}`;
  if (anchor.current.key !== key) {
    anchor.current = { key, server: Date.parse(prompt.steadySince ?? prompt.startedAt ?? ""), received: performance.now() };
  }
  return Number.isFinite(anchor.current.server)
    ? anchor.current.server + Math.max(0, performance.now() - anchor.current.received)
    : localNow;
}

const SLOW_CLOCK_MS = 250;
/**
 * Frame rate while a marker moves: precision and timing read the stop position from it, and
 * tracking animates its cups during playback. Everything else is static enough for a slow tick.
 */
function clockFor(prompt: InteractionPrompt, now: number): number | undefined {
  const { kind } = prompt.spec;
  if (kind === "precision" || kind === "timing") return undefined;
  if (kind === "tracking" && !prompt.relaxed && now - Date.parse(prompt.startedAt ?? "") < playbackMs(prompt.spec, false)) return undefined;
  return SLOW_CLOCK_MS;
}

/**
 * The result, felt: confetti for a success or a helping hand, a little dust for a miss, on every
 * screen. Keyed on the attempt so a retry earns its own burst. Nothing under reduced motion; the
 * banner's words already say it.
 */
function Burst({ prompt, settled = true }: { prompt: InteractionPrompt; settled?: boolean }) {
  if (prompt.phase !== "result" || reducedMotion() || !settled) return null;
  const kind = prompt.outcome === "failure" ? "miss" : "success";
  return <span className="game__burst" aria-hidden="true"><DiceCelebration key={`${prompt.openedSeq}:${prompt.attempt}`} kind={kind} seed={prompt.openedSeq * 31 + prompt.attempt} /></span>;
}

/** One sound for the room, from the TV only, so four phones do not chime over each other. */
function useResultSound(prompt: InteractionPrompt | null, settled: boolean): void {
  const played = useRef<string | null>(null);
  const key = prompt ? `${prompt.openedSeq}:${prompt.attempt}:${prompt.phase}` : null;
  useEffect(() => {
    if (!prompt || key === null || played.current === key || (prompt.phase === "result" && !settled)) return;
    played.current = key;
    if (prompt.phase === "active") cue("party-ready");
    if (prompt.phase === "result") cue(prompt.outcome === "failure" ? "chime-sour" : "chime-echo");
  }, [key, prompt, settled]);
}

/**
 * The TV directs the room's ears: each pad's note as a pattern plays, a tick as NOW comes and a
 * bright note on NOW, a whoosh for a pass or a shuffle, a soft catch when someone catches.
 */
function useRoomSounds(prompt: InteractionPrompt | null, now: number, connected: readonly string[]): void {
  const last = useRef<{ key: string; step: number | null; lamp: string; passed: number; caught: string | null; swap: number; rise: number }>({ key: "", step: null, lamp: "", passed: 0, caught: null, swap: -1, rise: 0 });
  useEffect(() => {
    if (prompt?.spec.kind === "relay" && prompt.phase === "result") {
      const passed = prompt.passed?.length ?? 0;
      if (passed > last.current.passed) cue("whoosh");
      last.current.passed = passed;
      return;
    }
    if (!prompt || prompt.phase !== "active") return;
    const key = `${prompt.openedSeq}:${prompt.attempt}`;
    const seen = last.current;
    if (seen.key !== key) Object.assign(seen, { key, step: null, lamp: "", passed: prompt.passed?.length ?? 0, caught: prompt.caughtBy ?? null, swap: -1, rise: 0 });
    const spec = prompt.spec;
    const elapsed = now - Date.parse(prompt.startedAt ?? "");
    if (spec.kind === "memory" && !prompt.relaxed && !reducedMotion()) {
      const step = litStep(elapsed, spec.stepMs, spec.answer.length);
      if (step !== null && step !== seen.step) padNote(Math.max(0, spec.options.findIndex((option) => option.id === spec.answer[step])));
      seen.step = step;
    }
    if (spec.kind === "cooperate" && !reducedMotion()) {
      const rise = Math.floor(cooperationProgress(prompt, connected, new Date(now).toISOString()) * 3);
      if (rise > seen.rise) padNote(rise);
      seen.rise = rise;
    }
    if (spec.kind === "timing") {
      const lamp = lampAt(prompt, now);
      const word = lamp.safe ? "now" : lamp.soon ? "soon" : "wait";
      if (word !== seen.lamp && seen.lamp !== "") { if (word === "soon") cue("tick"); if (word === "now") padNote(3); }
      seen.lamp = word;
    }
    if (spec.kind === "tracking" && !prompt.relaxed && !reducedMotion()) {
      const swap = Math.floor((elapsed - spec.stepMs) / spec.stepMs);
      if (swap >= 0 && swap < spec.swaps.length && swap !== seen.swap) cue("whoosh");
      seen.swap = swap;
    }
    if (spec.kind === "relay") {
      const passed = prompt.passed?.length ?? 0;
      if (passed > seen.passed) cue("whoosh");
      if (prompt.caughtBy && prompt.caughtBy !== seen.caught) cue("catch");
      seen.passed = passed; seen.caught = prompt.caughtBy ?? null;
    }
  }, [prompt, now, connected]);
}

/** The word stamped over a finished game, and a GO when a game starts that has no pattern to watch. */
function Stamp({ prompt, now, settled = true }: { prompt: InteractionPrompt; now: number; settled?: boolean }) {
  if (prompt.phase === "result" && !settled) return null;
  if (prompt.phase === "result") return <span className={`game-stamp game-stamp--${prompt.outcome ?? "failure"}`} key={`r:${prompt.attempt}`} aria-hidden="true">{stampFor(prompt)}</span>;
  if (prompt.phase === "active" && saysGo(prompt.spec.kind) && !reducedMotion() && now - Date.parse(prompt.startedAt ?? "") < 900) return <span className="game-stamp game-stamp--go" key={`g:${prompt.attempt}`} aria-hidden="true">GO!</span>;
  return null;
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
  const aligned = (t: number) => serverNow(state?.runId, prompt, state?.updatedAt, t);
  const localNow = aligned(useClock(prompt?.phase === "active", still ? SLOW_CLOCK_MS : prompt ? clockFor(prompt, aligned(Date.now())) : undefined));
  const now = useCooperationClock(prompt, localNow, (state?.party ?? []).filter((member) => member.connected).map((member) => member.playerId).join(","));
  const settled = useRelayArrival(prompt);
  useResultSound(prompt, settled);
  const connected = (state?.party ?? []).filter((member) => member.connected).map((member) => member.playerId);
  useRoomSounds(prompt, now, connected);
  if (!prompt || !state) return null;
  const view = { prompt, party: state.party, connected, now };
  const status = settled ? tvStatus(view) : "Watch it land. Nearly home!";
  return <section className={`story-interaction game game--tv game--${prompt.spec.kind} game--${prompt.phase}`} aria-label="Story interaction">
    <GameHead prompt={prompt} />
    <div className="game__board">
      {(prompt.spec.kind === "play" || (prompt.phase === "ready" && prompt.spec.kind !== "relay")) && <PaintedInteraction prompt={prompt} party={state.party} now={now} />}
      {prompt.phase === "ready" && <p className="game-how"><Icon name={GAME[prompt.spec.kind].icon} /> {GAME[prompt.spec.kind].how}</p>}
      <Board prompt={prompt} party={state.party} now={now} settled={settled} />
      <Stamp prompt={prompt} now={now} settled={settled} />
      {prompt.phase === "result" && settled && <p className={`game__outcome game__outcome--${prompt.outcome ?? "failure"}`}><Icon name={prompt.outcome === "failure" ? "shuffle" : "star"} /> {outcomeLine(prompt)}</p>}
    </div>
    <p className="game__status" role="status" key={status}><Icon name="phone" /><span>{status}</span></p>
    <Burst prompt={prompt} settled={settled} />
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
  return <Controls key={`${prompt.openedSeq}:${prompt.attempt}`} prompt={prompt} party={state.party} runId={state.runId} updatedAt={state.updatedAt} playerId={me.playerId} dispatch={dispatch} busy={pending > 0 || !synced} />;
}

function Controls({ prompt, party, runId, updatedAt, playerId, dispatch, busy }: {
  prompt: InteractionPrompt; party: PartyMember[]; runId: string; updatedAt: string; playerId: string;
  dispatch: ReturnType<typeof useSend>; busy: boolean;
}) {
  const settled = useRelayArrival(prompt);
  const connected = party.filter((member) => member.connected).map((member) => member.playerId);
  const actor = interactionActor(prompt, connected);
  const mine = actor === playerId;
  const still = reducedMotion();
  const [relaxed, setRelaxed] = useState(reducedMotion);
  const [answer, setAnswer] = useState<string[]>([]);
  const [holding, setHolding] = useState(false);
  const [stop, setStop] = useState<number | null>(null);
  const aligned = (t: number) => serverNow(runId, prompt, updatedAt, t);
  const localNow = aligned(useClock(prompt.phase === "active", still ? SLOW_CLOCK_MS : clockFor(prompt, aligned(Date.now()))));
  const now = useCooperationClock(prompt, localNow, connected.join(","));
  const latest = useRef({ prompt, busy, dispatch });
  latest.current = { prompt, busy, dispatch };
  /** Resolves false when the server refused it or it never arrived, so a gesture can take itself back. */
  const send = (action: InteractionAction): Promise<boolean> => dispatch({ type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt, ...action });
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
  const autoFinish = useRef({ key: "", at: 0 });
  useEffect(() => {
    if (!mine || busy || prompt.phase !== "active" || prompt.spec.kind !== "cooperate") return;
    const sameTeam = prompt.steadyPlayerIds?.length === connected.length && connected.every((id) => prompt.steadyPlayerIds?.includes(id));
    const rejoin = supportsReady(prompt, connected, new Date(now).toISOString()) &&
      (!prompt.steadySince || !sameTeam) && prompt.supports[playerId] === null;
    const finished = cooperationProgress(prompt, connected, new Date(now).toISOString()) === 1;
    if (!rejoin && !finished) return;
    const key = `${prompt.openedSeq}:${prompt.attempt}:${prompt.steadySince}:${connected.join(",")}:${rejoin}`;
    if (autoFinish.current.key === key && now - autoFinish.current.at < 1500) return;
    autoFinish.current = { key, at: now };
    void dispatch({ type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt,
      ...(rejoin ? { action: "support", mode: "prop" } : { action: "complete" }) });
  }, [prompt, mine, busy, now, playerId, connected.join(","), dispatch]);
  const view = { prompt, party, connected, now };
  const job = settled ? phoneJob(view, playerId) : { headline: "You sent it home!", detail: "Watch it land on the TV.", lookAt: "tv" as const };
  // A phone that cannot aim (reduced motion) needs the help open, not folded away.
  const needsHand = still && mine && prompt.phase === "active" && (prompt.spec.kind === "precision" || prompt.spec.kind === "timing");
  const controls = prompt.phase === "active" ? <KindControls prompt={prompt} playerId={playerId} connected={connected} mine={mine} now={now} busy={busy} send={send} answer={answer} setAnswer={setAnswer} holding={holding} setHolding={setHolding} setStop={setStop} /> : null;
  return <section className={`story-interaction game game--phone game--${prompt.spec.kind} game--${prompt.phase}${mine ? " game--lead" : ""}`} aria-label="Interaction controls">
    <GameHead prompt={prompt} />
    <p className={`game__job game__job--${job.lookAt}`}>
      <span className="game__job-eye" aria-hidden="true"><Icon name={job.lookAt === "tv" ? "tv" : "phone"} /></span>
      <span className="game__job-text"><strong>{job.headline}</strong>{job.detail ? <span className="game__job-detail">{job.detail}</span> : null}</span>
    </p>
    <div className="game__board">
      {((prompt.spec.kind === "play" && prompt.spec.options.length > 1) || (prompt.phase === "ready" && prompt.spec.kind !== "relay")) && <PaintedInteraction prompt={prompt} party={party} now={now} />}
      {prompt.phase === "ready" && <p className="game-how"><Icon name={GAME[prompt.spec.kind].icon} /> {GAME[prompt.spec.kind].how}</p>}
      {prompt.phase !== "ready" && <Board prompt={prompt} party={party} now={now} answer={mine ? answer : []} playerId={playerId} stop={stop} settled={settled} busy={busy} onCover={async (index) => {
        setAnswer([String(index)]);
        const accepted = await send({ action: "answer", answer: [String(index)] });
        if (!accepted) setAnswer([]);
        return accepted;
      }} />}
      {controls}
      <Stamp prompt={prompt} now={now} settled={settled} />
      {prompt.phase === "result" && settled && <p className={`game__outcome game__outcome--${prompt.outcome ?? "failure"}`} role="status"><Icon name={prompt.outcome === "failure" ? "shuffle" : "star"} /> {outcomeLine(prompt)}</p>}
    </div>
    <div className="game__controls">
      {prompt.phase === "result" && settled && <>
        <Button variant="primary" size="lg" block icon={<Icon name="forward" />} className="story-interaction__button game-action" disabled={busy} onClick={() => send({ action: "continue" })}>See what happens next</Button>
        {mine && <Button variant="secondary" size="lg" block icon={<Icon name="shuffle" />} className="story-interaction__button game-action" disabled={busy} onClick={() => send({ action: "retry" })}>Try again</Button>}
      </>}
      {prompt.phase === "ready" && mine && <Button variant="primary" size="lg" block icon={<Icon name="ready" />} className="story-interaction__button game-action" disabled={busy} onClick={() => send({ action: "start", relaxed })}>We’re ready</Button>}
      {prompt.phase === "active" && <>
        {mine && <div className="game-actions-row">
          <Button variant="ghost" icon={<Icon name="shuffle" />} className="story-interaction__button" disabled={busy} onClick={() => send({ action: "retry" })}>Start this attempt again</Button>
        </div>}
      </>}
    </div>
    <Burst prompt={prompt} settled={settled} />
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
