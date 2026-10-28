/**
 * The board (what a game looks like, read-only, the same on the TV and every phone) and the
 * per-kind controls a phone adds under it. StoryInteraction.tsx frames these; nothing here sends
 * an intent on its own, the frame hands `send` down.
 *
 * Each kind is a small game, not a form: a pad to TAP, a lamp to hit on NOW, coloured pads that
 * sing a pattern, a thing to catch and flick on, a lever to drag level, a button to grip, picks
 * that fly off as stickers. The engine's intents are unchanged; only how they are asked for is.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useChapter, useRunState } from "../store";
import { interactionAppearance } from "../world/riftlight-art";
import { characterWorldArtUrl } from "../world/art-paths";
import { PaintedCover, PaintedGlyph, propUrl } from "./InteractionArt";
import { balanceReady, interactionActor, interactionClues, playReady, precisionPosition, precisionSuccess, relayHolder, supportPlayers, supportsReady, trackedCover } from "@kad/shared";
import type { InteractionAction, InteractionOption, InteractionPrompt, PartyMember } from "@kad/shared";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";
import { Button } from "../ui/Button";
import { showing } from "./interaction-copy";
import { buzz, litStep, padNote } from "./game-feel";

/** Answers are slot indices; distinct moving paintings must not name those slots. */
function trackingLabels(covers: string[], icons?: string[]): string[] {
  if (icons?.length !== covers.length || new Set(icons).size < 2) return covers;
  const positions = covers.length === 3 ? ["Left", "Middle", "Right"] : covers.length === 2 ? ["Left", "Right"] : [];
  return covers.map((_, index) => positions[index] ?? `Position ${index + 1}`);
}

export interface BoardProps {
  prompt: InteractionPrompt;
  party: PartyMember[];
  now: number;
  /** The lead phone's half-built answer, for the slots on a sequence or memory board. */
  answer?: string[];
  /** Whose phone this is; the TV passes nothing. */
  playerId?: string;
  /** Where the lead's tap stopped the marker, so the board can freeze it there. */
  stop?: number | null;
}

/** The authored object a board can carry: the first prop that is not a musical note. */
function useObject(): string | undefined {
  const chapter = useChapter();
  const state = useRunState();
  const appearance = interactionAppearance(chapter?.id === state?.chapterId ? chapter : null, state?.sceneId);
  return appearance?.props?.find((id) => !id.startsWith("note-"));
}

function Prop({ id, className }: { id: string; className: string }) {
  return <img className={className} src={propUrl(id)} alt="" decoding="async" draggable={false} onError={(event) => { event.currentTarget.style.display = "none"; }} />;
}

function HeroChip({ member, state, tone, mark, token, air, strain }: {
  member: PartyMember; state?: string; tone?: "on" | "done" | "off"; mark?: string;
  /** The relay object, in this hero's hands (or in the air above them, coming in). */
  token?: string; air?: boolean; strain?: boolean;
}) {
  return <li className={`game-hero${tone ? ` game-hero--${tone}` : ""}${strain ? " game-hero--strain" : ""}`}>
    <span className="game-hero__face">
      <img src={characterWorldArtUrl(member.character.species, member.character.tier, member.character.class)} alt="" decoding="async" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
      {mark ? <span className="game-hero__mark" key={mark}><Icon name={mark} /></span> : null}
      {token ? <img key={air ? "air" : "hands"} className={`game-hero__token${air ? " game-hero__token--air" : ""}`} src={token} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
    </span>
    <span className="game-hero__name">{member.character.name}</span>
    {state ? <span className="game-hero__state">{state}</span> : null}
  </li>;
}

/** Which colour an option wears, by its place in the authored list, the same on every screen. */
export function toneOf(options: readonly InteractionOption[], id: string): number {
  return Math.max(0, options.findIndex((option) => option.id === id)) % 4;
}

function Tile({ option, size, index, muted, tone }: { option: InteractionOption; size?: "lg"; index?: number; muted?: boolean; tone?: number }) {
  return <span className={`game-tile${size ? ` game-tile--${size}` : ""}${muted ? " game-tile--muted" : ""}`} data-tone={tone}>
    {index !== undefined ? <span className="game-tile__index">{index}</span> : null}
    <span className="game-tile__icon"><PaintedGlyph label={option.label} /><Icon name={option.icon} /></span>
    <span className="game-tile__label">{option.label}</span>
  </span>;
}

/**
 * Coloured pads, Simon-style: each option is a pad with its own colour and note. Lit during a
 * pattern's playback on every screen; tappable only on the phone that builds the answer.
 */
export function Pads({ options, lit = null, onTap, disabled = false }: {
  options: InteractionOption[]; lit?: string | null; onTap?: (option: InteractionOption, tone: number) => void; disabled?: boolean;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const timer = window.setTimeout(() => setFlash(null), 240);
    return () => window.clearTimeout(timer);
  }, [flash]);
  return <div className="game-pads" data-count={options.length} aria-label={onTap ? undefined : "The pictures to choose from"} role={onTap ? undefined : "list"}>
    {options.map((option, i) => {
      const on = lit === option.id || flash === option.id;
      const body = <>
        <span className="game-pad__icon"><PaintedGlyph label={option.label} /><Icon name={option.icon} /></span>
        <span className="game-pad__label">{option.label}</span>
      </>;
      return onTap
        ? <button key={option.id} type="button" className="game-pad game-option kad-focusable" data-tone={i % 4} data-lit={on} disabled={disabled}
          onClick={() => { setFlash(option.id); padNote(i); buzz(12); onTap(option, i); }}>{body}</button>
        : <span key={option.id} role="listitem" className="game-pad" data-tone={i % 4} data-lit={on}>{body}</span>;
    })}
  </div>;
}

/** The sliding marker and its gold stretch, for precision aiming. Freezes where the tap stopped it. */
export function Meter({ prompt, now, prop, stop = null }: { prompt: InteractionPrompt; now: number; prop?: string; stop?: number | null }) {
  if (prompt.spec.kind !== "precision") return null;
  const spec = prompt.spec;
  const width = Math.min(1, spec.width * (prompt.relaxed ? 2 : 1));
  const left = Math.max(0, spec.target - width / 2);
  const right = Math.min(1, spec.target + width / 2);
  const start = Date.parse(prompt.startedAt ?? new Date(now).toISOString());
  const at = (t: number) => precisionPosition(t - start, spec.periodMs);
  const position = stop ?? at(now);
  const inGold = precisionSuccess(spec, position, prompt.relaxed);
  // A short trail behind the marker, so which way it is going reads at a glance.
  const trail = stop === null ? [70, 140, 210].map((ms) => at(now - ms)) : [];
  return <div className="story-interaction__track game-track" role="img" aria-label="Moving marker with a gold target" data-gold={inGold}
    data-stopped={stop !== null ? (inGold ? "hit" : "miss") : undefined}>
    <span className="story-interaction__target game-track__gold" style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}><Icon name="star" /></span>
    {trail.map((ghost, i) => <span key={i} className="game-track__ghost" style={{ left: `${ghost * 100}%`, opacity: 0.35 - i * 0.1 }} />)}
    <span className={`story-interaction__marker game-track__marker${prop ? " game-track__marker--prop" : ""}`} style={{ left: `${position * 100}%` }}>
      {prop ? <Prop id={prop} className="game-track__prop" /> : null}
    </span>
    {stop !== null ? <span className="game-track__splat" style={{ left: `${position * 100}%` }} aria-hidden="true">{inGold ? "THUNK!" : "boing"}</span> : null}
  </div>;
}

/**
 * How close a wait/now marker is to its window, 0 (far) to 1 (at the edge), so the lamp can fill
 * as NOW comes instead of switching from nothing. Pure, and tested beside the copy.
 */
export function approach(position: number, target: number, width: number): number {
  const gap = Math.abs(position - target) - width / 2;
  if (gap <= 0) return 1;
  const far = Math.max(target, 1 - target) - width / 2;
  return far <= 0 ? 1 : Math.max(0, Math.min(1, 1 - gap / far));
}

/** The lamp's state at a moment: on NOW, nearly there, or waiting, and how full its ring is. */
export function lampAt(prompt: InteractionPrompt, now: number): { safe: boolean; soon: boolean; fill: number } {
  if (prompt.spec.kind !== "timing") return { safe: false, soon: false, fill: 0 };
  const spec = prompt.spec;
  const position = precisionPosition(now - Date.parse(prompt.startedAt ?? new Date(now).toISOString()), spec.periodMs);
  const safe = precisionSuccess(spec, position, prompt.relaxed);
  const fill = safe ? 1 : approach(position, spec.target, Math.min(1, spec.width * (prompt.relaxed ? 2 : 1)));
  return { safe, soon: !safe && fill > 0.6, fill };
}

function Lamp({ prompt, now, hit }: { prompt: InteractionPrompt; now: number; hit?: boolean }) {
  const { safe, soon, fill } = lampAt(prompt, now);
  return <span className="story-interaction__signal game-lamp" data-safe={safe} data-soon={soon} data-hit={hit || undefined} role="img" aria-label={safe ? "Now!" : "Wait"}
    style={{ "--fill": `${Math.round(fill * 360)}deg` } as CSSProperties}>
    <span className="game-lamp__light"><span className="game-lamp__ring" aria-hidden="true" /><Icon name={safe ? "boot" : "eye"} /></span>
    <strong className="game-lamp__word">{safe ? "NOW!" : soon ? "Get ready…" : "Wait…"}</strong>
  </span>;
}

/** The numbered boxes the lead's answer fills, one tile popping in at a time. */
function Slots({ answer, length, options }: { answer: string[]; length: number; options: InteractionOption[] }) {
  return <ol className="game-row game-row--slots" aria-label="The order so far">{Array.from({ length }, (_, i) => {
    const o = answer[i] ? options.find((option) => option.id === answer[i]) : undefined;
    return <li key={i} className={o ? "game-slot game-slot--full" : "game-slot"}>{o ? <Tile key={o.id} option={o} index={i + 1} tone={toneOf(options, o.id)} /> : <span className="game-slot__number">{i + 1}</span>}</li>;
  })}</ol>;
}

const STILL_NOTE = <p className="game-note"><Icon name="hand" /> Moving parts are switched off. Take a helping hand to get past this one.</p>;

/** The same observation surface on TV and phone; it never sends an intent. */
export function Board({ prompt, party, now, answer = [], playerId, stop = null }: BoardProps) {
  const chapter = useChapter();
  const state = useRunState();
  const appearance = interactionAppearance(chapter?.id === state?.chapterId ? chapter : null, state?.sceneId);
  const spec = prompt.spec;
  const connectedMembers = party.filter((member) => member.connected);
  const connected = connectedMembers.map((member) => member.playerId);
  const member = (id: string) => party.find((m) => m.playerId === id);
  const name = (id: string) => member(id)?.character.name ?? "Your friend";
  const elapsed = Math.max(0, now - Date.parse(prompt.startedAt ?? new Date(now).toISOString()));
  const still = reducedMotion();
  const active = prompt.phase === "active";
  const bells = state?.sceneId === "song_track";
  const painted = appearance !== null;
  const view = { prompt, party, connected, now };
  const leadId = interactionActor(prompt, connected);
  const lead = name(leadId ?? "");
  /** This screen builds the answer: the lead's phone. The TV and the other phones see the choices instead. */
  const building = playerId !== undefined && playerId === leadId;
  const object = appearance?.props?.find((id) => !id.startsWith("note-"));
  switch (spec.kind) {
    case "precision":
      if (!active) return null;
      return still ? STILL_NOTE : <><Meter prompt={prompt} now={now} prop={object} stop={stop} /><p className="game-note">Tap when the marker is in the gold.</p></>;
    case "timing":
      if (!active) return null;
      return still ? STILL_NOTE : <div className="game-lamp-stage"><Lamp prompt={prompt} now={now} /></div>;
    case "tracking": {
      if (!active) return null;
      const labels = trackingLabels(spec.covers, appearance?.coverIcons);
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const progress = still || prompt.relaxed ? spec.swaps.length : Math.max(0, (elapsed - step) / step);
      const done = Math.min(spec.swaps.length, Math.floor(progress));
      const positions = spec.covers.map((_, index) => index);
      for (const [a, b] of spec.swaps.slice(0, done)) {
        for (let i = 0; i < positions.length; i++) positions[i] = positions[i] === a ? b : positions[i] === b ? a : positions[i]!;
      }
      const swap = spec.swaps[done];
      const moving = !still && !prompt.relaxed && swap !== undefined && progress > 0;
      return <div className={"story-interaction__covers" + (painted ? " story-interaction__covers--painted" : "")} role="img" aria-label={elapsed < step && !still ? "Watch the glowing object before the covers move" : "Follow the moving covers"}>
        {spec.covers.map((label, index) => {
          const at = positions[index]!;
          const destination = swap ? at === swap[0] ? swap[1] : at === swap[1] ? swap[0] : at : at;
          const t = progress - done;
          const position = at + (destination - at) * t;
          // Swapping covers hop over each other instead of sliding through: one up, one down.
          const hop = moving && destination !== at ? Math.sin(Math.PI * t) * (destination > at ? -1 : 0.4) : 0;
          const reveal = (!prompt.relaxed && !still && elapsed < step && index === spec.start) || ((still || prompt.relaxed) && at === trackedCover(spec));
          return <span className="story-interaction__cover" key={index} style={{ left: `${(position + 0.5) / spec.covers.length * 100}%`, translate: `0 ${(hop * 1.4).toFixed(2)}em` }}>
            {painted ? <PaintedCover bells={bells} icon={appearance?.coverIcons?.[index]} target={appearance?.props?.[0]} diving={elapsed > step * .5 && elapsed < step} reveal={reveal} /> : <span aria-hidden="true" className={reveal ? "game-cover game-cover--glow" : "game-cover"}>{reveal ? "✦" : "▰"}</span>}
          </span>;
        })}
        {labels.map((label, index) => <span className="story-interaction__cover story-interaction__cover-label" key={`label:${index}`} style={{ left: `${(index + 0.5) / spec.covers.length * 100}%` }}><small>{label}</small></span>)}
        {(still || prompt.relaxed) && <span className="story-interaction__tracking-help">The glow waits under: {labels[trackedCover(spec)]}.</span>}
      </div>;
    }
    case "memory": {
      if (!active) return null;
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const index = Math.floor(elapsed / step);
      const visible = prompt.relaxed || still;
      const option = (id: string) => spec.options.find((o) => o.id === id);
      if (visible) {
        return <div className="story-interaction__memory game-memory" aria-label="Magic pattern">
          <p className="game-note">The pattern stays on screen. Copy it in this order:</p>
          <ol className="game-row">{spec.answer.map((id, i) => { const o = option(id); return o ? <li key={i}><Tile option={o} index={i + 1} tone={toneOf(spec.options, id)} /></li> : null; })}</ol>
          {building && <Slots answer={answer} length={spec.answer.length} options={spec.options} />}
        </div>;
      }
      if (index < spec.answer.length) {
        const lit = litStep(elapsed, step, spec.answer.length);
        return <div className="story-interaction__memory game-memory game-memory--playing" aria-label="Magic pattern">
          <p className="game-note">Watch and remember…</p>
          <Pads options={spec.options} lit={lit === null ? null : spec.answer[lit] ?? null} />
          <p className="game-dots" aria-label={`${index + 1} of ${spec.answer.length}`}>{spec.answer.map((_, i) => <span key={i} className={i <= index ? "game-dots__dot game-dots__dot--on" : "game-dots__dot"} />)}<small> {index + 1} of {spec.answer.length}</small></p>
        </div>;
      }
      return <div className="story-interaction__memory game-memory" aria-label="Magic pattern">
        <p className="game-note game-note--big">{building ? "Now copy it!" : `Now ${lead} copies it!`}</p>
        {building ? <Slots answer={answer} length={spec.answer.length} options={spec.options} />
          : <><Pads options={spec.options} /><p className="game-note game-note--dim">{lead} taps the {spec.answer.length} pads on their phone. Say the order out loud to help!</p></>}
      </div>;
    }
    case "sequence": {
      if (!active) return null;
      const mine = playerId ? interactionClues(prompt, playerId, connected) : [];
      return <div className="game-sequence">
        {playerId ? (mine.length > 0 && <div className="game-clue"><span className="game-clue__eyebrow"><Icon name="scroll" /> Your clue{mine.length > 1 ? "s" : ""}. Read {mine.length > 1 ? "them" : "it"} out loud!</span><ul>{mine.map((clue, i) => <li key={i}>{clue}</li>)}</ul></div>)
          : <p className="game-note"><Icon name="phone" /> Every phone holds a clue. Put them together to find the order.</p>}
        {building ? <Slots answer={answer} length={spec.answer.length} options={spec.options} />
          : <><Pads options={spec.options} /><p className="game-note game-note--dim">{lead} puts the {spec.answer.length} steps in order on their phone.</p></>}
      </div>;
    }
    case "balance": {
      if (!active) return null;
      const levels = connected.map((id) => prompt.levels?.[id] ?? 0);
      const tilt = levels.length > 1 ? (levels[levels.length - 1]! - levels[0]!) * 24 : (levels[0]! - 0.5) * 30;
      const ready = balanceReady(prompt, connected);
      const window = prompt.relaxed ? 0.25 : 0.125;
      return <div className="game-balance" data-ready={ready}>
        <div className="game-seesaw">
          <div className="story-interaction__balance game-beam" style={{ transform: still ? undefined : `rotate(${tilt.toFixed(1)}deg)` }}>
            {object ? <Prop id={object} className="game-beam__load" /> : null}
            <span className="game-beam__label"><Icon name="hand" /> {spec.objectLabel}</span>
          </div>
          <span className="game-seesaw__pivot" aria-hidden="true" />
        </div>
        <ul className="game-gauges">{connectedMembers.map((m) => {
          const level = prompt.levels?.[m.playerId] ?? 0;
          const ok = Math.abs(level - 0.5) <= window;
          const word = ok ? "Just right" : level < 0.5 ? "Too low" : "Too high";
          return <li key={m.playerId} className={`game-gauge${ok ? " game-gauge--ok" : ""}`}>
            <span className="game-gauge__well"><span className="game-gauge__middle" /><span className="game-gauge__fill" style={{ height: `${Math.round(level * 100)}%` }} /></span>
            <span className="game-gauge__name">{m.character.name}</span>
            <span className="game-gauge__word">{word}</span>
          </li>;
        })}</ul>
        <p role="status" className="game-note">{ready ? "Steady together!" : "Bring everyone’s side to the middle."}</p>
      </div>;
    }
    case "relay": {
      if (!active) return null;
      const holder = relayHolder(prompt, connected);
      const order = [...prompt.playerIds, ...connected.filter((id) => !prompt.playerIds.includes(id))].filter((id) => connected.includes(id));
      const token = object ? propUrl(object) : undefined;
      return <div className="story-interaction__spark game-relay">
        <ul className="game-heroes">{order.map((id) => { const m = member(id); if (!m) return null;
          const passed = prompt.passed?.includes(id);
          const has = holder === id && prompt.caughtBy === id;
          const coming = holder === id && !has;
          return <HeroChip key={id} member={m} tone={passed ? "done" : holder === id ? "on" : "off"} mark={passed ? "check" : undefined}
            token={holder === id ? token : undefined} air={coming} state={passed ? "passed it" : holder === id ? (has ? "has it!" : "catch it!") : "waiting"} />; })}
          <li className={`game-hero game-hero--goal${holder ? " game-hero--off" : " game-hero--on"}`}><span className="game-hero__face game-hero__face--goal">{!holder && object ? <Prop id={object} className="game-hero__token game-hero__token--home" /> : <Icon name="quest" />}</span><span className="game-hero__name">Finish</span></li>
        </ul>
        <p className="game-note" role="status"><Icon name="star" /> {holder ? `${spec.objectLabel}: ${name(holder)} ${prompt.caughtBy === holder ? "has it!" : "can catch it"}` : "It made it all the way!"}</p>
        <p className="game-note game-note--dim">{(prompt.passed ?? []).map(name).join(" → ") || "Everyone gets a turn."}</p>
      </div>;
    }
    case "cooperate": {
      if (!active) return null;
      const supporters = supportPlayers(prompt, connected);
      const nowIso = new Date(now).toISOString();
      const ready = supportsReady(prompt, connected, nowIso);
      const held = supporters.filter((id) => { const lease = prompt.supports[id]; return lease === null || (typeof lease === "string" && Date.parse(lease) > now); }).length;
      return <div className="game-cooperate" data-ready={ready}>
        {object ? <div className="game-lift" style={{ "--lift": supporters.length ? held / supporters.length : 0 } as CSSProperties}><Prop id={object} className="game-lift__load" /></div> : null}
        <ul className="game-heroes">{connectedMembers.map((m) => {
          const supporting = supporters.includes(m.playerId);
          const lease = prompt.supports[m.playerId];
          const holding = supporting && (lease === null || (typeof lease === "string" && Date.parse(lease) > now));
          const isLead = m.playerId === leadId;
          return <HeroChip key={m.playerId} member={m} tone={holding ? "done" : supporting ? "off" : "on"} mark={holding ? "check" : isLead && !supporting ? "star" : undefined}
            strain={holding && lease !== null} state={supporting ? (holding ? (lease === null ? "propped" : "holding!") : "not yet") : "ready to go"} />;
        })}</ul>
        <p role="status" className="game-note">{ready ? "Holding steady!" : `${held} of ${supporters.length} holding…`}</p>
      </div>;
    }
    case "play": {
      if (!active) return null;
      const chosen = (id: string) => spec.options.find((o) => o.id === prompt.contributions?.[id]);
      const count = connected.filter((id) => prompt.contributions?.[id] !== undefined).length;
      return <div className="story-interaction__reactions game-play" aria-live="polite">
        <ul className="game-bubbles">{(prompt.reactions ?? []).slice(-3).map((reaction, index, shown) => {
          const who = member(reaction.playerId);
          return <li key={(prompt.taps ?? 0) - shown.length + index} className="game-bubble">
            {who ? <img className="game-bubble__face" src={characterWorldArtUrl(who.character.species, who.character.tier, who.character.class)} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
            <span><strong>{name(reaction.playerId)}:</strong> {reaction.text}</span>
          </li>;
        })}</ul>
        {(prompt.reactions ?? []).length === 0 && <p className="game-note game-note--dim">What you pick shows up here.</p>}
        {spec.participation === "everyone" && <>
          <ul className="game-heroes">{connectedMembers.map((m) => { const o = chosen(m.playerId); return <HeroChip key={m.playerId} member={m} tone={o ? "done" : "off"} mark={o ? "check" : undefined} state={o?.label ?? "choosing something"} />; })}</ul>
          <p className="game-note">{count} of {connected.length} friends have added something.</p>
        </>}
        {spec.participation === "any" && playReady(prompt, connected) && <p className="game-note">Everyone who wants a turn can have one.</p>}
      </div>;
    }
    default: return null;
  }
}

/** A drag lever for one side of a balance: five notches, the middle band glowing. */
function Lever({ level, window, busy, onStep }: { level: number; window: number; busy: boolean; onStep: (direction: "up" | "down", steps: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const notch = (event: ReactPointerEvent) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.height === 0) return level;
    const share = 1 - Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
    return Math.round(share * 4) / 4;
  };
  const shown = drag ?? level;
  const release = (target: number) => {
    setDrag(null);
    const steps = Math.round((target - level) * 4);
    if (steps !== 0) { buzz(Math.min(60, 12 * Math.abs(steps))); onStep(steps > 0 ? "up" : "down", Math.abs(steps)); }
  };
  return <div className="game-lever" data-ok={Math.abs(shown - 0.5) <= window}>
    <div ref={track} className="game-lever__track" aria-hidden="true"
      onPointerDown={(event) => { if (busy) return; event.currentTarget.setPointerCapture?.(event.pointerId); setDrag(notch(event)); }}
      onPointerMove={(event) => { if (drag === null) return; const next = notch(event); if (next !== drag) { setDrag(next); buzz(6); } }}
      onPointerUp={(event) => { if (drag !== null) release(notch(event)); }}
      onPointerCancel={() => setDrag(null)}>
      <span className="game-lever__band" style={{ bottom: `${(0.5 - window) * 100}%`, height: `${window * 200}%` }} />
      {[0, 0.25, 0.5, 0.75, 1].map((n) => <span key={n} className="game-lever__notch" style={{ bottom: `${n * 100}%` }} />)}
      <span className="game-lever__knob" style={{ bottom: `${shown * 100}%` }}><Icon name="hand" /></span>
    </div>
    <span className="game-lever__hint">Drag to the glow</span>
  </div>;
}

/** The thing you have, on a phone: catch it as it drops in, flick it up to pass it on. */
function Catcher({ object, caught, label, catchLabel, busy, onCatch, onPass }: {
  object?: string; caught: boolean; label: string; catchLabel: string; busy: boolean; onCatch: () => void; onPass: () => void;
}) {
  const [thrown, setThrown] = useState(false);
  const start = useRef<number | null>(null);
  const pass = () => { if (thrown || busy) return; setThrown(true); buzz([10, 30, 20]); window.setTimeout(onPass, reducedMotion() ? 0 : 260); };
  return <div className="game-catcher" data-caught={caught} data-thrown={thrown}>
    <div className="game-catcher__stage"
      onPointerDown={(event) => { if (!caught) return; start.current = event.clientY; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={(event) => { if (start.current !== null && start.current - event.clientY > 50) { start.current = null; pass(); } }}
      onPointerUp={() => { start.current = null; }}>
      {object ? <Prop key={caught ? "hand" : "air"} id={object} className="game-catcher__thing" /> : <span key={caught ? "hand" : "air"} className="game-catcher__thing game-catcher__thing--star"><Icon name="star" /></span>}
      {caught && <span className="game-catcher__hint" aria-hidden="true">↑ flick up to pass</span>}
    </div>
    {caught
      ? <Button variant="primary" size="lg" block icon={<Icon name="forward" />} className="story-interaction__button game-action game-action--go" disabled={busy || thrown} onClick={pass}>{label}</Button>
      : <Button variant="primary" size="lg" block icon={<Icon name="hand" />} className="story-interaction__button game-action game-action--catch" disabled={busy} onClick={() => { buzz(25); onCatch(); }}>{catchLabel}</Button>}
  </div>;
}

/** Little stickers that fly up off a play pick. */
function useStickers(): [{ id: number; icon: string; x: number }[], (icon: string, x: number) => void] {
  const [stickers, setStickers] = useState<{ id: number; icon: string; x: number }[]>([]);
  const next = useRef(0);
  const add = (icon: string, x: number) => {
    if (reducedMotion()) return;
    const id = next.current++;
    setStickers((current) => [...current.slice(-5), { id, icon, x }]);
    window.setTimeout(() => setStickers((current) => current.filter((sticker) => sticker.id !== id)), 1000);
  };
  return [stickers, add];
}

export interface KindControlsProps {
  prompt: InteractionPrompt; playerId: string; connected: readonly string[]; mine: boolean;
  now: number; busy: boolean; send: (action: InteractionAction) => void;
  answer: string[]; setAnswer: (update: (current: string[]) => string[]) => void;
  holding: boolean; setHolding: (holding: boolean) => void;
  /** Precision: where this phone's tap stopped the marker, for the board to freeze it. */
  setStop: (position: number) => void;
}

/** The phone's buttons for one kind of game, lead and helper alike. */
export function KindControls({ prompt, playerId, connected, mine, now, busy, send, answer, setAnswer, holding, setHolding, setStop }: KindControlsProps) {
  const chapter = useChapter();
  const state = useRunState();
  const appearance = interactionAppearance(chapter?.id === state?.chapterId ? chapter : null, state?.sceneId);
  const object = useObject();
  const [stickers, addSticker] = useStickers();
  const [tapped, setTapped] = useState(false);
  const spec = prompt.spec;
  const still = reducedMotion();
  const primary = (label: string, action: InteractionAction, icon: string, disabled = false, extra = "") =>
    <Button variant="primary" size="lg" block icon={<Icon name={icon} />} className={`story-interaction__button game-action${extra}`} disabled={busy || disabled} onClick={() => send(action)}>{label}</Button>;
  const secondary = (label: string, action: InteractionAction, icon: string, disabled = false) =>
    <Button variant="secondary" size="lg" block icon={<Icon name={icon} />} className="story-interaction__button game-action" disabled={busy || disabled} onClick={() => send(action)}>{label}</Button>;
  const positionNow = () => precisionPosition(Date.now() - Date.parse(prompt.startedAt ?? ""), spec.kind === "precision" || spec.kind === "timing" ? spec.periodMs : 1);
  switch (spec.kind) {
    case "precision":
      if (!mine || still) return null;
      // One big round pad, not a form button: the whole thing is the throw.
      return <button type="button" className="game-tap kad-focusable" aria-label={spec.actionLabel} disabled={busy || tapped}
        onClick={() => { const position = positionNow(); setTapped(true); setStop(position); buzz(precisionSuccess(spec, position, prompt.relaxed) ? [20, 40, 30] : 30); send({ action: "stop", position }); }}>
        <span className="game-tap__ring" aria-hidden="true" />
        <span className="game-tap__word">TAP!</span>
        <span className="game-tap__label">{spec.actionLabel}</span>
      </button>;
    case "timing":
      if (!mine || still) return null;
      // The lamp is the button: tap it when it says NOW.
      return <button type="button" className="game-tap game-tap--lamp kad-focusable" aria-label={spec.actionLabel} disabled={busy || tapped}
        onClick={() => { const position = positionNow(); setTapped(true); buzz(precisionSuccess(spec, position, prompt.relaxed) ? [20, 40, 30] : 30); send({ action: "stop", position }); }}>
        <Lamp prompt={prompt} now={now} hit={tapped} />
        <span className="game-tap__label">{spec.actionLabel}</span>
      </button>;
    case "tracking": {
      if (!mine) return null;
      const view = { prompt, party: [], connected, now };
      if (showing(view)) return <p className="game-note"><Icon name="tv" /> Keep your eyes on the covers…</p>;
      return <div className="game-options game-options--covers">{trackingLabels(spec.covers, appearance?.coverIcons).map((label, index) =>
        <Button key={index} variant="secondary" size="lg" block icon={<Icon name="eye" />} className="story-interaction__button game-action" disabled={busy} onClick={() => { buzz(15); send({ action: "answer", answer: [String(index)] }); }}>{`${spec.actionLabel}: ${label}`}</Button>)}</div>;
    }
    case "memory":
    case "sequence": {
      if (!mine) return null;
      const view = { prompt, party: [], connected, now };
      const locked = spec.kind === "memory" && showing(view);
      const full = answer.length >= spec.answer.length;
      if (locked) return <p className="game-note"><Icon name="tv" /> Watch the pads light up…</p>;
      return <>
        <Pads options={spec.options} disabled={busy || full} onTap={(option) => setAnswer((current) => current.length >= spec.answer.length ? current : [...current, option.id])} />
        <div className="game-actions-row">
          <Button variant="ghost" icon={<Icon name="back" />} className="story-interaction__button" disabled={busy || !answer.length} onClick={() => setAnswer((current) => current.slice(0, -1))}>Change last step</Button>
        </div>
        {primary(spec.actionLabel, { action: "answer", answer }, "check", answer.length !== spec.answer.length, full ? " game-action--go" : "")}
      </>;
    }
    case "balance": {
      const level = prompt.levels?.[playerId] ?? 0;
      const ready = balanceReady(prompt, connected);
      const step = (direction: "up" | "down", steps: number) => { for (let i = 0; i < steps; i++) send({ action: "adjust", direction }); };
      return <>
        <div className="game-balance-controls">
          {!still && <Lever level={level} window={prompt.relaxed ? 0.25 : 0.125} busy={busy} onStep={step} />}
          <div className="game-balance-controls__buttons">
            {secondary("Lift my side", { action: "adjust", direction: "up" }, "forward", level >= 1)}
            {secondary("Lower my side", { action: "adjust", direction: "down" }, "back", level <= 0)}
          </div>
        </div>
        {mine && primary(spec.actionLabel, { action: "complete" }, "check", !ready, ready ? " game-action--go" : "")}
      </>;
    }
    case "relay": {
      const holder = relayHolder(prompt, connected);
      if (!holder) return mine ? primary(spec.actionLabel, { action: "complete" }, "check", false, " game-action--go") : null;
      if (holder !== playerId) return null;
      return <Catcher key={prompt.caughtBy === playerId ? "caught" : "coming"} object={object} caught={prompt.caughtBy === playerId} label={spec.actionLabel} catchLabel={`Catch ${spec.objectLabel}`} busy={busy}
        onCatch={() => send({ action: "catch" })} onPass={() => send({ action: "pass" })} />;
    }
    case "cooperate": {
      const supporter = supportPlayers(prompt, connected).includes(playerId);
      const propped = prompt.supports[playerId] === null;
      const nowIso = new Date(now).toISOString();
      const ready = supportsReady(prompt, connected, nowIso);
      return <>
        {supporter && (prompt.relaxed || connected.length === 1
          ? secondary(propped ? "Remove support" : spec.supportLabel, { action: "support", mode: propped ? "release" : "prop" }, propped ? "close" : "hand")
          : <button type="button" className="kad-button kad-button--secondary kad-button--lg kad-button--block story-interaction__button story-interaction__hold game-action game-hold kad-focusable" aria-pressed={holding}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); buzz(20); setHolding(true); }}
            onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)} onLostPointerCapture={() => setHolding(false)} onBlur={() => setHolding(false)}
            onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHolding(true); } }}
            onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHolding(false); } }}>
            <span className="game-hold__grip" aria-hidden="true" />
            <span className="kad-button__icon" aria-hidden="true"><Icon name="hand" /></span>
            <span className="kad-button__label">{holding ? "I’ve got it!" : spec.supportLabel}</span>
            <span className="game-hold__hint" aria-hidden="true">{holding ? "keep holding" : "press and hold"}</span>
          </button>)}
        {supporter && !prompt.relaxed && connected.length > 1 && <div className="game-actions-row">
          <Button variant="ghost" icon={<Icon name="hand" />} className="story-interaction__button" disabled={busy || holding || propped} onClick={() => send({ action: "support", mode: "prop" })}>Use a prop instead</Button>
        </div>}
        {mine && primary(spec.actionLabel, { action: "complete" }, "check", !ready, ready ? " game-action--go" : "")}
      </>;
    }
    case "play":
      return <>
        <div className="game-options game-options--grid game-options--play">
          {spec.options.map((option, i) => <button key={option.id} type="button" className="story-interaction__button game-option kad-focusable" data-tone={i % 4} disabled={busy}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const parent = event.currentTarget.parentElement?.getBoundingClientRect();
              addSticker(option.icon, parent && parent.width ? ((box.left + box.width / 2 - parent.left) / parent.width) * 100 : 50);
              padNote(i); buzz(15); send({ action: "play", optionId: option.id });
            }}>
            <span className="game-option__icon"><Icon name={option.icon} /></span>
            <span className="game-option__label">{option.label}</span>
          </button>)}
          {stickers.map((sticker) => <span key={sticker.id} className="game-sticker" style={{ left: `${sticker.x}%` }} aria-hidden="true"><Icon name={sticker.icon} /></span>)}
        </div>
        {mine && primary(spec.actionLabel, { action: "complete" }, "check", !playReady(prompt, connected), playReady(prompt, connected) ? " game-action--go" : "")}
      </>;
    default: return null;
  }
}
