/**
 * The board (what a game looks like, read-only, the same on the TV and every phone) and the
 * per-kind controls a phone adds under it. StoryInteraction.tsx frames these; nothing here sends
 * an intent on its own, the frame hands `send` down.
 *
 * Each kind is a small game, not a form: a pad to TAP, a lamp to hit on NOW, coloured pads that
 * sing a pattern, a thing to catch and flick on, a lever to drag level, a button to grip, picks
 * that fly off as stickers. The server validates participation and decides when the shared action is complete.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useChapter, useRunState } from "../store";
import { interactionAppearance } from "../world/riftlight-art";
import { characterWorldArtUrl } from "../world/art-paths";
import { PaintedCover, PaintedGlyph, propUrl } from "./InteractionArt";
import { balanceLift, cooperationProgress, balanceReady, interactionActor, interactionClues, playReady, precisionPosition, precisionSuccess, relayHolder, supportPlayers, supportsReady, trackedCover } from "@kad/shared";
import type { InteractionAction, InteractionOption, InteractionPrompt, PartyMember } from "@kad/shared";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";
import { Button } from "../ui/Button";
import { RelayCatcher, RelayWorld, relaySeats } from "./RelayGame";
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
  settled?: boolean;
  busy?: boolean;
  onCover?: (index: number) => Promise<boolean>;
}

/** The authored object a board can carry: the first prop that is not a musical note. */
function useObject(): string | undefined {
  const chapter = useChapter();
  const state = useRunState();
  const appearance = interactionAppearance(chapter?.id === state?.chapterId ? chapter : null, state?.sceneId);
  return appearance?.props?.find((id) => !id.startsWith("note-"));
}

function Prop({ id, className }: { id: string; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  return failed ? <span className={`${className} game-prop-fallback`} aria-hidden="true"><Icon name="star" /></span>
    : <img className={className} src={propUrl(id)} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

function HeroChip({ member, state, tone, mark, strain }: {
  member: PartyMember; state?: string; tone?: "on" | "done" | "off"; mark?: string;
  strain?: boolean;
}) {
  return <li className={`game-hero${tone ? ` game-hero--${tone}` : ""}${strain ? " game-hero--strain" : ""}`}>
    <span className="game-hero__face">
      <img src={characterWorldArtUrl(member.character.species, member.character.tier, member.character.class)} alt="" decoding="async" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
      {mark ? <span className="game-hero__mark" key={mark}><Icon name={mark} /></span> : null}
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
  return <div className="story-interaction__track game-track" role="img" aria-label={stop === null ? "Moving marker with a gold target" : "Stopped marker with a gold target"} data-gold={inGold}
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
  const position = prompt.stopPosition ?? precisionPosition(now - Date.parse(prompt.startedAt ?? new Date(now).toISOString()), spec.periodMs);
  const safe = precisionSuccess(spec, position, prompt.relaxed);
  const fill = safe ? 1 : approach(position, spec.target, Math.min(1, spec.width * (prompt.relaxed ? 2 : 1)));
  return { safe, soon: !safe && fill > 0.6, fill };
}

function Lamp({ prompt, now, hit, object }: { prompt: InteractionPrompt; now: number; hit?: boolean; object?: string }) {
  const { safe, soon, fill } = lampAt(prompt, now);
  return <span className="story-interaction__signal game-lamp" data-safe={safe} data-soon={soon} data-hit={hit || undefined} role="img" aria-label={safe ? "Now!" : "Wait"}
    style={{ "--fill": `${Math.round(fill * 360)}deg` } as CSSProperties}>
    <span className="game-lamp__light"><span className="game-lamp__ring" aria-hidden="true" />{object ? <Prop id={object} className="game-lamp__object" /> : <Icon name={safe ? "boot" : "eye"} />}</span>
    <strong className="game-lamp__word">{safe ? "NOW!" : soon ? "Get ready…" : "Wait…"}</strong>
  </span>;
}

/** The numbered boxes the lead's answer fills, one tile popping in at a time. */
function Slots({ answer, length, options, onRemove, busy }: { answer: string[]; length: number; options: InteractionOption[]; onRemove?: (index: number) => void; busy?: boolean }) {
  return <ol className="game-row game-row--slots" aria-label="The order so far">{Array.from({ length }, (_, i) => {
    const o = answer[i] ? options.find((option) => option.id === answer[i]) : undefined;
    return <li key={i} className={o ? "game-slot game-slot--full" : "game-slot"}>{o ? onRemove ? <button type="button" className="game-slot__edit kad-focusable" disabled={busy} aria-label={`Remove step ${i + 1}: ${o.label}`} onClick={() => onRemove(i)}><Tile option={o} index={i + 1} tone={toneOf(options, o.id)} /><Icon name="close" /></button> : <Tile key={o.id} option={o} index={i + 1} tone={toneOf(options, o.id)} /> : <span className="game-slot__number">{i + 1}</span>}</li>;
  })}</ol>;
}

const STILL_NOTE = <p className="game-note"><Icon name="hand" /> Moving parts are switched off. Take a helping hand to get past this one.</p>;

/** The same observation surface on TV and phone; it never sends an intent. */
export function Board({ prompt, party, now, answer = [], playerId, stop = null, settled = true, busy, onCover }: BoardProps) {
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
      if (building && active && !still) return null;
      if (!active && prompt.stopPosition === undefined && stop === null) return null;
      return still ? STILL_NOTE : <><Meter prompt={prompt} now={now} prop={object} stop={prompt.stopPosition ?? stop} /><p className="game-note">{active ? "Tap when the marker is in the gold." : "This is where your tap landed."}</p></>;
    case "timing":
      if (!active && prompt.stopPosition === undefined) return null;
      if (building && active && !still) return null;
      return still ? STILL_NOTE : <><div className="game-lamp-stage"><Lamp prompt={prompt} now={now} object={object} /></div>{!active && <p className="game-note">This is the moment you tapped.</p>}</>;
    case "tracking": {
      if (!active && prompt.phase !== "result") return null;
      const labels = trackingLabels(spec.covers, appearance?.coverIcons);
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const progress = still || prompt.relaxed || !active ? spec.swaps.length : Math.max(0, (elapsed - step) / step);
      const done = Math.min(spec.swaps.length, Math.floor(progress));
      const positions = spec.covers.map((_, index) => index);
      for (const [a, b] of spec.swaps.slice(0, done)) {
        for (let i = 0; i < positions.length; i++) positions[i] = positions[i] === a ? b : positions[i] === b ? a : positions[i]!;
      }
      const swap = spec.swaps[done];
      const moving = !still && !prompt.relaxed && swap !== undefined && progress > 0;
      if ((building && !showing(view)) || prompt.phase === "result") {
        const picked = Number((prompt.submittedAnswer ?? answer)[0] ?? -1);
        return <div className="game-cover-choices" style={{ "--cover-count": labels.length } as CSSProperties}>{labels.map((label, slot) => {
          const source = positions.indexOf(slot);
          const correct = slot === trackedCover(spec);
          const reveal = (!active && correct) || ((still || prompt.relaxed) && correct);
          const body = <><PaintedCover bells={bells} icon={appearance?.coverIcons?.[source] ?? (painted ? undefined : "prop_brass_cup")} target={appearance?.props?.[0]} reveal={reveal} raised={!active && (correct || picked === slot)} /><strong>{label}</strong>{!active && <small>{correct ? "Found it!" : picked === slot ? "Your pick" : ""}</small>}</>;
          return active ? <button key={slot} type="button" className="game-cover-pick kad-focusable" aria-label={`${spec.actionLabel}: ${label}`} disabled={busy} data-picked={picked === slot} onClick={() => { buzz(15); void onCover?.(slot); }}>{body}</button>
            : <div key={slot} className="game-cover-pick" data-picked={picked === slot} data-correct={correct}>{body}</div>;
        })}</div>;
      }
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
            <PaintedCover bells={bells} icon={appearance?.coverIcons?.[index] ?? (painted ? undefined : "prop_brass_cup")} target={appearance?.props?.[0]} diving={elapsed > step * .5 && elapsed < step} reveal={reveal} />
          </span>;
        })}
        {labels.map((label, index) => <span className="story-interaction__cover story-interaction__cover-label" key={`label:${index}`} style={{ left: `${(index + 0.5) / spec.covers.length * 100}%` }}><small>{label}</small></span>)}
        {(still || prompt.relaxed) && <span className="story-interaction__tracking-help">The glow waits under: {labels[trackedCover(spec)]}.</span>}
      </div>;
    }
    case "memory": {
      if (!active && prompt.phase !== "result") return null;
      if (!active) return <Slots answer={prompt.submittedAnswer ?? []} length={spec.answer.length} options={spec.options} />;
      if (building && !prompt.relaxed && !still) return null;
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const index = Math.floor(elapsed / step);
      const visible = prompt.relaxed || still;
      const option = (id: string) => spec.options.find((o) => o.id === id);
      if (visible) {
        return <div className="story-interaction__memory game-memory" aria-label="Magic pattern">
          <p className="game-note">The pattern stays on screen. Copy it in this order:</p>
          <ol className="game-row">{spec.answer.map((id, i) => { const o = option(id); return o ? <li key={i}><Tile option={o} index={i + 1} tone={toneOf(spec.options, id)} /></li> : null; })}</ol>

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
        {building ? null
          : <><Pads options={spec.options} /><p className="game-note game-note--dim">{lead} taps the {spec.answer.length} pads on their phone. Say the order out loud to help!</p></>}
      </div>;
    }
    case "sequence": {
      if (!active && prompt.phase !== "result") return null;
      if (!active) return <Slots answer={prompt.submittedAnswer ?? []} length={spec.answer.length} options={spec.options} />;
      const mine = playerId ? interactionClues(prompt, playerId, connected) : [];
      return <div className="game-sequence">
        {playerId ? (mine.length > 0 && <div className="game-clue"><span className="game-clue__eyebrow"><Icon name="scroll" /> Your clue{mine.length > 1 ? "s" : ""}. Read {mine.length > 1 ? "them" : "it"} out loud!</span><ul>{mine.map((clue, i) => <li key={i}>{clue}</li>)}</ul></div>)
          : <p className="game-note"><Icon name="phone" /> Every phone holds a clue. Put them together to find the order.</p>}
        {building ? null
          : <><Pads options={spec.options} /><p className="game-note game-note--dim">{lead} puts the {spec.answer.length} steps in order on their phone.</p></>}
      </div>;
    }
    case "balance": {
      if (!active && prompt.phase !== "result") return null;
      const levels = connected.map((id) => prompt.levels?.[id] ?? 0);
      const lift = balanceLift(prompt, connected);
      const tilt = (lift - 0.5) * 45;
      const ready = balanceReady(prompt, connected);
      return <div className="game-balance" data-ready={ready}>
        <div className="game-seesaw">
          <div className="story-interaction__balance game-beam" style={{ transform: still ? undefined : `rotate(${tilt.toFixed(1)}deg)` }}>
            {object ? <Prop id={object} className="game-beam__load" /> : null}
            <span className="game-beam__label"><Icon name="hand" /> {spec.objectLabel}</span>
          </div>
          <span className="game-seesaw__pivot" aria-hidden="true" />
        </div>
        <p className="game-note">Our shared lift</p>
        <div className="game-team-meter" role="meter" aria-label="Our shared lift" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lift * 100)}>
          <span className="game-team-meter__gold" style={{ left: `${(0.5 - (prompt.relaxed ? 0.25 : 0.125) / Math.max(1, connected.length)) * 100}%`, width: `${(prompt.relaxed ? 0.5 : 0.25) / Math.max(1, connected.length) * 100}%` }} />
          <span className="game-team-meter__marker" style={{ left: `${lift * 100}%` }} />
        </div>
        <ul className="game-gauges">{connectedMembers.map((m) => {
          const level = prompt.levels?.[m.playerId] ?? 0;
          const ok = level > 0;
          const word = ok ? "Lifting!" : "Join the lift";
          return <li key={m.playerId} className={`game-gauge${ok ? " game-gauge--ok" : ""}`}>
            <span className="game-gauge__well"><span className="game-gauge__fill" style={{ height: `${Math.round(level * 100)}%` }} /></span>
            <span className="game-gauge__name">{m.character.name}</span>
            <span className="game-gauge__word">{word}</span>
          </li>;
        })}</ul>
        <p role="status" className="game-note">{ready ? "Steady together!" : levels.some((level) => level === 0) ? "Everyone lift a little. Bring the shared marker into the gold." : lift < 0.5 ? "A little more lift! Someone lift higher." : "Too much lift! Someone ease down."}</p>
      </div>;
    }
    case "relay": {
      if (playerId && relayHolder(prompt, connected) === playerId && active) return null;
      return <RelayWorld prompt={prompt} party={party} object={object} settled={settled} />;
    }
    case "cooperate": {
      if (!active && prompt.phase !== "result") return null;
      const supporters = supportPlayers(prompt, connected);
      const nowIso = new Date(now).toISOString();
      const ready = supportsReady(prompt, connected, nowIso);
      const progress = cooperationProgress(prompt, connected, nowIso);
      const held = supporters.filter((id) => { const lease = prompt.supports[id]; return lease === null || (typeof lease === "string" && Date.parse(lease) > now); }).length;
      return <div className="game-cooperate" data-ready={ready}>
        {(!playerId || !active) && <div className="game-lift" style={{ "--lift": progress } as CSSProperties}>
          <span className="game-lift__goal"><Icon name="star" /></span>
          {object ? <Prop id={object} className="game-lift__load" /> : <span className="game-lift__load game-lift__fallback"><Icon name="party" /></span>}
        </div>}
        <div className="game-team-progress" role="progressbar" aria-label="Lifting together" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>
        <ul className="game-heroes">{connectedMembers.map((m) => {
          const supporting = supporters.includes(m.playerId);
          const lease = prompt.supports[m.playerId];
          const finished = prompt.phase === "result" && prompt.outcome === "success";
          const holding = finished || (supporting && (lease === null || (typeof lease === "string" && Date.parse(lease) > now)));
          const isLead = m.playerId === leadId;
          return <HeroChip key={m.playerId} member={m} tone={holding ? "done" : supporting ? "off" : "on"} mark={holding ? "check" : isLead && !supporting ? "star" : undefined}
            strain={holding && !finished && lease !== null} state={finished ? "lifted!" : supporting ? (holding ? (lease === null ? "propped" : "holding!") : "not yet") : "ready to go"} />;
        })}</ul>
        <p role="status" className="game-note">{prompt.phase === "result" ? "Up it goes!" : ready ? "Keep holding together. Up it goes!" : `${held} of ${supporters.length} holding. Join in!`}</p>
      </div>;
    }
    case "play": {
      if (!active && prompt.phase !== "result") return null;
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

/** Five lift notches per hero; the goal belongs to the shared load, not this lever. */
function Lever({ level, busy, onStep }: { level: number; busy: boolean; onStep: (direction: "up" | "down", steps: number) => void }) {
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
  return <div className="game-lever" data-lifting={shown > 0}>
    <div ref={track} className="game-lever__track" aria-hidden="true"
      onPointerDown={(event) => { if (busy) return; event.currentTarget.setPointerCapture?.(event.pointerId); setDrag(notch(event)); }}
      onPointerMove={(event) => { if (drag === null) return; const next = notch(event); if (next !== drag) { setDrag(next); buzz(6); } }}
      onPointerUp={(event) => { if (drag !== null) release(notch(event)); }}
      onPointerCancel={() => setDrag(null)}>
      {[0, 0.25, 0.5, 0.75, 1].map((n) => <span key={n} className="game-lever__notch" style={{ bottom: `${n * 100}%` }} />)}
      <span className="game-lever__knob" style={{ bottom: `${shown * 100}%` }}><Icon name="hand" /></span>
    </div>
    <span className="game-lever__hint">Drag to lift or lower</span>
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
  now: number; busy: boolean; send: (action: InteractionAction) => Promise<boolean>;
  answer: string[]; setAnswer: (update: (current: string[]) => string[]) => void;
  holding: boolean; setHolding: (holding: boolean) => void;
  /** Precision: where this phone's tap stopped the marker, for the board to freeze it. */
  setStop: (position: number | null) => void;
}

/** The phone's buttons for one kind of game, lead and helper alike. */
export function KindControls({ prompt, playerId, connected, mine, now, busy, send, answer, setAnswer, holding, setHolding, setStop }: KindControlsProps) {
  const state = useRunState();
  const object = useObject();
  const [stickers, addSticker] = useStickers();
  const [tapped, setTapped] = useState<number | null>(null);
  const spec = prompt.spec;
  const still = reducedMotion();
  const primary = (label: string, action: InteractionAction, icon: string, disabled = false, extra = "") =>
    <Button variant="primary" size="lg" block icon={<Icon name={icon} />} className={`story-interaction__button game-action${extra}`} disabled={busy || disabled} onClick={() => send(action)}>{label}</Button>;
  const secondary = (label: string, action: InteractionAction, icon: string, disabled = false) =>
    <Button variant="secondary" size="lg" block icon={<Icon name={icon} />} className="story-interaction__button game-action" disabled={busy || disabled} onClick={() => send(action)}>{label}</Button>;
  const positionNow = () => precisionPosition(Date.now() - Date.parse(prompt.startedAt ?? ""), spec.kind === "precision" || spec.kind === "timing" ? spec.periodMs : 1);
  switch (spec.kind) {
    case "precision":
    case "timing": {
      if (!mine || still) return null;
      const takeShot = async () => {
        if (busy || tapped !== null) return;
        const position = positionNow(); setTapped(position); setStop(position);
        buzz(precisionSuccess(spec, position, prompt.relaxed) ? [20, 40, 30] : 30);
        try { if (await send({ action: "stop", position })) return; } catch { /* The control stays available after a failed send. */ }
        setTapped(null); setStop(null);
      };
      return <button type="button" className={`game-aim kad-focusable${spec.kind === "timing" ? " game-tap game-tap--lamp" : ""}`} aria-label={spec.actionLabel} disabled={busy || tapped !== null}
        onPointerDown={(event) => { if (event.button === 0) void takeShot(); }}
        onClick={(event) => { if (event.detail === 0) void takeShot(); }}>
        {spec.kind === "precision" ? <Meter prompt={prompt} now={now} prop={object} stop={tapped} /> : <Lamp prompt={tapped === null ? prompt : { ...prompt, stopPosition: tapped }} now={now} hit={tapped !== null} object={object} />}
        <span className="game-tap__label">{spec.actionLabel}</span>
        {spec.kind === "precision" && <small>Touch the moving object when it reaches the gold</small>}
      </button>;
    }
    case "tracking": return null;
    case "memory":
    case "sequence": {
      if (!mine) return null;
      const view = { prompt, party: [], connected, now };
      const locked = spec.kind === "memory" && showing(view);
      const full = answer.length >= spec.answer.length;
      return <>
        <p className="game-answer-progress" role="status">{locked ? "Watch the pads light up!" : full ? "Ready! Check your order, then send it." : `${answer.length} of ${spec.answer.length} chosen`}</p>
        <Pads options={spec.options} lit={locked && !still && spec.kind === "memory" ? spec.answer[litStep(Math.max(0, now - Date.parse(prompt.startedAt ?? "")), spec.stepMs, spec.answer.length) ?? -1] ?? null : null} disabled={busy || full || locked} onTap={(option) => setAnswer((current) => current.length >= spec.answer.length ? current : [...current, option.id])} />
        {!locked && <><Slots answer={answer} length={spec.answer.length} options={spec.options} busy={busy} onRemove={(index) => setAnswer((current) => current.filter((_, i) => i !== index))} />
          {answer.length > 0 && <small className="game-note">Tap a chosen step to take it out.</small>}
          {primary(spec.actionLabel, { action: "answer", answer }, "check", !full, full ? " game-action--go" : "")}
        </>}
      </>;
    }
    case "balance": {
      const level = prompt.levels?.[playerId] ?? 0;
      const step = (direction: "up" | "down", steps: number) => send({ action: "adjust", direction, steps });
      return <>
        <div className="game-balance-controls">
          {!still && <Lever level={level} busy={busy} onStep={step} />}
          <div className="game-balance-controls__buttons">
            {secondary("Lift my side", { action: "adjust", direction: "up" }, "forward", level >= 1)}
            {secondary("Lower my side", { action: "adjust", direction: "down" }, "back", level <= 0)}
          </div>
        </div>

      </>;
    }
    case "relay": {
      const holder = relayHolder(prompt, connected);
      if (!holder) return null;
      if (holder !== playerId) return null;
      const order = relaySeats(prompt, state?.party ?? []);
      const next = order.find((id) => id !== holder && !prompt.passed?.includes(id));
      const nextName = state?.party.find((m) => m.playerId === next)?.character.name ?? "home";
      return <RelayCatcher object={object} caught={prompt.caughtBy === playerId} label={spec.actionLabel} catchLabel={`Catch ${spec.objectLabel}`} nextName={nextName} busy={busy}
        onCatch={() => send({ action: "catch" })} onPass={() => send({ action: "pass" })} />;
    }
    case "cooperate": {
      const propped = prompt.supports[playerId] === null;
      const toggle = prompt.relaxed || connected.length === 1;
      const progress = cooperationProgress(prompt, connected, new Date(now).toISOString());
      return <>
        <button type="button" className="kad-button kad-button--secondary kad-button--lg kad-button--block story-interaction__button story-interaction__hold game-action game-hold kad-focusable" aria-pressed={toggle ? propped : holding} disabled={busy && !holding}
          onClick={() => { if (toggle) void send({ action: "support", mode: propped ? "release" : "prop" }); }}
          onPointerDown={(event) => { if (toggle) return; event.currentTarget.setPointerCapture?.(event.pointerId); buzz(20); setHolding(true); }}
          onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)} onLostPointerCapture={() => setHolding(false)} onBlur={() => setHolding(false)}
          onKeyDown={(event) => { if (!toggle && (event.key === " " || event.key === "Enter")) { event.preventDefault(); setHolding(true); } }}
          onKeyUp={(event) => { if (!toggle && (event.key === " " || event.key === "Enter")) { event.preventDefault(); setHolding(false); } }}>
          <span className="game-hold__grip" aria-hidden="true" />
          <span className="game-lift" style={{ "--lift": progress } as CSSProperties} aria-hidden="true"><span className="game-lift__goal"><Icon name="star" /></span>{object ? <Prop id={object} className="game-lift__load" /> : <span className="game-lift__load game-lift__fallback"><Icon name="hand" /></span>}</span>
          <span className="kad-button__label">{toggle ? propped ? "Remove support" : spec.supportLabel : holding ? "I’ve got it!" : spec.supportLabel}</span>
          <span className="game-hold__hint" aria-hidden="true">{toggle ? "tap to prop it" : holding ? "keep holding" : "press and hold the object"}</span>
        </button>
        {!toggle && <div className="game-actions-row"><Button variant="ghost" icon={<Icon name="hand" />} disabled={busy || holding || propped} onClick={() => send({ action: "support", mode: "prop" })}>Use a prop instead</Button></div>}
      </>;
    }
    case "play":
      return <>
        <div className="game-options game-options--grid game-options--play">
          {spec.options.map((option, i) => <button key={option.id} type="button" className="story-interaction__button game-option kad-focusable" data-tone={i % 4} aria-pressed={prompt.contributions?.[playerId] === option.id} disabled={busy}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const parent = event.currentTarget.parentElement?.getBoundingClientRect();
              addSticker(option.icon, parent && parent.width ? ((box.left + box.width / 2 - parent.left) / parent.width) * 100 : 50);
              padNote(i); buzz(15); send({ action: "play", optionId: option.id });
            }}>
            <span className="game-option__icon">{spec.options.length === 1 && object ? <Prop id={object} className="game-play-object" /> : <Icon name={option.icon} />}</span>
            <span className="game-option__label">{option.label}</span>
          </button>)}
          {stickers.map((sticker) => <span key={sticker.id} className="game-sticker" style={{ left: `${sticker.x}%` }} aria-hidden="true"><Icon name={sticker.icon} /></span>)}
        </div>
        {mine && primary(spec.actionLabel, { action: "complete" }, "check", !playReady(prompt, connected), playReady(prompt, connected) ? " game-action--go" : "")}
      </>;
    default: return null;
  }
}
